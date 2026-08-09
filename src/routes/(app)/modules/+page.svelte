<script lang="ts">
  import { ArrowRight, BookOpen, Plus, QrCode } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';

  let { data, form } = $props();
  let createOpen = $state(false);

  $effect(() => {
    if (form?.action === 'create' && form?.error) createOpen = true;
  });
</script>

<svelte:head>
  <title>Modules · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    eyebrow="Study areas"
    title="Modules"
    description="Keep each study area, its chapters, materials, and active work together."
  >
    {#snippet actions()}
      <a class="button" href="/modules/labels"><QrCode size={16} /> Labels</a>
      <button class="button button-primary" type="button" onclick={() => (createOpen = true)}>
        <Plus size={16} /> Add module
      </button>
    {/snippet}
  </PageHeader>

  <Toast
    message={form?.error ? form.error : form?.success ? 'Module added.' : ''}
    tone={form?.error ? 'error' : 'success'}
    token={form}
  />

  {#if data.modules.length}
    <div class="module-list">
      {#each data.modules as module}
        <a class="module-row" href={`/modules/${module.id}`}>
          <span class="module-icon" style={`--module-color: ${module.color}`}>
            <BookOpen size={18} strokeWidth={1.7} />
          </span>
          <span class="module-main">
            <span class="module-title">
              <strong>{module.code}</strong>
              <span>{module.name}</span>
              {#if !module.isCurrent}<span class="pill">Foundation</span>{/if}
            </span>
            <span class="module-meta">
              {module.chapterCount} chapters · {module.activeTasks} active tasks ·
              {module.materialCount} materials
            </span>
          </span>
          <ArrowRight size={16} class="row-arrow" />
        </a>
      {/each}
    </div>
  {:else}
    <EmptyState
      title="No modules yet"
      description="Add your first study area to begin organising work."
    />
  {/if}

  <Modal bind:open={createOpen} title="Add module">
    <form method="POST" action="?/create">
      {#if form?.action === 'create' && form?.error}
        <p class="error-message" role="alert">{form.error}</p>
      {/if}
      <div class="form-grid">
        <div class="field">
          <label for="module-code">Code</label>
          <input id="module-code" name="code" placeholder="e.g. CSC201" required />
        </div>
        <div class="field">
          <label for="module-name">Name</label>
          <input id="module-name" name="name" placeholder="Module name" required />
        </div>
        <div class="field">
          <label for="lecturer-name">Lecturer (optional)</label>
          <input id="lecturer-name" name="lecturerName" />
        </div>
        <div class="field">
          <label for="module-color">Module colour</label>
          <input id="module-color" name="color" type="color" value="#126bfa" />
        </div>
      </div>
      <div class="form-actions">
        <button class="button" type="button" onclick={() => (createOpen = false)}>Cancel</button>
        <button class="button button-primary" type="submit">Add module</button>
      </div>
    </form>
  </Modal>
</div>

<style>
  .module-list {
    border-top: 1px solid var(--border);
  }

  .module-row {
    display: flex;
    min-height: 76px;
    align-items: center;
    gap: 14px;
    padding: 12px 6px;
    border-bottom: 1px solid var(--border);
    transition: background-color 150ms ease;
  }

  .module-row:hover {
    background: var(--surface-hover);
  }

  .module-icon {
    display: grid;
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 8px;
    color: var(--module-color);
    background: color-mix(in srgb, var(--module-color) 12%, var(--surface));
  }

  .module-main {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 4px;
  }

  .module-title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 8px;
  }

  .module-title strong {
    font-size: 12px;
  }

  .module-title > span:not(.pill) {
    overflow: hidden;
    font-weight: 540;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .module-meta {
    color: var(--text-soft);
    font-size: 12px;
  }

  :global(.row-arrow) {
    color: var(--text-faint);
  }
</style>
