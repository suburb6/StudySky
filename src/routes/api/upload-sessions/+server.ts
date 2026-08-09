import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { createUploadSession, InvalidUploadError, QuotaExceededError } from '$lib/server/documents';
import { parseMetadataObject } from '$lib/server/upload-metadata';
import type { RequestHandler } from './$types';

const requestSchema = z.object({
  ownerUserId: z.uuid().optional(),
  filename: z.string().min(1).max(500),
  size: z.number().int().positive(),
  metadata: z.unknown()
});

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
  try {
    const value = requestSchema.parse(await request.json());
    if (value.ownerUserId && value.ownerUserId !== locals.user.id) {
      return json(
        { error: 'Upload belongs to a different signed-in account.', code: 'owner_mismatch' },
        { status: 409 }
      );
    }
    const session = await createUploadSession({
      userId: locals.user.id,
      originalFilename: value.filename,
      expectedBytes: value.size,
      metadata: parseMetadataObject(value.metadata)
    });
    return json(session, { status: 201 });
  } catch (error) {
    if (error instanceof QuotaExceededError) {
      return json({ error: error.message, code: 'quota_exceeded' }, { status: 413 });
    }
    if (error instanceof InvalidUploadError || error instanceof z.ZodError) {
      return json(
        {
          error:
            error instanceof z.ZodError
              ? (error.issues[0]?.message ?? 'Invalid upload session.')
              : error.message
        },
        { status: 400 }
      );
    }
    console.error('Could not create upload session', error);
    return json({ error: 'Could not start the upload.' }, { status: 500 });
  }
};
