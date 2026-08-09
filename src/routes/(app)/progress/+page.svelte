<script lang="ts">
  import { CalendarClock, ChartNoAxesColumnIncreasing, Plus, Target } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { dateKeyInTimeZone } from '$lib/domain/time';

  let { data, form } = $props();
  let createOpen = $state(false);
  const attempts = $derived(data.overview.attempts);
  const correctAttempts = $derived(
    attempts.filter((attempt) => attempt.result === 'correct').length
  );
  const practiceAccuracy = $derived(
    attempts.length ? Math.round((correctAttempts / attempts.length) * 100) : null
  );
  const upcoming = $derived(
    data.overview.assessments
      .filter(
        (assessment) =>
          assessment.assessmentDate >= dateKeyInTimeZone(new Date(), data.user.timezone)
      )
      .sort((a, b) => a.assessmentDate.localeCompare(b.assessmentDate))
  );
  const formatBytes = (value: number) =>
    value >= 1024 ** 3
      ? `${(value / 1024 ** 3).toFixed(2)} GB`
      : `${(value / 1024 ** 2).toFixed(1)} MB`;

  $effect(() => {
    if (form?.action === 'createAssessment' && form?.error) createOpen = true;
  });
</script>

<svelte:head>
  <title>Progress · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    eyebrow="Evidence, not activity"
    title="Progress"
    description="Practice, real assessment results, and focused study time."
    backHref="/modules"
    backLabel="Modules"
  >
    {#snippet actions()}
      <button class="button button-primary" type="button" onclick={() => (createOpen = true)}>
        <Plus size={16} /> Add result
      </button>
    {/snippet}
  </PageHeader>

  <Toast
    message={form?.error
      ? form.error
      : form?.action === 'createAssessment' && form?.success
        ? 'Assessment saved.'
        : ''}
    tone={form?.error ? 'error' : 'success'}
    token={form}
  />

  <section class="summary-strip" aria-label="Study summary">
    <div><strong>{data.overview.focusMinutes}</strong><span>focused minutes</span></div>
    <div><strong>{attempts.length}</strong><span>practice attempts</span></div>
    <div>
      <strong>{practiceAccuracy === null ? '—' : `${practiceAccuracy}%`}</strong><span
        >practice accuracy</span
      >
    </div>
    <div><strong>{formatBytes(data.overview.storageBytes)}</strong><span>study files</span></div>
  </section>

  <div class="progress-layout section">
    <section>
      <h2>Modules</h2>
      {#if data.overview.modules.length}
        <div class="module-progress-list">
          {#each data.overview.modules as module}
            <article class="module-progress-row">
              <span class="module-dot" style={`--module-color: ${module.color}`}></span>
              <div>
                <div class="row-between">
                  <span><strong>{module.code}</strong> · {module.name}</span>
                  <span class="subtle">
                    {module.result === null
                      ? 'No marked result'
                      : `${module.result.toFixed(1)}% weighted`}
                  </span>
                </div>
                <span class="subtle"
                  >{module.chapterCount} chapter{module.chapterCount === 1 ? '' : 's'}</span
                >
              </div>
              <a class="button button-sm" href={`/modules/${module.id}`}>Open</a>
            </article>
          {/each}
        </div>
      {:else}
        <EmptyState
          title="No module evidence yet"
          description="Add modules and record real study outcomes to build this view."
        />
      {/if}
    </section>

    <aside class="progress-sidebar">
      <section class="surface panel">
        <h2><CalendarClock size={17} /> Upcoming assessments</h2>
        {#if upcoming.length}
          <ul class="compact-list">
            {#each upcoming.slice(0, 8) as assessment}
              {@const module = data.overview.modules.find(
                (item) => item.id === assessment.moduleId
              )}
              <li>
                <strong>{assessment.name}</strong>
                <span>
                  {module?.code ?? 'Module'} ·
                  {new Date(`${assessment.assessmentDate}T12:00:00Z`).toLocaleDateString('en-GB', {
                    day: 'numeric',
                    month: 'short',
                    timeZone: 'UTC'
                  })}
                  {assessment.targetMark
                    ? ` · target ${assessment.targetMark}/${assessment.maximumMark}`
                    : ''}
                </span>
              </li>
            {/each}
          </ul>
        {:else}
          <p class="muted">No upcoming assessments recorded.</p>
        {/if}
      </section>

      <section class="surface panel cpa-note">
        <Target size={18} />
        <div>
          <h2>CPA tracking</h2>
          {#if data.overview.grading.enabled}
            {#if data.overview.cpa.value !== null}
              <strong class="cpa-value">{data.overview.cpa.value.toFixed(2)}%</strong>
              <p>
                Estimated CPA from {data.overview.cpa.includedModules} module{data.overview.cpa
                  .includedModules === 1
                  ? ''
                  : 's'}.
                {#if data.overview.cpa.classification}
                  Current band: {data.overview.cpa.classification}.
                {/if}
              </p>
              {#if data.overview.cpa.borderlineFor}
                <p>
                  Within 0.5 of {data.overview.cpa.borderlineFor}; UoM Board discretion may apply,
                  so StudySky has not upgraded it.
                </p>
              {/if}
            {:else}
              <p>
                Add marked results and module credit units before an estimate can be calculated.
              </p>
            {/if}
            {#if data.overview.cpa.missingCredits || data.overview.cpa.missingResults}
              <p>
                Excluded:
                {data.overview.cpa.missingResults} without results ·
                {data.overview.cpa.missingCredits} without valid credits.
              </p>
            {/if}
          {:else}
            <p>
              Weighted grading is off. Enable the generic method or choose an institution preset in
              Settings.
            </p>
          {/if}
          <a class="subtle" href="/settings#grading">Review grading settings →</a>
        </div>
      </section>
    </aside>
  </div>

  <section class="section">
    <div class="row-between">
      <h2>Assessment history</h2>
      <span class="pill">{data.overview.assessments.length}</span>
    </div>
    {#if data.overview.assessments.length}
      <div class="assessment-table-wrap">
        <table>
          <thead>
            <tr
              ><th>Date</th><th>Assessment</th><th>Module</th><th>Result</th><th>Weight</th><th
                >Target</th
              ></tr
            >
          </thead>
          <tbody>
            {#each data.overview.assessments as assessment}
              {@const module = data.overview.modules.find(
                (item) => item.id === assessment.moduleId
              )}
              <tr>
                <td>{assessment.assessmentDate}</td>
                <td><strong>{assessment.name}</strong><small>{assessment.type}</small></td>
                <td>{module?.code ?? '—'}</td>
                <td>
                  {assessment.achievedMark === null
                    ? 'Awaiting result'
                    : `${assessment.achievedMark}/${assessment.maximumMark} · ${((Number(assessment.achievedMark) / Number(assessment.maximumMark)) * 100).toFixed(1)}%`}
                </td>
                <td>{assessment.weight === null ? '—' : `${assessment.weight}%`}</td>
                <td
                  >{assessment.targetMark === null
                    ? '—'
                    : `${assessment.targetMark}/${assessment.maximumMark}`}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <p class="muted">No assessments recorded yet.</p>
    {/if}
  </section>

  <Modal bind:open={createOpen} title="Add result">
    <form method="POST" action="?/createAssessment">
      <div class="form-grid">
        <div class="field">
          <label for="assessment-module">Module</label>
          <select id="assessment-module" name="moduleId" required>
            <option value="">Choose module</option>
            {#each data.overview.modules as module}<option value={module.id}
                >{module.code} · {module.name}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="assessment-name">Assessment name</label>
          <input id="assessment-name" name="name" required />
        </div>
        <div class="field">
          <label for="assessment-type">Type</label>
          <input
            id="assessment-type"
            name="type"
            placeholder="Quiz, assignment, examination…"
            required
          />
        </div>
        <div class="field">
          <label for="assessment-date">Date</label>
          <input
            id="assessment-date"
            name="assessmentDate"
            type="date"
            value={dateKeyInTimeZone(new Date(), data.user.timezone)}
            required
          />
        </div>
        <div class="field">
          <label for="maximum-mark">Maximum mark</label>
          <input
            id="maximum-mark"
            name="maximumMark"
            type="number"
            min="0.01"
            step="0.01"
            value="100"
            required
          />
        </div>
        <div class="field">
          <label for="achieved-mark">Achieved mark</label>
          <input id="achieved-mark" name="achievedMark" type="number" min="0" step="0.01" />
        </div>
        <div class="field">
          <label for="assessment-weight">Assessment weight in module (%)</label>
          <input
            id="assessment-weight"
            name="weight"
            type="number"
            min="0"
            max="100"
            step="0.001"
          />
        </div>
        <div class="field">
          <label for="target-mark">Target mark</label>
          <input id="target-mark" name="targetMark" type="number" min="0" step="0.01" />
        </div>
        <div class="field form-span">
          <label for="assessment-notes">Notes</label>
          <textarea id="assessment-notes" name="notes"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit">
          <ChartNoAxesColumnIncreasing size={15} /> Save assessment
        </button>
      </div>
    </form>
  </Modal>
</div>

<style>
  .summary-strip {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    border-block: 1px solid var(--border);
  }

  .summary-strip > div {
    display: grid;
    gap: 1px;
    padding: 16px;
    border-right: 1px solid var(--border);
  }

  .summary-strip > div:last-child {
    border-right: 0;
  }

  .summary-strip strong {
    font-size: 20px;
    font-weight: 620;
  }

  .summary-strip span {
    color: var(--text-soft);
    font-size: 11px;
  }

  .progress-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 310px;
    gap: 30px;
  }

  .module-progress-list {
    border-top: 1px solid var(--border);
  }

  .module-progress-row {
    display: grid;
    min-height: 78px;
    grid-template-columns: 10px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    border-bottom: 1px solid var(--border);
  }

  .progress-sidebar {
    display: grid;
    align-content: start;
    gap: 14px;
  }

  .progress-sidebar h2 {
    display: flex;
    align-items: center;
    gap: 7px;
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
    padding-bottom: 9px;
    border-bottom: 1px solid var(--border);
  }

  .compact-list span {
    color: var(--text-faint);
    font-size: 10px;
  }

  .cpa-note {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .cpa-note p {
    color: var(--text-soft);
    font-size: 12px;
  }

  .cpa-value {
    display: block;
    margin-top: 5px;
    font-size: 24px;
    font-weight: 620;
  }

  .assessment-table-wrap {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  th,
  td {
    min-width: 90px;
    padding: 10px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
    white-space: nowrap;
  }

  th {
    color: var(--text-soft);
    font-size: 10px;
    text-transform: uppercase;
  }

  td small {
    display: block;
    color: var(--text-faint);
  }

  @media (max-width: 820px) {
    .progress-layout {
      grid-template-columns: 1fr;
    }

    .progress-sidebar {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 620px) {
    .summary-strip {
      grid-template-columns: repeat(2, 1fr);
    }

    .summary-strip > div:nth-child(2) {
      border-right: 0;
    }

    .summary-strip > div:nth-child(-n + 2) {
      border-bottom: 1px solid var(--border);
    }

    .progress-sidebar {
      grid-template-columns: 1fr;
    }
  }
</style>
