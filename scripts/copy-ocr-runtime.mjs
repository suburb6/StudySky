import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const sourceRoot = path.dirname(require.resolve('onnxruntime-web'));
const paddleRoot = path.dirname(fileURLToPath(import.meta.resolve('@paddleocr/paddleocr-js')));
const paddleAssetsRoot = path.join(paddleRoot, 'assets');
const destinationRoot = path.resolve('static/ocr-runtime');
const paddleWorkerCandidates = (await readdir(paddleAssetsRoot)).filter((name) =>
  /^worker-entry-[\w-]+\.js$/.test(name)
);
if (paddleWorkerCandidates.length !== 1) {
  throw new Error('Expected exactly one PaddleOCR browser worker artifact.');
}
const assets = [
  {
    source: path.join(sourceRoot, 'ort-wasm-simd-threaded.mjs'),
    destination: 'ort-wasm-simd-threaded.mjs'
  },
  {
    source: path.join(sourceRoot, 'ort-wasm-simd-threaded.wasm'),
    destination: 'ort-wasm-simd-threaded.wasm'
  },
  {
    source: path.join(paddleAssetsRoot, paddleWorkerCandidates[0]),
    destination: 'paddle-ocr-worker.js'
  }
];

await mkdir(destinationRoot, { recursive: true });
await Promise.all(
  assets.map((asset) => copyFile(asset.source, path.join(destinationRoot, asset.destination)))
);

console.log('Prepared the lazy local OCR runtime.');
