<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import {
    ArrowDown,
    ArrowRight,
    ArrowUp,
    CalendarDays,
    ExternalLink,
    FileText,
    GripVertical,
    Import,
    ListPlus,
    Pencil,
    Plus,
    Settings,
    Trash2,
    Upload
  } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import UploadForm from '$lib/components/UploadForm.svelte';
  import { taskTypeLabels } from '$lib/domain/labels';

  let { data, form } = $props();
  let chapterOpen = $state(false);
  let importOpen = $state(false);
  let renameOpen = $state(false);
  let taskOpen = $state(false);
  let uploadOpen = $state(false);
  let selectedChapter = $state<(typeof data.chapters)[number] | null>(null);
  let renameTitle = $state('');
  let orderedChapters = $derived([...data.chapters]);
  let draggedChapterId = $state<string | null>(null);
  let reorderForm = $state<HTMLFormElement>();
  let localToast = $state('');
  let localToastToken = $state(0);
  const allowedViews = new Set(['overview', 'chapters', 'materials', 'study', 'settings']);
  const view = $derived(
    allowedViews.has(page.url.searchParams.get('view') ?? '')
      ? (page.url.searchParams.get('view') as string)
      : 'overview'
  );
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const toastMessage = $derived(
    form?.error
      ? form.error
      : form?.success
        ? form.action === 'createChapter'
          ? 'Chapter added.'
          : form.action === 'importChapters'
            ? `${form.count ?? 0} chapter${form.count === 1 ? '' : 's'} imported.`
            : form.action === 'renameChapter'
              ? 'Chapter renamed.'
              : form.action === 'reorderChapters' || form.action === 'moveChapter'
                ? 'Chapter order saved.'
                : form.action === 'addTask'
                  ? 'Task added.'
                  : 'Changes saved.'
        : localToast
  );
  const toastTone = $derived(form?.error ? 'error' : 'success');

  $effect(() => {
    if (form?.action === 'createChapter' && form?.error) chapterOpen = true;
    if (form?.action === 'importChapters' && form?.error) importOpen = true;
    if (form?.action === 'renameChapter' && form?.error) renameOpen = true;
    if (form?.action === 'addTask' && form?.error) taskOpen = true;
  });

  function notify(message: string) {
    localToast = message;
    localToastToken += 1;
  }

  function editChapter(chapter: (typeof data.chapters)[number]) {
    selectedChapter = chapter;
    renameTitle = chapter.title;
    renameOpen = true;
  }

  async function placeChapter(chapterId: string, targetId: string) {
    if (chapterId === targetId) return;
    const from = orderedChapters.findIndex((chapter) => chapter.id === chapterId);
    const to = orderedChapters.findIndex((chapter) => chapter.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...orderedChapters];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    orderedChapters = next;
    await tick();
    reorderForm?.requestSubmit();
  }

  async function moveChapter(chapterId: string, direction: number) {
    const index = orderedChapters.findIndex((chapter) => chapter.id === chapterId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= orderedChapters.length) return;
    const next = [...orderedChapters];
    [next[index], next[target]] = [next[target], next[index]];
    orderedChapters = next;
    await tick();
    reorderForm?.requestSubmit();
  }

  function startDrag(event: DragEvent, chapterId: string) {
    draggedChapterId = chapterId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', chapterId);
    }
  }

  async function dropChapter(event: DragEvent, targetId: string) {
    event.preventDefault();
    const chapterId = event.dataTransfer?.getData('text/plain') || draggedChapterId;
    draggedChapterId = null;
    if (chapterId) await placeChapter(chapterId, targetId);
  }

  async function uploaded() {
    uploadOpen = false;
    notify('Material uploaded.');
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{data.module.code} {data.module.name} · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    title={`${data.module.code} · ${data.module.name}`}
    description={data.module.description ?? 'Chapters, materials, work, and revision in one place.'}
    backHref="/modules"
    backLabel="Modules"
  >
    {#snippet actions()}
      {#if view === 'overview'}
        <button class="button button-primary" type="button" onclick={() => (taskOpen = true)}>
          <ListPlus size={16} /> Add task
        </button>
      {:else if view === 'chapters'}
        <button class="button" type="button" onclick={() => (importOpen = true)}>
          <Import size={16} /> Import
        </button>
        <button class="button button-primary" type="button" onclick={() => (chapterOpen = true)}>
          <Plus size={16} /> Add chapter
        </button>
      {:else if view === 'materials'}
        <button class="button button-primary" type="button" onclick={() => (uploadOpen = true)}>
          <Upload size={16} /> Add material
        </button>
      {:else if view === 'study'}
        <a class="button" href={`/practice?module=${data.module.id}`}>Practice</a>
        <a class="button button-primary" href={`/revision?module=${data.module.id}`}>Revision</a>
      {:else}
        <button class="button button-primary" type="submit" form="module-settings-form">
          Save module
        </button>
      {/if}
    {/snippet}
  </PageHeader>

  <nav class="module-tabs" aria-label={`${data.module.code} sections`}>
    <a class:active={view === 'overview'} href={`/modules/${data.module.id}`}>Overview</a>
    <a class:active={view === 'chapters'} href={`/modules/${data.module.id}?view=chapters`}>
      Chapters <span>{data.chapters.length}</span>
    </a>
    <a class:active={view === 'materials'} href={`/modules/${data.module.id}?view=materials`}>
      Materials <span>{data.documents.length}</span>
    </a>
    <a class:active={view === 'study'} href={`/modules/${data.module.id}?view=study`}>Study</a>
    <a class:active={view === 'settings'} href={`/modules/${data.module.id}?view=settings`}>
      <Settings size={14} /> Settings
    </a>
  </nav>

  <Toast
    message={toastMessage}
    tone={toastTone}
    token={`${form?.action ?? ''}-${form?.success ?? ''}-${form?.error ?? ''}-${localToastToken}`}
  />

  {#if view === 'overview'}
    <div class="module-grid">
      <section class="module-card">
        <div class="card-heading"><h2>Upcoming work</h2></div>
        {#if data.tasks.length}
          <ul class="compact-list">
            {#each data.tasks as task}
              <li>
                <span class="task-check"></span>
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    {taskTypeLabels[task.type]}{#if task.deadline}
                      · due {new Date(task.deadline).toLocaleDateString('en-GB', {
                        timeZone: data.user.timezone
                      })}{/if}
                  </small>
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="card-empty">No unfinished work.</p>
        {/if}
      </section>

      <section class="module-card">
        <div class="card-heading">
          <h2>Weekly classes</h2>
          <a class="subtle" href="/timetable">Open timetable</a>
        </div>
        {#if data.timetable.length}
          <ul class="compact-list">
            {#each data.timetable as entry}
              <li>
                <CalendarDays size={16} />
                <span>
                  <strong>{entry.title}</strong>
                  <small>
                    {days[entry.dayOfWeek ?? 0]} · {entry.startTime.slice(
                      0,
                      5
                    )}–{entry.endTime.slice(0, 5)}
                    {#if entry.location}
                      · {entry.location}{/if}
                  </small>
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="card-empty">No weekly classes linked to this module.</p>
        {/if}
      </section>
    </div>
  {:else if view === 'chapters'}
    <section>
      <div class="section-heading">
        <div>
          <h2>Chapters</h2>
          <p>Drag to reorder, or use the arrow buttons.</p>
        </div>
      </div>
      {#if orderedChapters.length}
        <form
          bind:this={reorderForm}
          method="POST"
          action="?/reorderChapters"
          class="chapter-list"
          use:enhance={() => {
            return async ({ update }) => {
              await update({ reset: false });
            };
          }}
        >
          {#each orderedChapters as chapter, index (chapter.id)}
            <input type="hidden" name="chapterId" value={chapter.id} />
            <article
              class:dragging={draggedChapterId === chapter.id}
              class="chapter-row"
              draggable="true"
              ondragstart={(event) => startDrag(event, chapter.id)}
              ondragend={() => (draggedChapterId = null)}
              ondragover={(event) => event.preventDefault()}
              ondrop={(event) => dropChapter(event, chapter.id)}
            >
              <button
                class="drag-handle"
                type="button"
                aria-label={`Drag ${chapter.title}`}
                title="Drag to reorder"
              >
                <GripVertical size={16} />
              </button>
              <span class="chapter-number">{String(index + 1).padStart(2, '0')}</span>
              <a class="chapter-link" href={`/chapters/${chapter.id}`}>
                <strong>{chapter.title}</strong>
              </a>
              <div class="chapter-controls">
                <button
                  class="button button-icon button-quiet"
                  type="button"
                  onclick={() => moveChapter(chapter.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${chapter.title} up`}
                >
                  <ArrowUp size={15} />
                </button>
                <button
                  class="button button-icon button-quiet"
                  type="button"
                  onclick={() => moveChapter(chapter.id, 1)}
                  disabled={index === orderedChapters.length - 1}
                  aria-label={`Move ${chapter.title} down`}
                >
                  <ArrowDown size={15} />
                </button>
                <button
                  class="button button-icon button-quiet"
                  type="button"
                  onclick={() => editChapter(chapter)}
                  aria-label={`Rename ${chapter.title}`}
                >
                  <Pencil size={15} />
                </button>
                <a
                  class="button button-icon button-quiet"
                  href={`/chapters/${chapter.id}`}
                  aria-label={`Open ${chapter.title}`}
                >
                  <ArrowRight size={16} />
                </a>
              </div>
            </article>
          {/each}
        </form>
      {:else}
        <EmptyState
          title="No chapters yet"
          description="Add a chapter or import a simple one-per-line list."
        />
      {/if}
    </section>
  {:else if view === 'materials'}
    <section>
      {#if data.documents.length}
        <div class="material-list">
          {#each data.documents as document}
            <a
              class="material-row"
              href={`/api/documents/${document.id}/original`}
              target="_blank"
              rel="noreferrer"
            >
              <FileText size={17} />
              <span>
                <strong>{document.title}</strong>
                <small>{document.originalFilename}</small>
              </span>
              <ExternalLink size={15} />
            </a>
          {/each}
        </div>
      {:else}
        <EmptyState
          title="No materials yet"
          description="Add a module-wide file here, or upload directly inside a chapter."
        />
      {/if}
    </section>
  {:else if view === 'study'}
    <div class="module-grid">
      <section class="module-card">
        <div class="card-heading"><h2>Revision due</h2></div>
        {#if data.revisions.length}
          <ul class="compact-list">
            {#each data.revisions as revision}
              <li>
                <span class="task-check"></span>
                <span>
                  <strong>{revision.title}</strong>
                  <small
                    >{new Date(revision.dueAt).toLocaleDateString('en-GB', {
                      timeZone: data.user.timezone
                    })}</small
                  >
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="card-empty">Nothing is due.</p>
        {/if}
      </section>

      <section class="module-card">
        <div class="card-heading"><h2>Practice</h2></div>
        <dl class="evidence-list">
          <div>
            <dt>Questions attempted</dt>
            <dd>{data.practiceAttempts}</dd>
          </div>
          <div>
            <dt>Accuracy</dt>
            <dd>
              {data.practiceAccuracy === null ? '—' : `${Math.round(data.practiceAccuracy * 100)}%`}
            </dd>
          </div>
          <div>
            <dt>Current module result</dt>
            <dd>
              {data.weightedPerformance === null
                ? '—'
                : `${Math.round(data.weightedPerformance * 100)}%`}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  {:else}
    <section class="settings-layout">
      <form
        id="module-settings-form"
        method="POST"
        action="?/updateModule"
        class="surface panel form-grid"
        use:enhance
      >
        <div class="field">
          <label for="edit-code">Code</label>
          <input id="edit-code" name="code" value={data.module.code} required />
        </div>
        <div class="field">
          <label for="edit-name">Name</label>
          <input id="edit-name" name="name" value={data.module.name} required />
        </div>
        <div class="field">
          <label for="edit-lecturer">Lecturer (optional)</label>
          <input id="edit-lecturer" name="lecturerName" value={data.module.lecturerName ?? ''} />
        </div>
        <div class="field">
          <label for="edit-lecturer-email">Lecturer email (optional)</label>
          <input
            id="edit-lecturer-email"
            name="lecturerEmail"
            type="email"
            value={data.module.lecturerEmail ?? ''}
          />
        </div>
        <div class="field">
          <label for="edit-notebook">Notebook (optional)</label>
          <input id="edit-notebook" name="notebookName" value={data.module.notebookName ?? ''} />
        </div>
        <div class="field">
          <label for="edit-color">Colour</label>
          <input id="edit-color" name="color" type="color" value={data.module.color} />
        </div>
        <div class="field form-span">
          <label for="edit-description">Description (optional)</label>
          <textarea id="edit-description" name="description"
            >{data.module.description ?? ''}</textarea
          >
        </div>
        <input type="hidden" name="notebookNumber" value={data.module.notebookNumber ?? ''} />
        <input type="hidden" name="schedulingWeight" value={data.module.schedulingWeight} />
        <input type="hidden" name="creditUnits" value={data.module.creditUnits ?? ''} />
        <input type="hidden" name="gradeWeight" value={data.module.gradeWeight} />
        {#if data.module.isCurrent}<input type="hidden" name="isCurrent" value="1" />{/if}
      </form>

      <details class="surface disclosure danger-zone">
        <summary><Trash2 size={15} /> Delete module</summary>
        <form method="POST" action="?/deleteModule" class="panel">
          <p class="muted">
            Chapters and assessment results will be removed. Files remain unassigned.
          </p>
          <div class="field">
            <label for="delete-module-confirmation">Type {data.module.code} to confirm</label>
            <input
              id="delete-module-confirmation"
              name="confirmation"
              autocomplete="off"
              required
            />
          </div>
          <div class="form-actions">
            <button class="button button-danger" type="submit">Delete module</button>
          </div>
        </form>
      </details>
    </section>
  {/if}

  <Modal bind:open={chapterOpen} title="Add chapter" size="small">
    <form
      method="POST"
      action="?/createChapter"
      use:enhance={() => {
        return async ({ result, update }) => {
          await update();
          if (result.type === 'success') chapterOpen = false;
        };
      }}
    >
      <div class="field">
        <label for="chapter-title">Chapter title</label>
        <input id="chapter-title" name="title" required />
      </div>
      <div class="field field-gap">
        <label for="chapter-description">Description (optional)</label>
        <textarea id="chapter-description" name="description"></textarea>
      </div>
      {#if form?.action === 'createChapter' && form?.error}
        <p class="form-error" role="alert">{form.error}</p>
      {/if}
      <div class="form-actions">
        <button class="button" type="button" onclick={() => (chapterOpen = false)}>Cancel</button>
        <button class="button button-primary" type="submit">Add chapter</button>
      </div>
    </form>
  </Modal>

  <Modal
    bind:open={importOpen}
    title="Import chapters"
    description="Paste one title per line."
    size="small"
  >
    <form
      method="POST"
      action="?/importChapters"
      use:enhance={() => {
        return async ({ result, update }) => {
          await update();
          if (result.type === 'success') importOpen = false;
        };
      }}
    >
      <div class="field">
        <label for="chapter-import">Chapter titles</label>
        <textarea
          id="chapter-import"
          name="chapters"
          rows="9"
          placeholder="Linked lists&#10;Trees&#10;Graph algorithms"
        ></textarea>
      </div>
      {#if form?.action === 'importChapters' && form?.error}
        <p class="form-error" role="alert">{form.error}</p>
      {/if}
      <div class="form-actions">
        <a class="subtle" href={`/api/modules/${data.module.id}/chapters-template.csv`}
          >CSV template</a
        >
        <button class="button button-primary" type="submit">Import</button>
      </div>
    </form>
  </Modal>

  <Modal bind:open={renameOpen} title="Rename chapter" size="small">
    {#if selectedChapter}
      <form
        method="POST"
        action="?/renameChapter"
        use:enhance={() => {
          return async ({ result, update }) => {
            await update({ reset: false });
            if (result.type === 'success') renameOpen = false;
          };
        }}
      >
        <input type="hidden" name="chapterId" value={selectedChapter.id} />
        <div class="field">
          <label for="rename-chapter">Chapter title</label>
          <input id="rename-chapter" name="title" bind:value={renameTitle} required />
        </div>
        {#if form?.action === 'renameChapter' && form?.error}
          <p class="form-error" role="alert">{form.error}</p>
        {/if}
        <div class="form-actions">
          <button class="button" type="button" onclick={() => (renameOpen = false)}>Cancel</button>
          <button class="button button-primary" type="submit">Save</button>
        </div>
      </form>
    {/if}
  </Modal>

  <Modal bind:open={taskOpen} title="Add task" size="small">
    <form
      method="POST"
      action="?/addTask"
      class="form-grid"
      use:enhance={() => {
        return async ({ result, update }) => {
          await update();
          if (result.type === 'success') taskOpen = false;
        };
      }}
    >
      <div class="field form-span">
        <label for="task-title">What needs doing?</label>
        <input id="task-title" name="title" required />
      </div>
      <div class="field">
        <label for="task-chapter">Chapter (optional)</label>
        <select id="task-chapter" name="chapterId">
          <option value="">No chapter</option>
          {#each data.chapters as chapter}<option value={chapter.id}>{chapter.title}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="task-estimate">Minutes</label>
        <input id="task-estimate" name="estimatedMinutes" type="number" min="5" value="30" />
      </div>
      <div class="field form-span">
        <label for="task-deadline">Deadline (optional)</label>
        <input id="task-deadline" name="deadline" type="datetime-local" />
      </div>
      <input type="hidden" name="type" value="other" />
      <input type="hidden" name="priority" value="normal" />
      {#if form?.action === 'addTask' && form?.error}
        <p class="form-error form-span" role="alert">{form.error}</p>
      {/if}
      <div class="form-actions form-span">
        <button class="button" type="button" onclick={() => (taskOpen = false)}>Cancel</button>
        <button class="button button-primary" type="submit">Add task</button>
      </div>
    </form>
  </Modal>

  <Modal bind:open={uploadOpen} title="Add material" size="large">
    <UploadForm
      ownerUserId={data.user.id}
      modules={[data.module]}
      chapters={data.chapters}
      presetModule={data.module.id}
      oncomplete={uploaded}
    />
  </Modal>
</div>

<style>
  .module-tabs {
    display: flex;
    overflow-x: auto;
    gap: 3px;
    margin: -5px 0 20px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .module-tabs a {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border-radius: 6px;
    color: var(--text-soft);
    font-size: 12px;
    white-space: nowrap;
  }

  .module-tabs a:hover,
  .module-tabs a.active {
    color: var(--text);
    background: var(--surface-hover);
  }

  .module-tabs span {
    color: var(--text-faint);
    font-size: 10px;
  }

  .module-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 14px;
  }

  .module-card {
    min-height: 250px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
  }

  .card-heading,
  .section-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
  }

  .card-heading {
    min-height: 56px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .card-heading h2,
  .section-heading h2 {
    margin: 0;
  }

  .section-heading {
    margin-bottom: 10px;
  }

  .section-heading p {
    margin: 3px 0 0;
    color: var(--text-soft);
    font-size: 11px;
  }

  .compact-list {
    margin: 0;
    padding: 0 14px;
    list-style: none;
  }

  .compact-list li {
    display: flex;
    min-height: 55px;
    align-items: center;
    gap: 9px;
    border-bottom: 1px solid var(--border);
  }

  .compact-list li:last-child {
    border: 0;
  }

  .compact-list li > span:last-child {
    display: grid;
    min-width: 0;
  }

  .compact-list small {
    color: var(--text-soft);
  }

  .card-empty {
    display: grid;
    min-height: 188px;
    margin: 0;
    place-items: center;
    color: var(--text-faint);
  }

  .chapter-list,
  .material-list {
    border-top: 1px solid var(--border);
  }

  .chapter-row {
    display: grid;
    min-height: 62px;
    grid-template-columns: 30px 30px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--border);
    transition:
      opacity 120ms ease,
      background-color 120ms ease;
  }

  .chapter-row:hover {
    background: var(--surface-hover);
  }

  .chapter-row.dragging {
    opacity: 0.48;
  }

  .drag-handle {
    display: grid;
    width: 30px;
    height: 34px;
    padding: 0;
    place-items: center;
    border: 0;
    color: var(--text-faint);
    background: transparent;
    cursor: grab;
  }

  .drag-handle:active {
    cursor: grabbing;
  }

  .chapter-number {
    color: var(--text-faint);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .chapter-link {
    display: flex;
    min-height: 48px;
    min-width: 0;
    align-items: center;
  }

  .chapter-link strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chapter-controls {
    display: flex;
    padding-right: 4px;
  }

  .material-row {
    display: flex;
    min-height: 62px;
    align-items: center;
    gap: 11px;
    padding: 8px 4px;
    border-bottom: 1px solid var(--border);
  }

  .material-row:hover {
    background: var(--surface-hover);
  }

  .material-row > span {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .material-row small {
    color: var(--text-soft);
  }

  .task-check {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    border: 1px solid var(--border-strong);
    border-radius: 4px;
  }

  .evidence-list {
    margin: 0;
    padding: 4px 14px;
  }

  .evidence-list div {
    display: flex;
    min-height: 50px;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid var(--border);
  }

  .evidence-list div:last-child {
    border: 0;
  }

  .evidence-list dt {
    color: var(--text-soft);
  }

  .evidence-list dd {
    margin: 0;
    font-size: 15px;
    font-weight: 650;
  }

  .settings-layout {
    display: grid;
    max-width: 920px;
    gap: 12px;
  }

  .disclosure {
    overflow: hidden;
  }

  .disclosure summary {
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 7px;
    padding: 12px 14px;
    font-weight: 600;
  }

  .danger-zone {
    border-color: color-mix(in srgb, var(--danger) 25%, var(--border));
  }

  .field-gap {
    margin-top: 14px;
  }

  .form-error {
    margin: 12px 0 0;
    color: var(--danger);
    font-size: 12px;
  }

  @media (max-width: 760px) {
    .module-grid {
      grid-template-columns: 1fr;
    }

    .chapter-row {
      grid-template-columns: 24px 26px minmax(0, 1fr) auto;
    }

    .chapter-controls .button:nth-child(-n + 2) {
      display: none;
    }
  }
</style>
