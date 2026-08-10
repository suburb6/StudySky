import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, promises as filesystem } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getStorage } from './storage';

const upstreamRoot =
  'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0';

const models = {
  'PP-OCRv5_mobile_det.tar': {
    upstream: `${upstreamRoot}/PP-OCRv5_mobile_det_onnx_infer.tar`,
    bytes: 4_843_520,
    sha256: '781056046c9ed77a15c94681605db6a0f62317c2e9cce6931c71da2478d4bc30'
  },
  'en_PP-OCRv5_mobile_rec.tar': {
    upstream: `${upstreamRoot}/en_PP-OCRv5_mobile_rec_onnx_infer.tar`,
    bytes: 7_874_560,
    sha256: '4424e851309b291b00aab8191cd4314cefbd2d1b2381ff8994019d262fa95e28'
  },
  'latin_PP-OCRv5_mobile_rec.tar': {
    upstream: `${upstreamRoot}/latin_PP-OCRv5_mobile_rec_onnx_infer.tar`,
    bytes: 8_069_120,
    sha256: '0fd8634124d871d25492311da077517ba3b4277ea67a0dec9e46ce537978c7cb'
  }
} as const;

export type BrowserOcrModelName = keyof typeof models;

const verified = new Set<BrowserOcrModelName>();
const pending = new Map<BrowserOcrModelName, Promise<BrowserOcrModel>>();

export interface BrowserOcrModel {
  stream: ReturnType<typeof createReadStream>;
  byteSize: number;
  sha256: string;
}

export function isBrowserOcrModelName(value: string): value is BrowserOcrModelName {
  return Object.hasOwn(models, value);
}

export async function openBrowserOcrModel(name: BrowserOcrModelName): Promise<BrowserOcrModel> {
  let download = pending.get(name);
  if (!download) {
    download = prepareModel(name);
    pending.set(name, download);
    void download.then(
      () => pending.delete(name),
      () => pending.delete(name)
    );
  }
  return download;
}

async function prepareModel(name: BrowserOcrModelName): Promise<BrowserOcrModel> {
  const expected = models[name];
  const root =
    process.env.OCR_MODEL_CACHE_ROOT?.trim() || path.join(getStorage().root, '.browser-ocr-models');
  const target = path.join(root, name);

  await filesystem.mkdir(root, { recursive: true, mode: 0o700 });
  if (!verified.has(name)) {
    const valid = await verifyFile(target, expected.bytes, expected.sha256);
    if (!valid) {
      if (process.env.OCR_MODEL_DOWNLOADS_ENABLED === 'false') {
        throw new Error(`Browser OCR model ${name} is not installed.`);
      }
      await downloadModel(target, expected);
    }
    verified.add(name);
  }

  return {
    stream: createReadStream(target),
    byteSize: expected.bytes,
    sha256: expected.sha256
  };
}

async function downloadModel(
  target: string,
  expected: { upstream: string; bytes: number; sha256: string }
): Promise<void> {
  const response = await fetch(expected.upstream, {
    signal: AbortSignal.timeout(120_000),
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`Model download failed with HTTP ${response.status}.`);
  const contentLength = Number(response.headers.get('content-length'));
  if (contentLength && contentLength !== expected.bytes) {
    throw new Error('Model download size did not match the pinned artifact.');
  }
  if (!response.body) throw new Error('Model download returned no body.');

  const temporary = `${target}.${randomUUID()}.partial`;
  let byteSize = 0;
  const hash = createHash('sha256');
  try {
    const verifier = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.byteLength;
        if (byteSize > expected.bytes) {
          callback(new Error('Model download exceeded the pinned artifact size.'));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(
      Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
      verifier,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 })
    );
    if (byteSize !== expected.bytes || hash.digest('hex') !== expected.sha256) {
      throw new Error('Model download failed its integrity check.');
    }
    await filesystem.rm(target, { force: true });
    await filesystem.rename(temporary, target);
  } finally {
    await filesystem.rm(temporary, { force: true });
  }
}

async function verifyFile(target: string, expectedBytes: number, expectedHash: string) {
  try {
    const value = await filesystem.readFile(target);
    return (
      value.byteLength === expectedBytes &&
      createHash('sha256').update(value).digest('hex') === expectedHash
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
