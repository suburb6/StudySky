<script lang="ts">
  import { onMount } from 'svelte';
  import { addOfflineRecord, deleteOfflineRecord, listOfflineRecords } from '$lib/offline/queue';

  let { ownerUserId }: { ownerUserId: string } = $props();
  let status = $state('');

  onMount(() => {
    assignClientIds();
    const observer = new MutationObserver(assignClientIds);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('submit', captureOfflineDraft, true);
    addEventListener('online', flushTaskDrafts);
    if (navigator.onLine) void flushTaskDrafts();
    return () => {
      observer.disconnect();
      document.removeEventListener('submit', captureOfflineDraft, true);
      removeEventListener('online', flushTaskDrafts);
    };
  });

  function assignClientIds() {
    document.querySelectorAll<HTMLInputElement>('[data-client-id]').forEach((input) => {
      if (!input.value) input.value = crypto.randomUUID();
    });
  }

  async function captureOfflineDraft(event: SubmitEvent) {
    if (navigator.onLine) return;
    const form = event.target as HTMLFormElement | null;
    if (!form?.matches('[data-offline-draft="task"]')) return;
    event.preventDefault();
    const fields = Array.from(new FormData(form).entries())
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      .map(([key, value]) => [key, value] as [string, string]);
    await addOfflineRecord({
      ownerUserId,
      kind: 'task',
      createdAt: new Date().toISOString(),
      action: form.action,
      fields
    });
    status = 'Task draft saved on this device. It will sync when you are online.';
    form.reset();
    assignClientIds();
  }

  async function flushTaskDrafts() {
    const records = await listOfflineRecords(ownerUserId);
    let synced = 0;
    for (const record of records) {
      if (record.kind !== 'task' || !record.id) continue;
      const body = new FormData();
      record.fields.forEach(([key, value]) => body.append(key, value));
      body.set('ownerUserId', ownerUserId);
      try {
        const response = await fetch(record.action, { method: 'POST', body });
        if (response.ok) {
          await deleteOfflineRecord(record.id, ownerUserId);
          synced += 1;
        } else if (response.status === 409) {
          status = 'This draft belongs to another signed-in account. Sign back in to sync it.';
          break;
        }
      } catch {
        break;
      }
    }
    if (synced) status = `${synced} offline task draft${synced === 1 ? '' : 's'} synced.`;
  }
</script>

{#if status}
  <div class="offline-toast" role="status">
    {status}
    <button type="button" onclick={() => (status = '')} aria-label="Dismiss">×</button>
  </div>
{/if}

<style>
  .offline-toast {
    position: fixed;
    z-index: 100;
    right: 18px;
    bottom: 18px;
    display: flex;
    max-width: 380px;
    align-items: center;
    gap: 12px;
    padding: 11px 12px;
    border: 1px solid var(--border-strong);
    border-radius: 8px;
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 12px 36px rgba(0, 0, 0, 0.14);
    font-size: 12px;
  }

  .offline-toast button {
    border: 0;
    color: var(--text-soft);
    background: transparent;
  }

  @media (max-width: 760px) {
    .offline-toast {
      right: 10px;
      bottom: calc(82px + env(safe-area-inset-bottom));
      left: 10px;
    }
  }
</style>
