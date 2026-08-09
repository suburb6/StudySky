export { orderCorners, type ScanCorner } from './document-geometry';

type ScannerResponse = { ok: true; blob: Blob; name: string } | { ok: false; error: string };

export async function autoCorrectDocument(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Automatic page correction only works with image files.');
  }
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error(
      'Automatic page correction is unavailable on this device. Use the manual controls instead.'
    );
  }

  const worker = new Worker(new URL('./document-scanner.worker.ts', import.meta.url), {
    type: 'module',
    name: 'studysky-page-correction'
  });
  try {
    const result = await new Promise<ScannerResponse>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('Automatic page correction took too long on this device.')),
        60_000
      );
      worker.onmessage = (event: MessageEvent<ScannerResponse>) => {
        window.clearTimeout(timeout);
        resolve(event.data);
      };
      worker.onerror = (event) => {
        window.clearTimeout(timeout);
        reject(new Error(event.message || 'Automatic page correction could not start.'));
      };
      worker.postMessage({ file });
    });
    if (!result.ok) throw new Error(result.error);
    return new File([result.blob], result.name, {
      type: 'image/jpeg',
      lastModified: Date.now()
    });
  } finally {
    worker.terminate();
  }
}
