<script lang="ts">
  import { onMount } from 'svelte';
  import { Cloud, CloudOff } from '@lucide/svelte';

  let online = $state(true);

  onMount(() => {
    const update = () => (online = navigator.onLine);
    update();
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => {
      removeEventListener('online', update);
      removeEventListener('offline', update);
    };
  });
</script>

<span
  class:offline={!online}
  class="sync-status"
  aria-live="polite"
  title={online ? 'Online' : 'Offline'}
>
  {#if online}
    <Cloud size={15} aria-hidden="true" />
    <span class="sync-label">Synced</span>
  {:else}
    <CloudOff size={15} aria-hidden="true" />
    <span class="sync-label">Offline</span>
  {/if}
</span>

<style>
  .sync-status {
    display: inline-flex;
    min-height: 32px;
    align-items: center;
    gap: 6px;
    color: var(--text-faint);
    font-size: 12px;
  }

  .sync-status.offline {
    color: var(--warning);
  }
</style>
