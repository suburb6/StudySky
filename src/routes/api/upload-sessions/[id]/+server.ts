import { json } from '@sveltejs/kit';
import { and, eq, sql } from 'drizzle-orm';
import {
  appendUploadChunk,
  DuplicateUploadError,
  InvalidUploadError,
  QuotaExceededError
} from '$lib/server/documents';
import { getDatabase } from '$lib/server/db';
import { uploadSessions } from '$lib/server/db/schema';
import { getStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const HEAD: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) return new Response(null, { status: 401 });
  const [session] = await getDatabase()
    .select({
      offset: uploadSessions.receivedBytes,
      length: uploadSessions.expectedBytes,
      status: uploadSessions.status,
      tempStorageKey: uploadSessions.tempStorageKey
    })
    .from(uploadSessions)
    .where(and(eq(uploadSessions.id, params.id), eq(uploadSessions.userId, locals.user.id)))
    .limit(1);
  if (!session) return new Response(null, { status: 404 });
  let offset = session.offset;
  if (session.status === 'active') {
    offset = await getStorage()
      .stat(session.tempStorageKey)
      .then((value) => Math.min(value.byteSize, session.length))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return 0;
        throw error;
      });
  }
  return new Response(null, {
    status: 204,
    headers: {
      'upload-offset': String(offset),
      'upload-length': String(session.length),
      'upload-status': session.status,
      'cache-control': 'no-store'
    }
  });
};

export const PUT: RequestHandler = async ({ request, locals, params }) => {
  if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
  if (!request.body) return json({ error: 'Chunk body is required.' }, { status: 400 });
  const offset = Number(request.headers.get('upload-offset'));
  if (!Number.isSafeInteger(offset) || offset < 0) {
    return json({ error: 'A valid Upload-Offset header is required.' }, { status: 400 });
  }
  try {
    const result = await appendUploadChunk({
      userId: locals.user.id,
      sessionId: params.id,
      offset,
      body: request.body
    });
    return json(result, {
      headers: { 'upload-offset': String(result.offset), 'cache-control': 'no-store' }
    });
  } catch (error) {
    if (error instanceof DuplicateUploadError) {
      return json(
        { error: error.message, code: 'duplicate', documentId: error.documentId },
        { status: 409 }
      );
    }
    if (error instanceof QuotaExceededError) {
      return json({ error: error.message, code: 'quota_exceeded' }, { status: 413 });
    }
    if (error instanceof InvalidUploadError) {
      return json({ error: error.message }, { status: 400 });
    }
    console.error('Chunk upload failed', error);
    return json({ error: 'The upload could not be resumed.' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  if (!locals.user) return new Response(null, { status: 401 });
  const db = getDatabase();
  const session = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${params.id}))`);
    const [value] = await tx
      .select({
        id: uploadSessions.id,
        status: uploadSessions.status,
        tempStorageKey: uploadSessions.tempStorageKey
      })
      .from(uploadSessions)
      .where(and(eq(uploadSessions.id, params.id), eq(uploadSessions.userId, locals.user!.id)))
      .limit(1);
    if (!value) return null;
    if (value.status === 'complete' || value.status === 'finalising') return value;
    await tx
      .delete(uploadSessions)
      .where(and(eq(uploadSessions.id, value.id), eq(uploadSessions.userId, locals.user!.id)));
    return value;
  });
  if (!session) return new Response(null, { status: 404 });
  if (session.status === 'complete' || session.status === 'finalising') {
    return json({ error: 'This upload is already being finalised.' }, { status: 409 });
  }
  await getStorage()
    .delete(session.tempStorageKey)
    .catch(() => undefined);
  return new Response(null, { status: 204 });
};
