import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileTypeFromBuffer } from 'file-type';
import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { getDatabase } from './db';
import {
  documentAssets,
  documents,
  documentType,
  chapters,
  modules,
  uploadSessions,
  users
} from './db/schema';
import { enqueueDocumentProcessing } from './jobs';
import { getStorage } from './storage';

const textExtensions = new Map([
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.csv', 'text/csv'],
  ['.json', 'application/json']
]);

const allowedBinaryTypes = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

export class InvalidUploadError extends Error {}
export class DuplicateUploadError extends Error {
  constructor(public readonly documentId: string) {
    super('This file has already been uploaded.');
  }
}
export class QuotaExceededError extends Error {
  constructor(
    public readonly usedBytes: number,
    public readonly quotaBytes: number,
    public readonly uploadBytes: number
  ) {
    super('This upload would exceed the storage quota.');
  }
}

export interface DocumentMetadata {
  title?: string | null;
  moduleId?: string | null;
  chapterId?: string | null;
  section?: string | null;
  type?: (typeof documentType.enumValues)[number];
  documentDate?: string | null;
  description?: string | null;
  tags?: string[];
  notebookName?: string | null;
  notebookNumber?: number | null;
  notebookPageRange?: string | null;
  organiseLater?: boolean;
}

export function maximumUploadBytes(): number {
  const configured = Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024);
  return Number.isFinite(configured)
    ? Math.min(Math.max(configured, 1024 * 1024), 2 * 1024 * 1024 * 1024)
    : 100 * 1024 * 1024;
}

export function maximumActiveUploadSessions(): number {
  const configured = Number(process.env.MAX_ACTIVE_UPLOAD_SESSIONS ?? 10);
  return Number.isSafeInteger(configured) ? Math.min(Math.max(configured, 1), 50) : 10;
}

export async function createDocumentFromFile(input: {
  userId: string;
  file: File;
  metadata: DocumentMetadata;
}) {
  const { file, userId, metadata } = input;
  if (!file.size) throw new InvalidUploadError('The selected file is empty.');
  if (file.size > maximumUploadBytes()) {
    throw new InvalidUploadError('The selected file exceeds the upload limit.');
  }
  const type = await inspectUpload(file.name, file.slice(0, 16_384));
  const tempKey = `temporary/${userId}/${randomUUID()}.upload`;
  const storage = getStorage();
  const stored = await storage.put(tempKey, file.stream(), maximumUploadBytes());
  try {
    return await finaliseStoredUpload({
      userId,
      originalFilename: file.name,
      tempKey,
      byteSize: stored.byteSize,
      sha256: stored.sha256,
      mimeType: type.mimeType,
      extension: type.extension,
      metadata
    });
  } catch (error) {
    await storage.delete(tempKey);
    throw error;
  }
}

