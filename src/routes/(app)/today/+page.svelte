<script lang="ts">
  import { CalendarClock, Plus, RotateCcw } from '@lucide/svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { enhance } from '$app/forms';
  import TaskEditor from '$lib/components/TaskEditor.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { dateKeyInTimeZone } from '$lib/domain/time';

  let { data } = $props();
  let editOpen = $state(false);
  let editingTask = $state<(typeof data.scheduled)[number]['task'] | null>(null);
  let error = $state('');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayDay = $derived(new Date(`${data.date}T00:00:00Z`).getUTCDay());
  const todayEntries = $derived(
    data.timetable
      .filter((row) =>
        row.entry.isRecurring
          ? row.entry.dayOfWeek === todayDay
          : row.entry.oneTimeDate === data.date
      )
      .sort((first, second) => first.entry.startTime.localeCompare(second.entry.startTime))
  );
</script>

<svelte:head>
  <title>Today · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader title="Today" description="Your schedule and the study that needs attention now.">
    {#snippet actions()}
      <a class="button button-primary" href="/tasks?new=1"><Plus size={16} /> Add task</a>
    {/snippet}
  </PageHeader>

  <Toast message={error} tone="error" token={error} />
  <section class="surface panel stack" aria-labelledby="today-work">
    <div class="row-between">
      <h2 id="today-work">Your next tasks</h2>
      <a class="subtle" href="/tasks">All tasks</a>
    </div>
    {#if data.scheduled.length}
      {#each data.scheduled.slice(0, 8) as row}
        <div class="row-between">
          <button
            class="task-link"
            onclick={() => {
              editingTask = row.task;
              editOpen = true;
            }}
          >
            <strong>{row.task.title}</strong>
            <small
              >{row.moduleCode ?? 'General'} · {row.task.estimatedMinutes} min
              {#if row.task.deadline}
                · {dateKeyInTimeZone(new Date(row.task.deadline), data.user.timezone) < data.date
                  ? 'Overdue'
                  : dateKeyInTimeZone(new Date(row.task.deadline), data.user.timezone) === data.date
                    ? 'Due today'
                    : `Due ${dateKeyInTimeZone(new Date(row.task.deadline), data.user.timezone)}`}{/if}
            </small>
          </button>
          <form
            method="POST"
            action="/tasks?/status"
            use:enhance={() =>
              async ({ result, update }) => {
                if (result.type === 'success') {
                  error = '';
                  await update();
                } else
                  error =
                    result.type === 'failure'
                      ? String(result.data?.error ?? 'Could not complete task.')
                      : 'Could not complete task.';
              }}
          >
            <input type="hidden" name="taskId" value={row.task.id} />
            <input type="hidden" name="status" value="done" />
            <button class="button button-sm" aria-label={`Complete ${row.task.title}`}>Done</button>
          </form>
        </div>
      {/each}
      {#if data.scheduled.length > 8}<a class="subtle" href="/tasks"
          >View all {data.scheduled.length} tasks needing attention</a
        >{/if}
    {:else}<p class="muted">No overdue work or tasks planned for today.</p>{/if}
  </section>
  <TaskEditor bind:open={editOpen} task={editingTask} timezone={data.user.timezone} />
  <div class="today-grid">
    <section class="today-card" aria-labelledby="today-timetable">
      <div class="card-heading">
        <div>
          <span>{days[todayDay]}</span>
          <h2 id="today-timetable">Today’s timetable</h2>
        </div>
        <a class="subtle" href="/timetable">Open timetable</a>
      </div>
      {#if todayEntries.length}
        <ul class="today-list">
          {#each todayEntries as row}
            <li>
              <span class="time">{row.entry.startTime.slice(0, 5)}</span>
              <span class="event-copy">
                <strong>{row.entry.title}</strong>
                <small>
                  {row.entry.endTime.slice(0, 5)}
                  {#if row.entry.location}
                    · {row.entry.location}{/if}
                </small>
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="quiet-state">
          <CalendarClock size={20} />
          <span><strong>No classes today</strong><small>Your timetable is clear.</small></span>
        </div>
      {/if}
    </section>

    <section class="today-card" aria-labelledby="revision-due">
      <div class="card-heading">
        <div>
          <span>Due now</span>
          <h2 id="revision-due">Revision</h2>
        </div>
        <a class="subtle" href="/revision">Open queue</a>
      </div>
      {#if data.revisions.length}
        <ul class="today-list">
          {#each data.revisions.slice(0, 5) as row}
            <li>
              <span
                class="module-mark"
                style={`--module-color: ${row.moduleColor ?? 'var(--accent)'}`}
              ></span>
              <span class="event-copy">
                <strong>{row.revision.title}</strong>
                <small>
                  {new Date(row.revision.dueAt) < new Date() ? 'Overdue' : 'Due today'}
                  {#if row.moduleCode}
                    · {row.moduleCode}{/if}
                </small>
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <div class="quiet-state">
          <RotateCcw size={20} />
          <span><strong>Nothing due</strong><small>No revision needs attention today.</small></span>
        </div>
      {/if}
    </section>
  </div>
</div>

<style>
  .task-link {
    display: grid;
    gap: 3px;
    padding: 4px 0;
    border: 0;
    background: transparent;
    color: var(--text);
    text-align: left;
  }
  .task-link:hover strong {
    text-decoration: underline;
  }
  .task-link small {
    color: var(--text-soft);
  }
  .today-grid {
    margin-top: 18px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .today-card {
    min-height: 260px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
  }

  .card-heading {
    display: flex;
    min-height: 70px;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .card-heading > div {
    display: grid;
    gap: 2px;
  }

  .card-heading span {
    color: var(--text-faint);
    font-size: 10px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .card-heading h2 {
    margin: 0;
    font-size: 15px;
  }

  .today-list {
    margin: 0;
    padding: 0 16px;
    list-style: none;
  }

  .today-list li {
    display: flex;
    min-height: 58px;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid var(--border);
  }

  .today-list li:last-child {
    border-bottom: 0;
  }

  .time {
    width: 42px;
    flex: 0 0 auto;
    color: var(--text-soft);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .event-copy {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .event-copy strong {
    overflow: hidden;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .event-copy small {
    color: var(--text-soft);
  }

  .module-mark {
    width: 3px;
    height: 28px;
    flex: 0 0 auto;
    border-radius: 999px;
    background: var(--module-color);
  }

  .quiet-state {
    display: flex;
    min-height: 188px;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: var(--text-faint);
  }

  .quiet-state span {
    display: grid;
  }

  .quiet-state strong {
    color: var(--text-soft);
    font-size: 12px;
  }

  @media (max-width: 760px) {
    .today-grid {
      grid-template-columns: 1fr;
    }

    .today-card {
      min-height: 220px;
    }

    .quiet-state {
      min-height: 150px;
    }
  }
</style>
