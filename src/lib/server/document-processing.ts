import { createHash, randomUUID } from 'node:crypto';
import { promises as filesystem } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { and, eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { getDatabase } from './db';
import { documentAssets, documents, users } from './db/schema';
import { getStorage } from './storage';

const THUMBNAIL_MAX_BYTES = 8 * 1024 * 1024;
const PDF_TEXT_CHARACTER_LIMIT = 2_000_000;
const TEXT_CHARACTER_LIMIT = 2_000_000;
const DEFAULT_MAX_PDF_PROCESSING_PAGES = 500;
const ABSOLUTE_MAX_PDF_PROCESSING_PAGES = 10_000;

export function maximumPdfProcessingPages(): number {
  const configured = Number(
    process.env.MAX_PDF_PROCESSING_PAGES ?? DEFAULT_MAX_PDF_PROCESSING_PAGES
  );
  if (!Number.isSafeInteger(configured)) return DEFAULT_MAX_PDF_PROCESSING_PAGES;
  return Math.min(Math.max(configured, 1), ABSOLUTE_MAX_PDF_PROCESSING_PAGES);
}

export function assertPdfPageCountWithinLimit(
  pageCount: number,
  limit = maximumPdfProcessingPages()
): void {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > limit) {
    throw new Error(
      `PDF has ${pageCount} pages; the server processing limit is ${limit}. The original remains available.`
    );
  }
}

export interface DocumentProcessingInput {
  documentId: string;
  userId: string;
}

export async function processDocument(input: DocumentProcessingInput): Promise<void> {
  const db = getDatabase();
  const [row] = await db
    .select({
      document: documents,
      original: documentAssets
    })
    .from(documents)
    .innerJoin(
      documentAssets,
      and(eq(documentAssets.documentId, documents.id), eq(documentAssets.kind, 'original'))
    )
    .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)))
    .limit(1);
  if (!row) return;

  await db
    .update(documents)
    .set({ processingStatus: 'processing', processingError: null, updatedAt: new Date() })
    .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)));

  try {
    const storage = getStorage();
    const sourcePath = storage.resolveKey(row.original.storageKey);
    let pageCount: number | null = null;
    let extractedText: string | null = null;

    if (row.document.mimeType.startsWith('image/')) {
      const image = sharp(sourcePath, {
        failOn: 'error',
        limitInputPixels: 50_000_000
      });
      const metadata = await image.metadata();
      pageCount = metadata.pages ?? 1;
      const thumbnail = await image
        .rotate()
        .resize({ width: 720, height: 960, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 78, effort: 4 })
        .toBuffer();
      await storeDerivedAsset({
        documentId: input.documentId,
        userId: input.userId,
        kind: 'thumbnail',
        mimeType: 'image/webp',
        extension: '.webp',
        bytes: thumbnail
      });
    } else if (row.document.mimeType === 'application/pdf') {
      const pdfBytes = new Uint8Array(await filesystem.readFile(sourcePath));
      const extracted = await extractPdfText(pdfBytes);
      pageCount = extracted.pageCount;
      extractedText = extracted.text;

      if (process.env.OCR_ENABLED === 'true') {
        const ocrText = await processPdfWithOcr({
          sourcePath,
          documentId: input.documentId,
          userId: input.userId
        });
        if (ocrText) extractedText = ocrText;
      }
    } else if (row.document.mimeType.startsWith('text/')) {
      extractedText = (
        await filesystem.readFile(sourcePath, {
          encoding: 'utf8'
        })
      ).slice(0, TEXT_CHARACTER_LIMIT);
      pageCount = 1;
    }

    await db
      .update(documents)
      .set({
        pageCount,
        extractedText,
        processingStatus: 'ready',
        processingError: null,
        updatedAt: new Date()
      })
      .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)));
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 1_000) : 'Document processing failed.';
    await db
      .update(documents)
      .set({
        processingStatus: 'failed',
        processingError: message,
        updatedAt: new Date()
      })
      .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)));
    throw error;
  }
}

