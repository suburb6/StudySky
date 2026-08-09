import { fail } from '@sveltejs/kit';
import path from 'node:path';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  createDocumentFromFile,
  buildSafeFilename,
  DuplicateUploadError,
  InvalidUploadError,
  QuotaExceededError
} from '$lib/server/documents';
import { getDatabase } from '$lib/server/db';
import {
  chapters,
  auditLogs,
  documentAssets,
  documentShares,
  documents,
  documentType,
  modules,
  users,
  sharingPermission
} from '$lib/server/db/schema';
import { formString, optionalFormString } from '$lib/server/forms';
import { getStorage } from '$lib/server/storage';
import { parseMetadataForm } from '$lib/server/upload-metadata';
import { listModules } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const db = getDatabase();
  const moduleId = url.searchParams.get('module');
  const type = url.searchParams.get('type');
  const query = url.searchParams.get('q')?.trim();
  const inbox = url.searchParams.get('view') === 'inbox';
  const conditions = [eq(documents.userId, locals.user!.id)];
  if (moduleId) conditions.push(eq(documents.moduleId, moduleId));
  if (type && documentType.enumValues.includes(type as (typeof documentType.enumValues)[number])) {
    conditions.push(eq(documents.type, type as (typeof documentType.enumValues)[number]));
  }
  if (inbox) conditions.push(isNull(documents.moduleId));
  if (query) {
    conditions.push(
      sql`to_tsvector('english', coalesce(${documents.title}, '') || ' ' || coalesce(${documents.description}, '') || ' ' || coalesce(${documents.extractedText}, '') || ' ' || coalesce(${documents.correctedText}, '')) @@ websearch_to_tsquery('english', ${query})`
    );
  }

  const [rows, sharedRows, moduleRows, chapterRows, account] = await Promise.all([
    db
      .select({
        document: documents,
        moduleCode: modules.code,
        moduleName: modules.name,
        moduleColor: modules.color,
        chapterTitle: chapters.title
      })
      .from(documents)
      .leftJoin(modules, eq(documents.moduleId, modules.id))
      .leftJoin(chapters, eq(documents.chapterId, chapters.id))
      .where(and(...conditions))
      .orderBy(desc(documents.createdAt))
      .limit(200),
    db
      .select({
        document: {
          id: documents.id,
          title: documents.title,
          mimeType: documents.mimeType,
          extractedText: documents.extractedText
        },
        moduleCode: sql<string | null>`null`,
        moduleName: sql<string | null>`null`,
        moduleColor: sql<string | null>`null`,
        chapterTitle: sql<string | null>`null`,
        permission: documentShares.permission
      })
      .from(documentShares)
      .innerJoin(documents, eq(documentShares.documentId, documents.id))
      .where(
        and(eq(documentShares.sharedWithUserId, locals.user!.id), isNull(documentShares.revokedAt))
      )
      .orderBy(desc(documentShares.createdAt))
      .limit(200),
    listModules(locals.user!.id),
    db
      .select({ id: chapters.id, moduleId: chapters.moduleId, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.userId, locals.user!.id))
      .orderBy(asc(chapters.title)),
    db
      .select({ used: users.storageUsedBytes, quota: users.storageQuotaBytes })
      .from(users)
      .where(eq(users.id, locals.user!.id))
      .limit(1)
  ]);
  const ocrId = url.searchParams.get('ocr');
  const ocrDocument = ocrId
    ? (rows.map((row) => row.document).find((document) => document.id === ocrId) ??
      sharedRows.map((row) => row.document).find((document) => document.id === ocrId) ??
      null)
    : null;

  return {
    documents: rows,
    sharedDocuments: sharedRows,
    modules: moduleRows,
    chapters: chapterRows,
    account: account[0] ?? { used: 0, quota: 10 * 1024 ** 3 },
    ocrDocument,
    filters: { moduleId, type, query, inbox }
  };
};