export async function createUploadSession(input: {
  userId: string;
  originalFilename: string;
  expectedBytes: number;
  metadata: DocumentMetadata;
}) {
  if (!Number.isSafeInteger(input.expectedBytes) || input.expectedBytes <= 0) {
    throw new InvalidUploadError('Invalid upload size.');
  }
  if (input.expectedBytes > maximumUploadBytes()) {
    throw new InvalidUploadError('The selected file exceeds the upload limit.');
  }
  if (!input.originalFilename || input.originalFilename.length > 500) {
    throw new InvalidUploadError('Invalid filename.');
  }
  const id = randomUUID();
  const tempStorageKey = `temporary/${input.userId}/${id}.part`;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await getDatabase().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);
    const [account] = await tx
      .select({ quota: users.storageQuotaBytes })
      .from(users)
      .where(eq(users.id, input.userId))
      .limit(1);
    if (!account) throw new InvalidUploadError('User does not exist.');
    const [usage] = await tx
      .select({ bytes: sql<number>`coalesce(sum(${documentAssets.byteSize}), 0)` })
      .from(documentAssets)
      .where(eq(documentAssets.userId, input.userId));
    const [reservations] = await tx
      .select({
        bytes: sql<number>`coalesce(sum(${uploadSessions.expectedBytes}), 0)`,
        count: sql<number>`count(*)`
      })
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.userId, input.userId),
          inArray(uploadSessions.status, ['active', 'finalising']),
          gt(uploadSessions.expiresAt, new Date())
        )
      );
    const reservedBytes = Number(reservations?.bytes ?? 0);
    const usedBytes = Number(usage?.bytes ?? 0);
    if (Number(reservations?.count ?? 0) >= maximumActiveUploadSessions()) {
      throw new InvalidUploadError('Finish or cancel an existing resumable upload first.');
    }
    if (usedBytes + reservedBytes + input.expectedBytes > account.quota) {
      throw new QuotaExceededError(usedBytes + reservedBytes, account.quota, input.expectedBytes);
    }
    await tx.insert(uploadSessions).values({
      id,
      userId: input.userId,
      originalFilename: input.originalFilename,
      expectedBytes: input.expectedBytes,
      tempStorageKey,
      metadata: input.metadata as Record<string, unknown>,
      expiresAt
    });
  });
  return { id, offset: 0, expiresAt };
}