async function processPdfWithOcr(input: {
  sourcePath: string;
  documentId: string;
  userId: string;
}): Promise<string | null> {
  const db = getDatabase();
  const storage = getStorage();
  const temporaryDirectory = path.resolve(
    process.env.OCR_TEMP_ROOT || path.join(storage.root, '.ocr-temp')
  );
  await filesystem.mkdir(temporaryDirectory, { recursive: true });
  const outputPath = path.join(temporaryDirectory, `${randomUUID()}.pdf`);
  const executable = process.env.OCRMY_PDF_PATH || 'ocrmypdf';
  const languages = process.env.OCR_LANGUAGES || 'eng';
  const timeoutMs = Number(process.env.OCR_TIMEOUT_MS || 300_000);

  await db
    .update(documents)
    .set({ ocrStatus: 'processing', updatedAt: new Date() })
    .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)));

  try {
    await runProcess(
      executable,
      [
        '--skip-text',
        '--deskew',
        '--rotate-pages',
        '--optimize',
        '1',
        '--language',
        languages,
        input.sourcePath,
        outputPath
      ],
      timeoutMs
    );
    const processed = await filesystem.readFile(outputPath);
    await storeDerivedAsset({
      documentId: input.documentId,
      userId: input.userId,
      kind: 'processed',
      mimeType: 'application/pdf',
      extension: '.pdf',
      bytes: processed
    });
    await db
      .update(documents)
      .set({ ocrStatus: 'complete', updatedAt: new Date() })
      .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)));
    return (await extractPdfText(new Uint8Array(processed))).text;
  } catch (error) {
    await db
      .update(documents)
      .set({ ocrStatus: 'failed', updatedAt: new Date() })
      .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)));
    throw error;
  } finally {
    await filesystem.rm(outputPath, { force: true });
  }
}

async function extractPdfText(bytes: Uint8Array): Promise<{
  pageCount: number;
  text: string | null;
}> {
  const PDF = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = PDF.getDocument({
    data: bytes,
    useSystemFonts: true
  });
  const pdf = await loadingTask.promise;
  try {
    assertPdfPageCountWithinLimit(pdf.numPages);
    const pages: string[] = [];
    let characterCount = 0;
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter(Boolean)
        .join(' ');
      pages.push(text);
      characterCount += text.length;
      page.cleanup();
      if (characterCount >= PDF_TEXT_CHARACTER_LIMIT) break;
    }
    return {
      pageCount: pdf.numPages,
      text: pages.join('\n\n').slice(0, PDF_TEXT_CHARACTER_LIMIT) || null
    };
  } finally {
    await loadingTask.destroy();
  }
}

async function storeDerivedAsset(input: {
  documentId: string;
  userId: string;
  kind: 'processed' | 'thumbnail' | 'generated';
  mimeType: string;
  extension: string;
  bytes: Buffer;
}): Promise<void> {
  if (input.kind === 'thumbnail' && input.bytes.byteLength > THUMBNAIL_MAX_BYTES) {
    throw new Error('Generated thumbnail exceeded its safety limit.');
  }
  const storage = getStorage();
  const key = [
    input.userId,
    'derived',
    input.documentId,
    `${input.kind}-${randomUUID()}${input.extension}`
  ].join('/');
  const digest = createHash('sha256').update(input.bytes).digest('hex');
  const webBytes = Uint8Array.from(input.bytes);
  await storage.put(key, new Blob([webBytes]).stream(), input.bytes.byteLength);

  try {
    const db = getDatabase();
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.userId}))`);
      const [account] = await tx
        .select({ quota: users.storageQuotaBytes })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      const [usage] = await tx
        .select({ bytes: sql<number>`coalesce(sum(${documentAssets.byteSize}), 0)` })
        .from(documentAssets)
        .where(eq(documentAssets.userId, input.userId));
      const usedBytes = Number(usage.bytes);
      if (!account || usedBytes + input.bytes.byteLength > account.quota) {
        throw new Error('Storage quota has no room for a generated document asset.');
      }
      await tx.insert(documentAssets).values({
        documentId: input.documentId,
        userId: input.userId,
        kind: input.kind,
        storageKey: key,
        mimeType: input.mimeType,
        byteSize: input.bytes.byteLength,
        sha256: digest
      });
      await tx
        .update(users)
        .set({
          storageUsedBytes: usedBytes + input.bytes.byteLength,
          updatedAt: new Date()
        })
        .where(eq(users.id, input.userId));
    });
  } catch (error) {
    await storage.delete(key);
    throw error;
  }
}

async function runProcess(executable: string, args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let errorOutput = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      errorOutput = `${errorOutput}${chunk}`.slice(-4_000);
    });
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`OCR timed out after ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            `OCR process failed (${signal || `exit ${code}`}): ${errorOutput || 'no diagnostic output'}`
          )
        );
      }
    });
  });
}
