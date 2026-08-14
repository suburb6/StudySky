import { json } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { isOcrCapability } from '$lib/domain/ocr-providers';
import { decryptCredential } from '$lib/server/ai';
import {
  CustomOcrProviderError,
  parseOcrCapabilities,
  parseOcrLanguages,
  recogniseWithCustomOcrProvider
} from '$lib/server/custom-ocr-provider';
import { getDatabase } from '$lib/server/db';
import { ocrProviders } from '$lib/server/db/schema';
import {
  FormulaRecognitionError,
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
        throw new CustomOcrProviderError('The image is too large for this model.', 413);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export const POST: RequestHandler = async ({ locals, request, url }) => {
  if (!locals.user) return json({ error: 'Authentication required.' }, { status: 401 });
  const providerId = url.searchParams.get('provider') ?? '';
  const capability = url.searchParams.get('capability');
  const mode = url.searchParams.get('mode') ?? 'page';
  const language = url.searchParams.get('language')?.slice(0, 40);
  if (!isOcrCapability(capability)) {
    return json({ error: 'Unknown OCR capability.' }, { status: 400 });
  }
  if (!['page', 'formula'].includes(mode)) {
    return json({ error: 'Unknown recognition mode.' }, { status: 400 });
  }

  try {
    let maximumBytes: number;
    let maximumPixels: number;
    let provider: typeof ocrProviders.$inferSelect | null = null;
    if (providerId === 'builtin:formula') {
      if (capability !== 'formula_latex') {
        return json({ error: 'That model does not read general text.' }, { status: 400 });
      }
      const config = getFormulaRecognitionConfig();
      maximumBytes = config.maxImageBytes;
      maximumPixels = config.maxPixels;
    } else {
      const [row] = await getDatabase()
        .select()
        .from(ocrProviders)
        .where(eq(ocrProviders.id, providerId))
        .limit(1);
      if (!row || !row.enabled) {
        return json({ error: 'The selected OCR model is unavailable.' }, { status: 404 });
      }
      provider = row;
      maximumBytes = row.maxImageBytes;
      maximumPixels = row.maxPixels;
    }

    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > maximumBytes) {
      return json({ error: 'The image is too large for this model.' }, { status: 413 });
    }
    const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.toLowerCase() ?? '';
    if (!supportedImageTypes.has(contentType)) {
      return json({ error: 'Use a JPEG, PNG, or WebP image.' }, { status: 415 });
    }

    const source = await readBoundedImage(request, maximumBytes);
    if (!source.length) return json({ error: 'The image is empty.' }, { status: 400 });
    const image = sharp(source, {
      failOn: 'error',
      limitInputPixels: maximumPixels,
      animated: false
    });
    const metadata = await image.metadata();
    if (!metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) {
      return json({ error: 'The image is unreadable.' }, { status: 415 });
    }
    const normalised = await image
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 2_400, height: 2_400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4', mozjpeg: true })
      .toBuffer();

    if (providerId === 'builtin:formula') {
      const result = await recogniseFormulaImage(normalised, mode as FormulaRecognitionMode);
      return json(
        { ...result, outputKind: 'formula_latex' },
        { headers: { 'cache-control': 'private, no-store' } }
      );
    }
    const result = await recogniseWithCustomOcrProvider(
      {
        id: provider!.id,
        name: provider!.name,
        baseUrl: provider!.baseUrl,
        token: decryptCredential(provider!.encryptedToken),
        capabilities: parseOcrCapabilities(provider!.capabilities),
        languages: parseOcrLanguages(provider!.languages),
        timeoutMs: provider!.timeoutMs,
        maxImageBytes: provider!.maxImageBytes,
        maxPixels: provider!.maxPixels
      },
      normalised,
      capability,
      { mode: mode as FormulaRecognitionMode, language }
    );
    return json(result, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof CustomOcrProviderError || error instanceof FormulaRecognitionError) {
      return json({ error: error.message }, { status: error.status });
    }
    console.error('OCR image preparation failed', error);
    return json({ error: 'This image could not be prepared.' }, { status: 415 });
  }
};
