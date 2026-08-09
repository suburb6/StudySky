<script lang="ts">
  import { Check, CircleAlert, Info, X } from '@lucide/svelte';
  import { onDestroy } from 'svelte';

  let {
    message = '',
    tone = 'success',
    token,
    duration = 5_000
  }: {
    message?: string;
    tone?: 'success' | 'error' | 'info';
    token?: unknown;
    duration?: number;
  } = $props();

  let visible = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    void token;
    if (!message) {
      visible = false;
      return;
    }
    visible = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      visible = false;
    }, duration);
  });

  onDestroy(() => {
    if (timer) clearTimeout(timer);
  });
</script>

{#if visible && message}
  <aside
    class:error={tone === 'error'}
    class:info={tone === 'info'}
    class="toast"
    role={tone === 'error' ? 'alert' : 'status'}
    aria-live={tone === 'error' ? 'assertive' : 'polite'}
  >
    <span class="toast-icon" aria-hidden="true">
      {#if tone === 'error'}
        <CircleAlert size={17} />
      {:else if tone === 'info'}
        <Info size={17} />
      {:else}
        <Check size={17} />
      {/if}
    </span>
    <p>{message}</p>
    <button type="button" onclick={() => (visible = false)} aria-label="Dismiss notification">
      <X size={15} />
    </button>
  </aside>
{/if}

<style>
  .toast {
    position: fixed;
    z-index: 100;
    top: 18px;
    right: 18px;
    display: grid;
    width: min(380px, calc(100vw - 36px));
    min-height: 52px;
    grid-template-columns: 28px minmax(0, 1fr) 28px;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border: 1px solid color-mix(in srgb, var(--success) 32%, var(--border));
    border-radius: 9px;
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 12px 36px rgba(15, 23, 42, 0.16);
    animation: toast-in 180ms ease-out;
  }

  .toast.error {
    border-color: color-mix(in srgb, var(--danger) 35%, var(--border));
  }

  .toast.info {
    border-color: color-mix(in srgb, var(--accent) 28%, var(--border));
  }

  .toast-icon {
    display: grid;
    width: 28px;
    height: 28px;
    place-items: center;
    border-radius: 7px;
    color: var(--success);
    background: var(--success-soft);
  }

  .error .toast-icon {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .info .toast-icon {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .toast p {
    margin: 0;
    font-size: 13px;
    font-weight: 550;
  }

  .toast button {
    display: grid;
    width: 28px;
    height: 28px;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 6px;
    color: var(--text-soft);
    background: transparent;
  }

  .toast button:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
  }

  @media (max-width: 760px) {
    .toast {
      top: auto;
      right: 12px;
      bottom: calc(82px + env(safe-area-inset-bottom));
      width: calc(100vw - 24px);
    }
  }
</style>
