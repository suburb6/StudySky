import { Readable } from 'node:stream';
import { and, eq, isNull, or } from 'drizzle-orm';
import { getDatabase } from '$lib/server/db';
import { documentAssets, documents, documentShares } from '$lib/server/db/schema';
import { getStorage } from '$lib/server/storage';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  if (!locals.user) return new Response('Authentication required', { status: 401 });
  if (!['original', 'processed', 'thumbnail', 'generated'].includes(params.kind)) {
    return new Response('Not found', { status: 404 });
  }
  const db = getDatabase();
  const [asset] = await db
    .select({
      key: documentAssets.storageKey,
      mimeType: documentAssets.mimeType,
      byteSize: documentAssets.byteSize,
      filename: documents.safeFilename,
      ownerId: documents.userId,
      sharedWith: documentShares.sharedWithUserId
    })
    .from(documentAssets)
    .innerJoin(documents, eq(documentAssets.documentId, documents.id))
    .leftJoin(
      documentShares,
      and(
        eq(documentShares.documentId, documents.id),
        eq(documentShares.sharedWithUserId, locals.user.id),
        isNull(documentShares.revokedAt)
      )
    )
    .where(
      and(
        eq(documents.id, params.id),
        eq(
          documentAssets.kind,
          params.kind as 'original' | 'processed' | 'thumbnail' | 'generated'
        ),
        or(
          eq(documents.userId, locals.user.id),
          eq(documentShares.sharedWithUserId, locals.user.id)
        )
      )
    )
    .orderBy(documentAssets.createdAt)
    .limit(1);
  if (!asset) return new Response('Not found', { status: 404 });

  try {
    const source = await getStorage().open(asset.key);
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const safeName = asset.filename.replaceAll(/["\r\n]/g, '_');
    return new Response(Readable.toWeb(source) as ReadableStream, {
      headers: {
        'content-type': asset.mimeType,
        'content-length': String(asset.byteSize),
        'content-disposition': `${disposition}; filename="${safeName}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff'
      }
    });
  } catch {
    return new Response('File unavailable', { status: 404 });
  }
};
