<script lang="ts">
  import { BellRing, BellOff } from '@lucide/svelte';
  import { onMount } from 'svelte';

  let { configured }: { configured: boolean } = $props();
  let supported = $state(false);
  let permission = $state<NotificationPermission>('default');
  let busy = $state(false);
  let message = $state('');

  onMount(() => {
    supported =
      configured &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window;
    if ('Notification' in window) permission = Notification.permission;
  });

  async function enable() {
    busy = true;
    message = '';
    try {
      permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        message = 'Browser notifications were not enabled. In-app reminders still work.';
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const keyResponse = await fetch('/api/push/public-key');
      const keyValue = await keyResponse.json();
      if (!keyResponse.ok) throw new Error(keyValue.error ?? 'Push is not configured.');
      let subscription = await registration.pushManager.getSubscription();
      subscription ??= await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeKey(keyValue.publicKey)
      });
      const response = await fetch('/api/push/subscription', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(subscription)
      });
      if (!response.ok) throw new Error('Could not save this browser subscription.');
      message = 'Browser notifications enabled for this device.';
    } catch (error) {
      message = error instanceof Error ? error.message : 'Could not enable notifications.';
    } finally {
      busy = false;
    }
  }

  async function disable() {
    busy = true;
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await fetch('/api/push/subscription', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
        await subscription.unsubscribe();
      }
      message = 'Browser notifications disabled on this device.';
    } finally {
      busy = false;
    }
  }

  function decodeKey(value: string) {
    const padding = '='.repeat((4 - (value.length % 4)) % 4);
    const bytes = atob((value + padding).replaceAll('-', '+').replaceAll('_', '/'));
    return Uint8Array.from(bytes, (character) => character.charCodeAt(0));
  }
</script>

<div class="push-settings surface panel">
  <div>
    <h2>Browser notifications</h2>
    <p>
      In-app reminders always work. Browser push is optional and is only sent from your StudySky
      server.
    </p>
  </div>
  {#if !configured}
    <span class="pill">VAPID keys not configured</span>
  {:else if !supported}
    <span class="pill">Not supported here</span>
  {:else if permission === 'granted'}
    <button class="button" type="button" onclick={disable} disabled={busy}>
      <BellOff size={15} /> Disable on this device
    </button>
  {:else}
    <button class="button button-primary" type="button" onclick={enable} disabled={busy}>
      <BellRing size={15} />
      {busy ? 'Enabling…' : 'Enable on this device'}
    </button>
  {/if}
  {#if message}<p class="subtle status" role="status">{message}</p>{/if}
</div>

<style>
  .push-settings {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 18px;
    margin-bottom: 24px;
  }

  .push-settings h2,
  .push-settings p {
    margin-bottom: 2px;
  }

  .push-settings p {
    color: var(--text-soft);
    font-size: 12px;
  }

  .status {
    width: 100%;
  }

  @media (max-width: 620px) {
    .push-settings {
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