export async function appendUploadChunk(input: {
  userId: string;
  sessionId: string;
  offset: number;
  body: ReadableStream<Uint8Array>;
}) {
  const db = getDatabase();
  const storage = getStorage();
  const appended = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.sessionId}))`);
    const [session] = await tx
      .select()
      .from(uploadSessions)
      .where(
        and(
          eq(uploadSessions.id, input.sessionId),
          eq(uploadSessions.userId, input.userId),
          eq(uploadSessions.status, 'active')
        )
      )
      .limit(1);
    if (!session || session.expiresAt <= new Date()) {
      throw new InvalidUploadError('Upload session has expired or is already complete.');
    }
    const actualOffset = await storage
      .stat(session.tempStorageKey)
      .then((value) => value.byteSize)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return 0;
        throw error;
      });
    if (actualOffset > session.expectedBytes) {
      throw new InvalidUploadError('The temporary upload is invalid.');
    }
    if (actualOffset !== session.receivedBytes) {
      await tx
        .update(uploadSessions)
        .set({ receivedBytes: actualOffset, updatedAt: new Date() })
        .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.userId, input.userId)));
    }
    if (input.offset !== actualOffset) {
      throw new InvalidUploadError(`Resume from byte ${actualOffset}.`);
    }
    const result = await storage.append(
      session.tempStorageKey,
      input.body,
      actualOffset,
      session.expectedBytes
    );
    const complete = result.byteSize === session.expectedBytes;
    await tx
      .update(uploadSessions)
      .set({
        receivedBytes: result.byteSize,
        status: complete ? 'finalising' : 'active',
        updatedAt: new Date()
      })
      .where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.userId, input.userId)));
    return {
      complete,
      offset: result.byteSize,
      session: { ...session, receivedBytes: result.byteSize, status: 'finalising' }
    };
  });

  if (!appended.complete) return { complete: false as const, offset: appended.offset };
  try {
    const final = await finaliseUploadSession(appended.session);
    return { complete: true as const, offset: appended.offset, document: final };
  } catch (error) {
    await storage.delete(appended.session.tempStorageKey).catch(() => undefined);
    await db
      .update(uploadSessions)
      .set({ status: 'failed', updatedAt: new Date() })
      .where(
        and(eq(uploadSessions.id, appended.session.id), eq(uploadSessions.userId, input.userId))
      );
    throw error;
  }
}

export async function removeExpiredUploadSessions(): Promise<number> {
  const db = getDatabase();
  const expired = await db
    .select({ id: uploadSessions.id, tempStorageKey: uploadSessions.tempStorageKey })
    .from(uploadSessions)
    .where(
      and(
        inArray(uploadSessions.status, ['active', 'finalising', 'failed']),
        lt(uploadSessions.expiresAt, new Date())
      )
    )
    .limit(500);
  if (!expired.length) return 0;
  const storage = getStorage();
  await Promise.allSettled(expired.map((session) => storage.delete(session.tempStorageKey)));
  await db
    .delete(uploadSessions)
    .where(
      and(
        inArray(uploadSessions.status, ['active', 'finalising', 'failed']),
        lt(uploadSessions.expiresAt, new Date())
      )
    );
  return expired.length;
}

async function finaliseUploadSession(session: typeof uploadSessions.$inferSelect) {
  const storage = getStorage();
  const headStream = await storage.open(session.tempStorageKey);
  const chunks: Buffer[] = [];
  let headBytes = 0;
  for await (const chunk of headStream) {
    const buffer = Buffer.from(chunk);
    chunks.push(buffer);
    headBytes += buffer.length;
    if (headBytes >= 16_384) {
      headStream.destroy();
      break;
    }
  }
  const head = Buffer.concat(chunks).subarray(0, 16_384);
  const type = await inspectBuffer(session.originalFilename, head);
  const digest = createHash('sha256');
  const source = await storage.open(session.tempStorageKey);
  for await (const chunk of source) digest.update(chunk);
  const document = await finaliseStoredUpload({
    userId: session.userId,
    originalFilename: session.originalFilename,
    tempKey: session.tempStorageKey,
    byteSize: session.receivedBytes,
    sha256: digest.digest('hex'),
    mimeType: type.mimeType,
    extension: type.extension,
    metadata: session.metadata as DocumentMetadata
  });
  await getDatabase()
    .update(uploadSessions)
    .set({ status: 'complete', updatedAt: new Date() })
    .where(eq(uploadSessions.id, session.id));
  return document;
}

async function finaliseStoredUpload(input: {
  userId: string;
  originalFilename: string;
  tempKey: string;
  byteSize: number;
  sha256: string;
  mimeType: string;
  extension: string;
  metadata: DocumentMetadata;
}) {
  const db = getDatabase();
  const storage = getStorage();
  const documentId = randomUUID();
  const date = new Date();
  const permanentKey = [
    input.userId,
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    documentId,
    `original${input.extension}`
  ].join('/');
  let moved = false;

  try {
    const document = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [account] = await tx
        .select({ quota: users.storageQuotaBytes })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (!account) throw new InvalidUploadError('User does not exist.');
      let moduleCode: string | null = null;
      if (!input.metadata.organiseLater) {
        if (input.metadata.moduleId) {
          const [ownedModule] = await tx
            .select({ id: modules.id, code: modules.code })
            .from(modules)
            .where(and(eq(modules.id, input.metadata.moduleId), eq(modules.userId, input.userId)))
            .limit(1);
          if (!ownedModule) throw new InvalidUploadError('Choose a valid module.');
          moduleCode = ownedModule.code;
        }
        if (input.metadata.chapterId) {
          const [ownedChapter] = await tx
            .select({ id: chapters.id, moduleId: chapters.moduleId })
            .from(chapters)
            .where(
              and(eq(chapters.id, input.metadata.chapterId), eq(chapters.userId, input.userId))
            )
            .limit(1);
          if (!ownedChapter || ownedChapter.moduleId !== input.metadata.moduleId) {
            throw new InvalidUploadError('Choose a chapter from the selected module.');
          }
        }
      }
      const [usage] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${documentAssets.byteSize}), 0)` })
        .from(documentAssets)
        .where(eq(documentAssets.userId, input.userId));
      const usedBytes = Number(usage.bytes);
      if (usedBytes + input.byteSize > account.quota) {
        throw new QuotaExceededError(usedBytes, account.quota, input.byteSize);
      }
      const [duplicate] = await tx
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.userId, input.userId), eq(documents.sha256, input.sha256)))
        .limit(1);
      if (duplicate) throw new DuplicateUploadError(duplicate.id);

      await storage.move(input.tempKey, permanentKey);
      moved = true;
      const safeFilename = buildSafeFilename({
        originalFilename: input.originalFilename,
        moduleCode,
        date: input.metadata.documentDate ?? new Date().toISOString().slice(0, 10),
        title: input.metadata.title,
        type: input.metadata.type ?? 'other',
        extension: input.extension
      });
      const [created] = await tx
        .insert(documents)
        .values({
          id: documentId,
          userId: input.userId,
          moduleId: input.metadata.organiseLater ? null : input.metadata.moduleId,
          chapterId: input.metadata.organiseLater ? null : input.metadata.chapterId,
          originalFilename: input.originalFilename.slice(0, 500),
          safeFilename,
          sha256: input.sha256,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          section: input.metadata.organiseLater ? null : input.metadata.section,
          type: input.metadata.type ?? 'other',
          documentDate: input.metadata.documentDate,
          title:
            input.metadata.title?.trim().slice(0, 300) ||
            path.parse(input.originalFilename).name.slice(0, 300),
          description: input.metadata.description,
          tags: (input.metadata.tags ?? []).slice(0, 30),
          notebookName: input.metadata.notebookName,
          notebookNumber: input.metadata.notebookNumber,
          notebookPageRange: input.metadata.notebookPageRange,
          processingStatus: 'queued'
        })
        .returning();
      await tx.insert(documentAssets).values({
        documentId,
        userId: input.userId,
        kind: 'original',
        storageKey: permanentKey,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        sha256: input.sha256
      });
      await tx
        .update(users)
        .set({ storageUsedBytes: usedBytes + input.byteSize, updatedAt: new Date() })
        .where(eq(users.id, input.userId));
      return created;
    });

    await enqueueDocumentProcessing(document.id, input.userId).catch(async (error) => {
      console.error('Could not enqueue document processing', error);
      await db
        .update(documents)
        .set({ processingStatus: 'uploaded', processingError: 'Waiting for worker' })
        .where(and(eq(documents.id, document.id), eq(documents.userId, input.userId)));
    });
    return document;
  } catch (error) {
    if (moved) await storage.delete(permanentKey);
    throw error;
  }
}

