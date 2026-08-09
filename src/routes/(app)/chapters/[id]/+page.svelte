<script lang="ts">
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import { tick } from 'svelte';
  import {
    ArrowDown,
    ArrowLeft,
    ArrowRight,
    ArrowUp,
    Ellipsis,
    ExternalLink,
    FileText,
    GripVertical,
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
  import { documentTypeLabels } from '$lib/domain/labels';

  let { data, form } = $props();
  let boardColumns = $derived([...data.boardColumns]);
  let boardTasks = $derived([...data.tasks]);
  let cardOpen = $state(false);
  let columnOpen = $state(false);
  let deleteCardOpen = $state(false);
  let deleteColumnOpen = $state(false);
  let uploadOpen = $state(false);
  let selectedCard = $state<(typeof data.tasks)[number] | null>(null);
  let selectedColumn = $state<(typeof data.boardColumns)[number] | null>(null);
  let cardColumnId = $state('');
  let cardTitle = $state('');
  let cardMinutes = $state(30);
  let columnName = $state('');
  let columnDone = $state(false);
  let draggedCardId = $state<string | null>(null);
  let draggedColumnId = $state<string | null>(null);
  let moveTaskId = $state('');
  let moveColumnId = $state('');
  let movePosition = $state(0);
  let moveCardForm = $state<HTMLFormElement>();
  let reorderColumnsForm = $state<HTMLFormElement>();
  let localToast = $state('');
  let localToastToken = $state(0);
  const allowedViews = new Set(['overview', 'materials', 'study', 'settings']);
  const view = $derived(
    allowedViews.has(page.url.searchParams.get('view') ?? '')
      ? (page.url.searchParams.get('view') as string)
      : 'overview'
  );
  const toastMessage = $derived(
    form?.error
      ? form.error
      : form?.success
        ? form.action === 'addTask'
          ? 'Card added.'
          : form.action === 'updateCard'
            ? 'Card updated.'
            : form.action === 'deleteCard'
              ? 'Card deleted.'
              : form.action === 'createColumn'
                ? 'Column added.'
                : form.action === 'deleteColumn'
                  ? 'Column deleted.'
                  : form.action === 'updateColumn'
                    ? 'Column updated.'
                    : form.action === 'moveCard' || form.action === 'reorderColumns'
                      ? 'Board saved.'
                      : 'Changes saved.'
        : localToast
  );
  const toastTone = $derived(form?.error ? 'error' : 'success');

  function cardsIn(columnId: string, columnIndex: number) {
    return boardTasks
      .filter(
        (task) =>
          task.boardColumnId === columnId || (columnIndex === 0 && task.boardColumnId === null)
      )
      .sort((left, right) => left.boardPosition - right.boardPosition);
  }

  function dateLabel(value: Date | string | null) {
    return value
      ? new Date(value).toLocaleDateString('en-GB', {
          day: 'numeric',
          month: 'short',
          timeZone: data.user.timezone
        })
      : '—';
  }

  function notify(message: string) {
    localToast = message;
    localToastToken += 1;
  }

  function newCard(columnId?: string) {
    selectedCard = null;
    cardColumnId = columnId ?? boardColumns[0]?.id ?? '';
    cardTitle = '';
    cardMinutes = 30;
    cardOpen = true;
  }

  function editCard(task: (typeof data.tasks)[number]) {
    selectedCard = task;
    cardColumnId = task.boardColumnId ?? boardColumns[0]?.id ?? '';
    cardTitle = task.title;
    cardMinutes = task.estimatedMinutes;
    cardOpen = true;
  }

  function newColumn() {
    selectedColumn = null;
    columnName = '';
    columnDone = false;
    columnOpen = true;
  }

  function editColumn(column: (typeof data.boardColumns)[number]) {
    selectedColumn = column;
    columnName = column.name;
    columnDone = column.isDone;
    columnOpen = true;
  }

  async function persistCardMove(taskId: string, columnId: string, position: number) {
    const task = boardTasks.find((item) => item.id === taskId);
    if (!task) return;
    const nextTarget = boardTasks
      .filter((item) => item.id !== taskId && item.boardColumnId === columnId)
      .sort((left, right) => left.boardPosition - right.boardPosition);
    nextTarget.splice(Math.min(position, nextTarget.length), 0, {
      ...task,
      boardColumnId: columnId
    });
    const unaffected = boardTasks.filter(
      (item) => item.id !== taskId && item.boardColumnId !== columnId
    );
    boardTasks = [
      ...unaffected,
      ...nextTarget.map((item, index) => ({ ...item, boardPosition: index }))
    ];
    moveTaskId = taskId;
    moveColumnId = columnId;
    movePosition = Math.min(position, nextTarget.length - 1);
    await tick();
    moveCardForm?.requestSubmit();
  }

  function startCardDrag(event: DragEvent, taskId: string) {
    event.stopPropagation();
    draggedCardId = taskId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', taskId);
    }
  }

  async function dropCard(event: DragEvent, columnId: string, position: number) {
    event.preventDefault();
    event.stopPropagation();
    const taskId = event.dataTransfer?.getData('text/plain') || draggedCardId;
    draggedCardId = null;
    if (taskId) await persistCardMove(taskId, columnId, position);
  }

  function startColumnDrag(event: DragEvent, columnId: string) {
    draggedColumnId = columnId;
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', columnId);
    }
  }

  async function placeColumn(columnId: string, targetId: string) {
    if (columnId === targetId) return;
    const from = boardColumns.findIndex((column) => column.id === columnId);
    const to = boardColumns.findIndex((column) => column.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...boardColumns];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    boardColumns = next;
    await tick();
    reorderColumnsForm?.requestSubmit();
  }

  async function dropColumn(event: DragEvent, targetId: string) {
    event.preventDefault();
    const columnId = event.dataTransfer?.getData('text/plain') || draggedColumnId;
    draggedColumnId = null;
    if (columnId) await placeColumn(columnId, targetId);
  }

  async function moveColumn(columnId: string, direction: number) {
    const index = boardColumns.findIndex((column) => column.id === columnId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= boardColumns.length) return;
    const next = [...boardColumns];
    [next[index], next[target]] = [next[target], next[index]];
    boardColumns = next;
    await tick();
    reorderColumnsForm?.requestSubmit();
  }

  async function uploaded() {
    uploadOpen = false;
    notify('Material uploaded.');
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{data.chapter.title} · {data.module.code} · StudySky</title>
</svelte:head>

<div class="page chapter-page">
  <PageHeader
    title={data.chapter.title}
    description={data.chapter.description ?? `${data.module.code} chapter`}
    backHref={`/modules/${data.module.id}?view=chapters`}
    backLabel={data.module.code}
  >
    {#snippet actions()}
      {#if view === 'overview'}
        <button class="button" type="button" onclick={newColumn}>
          <Plus size={16} /> Add column
        </button>
        <button class="button button-primary" type="button" onclick={() => newCard()}>
          <Plus size={16} /> Add card
        </button>
      {:else if view === 'materials'}
        <button class="button button-primary" type="button" onclick={() => (uploadOpen = true)}>
          <Upload size={16} /> Add material
        </button>
      {:else if view === 'study'}
        <a class="button" href={`/practice?module=${data.module.id}`}>Practice</a>
        <a class="button button-primary" href={`/revision?module=${data.module.id}`}>Revision</a>
      {:else}
        <button class="button button-primary" type="submit" form="chapter-settings-form">
          Save chapter
        </button>
      {/if}
    {/snippet}
  </PageHeader>

  <div class="chapter-navigation">
    <nav class="chapter-tabs" aria-label={`${data.chapter.title} sections`}>
      <a class:active={view === 'overview'} href={`/chapters/${data.chapter.id}`}>Overview</a>
      <a class:active={view === 'materials'} href={`/chapters/${data.chapter.id}?view=materials`}>
        Materials <span>{data.documents.length}</span>
      </a>
      <a class:active={view === 'study'} href={`/chapters/${data.chapter.id}?view=study`}>Study</a>
      <a class:active={view === 'settings'} href={`/chapters/${data.chapter.id}?view=settings`}>
        <Settings size={14} /> Settings
      </a>
    </nav>
    <div class="study-dates" aria-label="Study dates">
      <span>Last studied <strong>{dateLabel(data.chapter.lastStudiedAt)}</strong></span>
      <span>Next revision <strong>{dateLabel(data.chapter.nextRevisionAt)}</strong></span>
    </div>
  </div>

  <Toast
    message={toastMessage}
    tone={toastTone}
    token={`${form?.action ?? ''}-${form?.success ?? ''}-${form?.error ?? ''}-${localToastToken}`}
  />

  {#if view === 'overview'}
    <form
      bind:this={reorderColumnsForm}
      method="POST"
      action="?/reorderColumns"
      class="board"
      use:enhance={() => {
        return async ({ update }) => {
          await update({ reset: false });
        };
      }}
    >
      {#each boardColumns as column, columnIndex (column.id)}
        <input type="hidden" name="columnId" value={column.id} />
        <section
          class:dragging={draggedColumnId === column.id}
          class="board-column"
          role="group"
          aria-label={column.name}
          draggable="true"
          ondragstart={(event) => startColumnDrag(event, column.id)}
          ondragend={() => (draggedColumnId = null)}
          ondragover={(event) => event.preventDefault()}
          ondrop={(event) => dropColumn(event, column.id)}
        >
          <header class="column-header">
            <button class="column-grip" type="button" aria-label={`Drag ${column.name} column`}>
              <GripVertical size={15} />
            </button>
            <h2>{column.name}</h2>
            <span>{cardsIn(column.id, columnIndex).length}</span>
            <details class="column-menu">
              <summary
                class="button button-icon button-quiet"
                aria-label={`Actions for ${column.name}`}
              >
                <Ellipsis size={16} />
              </summary>
              <div class="surface menu-popover">
                <button type="button" onclick={() => newCard(column.id)}
                  ><Plus size={15} /> Add card</button
                >
                <button type="button" onclick={() => editColumn(column)}
                  ><Pencil size={15} /> Edit column</button
                >
                <button
                  type="button"
                  onclick={() => moveColumn(column.id, -1)}
                  disabled={columnIndex === 0}><ArrowLeft size={15} /> Move left</button
                >
                <button
                  type="button"
                  onclick={() => moveColumn(column.id, 1)}
                  disabled={columnIndex === boardColumns.length - 1}
                  ><ArrowRight size={15} /> Move right</button
                >
                <button
                  class="danger"
                  type="button"
                  onclick={() => {
                    selectedColumn = column;
                    deleteColumnOpen = true;
                  }}><Trash2 size={15} /> Delete</button
                >
              </div>
            </details>
          </header>

          <div
            class="card-list"
            role="list"
            ondragover={(event) => event.preventDefault()}
            ondrop={(event) => dropCard(event, column.id, cardsIn(column.id, columnIndex).length)}
          >
            {#each cardsIn(column.id, columnIndex) as task, cardIndex (task.id)}
              <article
                class:dragging={draggedCardId === task.id}
                class="board-card"
                role="listitem"
                draggable="true"
                ondragstart={(event) => startCardDrag(event, task.id)}
                ondragend={() => (draggedCardId = null)}
                ondragover={(event) => event.preventDefault()}
                ondrop={(event) => dropCard(event, column.id, cardIndex)}
              >
                <div class="card-copy">
                  <strong>{task.title}</strong>
                  <small>{task.estimatedMinutes} min</small>
                </div>
                <details class="card-menu">
                  <summary
                    class="button button-icon button-quiet"
                    aria-label={`Actions for ${task.title}`}
                  >
                    <Ellipsis size={15} />
                  </summary>
                  <div class="surface menu-popover">
                    <button type="button" onclick={() => editCard(task)}
                      ><Pencil size={15} /> Edit</button
                    >
                    <button
                      type="button"
                      onclick={() => persistCardMove(task.id, column.id, cardIndex - 1)}
                      disabled={cardIndex === 0}><ArrowUp size={15} /> Move up</button
                    >
                    <button
                      type="button"
                      onclick={() => persistCardMove(task.id, column.id, cardIndex + 1)}
                      disabled={cardIndex === cardsIn(column.id, columnIndex).length - 1}
                      ><ArrowDown size={15} /> Move down</button
                    >
                    <label class="move-label">
                      <span>Move to</span>
                      <select
                        value={task.boardColumnId ?? boardColumns[0]?.id}
                        onchange={(event) =>
                          persistCardMove(
                            task.id,
                            event.currentTarget.value,
                            cardsIn(
                              event.currentTarget.value,
                              boardColumns.findIndex(
                                (item) => item.id === event.currentTarget.value
                              )
                            ).length
                          )}
                      >
                        {#each boardColumns as option}
                          <option value={option.id}>{option.name}</option>
                        {/each}
                      </select>
                    </label>
                    <button
                      class="danger"
                      type="button"
                      onclick={() => {
                        selectedCard = task;
                        deleteCardOpen = true;
                      }}><Trash2 size={15} /> Delete</button
                    >
                  </div>
                </details>
              </article>
            {/each}
            <button class="add-card-inline" type="button" onclick={() => newCard(column.id)}>
              <Plus size={15} /> Add card
            </button>
          </div>
        </section>
      {/each}
    </form>

    <form
      bind:this={moveCardForm}
      method="POST"
      action="?/moveCard"
      class="sr-only"
      aria-hidden="true"
      use:enhance={() => {
        return async ({ update }) => {
          await update({ reset: false });
        };
      }}
    >
      <input name="taskId" value={moveTaskId} />
      <input name="columnId" value={moveColumnId} />
      <input name="position" value={movePosition} />
    </form>
  {:else if view === 'materials'}
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
              <small>{documentTypeLabels[document.type]} · {document.originalFilename}</small>
            </span>
            <ExternalLink size={15} />
          </a>
        {/each}
      </div>
    {:else}
      <EmptyState
        title="No materials yet"
        description="Add a handwritten note, PDF, image, or lecturer file."
      />
    {/if}
  {:else if view === 'study'}
    <section class="study-panel surface">
      <div>
        <h2>Important formulas</h2>
        <p>{data.chapter.importantFormulas ?? 'Nothing recorded yet.'}</p>
      </div>
      <div>
        <h2>Questions for the lecturer</h2>
        <p>{data.chapter.lecturerQuestions ?? 'Nothing recorded yet.'}</p>
      </div>
    </section>
  {:else}
    <form
      id="chapter-settings-form"
      method="POST"
      action="?/update"
      class="surface panel form-grid chapter-settings"
      use:enhance
    >
      <div class="field form-span">
        <label for="edit-title">Title</label>
        <input id="edit-title" name="title" value={data.chapter.title} required />
      </div>
      <div class="field form-span">
        <label for="edit-description">Description (optional)</label>
        <textarea id="edit-description" name="description"
          >{data.chapter.description ?? ''}</textarea
        >
      </div>
      <div class="field form-span">
        <label for="edit-formulas">Important formulas (optional)</label>
        <textarea id="edit-formulas" name="importantFormulas"
          >{data.chapter.importantFormulas ?? ''}</textarea
        >
      </div>
      <div class="field form-span">
        <label for="edit-annotations">Personal notes (optional)</label>
        <textarea id="edit-annotations" name="annotations"
          >{data.chapter.annotations ?? ''}</textarea
        >
      </div>
      <div class="field form-span">
        <label for="edit-questions">Questions for the lecturer (optional)</label>
        <textarea id="edit-questions" name="lecturerQuestions"
          >{data.chapter.lecturerQuestions ?? ''}</textarea
        >
      </div>
      {#if data.prerequisiteOptions.length}
        <details class="form-span prerequisite-disclosure">
          <summary>Prerequisites</summary>
          <div class="prerequisite-options">
            {#each data.prerequisiteOptions as option}
              <label>
                <input
                  type="checkbox"
                  name="prerequisiteId"
                  value={option.id}
                  checked={data.prerequisites.includes(option.id)}
                />
                <span>{option.title}</span>
              </label>
            {/each}
          </div>
        </details>
      {/if}
    </form>
  {/if}

  <Modal bind:open={cardOpen} title={selectedCard ? 'Edit card' : 'Add card'} size="small">
    <form
      method="POST"
      action={selectedCard ? '?/updateCard' : '?/addTask'}
      use:enhance={() => {
        return async ({ result, update }) => {
          await update({ reset: !selectedCard });
          if (result.type === 'success') cardOpen = false;
        };
      }}
    >
      {#if selectedCard}<input type="hidden" name="taskId" value={selectedCard.id} />{/if}
      <div class="field">
        <label for="card-title">Card title</label>
        <input id="card-title" name="title" bind:value={cardTitle} required />
      </div>
      {#if !selectedCard}
        <div class="field field-gap">
          <label for="card-column">Column</label>
          <select id="card-column" name="columnId" bind:value={cardColumnId}>
            {#each boardColumns as column}<option value={column.id}>{column.name}</option>{/each}
          </select>
        </div>
      {/if}
      <div class="field field-gap">
        <label for="card-minutes">Estimated minutes</label>
        <input
          id="card-minutes"
          name="estimatedMinutes"
          type="number"
          min="5"
          max="720"
          bind:value={cardMinutes}
        />
      </div>
      {#if (form?.action === 'addTask' || form?.action === 'updateCard') && form?.error}
        <p class="form-error" role="alert">{form.error}</p>
      {/if}
      <div class="form-actions">
        <button class="button" type="button" onclick={() => (cardOpen = false)}>Cancel</button>
        <button class="button button-primary" type="submit"
          >{selectedCard ? 'Save' : 'Add card'}</button
        >
      </div>
    </form>
  </Modal>

  <Modal bind:open={columnOpen} title={selectedColumn ? 'Edit column' : 'Add column'} size="small">
    <form
      method="POST"
      action={selectedColumn ? '?/updateColumn' : '?/createColumn'}
      use:enhance={() => {
        return async ({ result, update }) => {
          await update({ reset: !selectedColumn });
          if (result.type === 'success') columnOpen = false;
        };
      }}
    >
      {#if selectedColumn}<input type="hidden" name="columnId" value={selectedColumn.id} />{/if}
      <div class="field">
        <label for="column-name">Column name</label>
        <input id="column-name" name="name" bind:value={columnName} required />
      </div>
      <label class="done-option">
        <input type="checkbox" name="isDone" bind:checked={columnDone} />
        <span><strong>Completed column</strong><small>Cards moved here count as done.</small></span>
      </label>
      {#if (form?.action === 'createColumn' || form?.action === 'updateColumn') && form?.error}
        <p class="form-error" role="alert">{form.error}</p>
      {/if}
      <div class="form-actions">
        <button class="button" type="button" onclick={() => (columnOpen = false)}>Cancel</button>
        <button class="button button-primary" type="submit">Save</button>
      </div>
    </form>
  </Modal>

  <Modal bind:open={deleteCardOpen} title="Delete card?" size="small">
    {#if selectedCard}
      <form
        method="POST"
        action="?/deleteCard"
        use:enhance={() => {
          return async ({ result, update }) => {
            await update();
            if (result.type === 'success') deleteCardOpen = false;
          };
        }}
      >
        <input type="hidden" name="taskId" value={selectedCard.id} />
        <p class="dialog-copy">“{selectedCard.title}” will be permanently removed.</p>
        <div class="form-actions">
          <button class="button" type="button" onclick={() => (deleteCardOpen = false)}
            >Cancel</button
          >
          <button class="button button-danger" type="submit">Delete</button>
        </div>
      </form>
    {/if}
  </Modal>

  <Modal bind:open={deleteColumnOpen} title="Delete column?" size="small">
    {#if selectedColumn}
      <form
        method="POST"
        action="?/deleteColumn"
        use:enhance={() => {
          return async ({ result, update }) => {
            await update();
            if (result.type === 'success') deleteColumnOpen = false;
          };
        }}
      >
        <input type="hidden" name="columnId" value={selectedColumn.id} />
        <p class="dialog-copy">
          Cards in “{selectedColumn.name}” will move to the first remaining column.
        </p>
        <div class="form-actions">
          <button class="button" type="button" onclick={() => (deleteColumnOpen = false)}
            >Cancel</button
          >
          <button class="button button-danger" type="submit">Delete</button>
        </div>
      </form>
    {/if}
  </Modal>

  <Modal bind:open={uploadOpen} title="Add material" size="large">
    <UploadForm
      ownerUserId={data.user.id}
      modules={[data.module]}
      chapters={[data.chapter]}
      presetModule={data.module.id}
      presetChapter={data.chapter.id}
      oncomplete={uploaded}
    />
  </Modal>
</div>

<style>
  .chapter-navigation {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 18px;
    margin: -5px 0 20px;
    border-bottom: 1px solid var(--border);
  }

  .chapter-tabs {
    display: flex;
    overflow-x: auto;
    gap: 3px;
    padding-bottom: 8px;
  }

  .chapter-tabs a {
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

  .chapter-tabs a:hover,
  .chapter-tabs a.active {
    color: var(--text);
    background: var(--surface-hover);
  }

  .chapter-tabs span {
    color: var(--text-faint);
    font-size: 10px;
  }

  .study-dates {
    display: flex;
    min-height: 36px;
    align-items: center;
    gap: 14px;
    color: var(--text-faint);
    font-size: 10px;
    white-space: nowrap;
  }

  .study-dates strong {
    margin-left: 3px;
    color: var(--text-soft);
    font-weight: 600;
  }

  .board {
    display: flex;
    min-height: 390px;
    overflow-x: auto;
    align-items: flex-start;
    gap: 12px;
    padding: 2px 2px 16px;
    scroll-snap-type: x proximity;
  }

  .board-column {
    width: min(300px, calc(100vw - 56px));
    min-width: 270px;
    overflow: visible;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface-raised);
    scroll-snap-align: start;
    transition: opacity 120ms ease;
  }

  .board-column.dragging,
  .board-card.dragging {
    opacity: 0.5;
  }

  .column-header {
    display: grid;
    min-height: 50px;
    grid-template-columns: 24px minmax(0, 1fr) auto 34px;
    align-items: center;
    gap: 5px;
    padding: 7px 8px;
    border-bottom: 1px solid var(--border);
  }

  .column-header h2 {
    overflow: hidden;
    margin: 0;
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .column-header > span {
    display: grid;
    min-width: 22px;
    height: 22px;
    place-items: center;
    border-radius: 6px;
    color: var(--text-faint);
    background: var(--surface);
    font-size: 10px;
  }

  .column-grip {
    display: grid;
    width: 24px;
    height: 30px;
    padding: 0;
    place-items: center;
    border: 0;
    color: var(--text-faint);
    background: transparent;
    cursor: grab;
  }

  .column-menu,
  .card-menu {
    position: relative;
  }

  .column-menu > summary,
  .card-menu > summary {
    list-style: none;
  }

  .menu-popover {
    position: absolute;
    z-index: 15;
    top: 38px;
    right: 0;
    display: grid;
    width: 190px;
    padding: 5px;
    box-shadow: 0 12px 36px rgba(15, 23, 42, 0.16);
  }

  .menu-popover button {
    display: flex;
    min-height: 36px;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border: 0;
    border-radius: 6px;
    color: var(--text);
    background: transparent;
    font: inherit;
    text-align: left;
  }

  .menu-popover button:hover:not(:disabled) {
    background: var(--surface-hover);
  }

  .menu-popover button:disabled {
    opacity: 0.42;
  }

  .menu-popover .danger {
    color: var(--danger);
  }

  .card-list {
    display: grid;
    min-height: 120px;
    gap: 7px;
    padding: 8px;
  }

  .board-card {
    position: relative;
    display: flex;
    min-height: 72px;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 8px 10px 11px;
    border: 1px solid var(--border);
    border-radius: 7px;
    background: var(--surface);
    box-shadow: 0 1px 1px rgba(15, 23, 42, 0.04);
    cursor: grab;
  }

  .board-card:hover {
    border-color: var(--border-strong);
  }

  .board-card:active {
    cursor: grabbing;
  }

  .card-copy {
    display: grid;
    min-width: 0;
    flex: 1;
    gap: 8px;
  }

  .card-copy strong {
    line-height: 1.35;
  }

  .card-copy small {
    color: var(--text-faint);
  }

  .move-label {
    display: grid;
    gap: 4px;
    padding: 7px 9px;
    color: var(--text-faint);
    font-size: 10px;
  }

  .move-label select {
    width: 100%;
    min-height: 34px;
    font-size: 11px;
  }

  .add-card-inline {
    display: flex;
    min-height: 38px;
    align-items: center;
    gap: 7px;
    padding: 8px 9px;
    border: 0;
    border-radius: 6px;
    color: var(--text-soft);
    background: transparent;
    font: inherit;
    text-align: left;
  }

  .add-card-inline:hover {
    color: var(--text);
    background: var(--surface-hover);
  }

  .material-list {
    border-top: 1px solid var(--border);
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

  .study-panel {
    display: grid;
    max-width: 920px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
  }

  .study-panel > div {
    min-height: 180px;
    padding: 18px;
  }

  .study-panel > div + div {
    border-left: 1px solid var(--border);
  }

  .study-panel h2 {
    margin-bottom: 8px;
  }

  .study-panel p {
    margin: 0;
    color: var(--text-soft);
    white-space: pre-wrap;
  }

  .chapter-settings {
    max-width: 920px;
  }

  .prerequisite-disclosure summary {
    padding: 8px 0;
    font-weight: 600;
  }

  .prerequisite-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 5px;
    margin-top: 8px;
  }

  .prerequisite-options label {
    display: flex;
    min-height: 38px;
    align-items: center;
    gap: 8px;
    padding: 7px 9px;
    border-radius: 6px;
    background: var(--surface-hover);
    font-size: 12px;
  }

  .field-gap {
    margin-top: 14px;
  }

  .done-option {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin-top: 14px;
    padding: 11px;
    border-radius: 7px;
    background: var(--surface-hover);
  }

  .done-option input {
    width: 17px;
    height: 17px;
  }

  .done-option span {
    display: grid;
  }

  .done-option small {
    color: var(--text-soft);
  }

  .form-error {
    margin: 12px 0 0;
    color: var(--danger);
    font-size: 12px;
  }

  .dialog-copy {
    margin: 0;
    color: var(--text-soft);
  }

  @media (max-width: 900px) {
    .chapter-navigation {
      display: block;
    }

    .study-dates {
      min-height: 32px;
      padding: 0 10px 8px;
    }
  }

  @media (max-width: 620px) {
    .study-dates {
      justify-content: space-between;
      gap: 8px;
    }

    .study-panel,
    .prerequisite-options {
      grid-template-columns: 1fr;
    }

    .study-panel > div + div {
      border-top: 1px solid var(--border);
      border-left: 0;
    }
  }
</style>
