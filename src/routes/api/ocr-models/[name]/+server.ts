import { Readable } from 'node:stream';
import { isBrowserOcrModelName, openBrowserOcrModel } from '$lib/server/browser-ocr-models';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, request }) => {
  if (!locals.user) return new Response('Authentication required', { status: 401 });
  if (!isBrowserOcrModelName(params.name)) return new Response('Not found', { status: 404 });

  try {
    const model = await openBrowserOcrModel(params.name);
    if (request.headers.get('if-none-match') === `"${model.sha256}"`) {
      model.stream.destroy();
      return new Response(null, { status: 304 });
    }
    return new Response(Readable.toWeb(model.stream) as ReadableStream, {
      headers: {
        'content-type': 'application/x-tar',
        'content-length': String(model.byteSize),
        'cache-control': 'private, max-age=31536000, immutable',
        etag: `"${model.sha256}"`,
        'cross-origin-resource-policy': 'same-origin',
        'x-content-type-options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('Browser OCR model is unavailable', error);
    return new Response('The local OCR model is temporarily unavailable.', { status: 503 });
  }
};
