<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, onMount } from 'svelte';
  import { LoaderCircle, Save } from '@lucide/svelte';
  import type { OcrResult } from '@paddleocr/paddleocr-js';

  type OcrRunner = {
    predict(input: unknown): Promise<OcrResult[]>;
    dispose(): Promise<void>;
  };

  let {
    documentId,
    title,
    mimeType,
    existingText = false,
    autoStart = false,
    onsaved
  }: {
    documentId: string;
    title: string;
    mimeType: string;
    existingText?: boolean;
    autoStart?: boolean;
    onsaved?: () => void;
  } = $props();

  let phase = $state<'idle' | 'loading' | 'reading' | 'ready'>('idle');
  let status = $state('');
  let error = $state('');
  let text = $state('');
  let confidence = $state(0);
  let currentPage = $state(0);
  let pageCount = $state(0);
  let runner: OcrRunner | null = null;
  let pdfTask: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;

  const supported = $derived(mimeType === 'application/pdf' || mimeType.startsWith('image/'));

  onMount(() => {
    if (autoStart && supported) void readLocally();
  });

  onDestroy(() => {
    void disposeLocalResources();
  });

  async function readLocally() {
    if (!supported || phase === 'loading' || phase === 'reading') return;
    await disposeLocalResources();
    error = '';
    text = '';
    confidence = 0;
    currentPage = 0;
    pageCount = 0;
    phase = 'loading';
    status = 'Loading the private handwriting model…';

    try {
      const response = await fetch(`/api/documents/${documentId}/original`, {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('The original document could not be opened.');
      const source = await response.blob();

      const { createLocalOcrRunner } = await import('$lib/client/local-ocr-runner');
      runner = await createLocalOcrRunner();

      phase = 'reading';
      const sources =
        mimeType === 'application/pdf'
          ? await renderPdfPages(source)
          : [await normaliseImage(source)];
      pageCount = sources.length;
      const pageTexts: string[] = [];
      const scores: number[] = [];

      for (let index = 0; index < sources.length; index += 1) {
        currentPage = index + 1;
        status = `Reading page ${currentPage} of ${pageCount} on this device…`;
        const [result] = await runner.predict(sources[index]);
        const items = orderedItems(result);
        scores.push(...items.map((item) => item.score));
        const body = items
          .map((item) => item.text.trim())
          .filter(Boolean)
          .join('\n');
        if (body) {
          pageTexts.push(pageCount > 1 ? `Page ${currentPage}\n${body}` : body);
        }
      }

      text = pageTexts.join('\n\n').trim();
      confidence = scores.length
        ? scores.reduce((sum, score) => sum + score, 0) / scores.length
        : 0;
      if (!text) {
        throw new Error(
          'No readable text was found. A brighter, flatter photo with clearer handwriting may help.'
        );
      }
      await disposeLocalResources();
      status = 'Draft extraction ready. Compare it with the original before saving.';
      phase = 'ready';
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : 'Handwriting recognition could not finish on this device.';
      status = '';
      phase = 'idle';
      await disposeLocalResources();
    }
  }

  async function disposeLocalResources() {
    const currentRunner = runner;
    const currentPdfTask = pdfTask;
    runner = null;
    pdfTask = null;
    await Promise.all([
      currentRunner?.dispose().catch(() => undefined),
      currentPdfTask?.destroy().catch(() => undefined)
    ]);
  }

  async function renderPdfPages(source: Blob): Promise<Blob[]> {
    const pdfjs = await import('pdfjs-dist');
    const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
    pdfTask = pdfjs.getDocument({ data: await source.arrayBuffer() });
    const document = await pdfTask.promise;
    if (document.numPages > 40) {
      throw new Error('Local handwriting OCR supports up to 40 PDF pages at a time.');
    }
    const pages: Blob[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      status = `Preparing page ${pageNumber} of ${document.numPages}…`;
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 1_800 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = documentOwnerCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      pages.push(await canvasBlob(canvas));
      page.cleanup();
    }
    return pages;
  }

  async function normaliseImage(source: Blob): Promise<Blob> {
    const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    try {
      const scale = Math.min(1, 2_400 / Math.max(bitmap.width, bitmap.height));
      const canvas = documentOwnerCanvas(
        Math.max(1, Math.round(bitmap.width * scale)),
        Math.max(1, Math.round(bitmap.height * scale))
      );
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return source;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvasBlob(canvas);
    } finally {
      bitmap.close();
    }
  }

  function documentOwnerCanvas(width: number, height: number) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(width));
    canvas.height = Math.max(1, Math.floor(height));
    return canvas;
  }

  function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('Could not prepare this page.'))),
        'image/jpeg',
        0.92
      )
    );
  }

  function orderedItems(result: OcrResult | undefined) {
    return [...(result?.items ?? [])].sort((first, second) => {
      const firstY = first.poly.reduce((sum, point) => sum + point[1], 0) / first.poly.length;
      const secondY = second.poly.reduce((sum, point) => sum + point[1], 0) / second.poly.length;
      if (Math.abs(firstY - secondY) > 12) return firstY - secondY;
      const firstX = Math.min(...first.poly.map((point) => point[0]));
      const secondX = Math.min(...second.poly.map((point) => point[0]));
      return firstX - secondX;
    });
  }
