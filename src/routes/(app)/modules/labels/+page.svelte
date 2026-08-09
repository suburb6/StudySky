<script lang="ts">
  import { Printer, ScanLine } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Notebook labels · StudySky</title>
</svelte:head>

<div class="page labels-page">
  <PageHeader
    eyebrow="Physical notebooks"
    title="Notebook labels"
    description="Print and attach a label. Scanning its QR code opens capture with the module already selected."
    backHref="/modules"
    backLabel="Modules"
  >
    {#snippet actions()}
      <button class="button button-primary" type="button" onclick={() => window.print()}>
        <Printer size={16} /> Print
      </button>
    {/snippet}
  </PageHeader>

  {#if data.labels.length}
    <div class="label-grid">
      {#each data.labels as label}
        <article class="notebook-label" style={`--module-color: ${label.color}`}>
          <div class="label-copy">
            <p class="brand"><ScanLine size={15} /> StudySky</p>
            <p class="module-code">{label.code}</p>
            <h2>{label.name}</h2>
            {#if label.notebookName || label.notebookNumber}
              <p class="notebook-meta">
                {label.notebookName || 'Notebook'}
                {label.notebookNumber ? ` · ${label.notebookNumber}` : ''}
              </p>
            {/if}
            <p class="instruction">Scan to file new pages in this module</p>
          </div>
          <img src={label.qr} alt={`QR code to scan notes for ${label.code}`} />
        </article>
      {/each}
    </div>
  {:else}
    <EmptyState
      title="No labels to print"
      description="Add a module first, then return to create its notebook label."
    />
  {/if}
</div>

<style>
  .label-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 16px;
  }

  .notebook-label {
    display: grid;
    min-height: 210px;
    grid-template-columns: 1fr 150px;
    gap: 16px;
    align-items: center;
    padding: 22px;
    border: 2px solid var(--module-color);
    border-radius: 10px;
    break-inside: avoid;
    background: #fff;
    color: #262522;
  }

  .notebook-label img {
    width: 150px;
    height: 150px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 16px;
    font-size: 11px;
    font-weight: 650;
  }

  .module-code {
    margin-bottom: 2px;
    color: var(--module-color);
    font-size: 13px;
    font-weight: 750;
    letter-spacing: 0.08em;
  }

  .notebook-label h2 {
    margin-bottom: 8px;
    font-size: 20px;
  }

  .notebook-meta {
    margin-bottom: 4px;
    font-size: 12px;
  }

  .instruction {
    margin: 22px 0 0;
    color: #6f6e69;
    font-size: 10px;
  }

  @media (max-width: 900px) {
    .label-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (max-width: 480px) {
    .notebook-label {
      grid-template-columns: 1fr 112px;
      min-height: 170px;
      padding: 16px;
    }

    .notebook-label img {
      width: 112px;
      height: 112px;
    }
  }

  @media print {
    :global(.sidebar),
    :global(.topbar),
    :global(.mobile-nav),
    :global(.page-header) {
      display: none !important;
    }

    :global(.workspace-content) {
      margin: 0 !important;
    }

    .labels-page {
      width: auto;
      padding: 8mm;
    }

    .label-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 6mm;
    }

    .notebook-label {
      box-shadow: none;
    }
  }
</style>
