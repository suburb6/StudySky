import type { OcrResult } from '@paddleocr/paddleocr-js';

type WorkerResponse =
  | {
      kind: 'worker-transport-response';
      status: 'success';
      requestId: number;
      payload: unknown;
    }
  | {
      kind: 'worker-transport-response';
      status: 'error';
      requestId: number;
      error: { name?: string; message?: string; stack?: string };
    };

type PendingRequest = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: number;
};

export interface LocalOcrRunner {
  predict(input: Blob): Promise<OcrResult[]>;
  dispose(): Promise<void>;
}

export async function createLocalOcrRunner(): Promise<LocalOcrRunner> {
  if (
    typeof Worker !== 'function' ||
    typeof OffscreenCanvas !== 'function' ||
    typeof createImageBitmap !== 'function'
  ) {
    throw new Error(
      'Local handwriting recognition needs a browser with Web Worker and OffscreenCanvas support.'
    );
  }
  const runner = new WorkerOcrRunner();
  try {
    await runner.initialize();
    return runner;
  } catch (error) {
    await runner.dispose();
    throw error;
  }
}

class WorkerOcrRunner implements LocalOcrRunner {
  private readonly worker = new Worker('/ocr-runtime/paddle-ocr-worker.js', {
    type: 'module',
    name: 'studysky-local-handwriting-ocr'
  });
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private disposed = false;

  constructor() {
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message?.kind !== 'worker-transport-response') return;
      const request = this.pending.get(message.requestId);
      if (!request) return;
      window.clearTimeout(request.timeout);
      this.pending.delete(message.requestId);
      if (message.status === 'success') {
        request.resolve(message.payload);
      } else {
        const error = new Error(message.error?.message || 'The local OCR worker failed.');
        error.name = message.error?.name || 'Error';
        if (message.error?.stack) error.stack = message.error.stack;
        request.reject(error);
      }
    };
    this.worker.onerror = (event) => {
      this.rejectPending(new Error(event.message || 'The local OCR worker could not start.'));
    };
  }

  async initialize() {
    await this.request(
      'init',
      {
        options: {
          pipelineConfig: {
            pipelineName: 'OCR',
            raw: {},
            warnings: [],
            unsupportedFeatures: [],
            modelSelection: {
              textDetectionModelName: 'PP-OCRv5_mobile_det',
              textRecognitionModelName: 'en_PP-OCRv5_mobile_rec'
            },
            assets: {
              det: { url: '/api/ocr-models/PP-OCRv5_mobile_det.tar' },
              rec: { url: '/api/ocr-models/en_PP-OCRv5_mobile_rec.tar' }
            },
            runtimeDefaults: {
              text_det_limit_side_len: 960,
              text_det_limit_type: 'max',
              text_det_max_side_limit: 2_400,
              text_det_thresh: 0.3,
              text_det_box_thresh: 0.6,
              text_det_unclip_ratio: 1.5,
              text_rec_score_thresh: 0.25
            },
            pipelineBatchSize: 1,
            textDetectionBatchSize: 1,
            textRecognitionBatchSize: 6
          },
          ortOptions: {
            backend: 'wasm',
            wasmPaths: {
              mjs: '/ocr-runtime/ort-wasm-simd-threaded.mjs',
              wasm: '/ocr-runtime/ort-wasm-simd-threaded.wasm'
            },
            numThreads: 1,
            simd: true,
            disableWasmProxy: true
          }
        }
      },
      [],
      180_000
    );
  }

  async predict(input: Blob): Promise<OcrResult[]> {
    const imageBitmap = await createImageBitmap(input, { imageOrientation: 'from-image' });
    return (await this.request(
      'predict',
      {
        sources: [{ kind: 'imageBitmap', imageBitmap }],
        params: {}
      },
      [imageBitmap],
      180_000
    )) as OcrResult[];
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.request('dispose', {}, [], 2_000);
    } catch {
      // Termination below is the final cleanup path.
    }
    this.disposed = true;
    this.rejectPending(new Error('The local OCR worker was closed.'));
    this.worker.terminate();
  }

  private request(
    type: 'init' | 'predict' | 'dispose',
    payload: unknown,
    transferables: Transferable[],
    timeoutMs: number
  ) {
    if (this.disposed) return Promise.reject(new Error('The local OCR worker was closed.'));
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('Local handwriting recognition took too long on this device.'));
      }, timeoutMs);
      this.pending.set(requestId, { resolve, reject, timeout });
      this.worker.postMessage(
        {
          kind: 'worker-transport-request',
          type,
          payload,
          requestId
        },
        transferables
      );
    });
  }

  private rejectPending(error: Error) {
    for (const request of this.pending.values()) {
      window.clearTimeout(request.timeout);
      request.reject(error);
    }
    this.pending.clear();
  }
}
