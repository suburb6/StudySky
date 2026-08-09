<script lang="ts">
  import { CalendarClock, Check, Clock3, Plus, X } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { humanize } from '$lib/domain/labels';

  let { data, form } = $props();
  let moduleId = $state('');
  let createOpen = $state(false);
  const filteredChapters = $derived(
    data.chapters.filter((chapter) => !moduleId || chapter.moduleId === moduleId)
  );
  const localDateTime = () => {
    const now = new Date(Date.now() + 24 * 60 * 60 * 1_000);
    const parts = new Intl.DateTimeFormat('sv-SE', {
      timeZone: data.user.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).format(now);
    return parts.replace(' ', 'T');
  };

  $effect(() => {
    if (form?.action === 'create' && form?.error) createOpen = true;
  });
</script>

<svelte:head>
  <title>Revision · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    eyebrow="Spaced review"
    title="Revision queue"
    description="Review what is due and let successful recall earn more space."
    backHref="/modules"
    backLabel="Modules"
  >
    {#snippet actions()}
      <button class="button button-primary" type="button" onclick={() => (createOpen = true)}>
        <Plus size={16} /> Add revision
      </button>
    {/snippet}
  </PageHeader>

  <Toast
    message={form?.error
      ? form.error
      : form?.action === 'complete' && form?.success
        ? `Revision recorded. Next review in ${form.intervalDays} day${form.intervalDays === 1 ? '' : 's'}. ${form.reason}`
        : ''}
    tone={form?.error ? 'error' : 'success'}
    token={form}
  />

  <div class="revision-layout">
    <section>
      <div class="row-between">
        <h2>Due now</h2>
        <span class="pill">{data.overdue.length} overdue · {data.due.length} due</span>
      </div>
      {#if data.due.length}
        <div class="revision-list">
          {#each data.due as row}
            <article class:overdue={new Date(row.item.dueAt) < new Date()} class="revision-row">
              <span class="module-dot" style={`--module-color: ${row.moduleColor ?? '#787774'}`}
              ></span>
              <div class="revision-copy">
                <p class="eyebrow">
                  {row.moduleCode ?? 'General'}
                  {row.chapterTitle ? ` · ${row.chapterTitle}` : ''}
                </p>
                <h3>{row.item.title}</h3>
                <p class="subtle">
                  {new Date(row.item.dueAt) < new Date() ? 'Overdue' : 'Due'}
                  · interval step {row.item.intervalStep + 1}
                </p>
              </div>
              <details class="complete-menu">
                <summary class="button button-primary button-sm"><Check size={15} /> Review</summary
                >
                <form method="POST" action="?/complete" class="review-form surface">
                  <input type="hidden" name="revisionId" value={row.item.id} />
                  <div class="field">
                    <label for={`revision-result-${row.item.id}`}>Recall result</label>
                    <select id={`revision-result-${row.item.id}`} name="result">
                      <option value="correct">Correct</option>
                      <option value="partially_correct">Partially correct</option>
                      <option value="incorrect">Incorrect</option>
                      <option value="skipped">Skipped</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for={`revision-minutes-${row.item.id}`}>Minutes</label>
                    <input
                      id={`revision-minutes-${row.item.id}`}
                      name="minutesSpent"
                      type="number"
                      min="0"
                      max="1440"
                      value="15"
                    />
                  </div>
                  <div class="field">
                    <label for={`revision-notes-${row.item.id}`}>Short note</label>
                    <textarea id={`revision-notes-${row.item.id}`} name="notes" rows="2"></textarea>
                  </div>
                  <div class="form-actions">
                    <button class="button button-primary" type="submit">Record review</button>
                  </div>
                </form>
              </details>
              <form method="POST" action="?/dismiss">
                <input type="hidden" name="revisionId" value={row.item.id} />
                <button
                  class="button button-icon button-quiet"
                  type="submit"
                  aria-label={`Dismiss ${row.item.title}`}
                >
                  <X size={15} />
                </button>
              </form>
            </article>
          {/each}
        </div>
      {:else}
        <EmptyState
          title="Revision is clear"
          description="Nothing is due today. Upcoming items remain visible below."
        />
      {/if}

      <section class="section">
        <div class="row-between">
          <h2>Upcoming</h2>
          <span class="pill">{data.upcoming.length}</span>
        </div>
        <ul class="list">
          {#each data.upcoming.slice(0, 12) as row}
            <li class="list-row">
              <CalendarClock size={16} class="muted" />
              <span class="list-row-main">
                <span class="list-row-title">{row.item.title}</span>
                <span class="list-row-meta">
                  {new Date(row.item.dueAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    year: 'numeric',
                    timeZone: data.user.timezone
                  })}
                  {row.moduleCode ? ` · ${row.moduleCode}` : ''}
                </span>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    </section>

    <aside class="revision-sidebar">
      <section class="surface panel">
        <h2>Needs review</h2>
        {#if data.weakTopics.length}
          <ul class="compact-list">
            {#each data.weakTopics as topic}
              <li>
                <a href={`/chapters/${topic.id}`}>{topic.title}</a>
                <span>{topic.accuracy !== null ? `${topic.accuracy}% practice` : 'Review due'}</span
                >
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">No weak topics identified yet.</p>
        {/if}
      </section>
      <section class="surface panel">
        <h2>Recent history</h2>
        {#if data.completed.length}
          <ul class="compact-list">
            {#each data.completed.slice(0, 10) as row}
              <li>
                <span class="history-title">{row.title}</span>
                <span>
                  {humanize(row.record.result)} ·
                  {new Date(row.record.completedAt).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    timeZone: data.user.timezone
                  })}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">Completed reviews will appear here.</p>
        {/if}
      </section>
    </aside>
  </div>

  <Modal bind:open={createOpen} title="Add revision">
    <form method="POST" action="?/create">
      <div class="form-grid">
        <div class="field form-span">
          <label for="revision-title">What should be reviewed?</label>
          <input id="revision-title" name="title" required />
        </div>
        <div class="field">
          <label for="revision-module">Module</label>
          <select id="revision-module" name="moduleId" bind:value={moduleId}>
            <option value="">General</option>
            {#each data.modules as module}<option value={module.id}
                >{module.code} · {module.name}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="revision-chapter">Chapter</label>
          <select id="revision-chapter" name="chapterId">
            <option value="">No chapter</option>
            {#each filteredChapters as chapter}<option value={chapter.id}>{chapter.title}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="revision-document">Source note</label>
          <select id="revision-document" name="documentId">
            <option value="">No source note</option>
            {#each data.documents.filter((document) => !moduleId || document.moduleId === moduleId) as document}
              <option value={document.id}>{document.title}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="revision-due">First review</label>
          <input
            id="revision-due"
            name="dueAt"
            type="datetime-local"
            value={localDateTime()}
            required
          />
        </div>
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit"
          ><Clock3 size={15} /> Add to queue</button
        >
      </div>
    </form>
  </Modal>
</div>

<style>
  .revision-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 30px;
  }

  .revision-list {
    border-top: 1px solid var(--border);
  }

  .revision-row {
    position: relative;
    display: flex;
    min-height: 78px;
    align-items: center;
    gap: 11px;
    padding: 11px 4px;
    border-bottom: 1px solid var(--border);
  }

  .revision-row.overdue::before {
    position: absolute;
    top: 14px;
    bottom: 14px;
    left: -8px;
    width: 2px;
    border-radius: 999px;
    background: var(--warning);
    content: '';
  }

  .revision-copy {
    min-width: 0;
    flex: 1;
  }

  .revision-copy p,
  .revision-copy h3 {
    margin-bottom: 2px;
  }

  .complete-menu {
    position: relative;
  }

  .complete-menu > summary {
    list-style: none;
  }

  .review-form {
    position: absolute;
    z-index: 10;
    top: 42px;
    right: 0;
    width: min(360px, calc(100vw - 36px));
    padding: 16px;
    box-shadow: 0 14px 44px rgba(0, 0, 0, 0.16);
  }

  .revision-sidebar {
    display: grid;
    align-content: start;
    gap: 14px;
  }

  .compact-list {
    display: grid;
    gap: 10px;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .compact-list li {
    display: grid;
    gap: 1px;
    padding-bottom: 9px;
    border-bottom: 1px solid var(--border);
  }

  .compact-list li > span:last-child {
    color: var(--text-faint);
    font-size: 10px;
  }

  .history-title {
    font-size: 12px;
    font-weight: 550;
  }

  @media (max-width: 820px) {
    .revision-layout {
      grid-template-columns: 1fr;
    }

    .revision-sidebar {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 560px) {
    .revision-sidebar {
      grid-template-columns: 1fr;
    }

    .revision-row {
      flex-wrap: wrap;
    }

    .revision-copy {
      width: calc(100% - 28px);
    }

    .complete-menu {
      margin-left: 20px;
    }
  }
</style>
