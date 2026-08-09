import { json } from '@sveltejs/kit';
import { z } from 'zod';
import {
  createDocumentFromFile,
  DuplicateUploadError,
  InvalidUploadError,
  QuotaExceededError
} from '$lib/server/documents';
import { intendedOwnerMatches } from '$lib/server/forms';
import { parseMetadataForm } from '$lib/server/upload-metadata';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Authentication required' }, { status: 401 });
  try {
    const form = await request.formData();
    if (!intendedOwnerMatches(form, locals.user.id)) {
      return json(
        { error: 'Upload belongs to a different signed-in account.', code: 'owner_mismatch' },
        { status: 409 }
      );
    }
    const files = form
      .getAll('files')
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) {
      return json({ error: 'Choose at least one file.' }, { status: 400 });
    }
    const metadata = parseMetadataForm(form);
    const created = [];
    for (const file of files.slice(0, 40)) {
      created.push(
        await createDocumentFromFile({
          userId: locals.user.id,
          file,
          metadata
        })
      );
    }
    return json(
      {
        documents: created.map((document) => ({
          id: document.id,
          title: document.title,
          processingStatus: document.processingStatus
        }))
      },
      { status: 201 }
    );
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
    if (error instanceof InvalidUploadError || error instanceof z.ZodError) {
      return json(
        {
          error:
            error instanceof z.ZodError
              ? (error.issues[0]?.message ?? 'Invalid upload.')
              : error.message
        },
        { status: 400 }
      );
    }
    console.error('Direct upload failed', error);
    return json({ error: 'The upload could not be stored.' }, { status: 500 });
  }
};