</script>

{#if supported}
  <section class="local-ocr">
    {#if phase === 'idle'}
      <div class="local-ocr-start">
        <p>{existingText ? 'Create a fresh text draft?' : 'Ready to read the handwriting.'}</p>
        <button class="button button-primary" type="button" onclick={readLocally}>
          {existingText ? 'Read again' : 'Read handwriting'}
        </button>
      </div>
    {:else}
      <div class="local-ocr-status" role="status" aria-live="polite">
        {#if phase !== 'ready'}<LoaderCircle class="spinner" size={17} />{/if}
        <span>{status}</span>
        {#if pageCount}<strong>{currentPage}/{pageCount}</strong>{/if}
      </div>
    {/if}

    {#if error}<p class="error-message" role="alert">{error}</p>{/if}

    {#if phase === 'ready'}
      <form
        method="POST"
        action="?/saveLocalOcr"
        class="local-ocr-result"
        use:enhance={() => {
          return async ({ update, result }) => {
            await update();
            if (result.type === 'success') onsaved?.();
          };
        }}
      >
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="confidence" value={confidence} />
        <input type="hidden" name="engine" value="PaddleOCR.js PP-OCRv5 mobile English" />
        <label for={`local-ocr-${documentId}`}>Review the text from {title}</label>
        <textarea id={`local-ocr-${documentId}`} name="extractedText" rows="14" bind:value={text}
        ></textarea>
        <div class="form-actions">
          <button class="button" type="button" onclick={readLocally}>Run again</button>
          <button class="button button-primary" type="submit">
            <Save size={15} /> Save text
          </button>
        </div>
      </form>
    {/if}
  </section>
{/if}

<style>
  .local-ocr {
    display: grid;
    gap: 14px;
  }

  .local-ocr-start {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .local-ocr-start p {
    margin: 0;
    color: var(--text-soft);
  }

  .local-ocr-status {
    display: flex;
    min-height: 42px;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 7px;
    background: var(--surface-hover);
  }

  .local-ocr-status span {
    flex: 1;
  }

  .local-ocr-status strong {
    font-size: 11px;
  }

  .local-ocr-result {
    display: grid;
    gap: 9px;
  }

  .local-ocr-result textarea {
    min-height: 220px;
    font-family: var(--font-mono);
    line-height: 1.55;
  }

  .local-ocr :global(.spinner) {
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 620px) {
    .local-ocr-start {
      align-items: stretch;
      flex-direction: column;
    }

    .local-ocr-start .button,
    .local-ocr-result .button {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .local-ocr :global(.spinner) {
      animation-duration: 1.8s;
    }
  }
</style>