async function inspectUpload(filename: string, head: Blob) {
  return inspectBuffer(filename, Buffer.from(await head.arrayBuffer()));
}

async function inspectBuffer(filename: string, head: Buffer) {
  const detected = await fileTypeFromBuffer(head);
  if (detected && allowedBinaryTypes.has(detected.mime)) {
    return {
      mimeType: detected.mime,
      extension: allowedBinaryTypes.get(detected.mime)!
    };
  }
  const extension = path.extname(filename).toLowerCase();
  const textMime = textExtensions.get(extension);
  if (textMime) {
    if (head.includes(0)) throw new InvalidUploadError('Text file contains binary data.');
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(head);
    } catch {
      throw new InvalidUploadError('Text files must use UTF-8 encoding.');
    }
    if (extension === '.json') {
      try {
        JSON.parse(head.toString('utf8'));
      } catch {
        // Large JSON may be incomplete in the head; reject only if the entire
        // upload is smaller than the inspection window.
        if (head.length < 16_384) throw new InvalidUploadError('JSON file is invalid.');
      }
    }
    return { mimeType: textMime, extension };
  }
  throw new InvalidUploadError('Use a PDF, JPEG, PNG, WebP, text, Markdown, CSV, or JSON file.');
}

export function buildSafeFilename(input: {
  originalFilename: string;
  moduleCode: string | null;
  date: string;
  title?: string | null;
  type: string;
  extension: string;
}) {
  const slug = (value: string) =>
    value
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100);
  const parts = [
    input.moduleCode ? slug(input.moduleCode).toUpperCase() : 'INBOX',
    input.date,
    slug(input.title || path.parse(input.originalFilename).name) || 'document',
    slug(input.type)
  ];
  return `${parts.join('_')}${input.extension}`;
}
