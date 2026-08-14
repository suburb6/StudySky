<script lang="ts">
  import { enhance } from '$app/forms';
  import { onDestroy, onMount } from 'svelte';
  import {
    HardDriveDownload,
    LoaderCircle,
    Save,
    ScanText,
    ShieldCheck,
    Sigma
  } from '@lucide/svelte';
  import type { OcrResult } from '@paddleocr/paddleocr-js';
  import FormulaLatexOcr from '$lib/components/FormulaLatexOcr.svelte';
  import {
    browserOcrProfiles,
    defaultBrowserOcrProfileId,
    getBrowserOcrProfile,
    isBrowserOcrProfileId
  } from '$lib/domain/browser-ocr-profiles';
  import type { AvailableOcrProvider } from '$lib/domain/ocr-providers';

  const OCR_PROFILE_STORAGE_KEY = 'studysky:browser-ocr-profile';

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
  let digitiseMode = $state<'text' | 'formula'>('text');
  let selectedReaderId = $state(`browser:${defaultBrowserOcrProfileId}`);
  let activeEngine = $state<string>(getBrowserOcrProfile(defaultBrowserOcrProfileId).engine);
  let activeReaderName = $state<string>(getBrowserOcrProfile(defaultBrowserOcrProfileId).label);
  let textProviders = $state<AvailableOcrProvider[]>(
    browserOcrProfiles.map((profile) => ({
      id: `browser:${profile.id}`,
      name: profile.label,
      description: profile.description,
      capabilities: ['text'],
      languages: profile.id === 'latin' ? ['English', 'French'] : ['English'],
      location: 'browser',
      model: profile.recognitionModelName
    }))
  );
  let runner: OcrRunner | null = null;
  let pdfTask: import('pdfjs-dist').PDFDocumentLoadingTask | null = null;

  const supported = $derived(mimeType === 'application/pdf' || mimeType.startsWith('image/'));
  const selectedReader = $derived(
    textProviders.find((provider) => provider.id === selectedReaderId) ?? textProviders[0]
  );
  const busy = $derived(phase === 'loading' || phase === 'reading');

  onMount(() => {
    try {
      const savedProfile = window.localStorage.getItem(OCR_PROFILE_STORAGE_KEY);
      if (isBrowserOcrProfileId(savedProfile)) {
        selectedReaderId = `browser:${savedProfile}`;
      } else if (savedProfile) {
        selectedReaderId = savedProfile;
      }
    } catch {
      // Private browsing modes may disable localStorage; the safe default still works.
    }
    void loadTextProviders().then(() => {
      if (autoStart && supported) void readText();
    });
  });

  onDestroy(() => {
    void disposeLocalResources();
  });

  async function loadTextProviders() {
    try {
      const response = await fetch('/api/ocr-providers?capability=text', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) return;
      const result = (await response.json()) as { providers?: AvailableOcrProvider[] };
      if (result.providers?.length) textProviders = result.providers;
      if (!textProviders.some((provider) => provider.id === selectedReaderId)) {
        selectedReaderId = `browser:${defaultBrowserOcrProfileId}`;
      }
    } catch {
      // Built-in browser OCR remains available when provider discovery fails.
    }
  }

  function selectReader(event: Event) {
    const value = (event.currentTarget as HTMLSelectElement).value;
    const browserProfile = value.startsWith('browser:') ? value.slice(8) : '';
    if (browserProfile && !isBrowserOcrProfileId(browserProfile)) return;
    selectedReaderId = value;
    try {
      window.localStorage.setItem(OCR_PROFILE_STORAGE_KEY, value);
    } catch {
      // The selection still applies to this run when localStorage is unavailable.
    }
  }

  function selectDigitiseMode(mode: 'text' | 'formula') {
    digitiseMode = mode;
    if (mode === 'formula') void disposeLocalResources();
  }

  async function readText() {
    if (!supported || phase === 'loading' || phase === 'reading') return;
    const provider = selectedReader;
    const browserProfileId = provider.id.startsWith('browser:') ? provider.id.slice(8) : '';
    const localProfile = isBrowserOcrProfileId(browserProfileId)
      ? getBrowserOcrProfile(browserProfileId)
      : null;
    activeEngine = localProfile?.engine ?? provider.name;
    activeReaderName = provider.name;
    await disposeLocalResources();
    error = '';
    text = '';
    confidence = 0;
    currentPage = 0;
    pageCount = 0;
    phase = 'loading';
    status = localProfile
      ? `Loading ${localProfile.label.toLowerCase()}…`
      : `Connecting to ${provider.name}…`;

    try {
      const response = await fetch(`/api/documents/${documentId}/original`, {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('The original document could not be opened.');
      const source = await response.blob();

      if (localProfile) {
        const { createLocalOcrRunner } = await import('$lib/client/local-ocr-runner');
        runner = await createLocalOcrRunner(localProfile.id);
      }

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
        status = localProfile
          ? `Reading page ${currentPage} of ${pageCount} on this device…`
          : `Reading page ${currentPage} of ${pageCount} with ${provider.name}…`;
        let body = '';
        if (runner) {
          const [result] = await runner.predict(sources[index]);
          const items = orderedItems(result);
          scores.push(...items.map((item) => item.score));
          body = items
            .map((item) => item.text.trim())
            .filter(Boolean)
            .join('\n');
        } else {
          const params = new URLSearchParams({ provider: provider.id, capability: 'text' });
          const response = await fetch(`/api/ocr-recognition?${params}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': sources[index].type || 'image/jpeg' },
            body: sources[index]
          });
          const result = (await response.json()) as {
            text?: string;
            confidence?: number | null;
            engine?: string;
            error?: string;
          };
          if (!response.ok) throw new Error(result.error || 'Text recognition could not finish.');
          body = result.text?.trim() ?? '';
          if (typeof result.confidence === 'number') scores.push(result.confidence);
          if (result.engine) activeEngine = result.engine;
        }
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
    <div class="digitise-switch" role="group" aria-label="Choose what to digitise">
      <button
        type="button"
        aria-pressed={digitiseMode === 'text'}
        class:active={digitiseMode === 'text'}
        onclick={() => selectDigitiseMode('text')}
      >
        <ScanText size={16} /> Text
      </button>
      <button
        type="button"
        aria-pressed={digitiseMode === 'formula'}
        class:active={digitiseMode === 'formula'}
        onclick={() => selectDigitiseMode('formula')}
      >
        <Sigma size={16} /> Formula to LaTeX
      </button>
    </div>

    {#if digitiseMode === 'text'}
      <div class="ocr-profile-picker">
        <label for={`ocr-profile-${documentId}`}>Reading mode</label>
        <select
          id={`ocr-profile-${documentId}`}
          value={selectedReaderId}
          onchange={selectReader}
          disabled={busy}
        >
          {#each textProviders as provider}
            <option value={provider.id}>
              {provider.name}{provider.id === `browser:${defaultBrowserOcrProfileId}`
                ? ' · Recommended'
                : ''}
            </option>
          {/each}
        </select>
        <p>{selectedReader.description}</p>
        <div class="ocr-profile-meta" aria-label="Reading mode details">
          {#if selectedReader.location === 'browser'}
            <span><ShieldCheck size={14} /> On this device</span>
            <span><HardDriveDownload size={14} /> About 36 MB on first use</span>
          {:else}
            <span><ShieldCheck size={14} /> Administrator approved</span>
            <span><HardDriveDownload size={14} /> Sent to the connected service</span>
          {/if}
        </div>
      </div>

      {#if phase === 'idle'}
        <div class="local-ocr-start">
          <p>{existingText ? 'Create a fresh text draft?' : 'Ready to read the handwriting.'}</p>
          <button class="button button-primary" type="button" onclick={readText}>
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
          <input type="hidden" name="engine" value={activeEngine} />
          <input type="hidden" name="outputKind" value="text" />
          <label for={`local-ocr-${documentId}`}
            >Review the text from {title}<small>Read with {activeReaderName}</small></label
          >
          <textarea id={`local-ocr-${documentId}`} name="extractedText" rows="14" bind:value={text}
          ></textarea>
          <div class="form-actions">
            <button class="button" type="button" onclick={readText}>Run again</button>
            <button class="button button-primary" type="submit">
              <Save size={15} /> Save text
            </button>
          </div>
        </form>
      {/if}
    {:else}
      <FormulaLatexOcr {documentId} {title} {mimeType} {existingText} {onsaved} />
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

  .digitise-switch {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px;
    padding: 3px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface-muted);
  }

  .digitise-switch button {
    display: inline-flex;
    min-height: 40px;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 7px 10px;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--text-soft);
    background: transparent;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .digitise-switch button:hover {
    color: var(--text);
  }

  .digitise-switch button.active {
    border-color: var(--border);
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 1px 2px color-mix(in srgb, var(--text) 8%, transparent);
  }

  .digitise-switch button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .local-ocr-start p {
    margin: 0;
    color: var(--text-soft);
  }

  .ocr-profile-picker {
    display: grid;
    gap: 7px;
  }

  .ocr-profile-picker > label {
    font-weight: 650;
  }

  .ocr-profile-picker select {
    min-height: 42px;
  }

  .ocr-profile-picker p {
    margin: 0;
    color: var(--text-soft);
    line-height: 1.45;
  }

  .ocr-profile-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .ocr-profile-meta span {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-height: 26px;
    padding: 3px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-soft);
    font-size: 12px;
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

  .local-ocr-result > label {
    display: grid;
    gap: 2px;
  }

  .local-ocr-result > label small {
    color: var(--text-soft);
    font-weight: 400;
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

    .ocr-profile-picker select {
      min-height: 44px;
    }

    .digitise-switch button {
      min-height: 44px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .local-ocr :global(.spinner) {
      animation-duration: 1.8s;
    }
  }
</style>
