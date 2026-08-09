<script lang="ts">
  import { onMount } from 'svelte';
  import { ChevronLeft, ChevronRight, LoaderCircle } from '@lucide/svelte';

  let { url, title }: { url: string; title: string } = $props();
  let canvas: HTMLCanvasElement;
  let page = $state(1);
  let pageCount = $state(0);
  let loading = $state(true);
  let error = $state('');
  let document: import('pdfjs-dist').PDFDocumentProxy | null = null;
  let loadingTask: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;

  onMount(() => {
    void load();
    return () => {
      void loadingTask?.destroy();
    };
  });

  async function load() {
    try {
      const pdfjs = await import('pdfjs-dist');
      const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
      loadingTask = pdfjs.getDocument({ url, withCredentials: true });
      document = await loadingTask.promise;
      pageCount = document.numPages;
      await render();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'PDF preview is unavailable.';
      loading = false;
    }
  }

  async function render() {
    if (!document || !canvas) return;
    loading = true;
    const pdfPage = await document.getPage(page);
    const base = pdfPage.getViewport({ scale: 1 });
    const containerWidth = Math.min(canvas.parentElement?.clientWidth ?? 800, 1000);
    const viewport = pdfPage.getViewport({ scale: Math.max(containerWidth / base.width, 0.5) });
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable.');
    await pdfPage.render({
      canvas,
      canvasContext: context,
      viewport,
      transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
    }).promise;
    loading = false;
  }

  async function changePage(next: number) {
    if (next < 1 || next > pageCount || loading) return;
    page = next;
    await render();
  }
</script>

<div class="pdf-preview">
  <div class="preview-toolbar">
    <strong>{title}</strong>
    <div class="row">
      <button
        class="button button-icon button-sm"
        type="button"
        onclick={() => changePage(page - 1)}
        disabled={page <= 1}
      >
        <ChevronLeft size={15} /><span class="sr-only">Previous page</span>
      </button>
      <span>Page {page} of {pageCount || '—'}</span>
      <button
        class="button button-icon button-sm"
        type="button"
        onclick={() => changePage(page + 1)}
        disabled={page >= pageCount}
      >
        <ChevronRight size={15} /><span class="sr-only">Next page</span>
      </button>
    </div>
  </div>
  <div class="canvas-wrap">
    {#if loading}<span class="loading"><LoaderCircle size={20} /> Rendering page…</span>{/if}
    {#if error}<p class="error-message">{error}</p>{/if}
    <canvas bind:this={canvas} aria-label={`PDF preview of ${title}, page ${page}`}></canvas>
  </div>
</div>

<style>
  .pdf-preview {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-hover);
  }

  .preview-toolbar {
    display: flex;
    min-height: 48px;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .preview-toolbar > strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .preview-toolbar span {
    color: var(--text-soft);
    font-size: 11px;
    white-space: nowrap;
  }

  .canvas-wrap {
    position: relative;
    min-height: 240px;
    overflow: auto;
    padding: 16px;
  }

  canvas {
    max-width: 100%;
    height: auto;
    margin: 0 auto;
    background: white;
    box-shadow: var(--shadow);
  }

  .loading {
    position: absolute;
    z-index: 2;
    top: 22px;
    left: 50%;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    border-radius: 7px;
    color: var(--text-soft);
    background: var(--surface);
    box-shadow: var(--shadow);
    font-size: 11px;
    transform: translateX(-50%);
  }
</style>
