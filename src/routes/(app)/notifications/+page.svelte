<script lang="ts">
  import { Bell, CheckCheck, Circle } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import PushNotifications from '$lib/components/PushNotifications.svelte';
  import { humanize } from '$lib/domain/labels';

  let { data } = $props();
</script>

<svelte:head>
  <title>Notifications · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    eyebrow="Quiet reminders"
    title="Notifications"
    description="A restrained in-app history for deadlines, revision, classes, scans, and weekly planning."
    backHref="/today"
    backLabel="Today"
  >
    {#snippet actions()}
      {#if data.unread}
        <form method="POST" action="?/readAll">
          <button class="button" type="submit"><CheckCheck size={16} /> Mark all read</button>
        </form>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="page-narrow">
    <PushNotifications configured={data.pushConfigured} />

    {#if data.notifications.length}
      <div class="notification-list">
        {#each data.notifications as notification}
          <article class:unread={!notification.readAt} class="notification-row">
            <span class="notification-icon"><Bell size={16} /></span>
            <a class="notification-copy" href={notification.href ?? '/notifications'}>
              <span class="eyebrow">{humanize(notification.kind)}</span>
              <strong>{notification.title}</strong>
              {#if notification.body}<span>{notification.body}</span>{/if}
              <small>
                {new Date(notification.createdAt).toLocaleString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: data.user.timezone
                })}
              </small>
            </a>
            {#if !notification.readAt}
              <form method="POST" action="?/read">
                <input type="hidden" name="notificationId" value={notification.id} />
                <button
                  class="button button-icon button-quiet"
                  type="submit"
                  aria-label={`Mark ${notification.title} as read`}
                >
                  <Circle size={13} fill="currentColor" />
                </button>
              </form>
            {/if}
          </article>
        {/each}
      </div>
    {:else}
      <EmptyState
        title="No notifications"
        description="Useful reminders will appear here without crowding your study view."
      />
    {/if}
  </div>
</div>

<style>
  .notification-list {
    border-top: 1px solid var(--border);
  }

  .notification-row {
    display: flex;
    min-height: 82px;
    align-items: flex-start;
    gap: 11px;
    padding: 13px 4px;
    border-bottom: 1px solid var(--border);
  }

  .notification-row.unread {
    background: color-mix(in srgb, var(--surface-hover) 55%, transparent);
  }

  .notification-icon {
    display: grid;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 7px;
    color: var(--text-soft);
    background: var(--surface-hover);
  }

  .notification-copy {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .notification-copy .eyebrow {
    margin-bottom: 1px;
  }

  .notification-copy > span:not(.eyebrow) {
    color: var(--text-soft);
    font-size: 12px;
  }

  .notification-copy small {
    margin-top: 4px;
    color: var(--text-faint);
    font-size: 10px;
  }
</style>
