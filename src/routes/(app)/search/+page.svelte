<script lang="ts">
  import {
    BookOpen,
    CheckSquare2,
    FileText,
    Filter,
    Search,
    Target,
    TimerReset
  } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import { documentTypeLabels, humanize } from '$lib/domain/labels';

  let { data } = $props();
  const groups = $derived([
    { key: 'modules', label: 'Modules', icon: BookOpen, rows: data.results.modules },
    { key: 'chapters', label: 'Chapters', icon: BookOpen, rows: data.results.chapters },
    { key: 'tasks', label: 'Tasks', icon: CheckSquare2, rows: data.results.tasks },
    { key: 'documents', label: 'Documents', icon: FileText, rows: data.results.documents },
    { key: 'practice', label: 'Practice', icon: Target, rows: data.results.practice },
    { key: 'revisions', label: 'Revision', icon: TimerReset, rows: data.results.revisions }
  ]);
  const total = $derived(groups.reduce((sum, group) => sum + group.rows.length, 0));

  function hrefFor(group: string, row: Record<string, unknown>) {
    if (group === 'modules') return `/modules/${row.id}`;
    if (group === 'chapters') return `/chapters/${row.id}`;
    if (group === 'tasks') return '/tasks';
    if (group === 'documents') return `/api/documents/${row.id}/original`;
    if (group === 'practice') return `/practice?question=${row.id}`;
    return '/revision';
  }

  function titleFor(group: string, row: Record<string, unknown>) {
    if (group === 'modules') return `${row.code} · ${row.name}`;
    if (group === 'practice') return row.prompt;
    return row.title;
  }
</script>

<svelte:head>
  <title>{data.query ? `${data.query} · Search` : 'Search'} · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    title="Search"
    description="Find modules, chapters, tasks, and materials."
    backHref="/today"
    backLabel="Today"
  />

  <form method="GET" class="search-form surface">
    <div class="main-query">
      <Search size={19} />
      <label class="sr-only" for="search-query">Search StudySky</label>
      <input
        id="search-query"
        name="q"
        value={data.query}
        placeholder="Search your study workspace"
      />
      <button class="button button-primary" type="submit">Search</button>
    </div>
    <details class="filter-panel" open={Object.values(data.filters).some(Boolean)}>
      <summary><Filter size={15} /> Filters</summary>
      <div class="form-grid filters">
        <div class="field">
          <label for="search-module">Module</label>
          <select id="search-module" name="module">
            <option value="">All modules</option>
            {#each data.modules as module}<option
                value={module.id}
                selected={data.filters.moduleId === module.id}>{module.code} · {module.name}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="search-chapter">Chapter</label>
          <select id="search-chapter" name="chapter">
            <option value="">All chapters</option>
            {#each data.chapters as chapter}<option
                value={chapter.id}
                selected={data.filters.chapterId === chapter.id}>{chapter.title}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="search-type">Document type</label>
          <select id="search-type" name="type">
            <option value="">All document types</option>
            {#each Object.entries(documentTypeLabels) as [value, label]}<option
                {value}
                selected={data.filters.documentType === value}>{label}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="search-task-status">Task status</label>
          <select id="search-task-status" name="taskStatus">
            <option value="">All task statuses</option>
            {#each ['inbox', 'this_week', 'doing', 'waiting', 'done', 'skipped'] as status}<option
                value={status}
                selected={data.filters.taskStatus === status}>{humanize(status)}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="search-revision-status">Revision status</label>
          <select id="search-revision-status" name="revisionStatus">
            <option value="">All revision states</option>
            {#each ['due', 'upcoming', 'completed', 'dismissed'] as state}<option
                value={state}
                selected={data.filters.revisionStatus === state}>{humanize(state)}</option
              >{/each}
          </select>
        </div>
        <div class="field date-pair">
          <label for="search-from">Date range</label>
          <div>
            <input id="search-from" name="from" type="date" value={data.filters.from ?? ''} /><input
              name="to"
              type="date"
              value={data.filters.to ?? ''}
              aria-label="End date"
            />
          </div>
        </div>
      </div>
    </details>
  </form>

  {#if !data.query}
    <EmptyState
      title="Search your study system"
      description="Results always stay within your account and documents explicitly shared with you."
    />
  {:else if total === 0}
    <EmptyState
      title="No matching study items"
      description="Try fewer words or clear one of the filters."
    />
  {:else}
    <p class="result-count">{total} result{total === 1 ? '' : 's'} for “{data.query}”</p>
    <div class="result-groups">
      {#each groups.filter((group) => group.rows.length) as group}
        {@const Icon = group.icon}
        <section class="result-group">
          <div class="group-heading">
            <Icon size={17} />
            <h2>{group.label}</h2>
            <span class="pill">{group.rows.length}</span>
          </div>
          <div class="result-list">
            {#each group.rows as raw}
              {@const row = raw as Record<string, unknown>}
              <a
                class="result-row"
                href={hrefFor(group.key, row)}
                target={group.key === 'documents' ? '_blank' : undefined}
                rel={group.key === 'documents' ? 'noreferrer' : undefined}
              >
                {#if row.moduleColor}<span
                    class="module-dot"
                    style={`--module-color: ${row.moduleColor}`}
                  ></span>{/if}
                <span>
                  <strong>{titleFor(group.key, row)}</strong>
                  <small>
                    {row.moduleCode ?? (row.isOwner === false ? 'Shared document' : 'General')}
                    {row.chapterTitle ? ` · ${row.chapterTitle}` : ''}
                    {group.key === 'tasks' && row.status
                      ? ` · ${humanize(String(row.status))}`
                      : ''}
                    {row.type ? ` · ${humanize(String(row.type))}` : ''}
                    {row.mode ? ` · ${humanize(String(row.mode))}` : ''}
                  </small>
                </span>
              </a>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search-form {
    overflow: hidden;
    margin-bottom: 30px;
  }

  .main-query {
    display: flex;
    min-height: 62px;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
  }

  .main-query > input {
    min-height: 42px;
    flex: 1;
    border: 0;
    outline: 0;
    font-size: 16px;
  }

  .filter-panel {
    border-top: 1px solid var(--border);
  }

  .filter-panel summary {
    display: flex;
    min-height: 42px;
    align-items: center;
    gap: 7px;
    padding: 8px 12px;
    color: var(--text-soft);
    font-size: 12px;
    font-weight: 600;
    list-style: none;
  }

  .filters {
    padding: 6px 14px 16px;
  }

  .date-pair > div {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .result-count {
    color: var(--text-soft);
    font-size: 12px;
  }

  .result-groups {
    display: grid;
    gap: 30px;
  }

  .group-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }

  .group-heading h2 {
    margin: 0;
  }

  .result-list {
    border-top: 1px solid var(--border);
  }

  .result-row {
    display: flex;
    min-height: 58px;
    align-items: center;
    gap: 10px;
    padding: 9px 5px;
    border-bottom: 1px solid var(--border);
  }

  .result-row:hover {
    background: var(--surface-hover);
  }

  .result-row > span:last-child {
    display: grid;
    min-width: 0;
  }

  .result-row strong {
    overflow: hidden;
    font-weight: 550;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-row small {
    color: var(--text-faint);
  }

  @media (max-width: 560px) {
    .main-query {
      flex-wrap: wrap;
    }

    .main-query > input {
      width: calc(100% - 32px);
    }

    .main-query .button {
      width: 100%;
    }
  }
</style>
