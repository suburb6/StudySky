import { json } from '@sveltejs/kit';
import sharp from 'sharp';
import {
  FormulaRecognitionError,
  formulaRecognitionStatus,
  getFormulaRecognitionConfig,
  recogniseFormulaImage,
  type FormulaRecognitionMode
} from '$lib/server/formula-recognition';
import type { RequestHandler } from './$types';

const supportedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

async function readBoundedImage(request: Request, maxBytes: number) {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new FormulaRecognitionError('The formula image is too large.', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return json({ error: 'Authentication required.' }, { status: 401 });
  const status = await formulaRecognitionStatus();
  return json(status, { headers: { 'cache-control': 'private, no-store' } });
};

export const POST: RequestHandler = async ({ locals, request, url }) => {
  if (!locals.user) return json({ error: 'Authentication required.' }, { status: 401 });
  const mode = url.searchParams.get('mode') ?? 'page';
  if (!['page', 'formula'].includes(mode)) {
    return json({ error: 'Unknown formula recognition mode.' }, { status: 400 });
  }

  try {
    const config = getFormulaRecognitionConfig();
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > config.maxImageBytes) {
      return json({ error: 'The formula image is too large.' }, { status: 413 });
    }
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? '';
    if (!supportedImageTypes.has(contentType)) {
      return json({ error: 'Use a JPEG, PNG, or WebP formula image.' }, { status: 415 });
    }

    const source = await readBoundedImage(request, config.maxImageBytes);
    if (!source.length) return json({ error: 'The formula image is empty.' }, { status: 400 });
    if (source.length > config.maxImageBytes) {
      return json({ error: 'The formula image is too large.' }, { status: 413 });
    }

    const image = sharp(source, {
      failOn: 'error',
      limitInputPixels: config.maxPixels,
      animated: false
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      return json({ error: 'The formula image is unreadable.' }, { status: 415 });
    }
    const normalised = await image
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({
        width: 2_400,
        height: 2_400,
        fit: 'inside',
        withoutEnlargement: true
      })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();
    const result = await recogniseFormulaImage(normalised, mode as FormulaRecognitionMode);
    return json(result, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof FormulaRecognitionError) {
      return json({ error: error.message }, { status: error.status });
    }
    console.error('Formula image preparation failed', error);
    return json({ error: 'This formula image could not be prepared.' }, { status: 415 });
  }
};
