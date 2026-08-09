import { redirect } from '@sveltejs/kit';
import { createDocumentFromFile } from '$lib/server/documents';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) redirect(303, '/login?next=/scan');
  let destination = '/scan?shared=1';
  try {
    const form = await request.formData();
    const files = form
      .getAll('files')
      .filter((value): value is File => value instanceof File && value.size > 0);
    if (!files.length) throw new Error('No shared file was received.');
    const sharedTitle =
      typeof form.get('title') === 'string' ? form.get('title')!.toString() : null;
    for (const file of files) {
      await createDocumentFromFile({
        userId: locals.user.id,
        file,
        metadata: {
          title: files.length === 1 ? sharedTitle : null,
          organiseLater: true,
          type: 'my_notes',
          documentDate: new Date().toISOString().slice(0, 10)
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Shared file could not be uploaded.';
    destination = `/scan?shareError=${encodeURIComponent(message)}`;
  }
  redirect(303, destination);
};
