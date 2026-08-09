<script lang="ts">
  import { CalendarCheck2, LockKeyhole, RefreshCw, X } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';

  let { data, form } = $props();
  const sessionKey = (session: { taskId: string; date: string; startTime: string }) =>
    `${session.taskId}|${session.date}|${session.startTime}`;
  const excludedWith = (taskId: string) => [...new Set([...data.excluded, taskId])].join(',');
</script>

<svelte:head>
  <title>Weekly planning · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    eyebrow="Deterministic plan"
    title="Plan the study week"
    description="Preview a realistic plan around classes, sleep, travel, rest, deadlines, and weak topics."
    backHref="/timetable"
    backLabel="Timetable"
  >
    {#snippet actions()}
      <a class="button" href="/planning"><RefreshCw size={16} /> Regenerate</a>
    {/snippet}
  </PageHeader>

  <Toast
    message={form?.error
      ? form.error
      : form?.success
        ? `Added ${form.count} approved session${form.count === 1 ? '' : 's'} to the timetable.`
        : ''}
    tone={form?.error ? 'error' : 'success'}
    token={form}
  />

  <div class="rules-strip">
    <span><LockKeyhole size={14} /> Classes and locked time never move</span>
    <span>{data.preferences.preferredSessionMinutes} min sessions</span>
    <span
      >{Math.round((data.preferences.maxWeekdayStudyMinutes / 60) * 10) / 10} h weekday limit</span
    >
    <span>15% left unscheduled</span>
  </div>

  {#if data.proposals.length}
    <form method="POST" action="?/approve">
      <input type="hidden" name="excluded" value={data.excluded.join(',')} />
      <div class="plan-days">
        {#each [...new Set(data.proposals.map((proposal) => proposal.date))] as date}
          <section class="plan-day">
            <header>
              <strong>
                {new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  timeZone: 'UTC'
                })}
              </strong>
              <span>
                {data.proposals
                  .filter((proposal) => proposal.date === date)
                  .reduce((sum, proposal) => sum + proposal.minutes, 0)} min
              </span>
            </header>
            {#each data.proposals.filter((proposal) => proposal.date === date) as session}
              <article class="session-row">
                <input
                  type="checkbox"
                  name="session"
                  value={sessionKey(session)}
                  checked
                  aria-label={`Approve ${session.title}`}
                />
                <span class="session-time">
                  <label class="sr-only" for={`start-${sessionKey(session)}`}
                    >Start time for {session.title}</label
                  >
                  <input
                    id={`start-${sessionKey(session)}`}
                    name={`start:${sessionKey(session)}`}
                    type="time"
                    step="900"
                    value={session.startTime}
                  />
                  <span>–</span>
                  <label class="sr-only" for={`end-${sessionKey(session)}`}
                    >End time for {session.title}</label
                  >
                  <input
                    id={`end-${sessionKey(session)}`}
                    name={`end:${sessionKey(session)}`}
                    type="time"
                    step="900"
                    value={session.endTime}
                  />
                </span>
                <span class="module-dot"></span>
                <span class="session-main">
                  <strong>{session.title}</strong>
                  <small>{session.moduleCode ?? 'General'} · {session.reason}</small>
                </span>
                <label class="lock-control" title="Lock this session after approval">
                  <input type="checkbox" name={`lock:${sessionKey(session)}`} />
                  <LockKeyhole size={14} />
                  <span class="sr-only">Lock {session.title}</span>
                </label>
                <a
                  class="reject-link"
                  href={`?exclude=${excludedWith(session.taskId)}`}
                  title="Remove this task and regenerate the remaining plan"
                  aria-label={`Remove ${session.title} from this plan`}
                  onclick={(event) => event.stopPropagation()}
                >
                  <X size={15} />
                </a>
              </article>
            {/each}
          </section>
        {/each}
      </div>
      <div class="approval-bar">
        <p>
          <strong>Nothing is saved yet.</strong>
          Edit times directly, lock fixed sessions, or uncheck one to reject it. Removing a task regenerates
          only the remaining work.
        </p>
        <button class="button button-primary" type="submit">
          <CalendarCheck2 size={16} /> Approve selected sessions
        </button>
      </div>
    </form>
  {:else}
    <EmptyState
      title={data.taskCount ? 'No safe study slots found' : 'No work to schedule'}
      description={data.taskCount
        ? 'Adjust study limits or blocked periods, then regenerate.'
        : 'Add estimated tasks before creating a weekly plan.'}
    >
      {#snippet action()}
        <a class="button button-primary" href={data.taskCount ? '/settings' : '/tasks?new=1'}>
          {data.taskCount ? 'Adjust preferences' : 'Add a task'}
        </a>
      {/snippet}
    </EmptyState>
  {/if}
</div>

<style>
  .rules-strip {
    display: flex;
    overflow-x: auto;
    gap: 18px;
    padding: 12px 0;
    border-block: 1px solid var(--border);
    color: var(--text-soft);
    font-size: 11px;
    white-space: nowrap;
  }

  .rules-strip span {
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .plan-days {
    margin-top: 28px;
  }

  .plan-day {
    margin-bottom: 28px;
  }

  .plan-day > header {
    display: flex;
    justify-content: space-between;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--border);
  }

  .plan-day > header span {
    color: var(--text-soft);
    font-size: 11px;
  }

  .session-row {
    display: flex;
    min-height: 66px;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid var(--border);
  }

  .session-row > input[type='checkbox'] {
    width: 17px;
    height: 17px;
  }

  .session-time {
    display: flex;
    width: 176px;
    align-items: center;
    gap: 3px;
    color: var(--text-soft);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .session-time input {
    width: 82px;
    min-height: 32px;
    padding: 4px 5px;
    font-size: 10px;
  }

  .session-main {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .session-main small {
    overflow: hidden;
    color: var(--text-soft);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reject-link {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 6px;
    color: var(--text-faint);
  }

  .lock-control {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 6px;
    color: var(--text-faint);
    cursor: pointer;
  }

  .lock-control:hover,
  .lock-control:has(input:checked) {
    color: var(--text);
    background: var(--surface-hover);
  }

  .lock-control input {
    position: absolute;
    width: 1px;
    height: 1px;
    opacity: 0;
  }

  .reject-link:hover {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .approval-bar {
    position: sticky;
    z-index: 10;
    bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    padding: 14px 16px;
    border: 1px solid var(--border-strong);
    border-radius: 9px;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    box-shadow: 0 10px 34px rgba(0, 0, 0, 0.1);
    backdrop-filter: blur(12px);
  }

  .approval-bar p {
    margin: 0;
    color: var(--text-soft);
    font-size: 11px;
  }

  @media (max-width: 680px) {
    .session-row {
      align-items: flex-start;
      flex-wrap: wrap;
      padding: 12px 0;
    }

    .session-main {
      width: calc(100% - 250px);
    }

    .session-main small {
      white-space: normal;
    }

    .approval-bar {
      bottom: 84px;
      align-items: stretch;
      flex-direction: column;
    }
  }
</style>
