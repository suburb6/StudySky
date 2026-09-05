<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import {
    Ellipsis,
    ExternalLink,
    FileImage,
    FileText,
    Inbox,
    Pencil,
    ScanText,
    Search,
    Trash2,
    Upload
  } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import LocalHandwritingOcr from '$lib/components/LocalHandwritingOcr.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import UploadForm from '$lib/components/UploadForm.svelte';
  import { documentTypeLabels, humanize } from '$lib/domain/labels';

  let { data, form } = $props();
  let uploadOpen = $state(false);
  let editOpen = $state(false);
  let textOpen = $state(false);
  let savedText = $state('');
  let textError = $state('');
  let textDocument = $state<{ id: string; title: string } | null>(null);
  function readSavedText(document: {
    id: string;
    title: string;
    extractedText: string | null;
    correctedText: string | null;
  }) {
    textDocument = document;
    savedText = document.correctedText ?? document.extractedText ?? '';
    textError = '';
    textOpen = true;
  }
  async function copyText() {
    try {
      await navigator.clipboard.writeText(savedText);
      localToast = 'Text copied.';
      localToastToken += 1;
    } catch {
      textError = 'Copy was unavailable. Select the text and copy it manually.';
    }
  }
  function downloadText() {
    const url = URL.createObjectURL(new Blob([savedText], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'studysky-notes.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  let deleteOpen = $state(false);
  let ocrOpen = $state(false);
  let selectedRow = $state<(typeof data.documents)[number] | null>(null);
  let editModuleId = $state('');
  let ocrDocument = $state<{
    id: string;
    title: string;
    mimeType: string;
    existingText: boolean;
  } | null>(null);
  let localToast = $state('');
  let localToastToken = $state(0);

  const editChapters = $derived(
    data.chapters.filter((chapter) => !editModuleId || chapter.moduleId === editModuleId)
  );
  const usedStorage = $derived(size(data.account.used));
  const toastMessage = $derived(
    form?.error
      ? form.error
      : form?.success
        ? form.action === 'deleteDocument'
          ? 'Document deleted.'
          : form.action === 'organise'
            ? 'Document details updated.'
            : form.action === 'saveLocalOcr'
              ? 'Digitised content saved.'
              : 'Saved.'
        : localToast
  );
  const toastTone = $derived(form?.error ? 'error' : 'success');

  $effect(() => {
    if (data.ocrDocument && !ocrDocument) {
      ocrDocument = {
        id: data.ocrDocument.id,
        title: data.ocrDocument.title,
        mimeType: data.ocrDocument.mimeType,
        existingText: Boolean(data.ocrDocument.extractedText)
      };
      ocrOpen = true;
    }
  });

  function size(bytes: number) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
    if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  }

  function openEdit(row: (typeof data.documents)[number]) {
    selectedRow = row;
    editModuleId = row.document.moduleId ?? '';
    editOpen = true;
  }

  function openDelete(row: (typeof data.documents)[number]) {
    selectedRow = row;
    deleteOpen = true;
  }

  function openOcr(document: {
    id: string;
    title: string;
    mimeType: string;
    extractedText?: string | null;
  }) {
    ocrDocument = {
      id: document.id,
      title: document.title,
      mimeType: document.mimeType,
      existingText: Boolean(document.extractedText)
    };
    ocrOpen = true;
  }

  function notify(message: string) {
    localToast = message;
    localToastToken += 1;
  }

  async function uploaded(detail: {
    documentIds: string[];
    requestedOcr: boolean;
    title: string;
    mimeType: string;
  }) {
    uploadOpen = false;
    notify(
      `${detail.documentIds.length || 1} file${detail.documentIds.length === 1 ? '' : 's'} uploaded.`
    );
    await invalidateAll();
    if (detail.requestedOcr && detail.documentIds[0]) {
      ocrDocument = {
        id: detail.documentIds[0],
        title: detail.title,
        mimeType: detail.mimeType,
        existingText: false
      };
      ocrOpen = true;
    }
  }
</script>

<svelte:head>
  <title>Library · StudySky</title>
</svelte:head>

<div class="page documents-page">
  <PageHeader
    title="Library"
    description="Notes and files from every module."
    backHref="/modules"
    backLabel="Modules"
  >
    {#snippet actions()}
      <button class="button button-primary" type="button" onclick={() => (uploadOpen = true)}>
        <Upload size={16} /> Upload
      </button>
    {/snippet}
  </PageHeader>

  <Toast
    message={toastMessage}
    tone={toastTone}
    token={`${form?.action ?? ''}-${form?.success ?? ''}-${form?.error ?? ''}-${localToastToken}`}
  />

  <form method="GET" class="library-toolbar" role="search">
    <label class="document-search">
      <Search size={16} aria-hidden="true" />
      <span class="sr-only">Search documents</span>
      <input
        name="q"
        value={data.filters.query ?? ''}
        placeholder="Search files"
        aria-label="Search documents"
      />
    </label>
    <select
      name="module"
      aria-label="Filter by module"
      onchange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      <option value="">All modules</option>
      {#each data.modules as module}
        <option value={module.id} selected={data.filters.moduleId === module.id}
          >{module.code}</option
        >
      {/each}
    </select>
    <select
      name="type"
      aria-label="Filter by type"
      onchange={(event) => event.currentTarget.form?.requestSubmit()}
    >
      <option value="">All types</option>
      {#each Object.entries(documentTypeLabels) as [value, label]}
        <option {value} selected={data.filters.type === value}>{label}</option>
      {/each}
    </select>
    <a class:active={data.filters.inbox} class="button" href="?view=inbox">
      <Inbox size={15} /> Inbox
    </a>
  </form>

  <p class="storage-note">{usedStorage} stored · uploads are optimised automatically</p>

  {#if data.documents.length}
    <div class="document-list" aria-label="Your documents">
      <div class="document-heading" aria-hidden="true">
        <span>Name</span><span>Location</span><span>Type</span><span>Size</span><span></span>
      </div>
      {#each data.documents as row}
        <article class="document-row">
          <a
            class="document-title"
            href={`/api/documents/${row.document.id}/original`}
            target="_blank"
            rel="noreferrer"
          >
            <span class="file-icon">
              {#if row.document.mimeType.startsWith('image/')}
                <FileImage size={17} />
              {:else}
                <FileText size={17} />
              {/if}
            </span>
            <span>
              <strong>{row.document.title}</strong>
              <small>{row.document.originalFilename}</small>
            </span>
          </a>
          <span class="row-location">
            {row.moduleCode ?? 'Inbox'}{#if row.chapterTitle}
              · {row.chapterTitle}{/if}
          </span>
          <span>{documentTypeLabels[row.document.type]}</span>
          <span>{size(row.document.byteSize)}</span>
          <details class="row-menu">
            <summary
              class="button button-icon button-quiet"
              aria-label={`Actions for ${row.document.title}`}
            >
              <Ellipsis size={17} />
            </summary>
            <div class="surface menu-popover">
              <a
                href={`/api/documents/${row.document.id}/original`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={15} /> Open
              </a>
              {#if row.document.mimeType === 'application/pdf' || row.document.mimeType.startsWith('image/')}
                <button type="button" onclick={() => openOcr(row.document)}>
                  <ScanText size={15} /> Digitise
                </button>
              {/if}
              <button type="button" onclick={() => openEdit(row)}>
                <Pencil size={15} /> Edit details
              </button>
              {#if row.document.correctedText !== null || row.document.extractedText !== null}
                <button type="button" onclick={() => readSavedText(row.document)}
                  ><FileText size={15} /> Read / edit text</button
                >
              {/if}
              <button class="danger" type="button" onclick={() => openDelete(row)}>
                <Trash2 size={15} /> Delete
              </button>
            </div>
          </details>
        </article>
      {/each}
    </div>
  {:else}
    <EmptyState
      title={data.filters.query || data.filters.moduleId || data.filters.type || data.filters.inbox
        ? 'No matching files'
        : 'Your library is empty'}
      description={data.filters.query ||
      data.filters.moduleId ||
      data.filters.type ||
      data.filters.inbox
        ? 'Try a different search or filter.'
        : 'Upload a note here, or add it directly inside a chapter.'}
    />
  {/if}

  {#if data.sharedDocuments.length}
    <section class="shared-files">
      <h2>Shared with you</h2>
      <div class="document-list">
        {#each data.sharedDocuments as row}
          <a
            class="shared-row"
            href={`/api/documents/${row.document.id}/original`}
            target="_blank"
            rel="noreferrer"
          >
            <FileText size={17} />
            <span
              ><strong>{row.document.title}</strong><small>{humanize(row.permission)}</small></span
            >
            <ExternalLink size={15} />
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <Modal
    bind:open={uploadOpen}
    title="Upload files"
    description="Choose a module and chapter now, or leave the file in your inbox."
    size="large"
  >
    <UploadForm
      ownerUserId={data.user.id}
      modules={data.modules}
      chapters={data.chapters}
      oncomplete={uploaded}
    />
  </Modal>

  <Modal bind:open={editOpen} title="Edit document" size="small">
    {#if selectedRow}
      <form
        method="POST"
        action="?/organise"
        use:enhance={() => {
          return async ({ result, update }) => {
            await update({ reset: false });
            if (result.type === 'success') editOpen = false;
          };
        }}
      >
        <input type="hidden" name="documentId" value={selectedRow.document.id} />
        <div class="field">
          <label for="edit-document-title">Title</label>
          <input
            id="edit-document-title"
            name="title"
            value={selectedRow.document.title}
            required
          />
        </div>
        <div class="field field-gap">
          <label for="edit-document-module">Module</label>
          <select id="edit-document-module" name="moduleId" bind:value={editModuleId}>
            <option value="">Inbox</option>
            {#each data.modules as module}
              <option value={module.id}>{module.code} · {module.name}</option>
            {/each}
          </select>
        </div>
        <div class="field field-gap">
          <label for="edit-document-chapter">Chapter</label>
          <select id="edit-document-chapter" name="chapterId">
            <option value="">No chapter</option>
            {#each editChapters as chapter}
              <option value={chapter.id} selected={chapter.id === selectedRow.document.chapterId}>
                {chapter.title}
              </option>
            {/each}
          </select>
        </div>
        <div class="field field-gap">
          <label for="edit-document-type">Type</label>
          <select id="edit-document-type" name="type">
            {#each Object.entries(documentTypeLabels) as [value, label]}
              <option {value} selected={value === selectedRow.document.type}>{label}</option>
            {/each}
          </select>
        </div>
        {#if form?.action === 'organise' && form?.error}
          <p class="form-error" role="alert">{form.error}</p>
        {/if}
        <div class="form-actions">
          <button class="button" type="button" onclick={() => (editOpen = false)}>Cancel</button>
          <button class="button button-primary" type="submit">Save</button>
        </div>
      </form>
    {/if}
  </Modal>

  <Modal bind:open={deleteOpen} title="Delete document?" size="small">
    {#if selectedRow}
      <form
        method="POST"
        action="?/deleteDocument"
        use:enhance={() => {
          return async ({ result, update }) => {
            await update();
            if (result.type === 'success') deleteOpen = false;
          };
        }}
      >
        <input type="hidden" name="documentId" value={selectedRow.document.id} />
        <p class="dialog-copy">
          “{selectedRow.document.title}” and its stored copies will be permanently removed.
        </p>
        <div class="form-actions">
          <button class="button" type="button" onclick={() => (deleteOpen = false)}>Cancel</button>
          <button class="button button-danger" type="submit">Delete</button>
        </div>
      </form>
    {/if}
  </Modal>

  <Modal
    bind:open={ocrOpen}
    title="Digitise notes"
    description="Turn handwriting or formulas into editable text, then review before saving."
    size="large"
  >
    {#if ocrDocument}
      <LocalHandwritingOcr
        documentId={ocrDocument.id}
        title={ocrDocument.title}
        mimeType={ocrDocument.mimeType}
        existingText={ocrDocument.existingText}
        onsaved={() => {
          ocrOpen = false;
          notify('Digitised content saved.');
        }}
      />
    {/if}
  </Modal>
</div>

<Modal
  bind:open={textOpen}
  title={textDocument ? `Text · ${textDocument.title}` : 'Saved text'}
  size="large"
>
  {#if textDocument}
    <form
      method="POST"
      action="?/correctText"
      class="stack"
      use:enhance={() =>
        async ({ result, update }) => {
          if (result.type === 'success') {
            await update();
            textOpen = false;
          } else
            textError =
              result.type === 'failure'
                ? String(result.data?.error ?? 'Could not save text.')
                : 'Could not save text. Try again.';
        }}
    >
      <input type="hidden" name="documentId" value={textDocument.id} />
      <label class="field"
        >Saved text and LaTeX<textarea
          name="correctedText"
          rows="18"
          bind:value={savedText}
          maxlength="2000000"
        ></textarea></label
      >
      {#if textError}<p role="alert">{textError}</p>{/if}
      <div class="form-actions">
        <button class="button" type="button" onclick={copyText}>Copy</button>
        <button class="button" type="button" onclick={downloadText}>Download text</button>
        <button class="button button-primary">Save text</button>
      </div>
    </form>
  {/if}
</Modal>

<style>
  .library-toolbar {
    display: grid;
    grid-template-columns: minmax(220px, 1fr) 150px 150px auto;
    align-items: center;
    gap: 8px;
  }

  .document-search {
    display: flex;
    min-height: 40px;
    align-items: center;
    gap: 8px;
    padding: 0 11px;
    border: 1px solid var(--border-strong);
    border-radius: 7px;
    background: var(--surface);
  }

  .document-search:focus-within {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }

  .document-search input {
    min-height: 0;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
  }

  .storage-note {
    margin: 9px 0 22px;
    color: var(--text-faint);
    font-size: 11px;
  }

  .document-list {
    border-top: 1px solid var(--border);
  }

  .document-heading,
  .document-row {
    display: grid;
    grid-template-columns: minmax(240px, 2fr) minmax(120px, 1fr) 130px 78px 36px;
    align-items: center;
    gap: 12px;
  }

  .document-heading {
    min-height: 38px;
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .document-row {
    min-height: 64px;
    border-bottom: 1px solid var(--border);
    color: var(--text-soft);
    font-size: 11px;
  }

  .document-row:hover {
    background: var(--surface-hover);
  }

  .document-title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
    color: var(--text);
  }

  .document-title > span:last-child,
  .shared-row > span {
    display: grid;
    min-width: 0;
  }

  .document-title strong,
  .document-title small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .document-title small,
  .shared-row small {
    color: var(--text-faint);
  }

  .file-icon {
    display: grid;
    width: 34px;
    height: 34px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 7px;
    color: var(--text-soft);
    background: var(--surface-raised);
  }

  .row-location {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-menu {
    position: relative;
  }

  .row-menu > summary {
    list-style: none;
  }

  .row-menu[open] > summary {
    background: var(--surface-raised);
  }

  .menu-popover {
    position: absolute;
    z-index: 12;
    top: 40px;
    right: 0;
    display: grid;
    width: 190px;
    padding: 5px;
    box-shadow: 0 12px 36px rgba(15, 23, 42, 0.15);
  }

  .menu-popover a,
  .menu-popover button {
    display: flex;
    min-height: 36px;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border: 0;
    border-radius: 6px;
    color: var(--text);
    background: transparent;
    font: inherit;
    text-align: left;
  }

  .menu-popover a:hover,
  .menu-popover button:hover {
    background: var(--surface-hover);
  }

  .menu-popover .danger {
    color: var(--danger);
  }

  .shared-files {
    margin-top: 32px;
  }

  .shared-files h2 {
    margin-bottom: 10px;
  }

  .shared-row {
    display: grid;
    min-height: 58px;
    grid-template-columns: 22px 1fr 22px;
    align-items: center;
    gap: 10px;
    padding: 7px 4px;
    border-bottom: 1px solid var(--border);
  }

  .field-gap {
    margin-top: 14px;
  }

  .form-error {
    margin: 12px 0 0;
    color: var(--danger);
    font-size: 12px;
  }

  .dialog-copy {
    margin: 0;
    color: var(--text-soft);
  }

  @media (max-width: 760px) {
    .library-toolbar {
      grid-template-columns: 1fr 1fr;
    }

    .document-search {
      grid-column: 1 / -1;
    }

    .document-heading {
      display: none;
    }

    .document-row {
      grid-template-columns: minmax(0, 1fr) 36px;
      gap: 8px;
      padding: 9px 2px;
    }

    .document-row > span:not(.file-icon),
    .document-row > .row-location {
      display: none;
    }
  }
</style>