export const actions: Actions = {
  upload: async ({ request, locals }) => {
    try {
      const form = await request.formData();
      const files = form
        .getAll('files')
        .filter((value): value is File => value instanceof File && value.size > 0);
      if (!files.length) return fail(400, { error: 'Choose a file.', action: 'upload' });
      const metadata = parseMetadataForm(form);
      for (const file of files) {
        await createDocumentFromFile({ userId: locals.user!.id, file, metadata });
      }
      return { success: true, action: 'upload' };
    } catch (caught) {
      return handleUploadFailure(caught);
    }
  },
  organise: async ({ request, locals }) => {
    const form = await request.formData();
    const documentId = formString(form, 'documentId');
    const moduleId = optionalFormString(form, 'moduleId');
    const chapterId = optionalFormString(form, 'chapterId');
    const type = formString(form, 'type');
    const title = formString(form, 'title');
    const parsed = z
      .object({
        documentId: z.uuid(),
        moduleId: z.uuid().nullable(),
        chapterId: z.uuid().nullable(),
        type: z.enum(documentType.enumValues),
        title: z.string().min(1).max(300),
        section: z.string().max(80).nullable()
      })
      .safeParse({
        documentId,
        moduleId,
        chapterId,
        type,
        title,
        section: optionalFormString(form, 'section')
      });
    if (!parsed.success) {
      return fail(400, { error: parsed.error.issues[0]?.message, action: 'organise' });
    }
    let moduleCode: string | null = null;
    if (parsed.data.moduleId) {
      const [ownedModule] = await getDatabase()
        .select({ id: modules.id, code: modules.code })
        .from(modules)
        .where(and(eq(modules.id, parsed.data.moduleId), eq(modules.userId, locals.user!.id)))
        .limit(1);
      if (!ownedModule) return fail(400, { error: 'Invalid module.', action: 'organise' });
      moduleCode = ownedModule.code;
    }
    if (parsed.data.chapterId) {
      const [ownedChapter] = await getDatabase()
        .select({ id: chapters.id, moduleId: chapters.moduleId })
        .from(chapters)
        .where(and(eq(chapters.id, parsed.data.chapterId), eq(chapters.userId, locals.user!.id)))
        .limit(1);
      if (!ownedChapter || ownedChapter.moduleId !== parsed.data.moduleId) {
        return fail(400, { error: 'Invalid chapter.', action: 'organise' });
      }
    }
    const [target] = await getDatabase()
      .select({
        originalFilename: documents.originalFilename,
        safeFilename: documents.safeFilename,
        documentDate: documents.documentDate,
        createdAt: documents.createdAt
      })
      .from(documents)
      .where(and(eq(documents.id, parsed.data.documentId), eq(documents.userId, locals.user!.id)))
      .limit(1);
    if (!target) return fail(404, { error: 'Document not found.', action: 'organise' });
    await getDatabase()
      .update(documents)
      .set({
        moduleId: parsed.data.moduleId,
        chapterId: parsed.data.chapterId,
        section: parsed.data.section,
        type: parsed.data.type,
        title: parsed.data.title,
        safeFilename: buildSafeFilename({
          originalFilename: target.originalFilename,
          moduleCode,
          date: target.documentDate ?? target.createdAt.toISOString().slice(0, 10),
          title: parsed.data.title,
          type: parsed.data.type,
          extension: path.extname(target.safeFilename)
        }),
        updatedAt: new Date()
      })
      .where(and(eq(documents.id, parsed.data.documentId), eq(documents.userId, locals.user!.id)));
    return { success: true, action: 'organise' };
  },
  bulkOrganise: async ({ request, locals }) => {
    const form = await request.formData();
    const ids = [
      ...new Set(
        form
          .getAll('documentId')
          .map(String)
          .filter((id) => z.uuid().safeParse(id).success)
      )
    ].slice(0, 100);
    if (!ids.length) {
      return fail(400, { error: 'Select documents to organise.', action: 'bulkOrganise' });
    }
    const moduleId = optionalFormString(form, 'bulkModuleId');
    const chapterId = optionalFormString(form, 'bulkChapterId');
    const section = optionalFormString(form, 'bulkSection');
    const typeValue = optionalFormString(form, 'bulkType');
    const parsed = z
      .object({
        moduleId: z.uuid().nullable(),
        chapterId: z.uuid().nullable(),
        section: z.string().max(80).nullable(),
        type: z.enum(documentType.enumValues).nullable()
      })
      .safeParse({ moduleId, chapterId, section, type: typeValue });
    if (!parsed.success) {
      return fail(400, { error: 'Choose valid organisation values.', action: 'bulkOrganise' });
    }
    let moduleCode: string | null = null;
    if (parsed.data.moduleId) {
      const [ownedModule] = await getDatabase()
        .select({ id: modules.id, code: modules.code })
        .from(modules)
        .where(and(eq(modules.id, parsed.data.moduleId), eq(modules.userId, locals.user!.id)))
        .limit(1);
      if (!ownedModule) {
        return fail(400, { error: 'Choose a valid module.', action: 'bulkOrganise' });
      }
      moduleCode = ownedModule.code;
    }
    if (parsed.data.chapterId) {
      const [ownedChapter] = await getDatabase()
        .select({ id: chapters.id, moduleId: chapters.moduleId })
        .from(chapters)
        .where(and(eq(chapters.id, parsed.data.chapterId), eq(chapters.userId, locals.user!.id)))
        .limit(1);
      if (!ownedChapter || ownedChapter.moduleId !== parsed.data.moduleId) {
        return fail(400, {
          error: 'Choose a chapter from the selected module.',
          action: 'bulkOrganise'
        });
      }
    }
    const db = getDatabase();
    const targets = await db
      .select()
      .from(documents)
      .where(and(eq(documents.userId, locals.user!.id), inArray(documents.id, ids)));
    await db.transaction(async (tx) => {
      for (const target of targets) {
        const nextType = parsed.data.type ?? target.type;
        await tx
          .update(documents)
          .set({
            moduleId: parsed.data.moduleId,
            chapterId: parsed.data.chapterId,
            section: parsed.data.section,
            type: nextType,
            safeFilename: buildSafeFilename({
              originalFilename: target.originalFilename,
              moduleCode,
              date: target.documentDate ?? target.createdAt.toISOString().slice(0, 10),
              title: target.title,
              type: nextType,
              extension: path.extname(target.safeFilename)
            }),
            updatedAt: new Date()
          })
          .where(and(eq(documents.id, target.id), eq(documents.userId, locals.user!.id)));
      }
    });
    return { success: true, action: 'bulkOrganise', count: targets.length };
  },
  saveLocalOcr: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = z
      .object({
        documentId: z.uuid(),
        extractedText: z.string().min(1).max(2_000_000),
        confidence: z.coerce.number().min(0).max(1),
        engine: z.string().min(1).max(120)
      })
      .safeParse({
        documentId: formString(form, 'documentId'),
        extractedText: formString(form, 'extractedText'),
        confidence: formString(form, 'confidence'),
        engine: formString(form, 'engine')
      });
    if (!parsed.success) {
      return fail(400, {
        error: 'The local OCR draft is invalid or too large.',
        action: 'saveLocalOcr'
      });
    }

    const db = getDatabase();
    const [target] = await db
      .select({ ownerId: documents.userId })
      .from(documents)
      .where(
        and(
          eq(documents.id, parsed.data.documentId),
          or(
            eq(documents.userId, locals.user!.id),
            sql`exists (
              select 1 from ${documentShares}
              where ${documentShares.documentId} = ${documents.id}
                and ${documentShares.sharedWithUserId} = ${locals.user!.id}
                and ${documentShares.permission} = 'collaborate'
                and ${documentShares.revokedAt} is null
            )`
          )
        )
      )
      .limit(1);
    if (!target) {
      return fail(403, {
        error: 'Collaborative access is required to save OCR text.',
        action: 'saveLocalOcr'
      });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(documents)
        .set({
          extractedText: parsed.data.extractedText,
          ocrConfidence: parsed.data.confidence,
          ocrStatus: 'needs_review',
          updatedAt: new Date()
        })
        .where(eq(documents.id, parsed.data.documentId));
      await tx.insert(auditLogs).values({
        actorUserId: locals.user!.id,
        targetUserId: target.ownerId,
        action: 'document.local_ocr_saved',
        entityType: 'document',
        entityId: parsed.data.documentId,
        detail: {
          engine: parsed.data.engine,
          confidence: parsed.data.confidence
        }
      });
    });
    return { success: true, action: 'saveLocalOcr' };
  },
  correctText: async ({ request, locals }) => {
    const form = await request.formData();
    const documentId = formString(form, 'documentId');
    const text = formString(form, 'correctedText');
    const parsed = z
      .object({ documentId: z.uuid(), text: z.string().max(2_000_000) })
      .safeParse({ documentId, text });
    if (!parsed.success)
      return fail(400, { error: 'Invalid corrected text.', action: 'correctText' });
    const db = getDatabase();
    const [target] = await db
      .select({ ownerId: documents.userId })
      .from(documents)
      .where(
        and(
          eq(documents.id, parsed.data.documentId),
          or(
            eq(documents.userId, locals.user!.id),
            sql`exists (
              select 1 from ${documentShares}
              where ${documentShares.documentId} = ${documents.id}
                and ${documentShares.sharedWithUserId} = ${locals.user!.id}
                and ${documentShares.permission} = 'collaborate'
                and ${documentShares.revokedAt} is null
            )`
          )
        )
      )
      .limit(1);
    if (!target) {
      return fail(403, {
        error: 'Collaborative access is required to correct this text.',
        action: 'correctText'
      });
    }
    await db
      .update(documents)
      .set({ correctedText: parsed.data.text, updatedAt: new Date() })
      .where(eq(documents.id, parsed.data.documentId));
    if (target.ownerId !== locals.user!.id) {
      await db.insert(auditLogs).values({
        actorUserId: locals.user!.id,
        targetUserId: target.ownerId,
        action: 'document.corrected_by_collaborator',
        entityType: 'document',
        entityId: parsed.data.documentId
      });
    }
    return { success: true, action: 'correctText' };
  },
  share: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = z
      .object({
        documentId: z.uuid(),
        sharedWithUserId: z.uuid(),
        permission: z.enum(sharingPermission.enumValues)
      })
      .safeParse({
        documentId: formString(form, 'documentId'),
        sharedWithUserId: formString(form, 'sharedWithUserId'),
        permission: formString(form, 'permission')
      });
    if (!parsed.success || parsed.data.sharedWithUserId === locals.user!.id) {
      return fail(400, { error: 'Choose a valid member and permission.', action: 'share' });
    }
    const db = getDatabase();
    const [ownedDocument] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, parsed.data.documentId), eq(documents.userId, locals.user!.id)))
      .limit(1);
    const [recipient] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, parsed.data.sharedWithUserId))
      .limit(1);
    if (!ownedDocument || !recipient) {
      return fail(404, { error: 'Document or member not found.', action: 'share' });
    }
    await db.transaction(async (tx) => {
      await tx
        .insert(documentShares)
        .values({
          documentId: parsed.data.documentId,
          ownerId: locals.user!.id,
          sharedWithUserId: parsed.data.sharedWithUserId,
          permission: parsed.data.permission
        })
        .onConflictDoUpdate({
          target: [documentShares.documentId, documentShares.sharedWithUserId],
          set: {
            ownerId: locals.user!.id,
            permission: parsed.data.permission,
            revokedAt: null
          }
        });
      await tx.insert(auditLogs).values({
        actorUserId: locals.user!.id,
        targetUserId: parsed.data.sharedWithUserId,
        action: 'document.shared',
        entityType: 'document',
        entityId: parsed.data.documentId,
        detail: { permission: parsed.data.permission }
      });
    });
    return { success: true, action: 'share' };
  },
  revokeShare: async ({ request, locals }) => {
    const form = await request.formData();
    const shareId = z.uuid().safeParse(formString(form, 'shareId'));
    if (!shareId.success) {
      return fail(400, { error: 'Invalid sharing record.', action: 'revokeShare' });
    }
    const db = getDatabase();
    const [share] = await db
      .update(documentShares)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(documentShares.id, shareId.data),
          eq(documentShares.ownerId, locals.user!.id),
          isNull(documentShares.revokedAt)
        )
      )
      .returning();
    if (!share) return fail(404, { error: 'Share not found.', action: 'revokeShare' });
    await db.insert(auditLogs).values({
      actorUserId: locals.user!.id,
      targetUserId: share.sharedWithUserId,
      action: 'document.share_revoked',
      entityType: 'document',
      entityId: share.documentId
    });
    return { success: true, action: 'revokeShare' };
  },
  deleteDocument: async ({ request, locals }) => {
    const form = await request.formData();
    const documentId = formString(form, 'documentId');
    if (!z.uuid().safeParse(documentId).success) {
      return fail(400, { error: 'Document not found.', action: 'deleteDocument' });
    }
    const db = getDatabase();
    const assets = await db
      .select({ key: documentAssets.storageKey })
      .from(documentAssets)
      .innerJoin(documents, eq(documentAssets.documentId, documents.id))
      .where(and(eq(documents.userId, locals.user!.id), eq(documents.id, documentId)));
    const removed = await db.transaction(async (tx) => {
      const [deleted] = await tx
        .delete(documents)
        .where(and(eq(documents.userId, locals.user!.id), eq(documents.id, documentId)))
        .returning({ id: documents.id });
      if (!deleted) return null;
      const [usage] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${documentAssets.byteSize}), 0)` })
        .from(documentAssets)
        .where(eq(documentAssets.userId, locals.user!.id));
      await tx
        .update(users)
        .set({ storageUsedBytes: Number(usage.bytes), updatedAt: new Date() })
        .where(eq(users.id, locals.user!.id));
      return deleted;
    });
    if (!removed) {
      return fail(404, { error: 'Document not found.', action: 'deleteDocument' });
    }
    const storage = getStorage();
    const removals = await Promise.allSettled(assets.map((asset) => storage.delete(asset.key)));
    if (removals.some((result) => result.status === 'rejected')) {
      console.error('One or more deleted document objects could not be removed from storage.');
    }
    return { success: true, action: 'deleteDocument' };
  },
  bulkDelete: async ({ request, locals }) => {
    const form = await request.formData();
    if (formString(form, 'confirmation').toUpperCase() !== 'DELETE') {
      return fail(400, { error: 'Type DELETE to confirm.', action: 'bulkDelete' });
    }
    const ids = [
      ...new Set(
        form
          .getAll('documentId')
          .map(String)
          .filter((id) => z.uuid().safeParse(id).success)
      )
    ].slice(0, 100);
    if (!ids.length)
      return fail(400, { error: 'Select documents to delete.', action: 'bulkDelete' });
    const db = getDatabase();
    const assets = await db
      .select({ key: documentAssets.storageKey })
      .from(documentAssets)
      .innerJoin(documents, eq(documentAssets.documentId, documents.id))
      .where(and(eq(documents.userId, locals.user!.id), inArray(documents.id, ids)));
    const deleted = await db.transaction(async (tx) => {
      const removed = await tx
        .delete(documents)
        .where(and(eq(documents.userId, locals.user!.id), inArray(documents.id, ids)))
        .returning({ id: documents.id });
      const [usage] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${documentAssets.byteSize}), 0)` })
        .from(documentAssets)
        .where(eq(documentAssets.userId, locals.user!.id));
      await tx
        .update(users)
        .set({ storageUsedBytes: Number(usage.bytes), updatedAt: new Date() })
        .where(eq(users.id, locals.user!.id));
      return removed;
    });
    const storage = getStorage();
    const removals = await Promise.allSettled(assets.map((asset) => storage.delete(asset.key)));
    if (removals.some((result) => result.status === 'rejected')) {
      console.error('One or more deleted document objects could not be removed from storage.');
    }
    return { success: true, action: 'bulkDelete', count: deleted.length };
  }
};

function handleUploadFailure(caught: unknown) {
  if (caught instanceof DuplicateUploadError) {
    return fail(409, { error: caught.message, action: 'upload', duplicateId: caught.documentId });
  }
  if (caught instanceof QuotaExceededError || caught instanceof InvalidUploadError) {
    return fail(caught instanceof QuotaExceededError ? 413 : 400, {
      error: caught.message,
      action: 'upload'
    });
  }
  if (caught instanceof z.ZodError) {
    return fail(400, { error: caught.issues[0]?.message, action: 'upload' });
  }
  throw caught;
}
