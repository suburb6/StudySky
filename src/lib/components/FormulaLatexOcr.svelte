<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, onMount } from 'svelte';
  import {
    Check,
    ChevronLeft,
    ChevronRight,
    Copy,
    LoaderCircle,
    Save,
    Server,
    Sigma
  } from '@lucide/svelte';

  type FormulaPhase =
    | 'checking'
    | 'disabled'
    | 'unavailable'
    | 'idle'
    | 'preparing'
    | 'prepared'
    | 'reading'
    | 'ready';

  type FormulaResult = {
    model: string;
    layoutModel: string;
    engine: string;
    formulas: Array<{ latex: string; box: [number, number, number, number] | null }>;
  };

  let {
    documentId,
    title,
    mimeType,
    existingText = false,
    onsaved
  }: {
    documentId: string;
    title: string;
    mimeType: string;
    existingText?: boolean;
    onsaved?: () => void;
  } = $props();

  let phase = $state<FormulaPhase>('checking');
  let status = $state('Checking the self-hosted formula model…');
  let error = $state('');
  let noFormulaFound = $state(false);
  let currentPage = $state(1);
  let pageCount = $state(0);
  let pageBlob = $state<Blob | null>(null);
  let previewUrl = $state('');
  let latex = $state('');
  let formulaCount = $state(0);
  let engine = $state('PaddleOCR PP-FormulaNet-S + PP-DocLayout-M');
  let copied = $state(false);
  let pdfTask: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;
  let pdfDocument: import('pdfjs-dist').PDFDocumentProxy | null = null;
  let originalImage: Blob | null = null;
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  const supported = $derived(mimeType === 'application/pdf' || mimeType.startsWith('image/'));
  const busy = $derived(phase === 'checking' || phase === 'preparing' || phase === 'reading');

  onMount(() => {
    void checkAvailability();
  });

  onDestroy(() => {
    void disposeDocument();
    if (copyTimer) clearTimeout(copyTimer);
  });

  async function checkAvailability() {
    phase = 'checking';
    status = 'Checking the self-hosted formula model…';
    error = '';
    try {
      const response = await fetch('/api/formula-recognition', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('Formula recognition status could not be checked.');
      const availability = (await response.json()) as { enabled: boolean; ready: boolean };
      if (!availability.enabled) {
        phase = 'disabled';
        status = '';
        return;
      }
      if (!availability.ready) {
        phase = 'unavailable';
        status = '';
        return;
      }
      phase = 'idle';
      status = '';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Formula recognition is unavailable.';
      phase = 'unavailable';
      status = '';
    }
  }

  async function prepareDocument() {
    if (!supported || busy) return;
    await disposeDocument();
    resetResult();
    phase = 'preparing';
    status = 'Preparing the first page…';
    error = '';
    try {
      const response = await fetch(`/api/documents/${documentId}/original`, {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('The original document could not be opened.');
      const source = await response.blob();
      if (mimeType === 'application/pdf') {
        const pdfjs = await import('pdfjs-dist');
        const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
        pdfTask = pdfjs.getDocument({ data: await source.arrayBuffer() });
        const loadedDocument = await pdfTask.promise;
        pdfDocument = loadedDocument;
        if (loadedDocument.numPages > 500) {
          throw new Error('Formula recognition supports PDFs with up to 500 pages.');
        }
        pageCount = loadedDocument.numPages;
      } else {
        originalImage = source;
        pageCount = 1;
      }
      await loadPage(1);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'This document could not be prepared.';
      status = '';
      phase = 'idle';
      await disposeDocument();
    }
  }

  async function loadPage(pageNumber: number) {
    if (pageNumber < 1 || pageNumber > pageCount) return;
    phase = 'preparing';
    status = pageCount > 1 ? `Preparing page ${pageNumber} of ${pageCount}…` : 'Preparing image…';
    error = '';
    resetResult();
    try {
      pageBlob = pdfDocument
        ? await renderPdfPage(pdfDocument, pageNumber)
        : await normaliseImage(originalImage!);
      currentPage = pageNumber;
      replacePreview(pageBlob);
      phase = 'prepared';
      status = '';
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'This page could not be prepared.';
      status = '';
      phase = 'idle';
    }
  }

  async function renderPdfPage(pdf: import('pdfjs-dist').PDFDocumentProxy, pageNumber: number) {
    const page = await pdf.getPage(pageNumber);
    try {
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, 2_400 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      return canvasBlob(canvas);
    } finally {
      page.cleanup();
    }
  }

  async function normaliseImage(source: Blob) {
    const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    try {
      const scale = Math.min(1, 2_400 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Canvas rendering is unavailable in this browser.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvasBlob(canvas);
    } finally {
      bitmap.close();
    }
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

  function replacePreview(source: Blob) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(source);
  }

  async function scanPage(mode: 'page' | 'formula' = 'page') {
    if (!pageBlob || busy) return;
    phase = 'reading';
    status =
      mode === 'page'
        ? `Finding formulas on page ${currentPage}…`
        : 'Reading this image as one formula…';
    error = '';
    noFormulaFound = false;
    copied = false;
    try {
      const response = await fetch(`/api/formula-recognition?mode=${mode}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': pageBlob.type || 'image/jpeg' },
        body: pageBlob
      });
      const result = (await response.json()) as FormulaResult & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Formula recognition could not finish.');
      if (!Array.isArray(result.formulas) || result.formulas.length === 0) {
        phase = 'prepared';
        status = '';
        noFormulaFound = true;
        return;
      }
      engine = result.engine;
      formulaCount = result.formulas.length;
      latex = result.formulas.map((formula) => `\\[\n${formula.latex.trim()}\n\\]`).join('\n\n');
      phase = 'ready';
      status = `${formulaCount} formula${formulaCount === 1 ? '' : 's'} ready to review.`;
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Formula recognition could not finish.';
      status = '';
      phase = 'prepared';
    }
  }

  async function copyLatex() {
    try {
      await navigator.clipboard.writeText(latex);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2_000);
    } catch {
      error = 'The browser could not copy the LaTeX. Select the text and copy it manually.';
    }
  }

  function resetResult() {
    latex = '';
    formulaCount = 0;
    noFormulaFound = false;
    copied = false;
  }

  async function disposeDocument() {
    const currentTask = pdfTask;
    pdfTask = null;
    pdfDocument = null;
    originalImage = null;
    pageBlob = null;
    pageCount = 0;
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = '';
    }
    await currentTask?.destroy().catch(() => undefined);
  }
</script>

<div class="formula-reader">
  {#if phase === 'checking'}
    <div class="formula-status" role="status" aria-live="polite">
      <LoaderCircle class="spinner" size={17} />
      <span>{status}</span>
    </div>
  {:else if phase === 'disabled'}
    <div class="formula-availability">
      <Server size={18} />
      <div>
        <strong>Formula recognition is not enabled</strong>
        <p>The host can add the optional formula Compose profile. Text OCR still works normally.</p>
      </div>
    </div>
  {:else if phase === 'unavailable'}
    <div class="formula-availability">
      <Server size={18} />
      <div>
        <strong>The formula model is not ready</strong>
        <p>It may still be starting. This model is optional and runs on the StudySky server.</p>
      </div>
      <button class="button" type="button" onclick={checkAvailability}>Check again</button>
    </div>
  {:else if phase === 'idle'}
    <div class="formula-start">
      <div>
        <strong>Turn formulas into editable LaTeX</strong>
        <p>StudySky finds formulas on one page at a time. The result remains a draft.</p>
      </div>
      <button class="button button-primary" type="button" onclick={prepareDocument}>
        <Sigma size={16} /> Prepare page
      </button>
    </div>
  {:else}
    {#if previewUrl}
      <div class="formula-page">
        {#if pageCount > 1}
          <div class="page-picker" aria-label="PDF page controls">
            <button
              class="icon-button"
              type="button"
              aria-label="Previous page"
              title="Previous page"
              disabled={busy || currentPage <= 1}
              onclick={() => loadPage(currentPage - 1)}
            >
              <ChevronLeft size={17} />
            </button>
            <label>
              <span class="sr-only">Choose PDF page</span>
              <select
                value={currentPage}
                disabled={busy}
                onchange={(event) => loadPage(Number(event.currentTarget.value))}
              >
                {#each Array.from({ length: pageCount }, (_, index) => index + 1) as pageNumber}
                  <option value={pageNumber}>Page {pageNumber} of {pageCount}</option>
                {/each}
              </select>
            </label>
            <button
              class="icon-button"
              type="button"
              aria-label="Next page"
              title="Next page"
              disabled={busy || currentPage >= pageCount}
              onclick={() => loadPage(currentPage + 1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
        {/if}
        <div class="page-preview">
          <img src={previewUrl} alt={`Page ${currentPage} of ${title}`} />
        </div>
      </div>
    {/if}

    {#if phase === 'preparing' || phase === 'reading'}
      <div class="formula-status" role="status" aria-live="polite">
        <LoaderCircle class="spinner" size={17} />
        <span>{status}</span>
      </div>
    {:else if phase === 'prepared'}
      <div class="formula-run">
        <div>
          <span><Server size={14} /> Self-hosted</span>
          <span><Sigma size={14} /> PP-FormulaNet-S</span>
        </div>
        <button class="button button-primary" type="button" onclick={() => scanPage('page')}>
          Find formulas on this page
        </button>
      </div>
      {#if noFormulaFound}
        <div class="formula-empty" role="status">
          <p>No formula region was found on this page.</p>
          <button class="button" type="button" onclick={() => scanPage('formula')}>
            This image is one close-up formula
          </button>
        </div>
      {/if}
    {/if}

    {#if phase === 'ready'}
      <p class="sr-only" role="status" aria-live="polite">{status}</p>
      <form
        method="POST"
        action="?/saveLocalOcr"
        class="formula-result"
        use:enhance={() => {
          return async ({ update, result }) => {
            await update();
            if (result.type === 'success') onsaved?.();
          };
        }}
      >
        <input type="hidden" name="documentId" value={documentId} />
        <input type="hidden" name="engine" value={engine} />
        <input type="hidden" name="outputKind" value="formula_latex" />
        <label for={`formula-latex-${documentId}`}>
          Review the LaTeX from page {currentPage}
          <small>
            {formulaCount} formula{formulaCount === 1 ? '' : 's'} · {existingText
              ? 'Adds below existing document text'
              : 'Saves with this document'}
          </small>
        </label>
        <textarea
          id={`formula-latex-${documentId}`}
          name="extractedText"
          rows="14"
          bind:value={latex}
          spellcheck="false"
        ></textarea>
        <div class="form-actions formula-actions">
          <button class="button" type="button" onclick={() => scanPage('page')}>Scan again</button>
          <button class="button" type="button" onclick={copyLatex}>
            {#if copied}<Check size={15} /> Copied{:else}<Copy size={15} /> Copy LaTeX{/if}
          </button>
          <button class="button button-primary" type="submit">
            <Save size={15} /> Add to document
          </button>
        </div>
      </form>
    {/if}
  {/if}

  {#if error}<p class="error-message" role="alert">{error}</p>{/if}
</div>

<style>
  .formula-reader {
    display: grid;
    gap: 14px;
  }

  .formula-status,
  .formula-availability,
  .formula-start,
  .formula-run,
  .formula-empty {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .formula-status {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 8px;
    padding: 9px 11px;
  }

  .formula-availability,
  .formula-start {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 13px;
  }

  .formula-availability > div,
  .formula-start > div {
    min-width: 0;
    flex: 1;
  }

  .formula-availability p,
  .formula-start p,
  .formula-empty p {
    margin: 3px 0 0;
    color: var(--text-soft);
    line-height: 1.45;
  }

  .formula-page {
    display: grid;
    gap: 8px;
  }

  .page-picker {
    display: flex;
    justify-content: center;
    gap: 6px;
  }

  .page-picker select {
    min-height: 36px;
    min-width: 150px;
  }

  .page-preview {
    display: grid;
    max-height: 310px;
    place-items: center;
    overflow: auto;
    padding: 10px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-hover);
  }

  .page-preview img {
    display: block;
    max-width: 100%;
    max-height: 286px;
    border: 1px solid var(--border);
    background: #ffffff;
    object-fit: contain;
  }

  .formula-run {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px;
  }

  .formula-run > div {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .formula-run span {
    display: inline-flex;
    min-height: 26px;
    align-items: center;
    gap: 5px;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-soft);
    background: var(--surface);
    font-size: 12px;
  }

  .formula-empty {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px;
  }

  .formula-empty p {
    margin: 0;
  }

  .formula-result {
    display: grid;
    gap: 9px;
  }

  .formula-result > label {
    display: grid;
    gap: 2px;
    font-weight: 650;
  }

  .formula-result small {
    color: var(--text-soft);
    font-weight: 400;
  }

  .formula-result textarea {
    min-height: 220px;
    font-family: var(--font-mono);
    line-height: 1.55;
  }

  .formula-reader :global(.spinner) {
    flex: 0 0 auto;
    animation: spin 900ms linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 620px) {
    .formula-availability,
    .formula-start,
    .formula-run,
    .formula-empty {
      align-items: stretch;
      flex-direction: column;
    }

    .formula-availability .button,
    .formula-start .button,
    .formula-run .button,
    .formula-empty .button,
    .formula-actions .button {
      min-height: 44px;
    }

    .page-picker select,
    .page-picker .icon-button {
      min-height: 44px;
    }

    .formula-actions {
      display: grid;
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .formula-reader :global(.spinner) {
      animation-duration: 1.8s;
    }
  }
</style>
