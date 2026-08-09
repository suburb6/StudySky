<script lang="ts">
  import { X } from '@lucide/svelte';
  import type { Snippet } from 'svelte';

  let {
    open = $bindable(false),
    title,
    description,
    size = 'medium',
    children
  }: {
    open?: boolean;
    title: string;
    description?: string;
    size?: 'small' | 'medium' | 'large';
    children: Snippet;
  } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  function close() {
    open = false;
  }
</script>

<dialog
  bind:this={dialog}
  class={`dialog-${size}`}
  aria-label={title}
  onclose={close}
  onclick={(event) => {
    if (event.target === dialog) close();
  }}
>
  <header class="dialog-header">
    <div>
      <h2>{title}</h2>
      {#if description}<p>{description}</p>{/if}
    </div>
    <button
      class="button button-icon button-quiet"
      type="button"
      onclick={close}
      aria-label="Close"
    >
      <X size={17} />
    </button>
  </header>
  <div class="dialog-content">{@render children()}</div>
</dialog>

<style>
  .dialog-header {
    position: sticky;
    z-index: 2;
    top: 0;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }

  .dialog-header h2 {
    margin-bottom: 2px;
    font-size: 18px;
  }

  .dialog-header p {
    margin: 0;
    color: var(--text-soft);
    font-size: 12px;
  }

  .dialog-content {
    padding: 20px;
  }

  :global(.dialog-content > form) {
    padding: 0;
  }

  :global(dialog.dialog-small) {
    width: min(calc(100% - 32px), 480px);
  }

  :global(dialog.dialog-large) {
    width: min(calc(100% - 32px), 860px);
    max-height: min(90vh, 860px);
  }
</style>
