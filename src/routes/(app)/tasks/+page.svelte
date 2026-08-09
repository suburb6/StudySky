<script lang="ts">
  import { page } from '$app/state';
  import { Check, Clock3, Plus, Timer } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import FocusTimer from '$lib/components/FocusTimer.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { taskStatusLabels, taskTypeLabels } from '$lib/domain/labels';

  let { data, form } = $props();
  let createOpen = $state(false);
  let taskModuleId = $state('');
  const views = [
    ['all', 'All'],
    ['today', 'Today'],
    ['by_module', 'By Module'],
    ['completed', 'Completed']
  ];
  const taskChapters = $derived(
    data.chapters.filter((chapter) => !taskModuleId || chapter.moduleId === taskModuleId)
  );
  const calendarMoment = (row: { task: { scheduledStart: Date | null; deadline: Date | null } }) =>
    row.task.scheduledStart ?? row.task.deadline;

  $effect(() => {
    if (page.url.searchParams.get('new') === '1' || (form?.action === 'create' && form?.error)) {
      createOpen = true;
    }
  });
</script>

<svelte:head>
  <title>Tasks · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader title="Tasks" description="The concrete work you need to finish.">
    {#snippet actions()}
      <button class="button button-primary" type="button" onclick={() => (createOpen = true)}>
        <Plus size={16} /> Add task
      </button>
    {/snippet}
  </PageHeader>

  <Toast
    message={form?.error
      ? form.error
      : form?.success && form?.action === 'finishFocus'
        ? form.nextAction
        : form?.success
          ? 'Saved.'
          : ''}
    tone={form?.error ? 'error' : 'success'}
    token={form}
  />

  {#if data.taskOptions.length}
    <details class="focus-disclosure surface">
      <summary><Timer size={16} /> Start a focus session</summary>
      <div class="focus-body">
        <FocusTimer
          tasks={data.taskOptions.map((task) => ({
            id: task.id,
            title: task.title,
            estimatedMinutes: task.estimatedMinutes
          }))}
        />
      </div>
    </details>
  {/if}

  <nav class="view-tabs section" aria-label="Task views">
    {#each views as [value, label]}
      <a class:active={data.view === value} href={`?view=${value}`}>{label}</a>
    {/each}
  </nav>

  {#if data.tasks.length}
    <div class="task-list">
      {#each data.tasks as row, index}
        {#if data.view === 'by_module' && (index === 0 || (data.tasks[index - 1]?.moduleCode ?? 'General') !== (row.moduleCode ?? 'General'))}
          <h2 class="group-heading">
            {row.moduleCode ? `${row.moduleCode} · ${row.moduleName}` : 'General'}
          </h2>
        {:else if data.view === 'calendar' && (index === 0 || calendarMoment(data.tasks[index - 1])
              ?.toISOString()
              .slice(0, 10) !== calendarMoment(row)?.toISOString().slice(0, 10))}
          <h2 class="group-heading">
            {calendarMoment(row)?.toLocaleDateString('en-GB', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              timeZone: data.user.timezone
            }) ?? 'Unscheduled'}
          </h2>
        {/if}
        <article class="task-row">
          <form method="POST" action="?/status">
            <input type="hidden" name="taskId" value={row.task.id} />
            <input
              type="hidden"
              name="status"
              value={row.task.status === 'done' ? 'doing' : 'done'}
            />
            <button
              class:checked={row.task.status === 'done'}
              class="complete-button"
              type="submit"
              aria-label={row.task.status === 'done'
                ? `Reopen ${row.task.title}`
                : `Complete ${row.task.title}`}
            >
              {#if row.task.status === 'done'}<Check size={13} />{/if}
            </button>
          </form>
          {#if row.moduleColor}
            <span class="module-dot" style={`--module-color: ${row.moduleColor}`}></span>
          {/if}
          <div class="task-main">
            <h2 class:done={row.task.status === 'done'}>{row.task.title}</h2>
            <p>
              {taskTypeLabels[row.task.type]}
              {#if row.moduleCode}
                · {row.moduleCode}{/if}
              {#if row.chapterTitle}
                · {row.chapterTitle}{/if}
            </p>
            {#if data.checklists.some((item) => item.taskId === row.task.id)}
              <div class="task-checklist">
                {#each data.checklists.filter((item) => item.taskId === row.task.id) as item}
                  <form method="POST" action="?/checklist">
                    <input type="hidden" name="checklistId" value={item.id} />
                    <button class:checked={item.completed} type="submit">
                      <span>{item.completed ? '✓' : ''}</span>{item.title}
                    </button>
                  </form>
                {/each}
              </div>
            {/if}
          </div>
          <div class="task-side">
            {#if row.task.priority === 'urgent' || row.task.priority === 'high'}
              <span class={`pill priority-${row.task.priority}`}>{row.task.priority}</span>
            {/if}
            <span class="duration"><Clock3 size={13} /> {row.task.estimatedMinutes}m</span>
            {#if row.task.scheduledStart}
              <time datetime={new Date(row.task.scheduledStart).toISOString()}>
                {new Date(row.task.scheduledStart).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: data.user.timezone
                })}
              </time>
            {/if}
            {#if row.task.deadline}
              <time datetime={new Date(row.task.deadline).toISOString()}>
                {new Date(row.task.deadline).toLocaleDateString('en-GB', {
                  day: 'numeric',
                  month: 'short',
                  timeZone: data.user.timezone
                })}
              </time>
            {/if}
            <form method="POST" action="?/status">
              <input type="hidden" name="taskId" value={row.task.id} />
              <label class="sr-only" for={`status-${row.task.id}`}
                >Status for {row.task.title}</label
              >
              <select
                id={`status-${row.task.id}`}
                name="status"
                value={row.task.status}
                onchange={(event) => event.currentTarget.form?.requestSubmit()}
              >
                {#each Object.entries(taskStatusLabels) as [value, label]}
                  <option {value}>{label}</option>
                {/each}
              </select>
            </form>
          </div>
        </article>
      {/each}
    </div>
  {:else}
    <div class="section">
      <EmptyState
        title="Nothing in this view"
        description="A clear task list is a good thing. Add work only when it has a useful next action."
      />
    </div>
  {/if}

  <Modal bind:open={createOpen} title="Add task">
    <form method="POST" action="?/create" class="form-grid" data-offline-draft="task">
      <input type="hidden" name="clientId" value="" data-client-id />
      <div class="field form-span">
        <label for="task-title">Title</label>
        <input id="task-title" name="title" required />
      </div>
      <div class="field">
        <label for="task-module">Module</label>
        <select id="task-module" name="moduleId" bind:value={taskModuleId}>
          <option value="">General task</option>
          {#each data.modules as module}
            <option value={module.id}>{module.code} · {module.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="task-chapter">Chapter (optional)</label>
        <select id="task-chapter" name="chapterId">
          <option value="">No chapter</option>
          {#each taskChapters as chapter}
            <option value={chapter.id}>{chapter.title}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="task-estimate">Estimated minutes</label>
        <input
          id="task-estimate"
          name="estimatedMinutes"
          type="number"
          min="5"
          max="720"
          value="30"
        />
      </div>
      <div class="field">
        <label for="task-deadline">Deadline (optional)</label>
        <input id="task-deadline" name="deadline" type="datetime-local" />
      </div>
      <details class="form-span advanced-fields">
        <summary>More details</summary>
        <div class="form-grid">
          <div class="field form-span">
            <label for="task-description">Description (optional)</label>
            <textarea id="task-description" name="description"></textarea>
          </div>
          <div class="field">
            <label for="task-type">Type</label>
            <select id="task-type" name="type">
              {#each Object.entries(taskTypeLabels) as [value, label]}
                <option {value}>{label}</option>
              {/each}
            </select>
          </div>
          <div class="field">
            <label for="task-priority">Priority</label>
            <select id="task-priority" name="priority">
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
              <option value="low">Low</option>
            </select>
          </div>
          <div class="field form-span">
            <label for="task-checklist">Checklist (optional, one item per line)</label>
            <textarea id="task-checklist" name="checklist"></textarea>
          </div>
          <div class="field form-span">
            <label for="task-notes">Working notes (optional)</label>
            <textarea id="task-notes" name="notes"></textarea>
          </div>
        </div>
      </details>
      <input type="hidden" name="status" value="inbox" />
      <input type="hidden" name="difficulty" value="3" />
      <div class="form-actions form-span">
        <span class="subtle offline-draft-note"
          >Offline drafts stay on this device until synced.</span
        >
        <button class="button button-primary" type="submit">Add task</button>
      </div>
    </form>
  </Modal>
</div>

<style>
  .view-tabs {
    display: flex;
    overflow-x: auto;
    gap: 2px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .focus-disclosure {
    overflow: hidden;
    margin-bottom: 14px;
  }

  .focus-disclosure > summary {
    display: flex;
    min-height: 44px;
    align-items: center;
    gap: 8px;
    padding: 10px 13px;
    font-weight: 600;
    list-style: none;
  }

  .focus-body :global(.focus-panel) {
    border: 0;
    border-top: 1px solid var(--border);
    border-radius: 0;
  }

  .advanced-fields {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
  }

  .advanced-fields > summary {
    min-height: 42px;
    padding: 11px 12px;
    font-weight: 600;
  }

  .advanced-fields > .form-grid {
    padding: 12px;
    border-top: 1px solid var(--border);
  }

  .view-tabs a {
    min-height: 36px;
    padding: 8px 11px;
    border-radius: 6px;
    color: var(--text-soft);
    font-size: 12px;
    white-space: nowrap;
  }

  .view-tabs a:hover,
  .view-tabs a.active {
    color: var(--text);
    background: var(--surface-hover);
  }

  .task-list {
    border-top: 1px solid var(--border);
  }

  .group-heading {
    margin: 20px 0 0;
    padding: 8px 2px;
    border-bottom: 1px solid var(--border);
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 650;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .group-heading:first-child {
    margin-top: 0;
  }

  .task-row {
    display: flex;
    min-height: 64px;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--border);
  }

  .complete-button {
    display: grid;
    width: 18px;
    height: 18px;
    padding: 0;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 5px;
    color: white;
    background: transparent;
  }

  .complete-button:hover {
    border-color: var(--success);
  }

  .complete-button.checked {
    border-color: var(--success);
    background: var(--success);
  }

  .task-main {
    min-width: 0;
    flex: 1;
  }

  .task-main h2 {
    overflow: hidden;
    margin: 0;
    font-size: 14px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-main h2.done {
    color: var(--text-faint);
    text-decoration: line-through;
  }

  .task-main p {
    margin: 2px 0 0;
    color: var(--text-soft);
    font-size: 11px;
  }

  .task-checklist {
    display: grid;
    gap: 2px;
    margin-top: 8px;
  }

  .task-checklist button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 0;
    border: 0;
    color: var(--text-soft);
    background: transparent;
    font-size: 11px;
    text-align: left;
  }

  .task-checklist button > span {
    display: grid;
    width: 14px;
    height: 14px;
    place-items: center;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
    font-size: 9px;
  }

  .task-checklist button.checked {
    color: var(--text-faint);
    text-decoration: line-through;
  }

  .task-side {
    display: flex;
    align-items: center;
    gap: 10px;
    color: var(--text-soft);
    font-size: 11px;
  }

  .task-side select {
    width: 104px;
    min-height: 34px;
    padding: 5px 8px;
    font-size: 11px;
  }

  .duration {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .priority-urgent {
    color: var(--danger);
    background: var(--danger-soft);
  }

  .priority-high {
    color: var(--warning);
    background: var(--warning-soft);
  }

  .offline-draft-note {
    margin-right: auto;
  }

  @media (max-width: 700px) {
    .task-row {
      align-items: flex-start;
      flex-wrap: wrap;
      padding: 12px 2px;
    }

    .task-main {
      width: calc(100% - 54px);
    }

    .task-side {
      width: 100%;
      padding-left: 38px;
      flex-wrap: wrap;
    }

    .task-side select {
      min-height: 38px;
    }
  }
</style>
