<script lang="ts">
  import { Check, CircleAlert, Plus, RotateCcw, Target } from '@lucide/svelte';
  import EmptyState from '$lib/components/EmptyState.svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { humanize } from '$lib/domain/labels';

  let { data, form } = $props();
  let startedAt = $state(Date.now());
  let secondsTaken = $state(0);
  let moduleId = $state('');
  let createOpen = $state(false);
  const selected = $derived(data.selected);
  const filteredChapters = $derived(
    data.chapters.filter((chapter) => !moduleId || chapter.moduleId === moduleId)
  );

  $effect(() => {
    if (form?.action === 'create' && form?.error) createOpen = true;
  });
</script>

<svelte:head>
  <title>Practice · StudySky</title>
</svelte:head>

<div class="page">
  <PageHeader
    eyebrow="Active recall"
    title="Practice"
    description="Answer first. The expected answer stays hidden until you submit or deliberately reveal it."
    backHref="/modules"
    backLabel="Modules"
  >
    {#snippet actions()}
      <button class="button button-primary" type="button" onclick={() => (createOpen = true)}>
        <Plus size={16} /> Add question
      </button>
    {/snippet}
  </PageHeader>

  <Toast
    message={form?.action === 'create'
      ? form?.error
        ? form.error
        : form?.success
          ? 'Question added.'
          : ''
      : ''}
    tone={form?.error ? 'error' : 'success'}
    token={form}
  />

  <div class="practice-layout">
    <aside class="question-index" aria-label="Practice questions">
      <div class="index-summary">
        <strong>{data.questions.length} questions</strong>
        <span>
          {data.totals.attempts
            ? `${Math.round((data.totals.correct / data.totals.attempts) * 100)}% correct`
            : 'No attempts yet'}
        </span>
      </div>
      {#each data.questions as question}
        <a
          class:active={question.id === selected?.id}
          class="question-link"
          href={`/practice?question=${question.id}`}
        >
          <span class="module-dot" style={`--module-color: ${question.moduleColor ?? '#787774'}`}
          ></span>
          <span>
            <strong>{question.prompt}</strong>
            <small>
              {question.moduleCode ?? 'General'} · {humanize(question.mode)}
              {question.accuracy !== null ? ` · ${question.accuracy}%` : ''}
            </small>
          </span>
        </a>
      {/each}
    </aside>

    <section class="practice-stage">
      {#if selected}
        <div class="surface question-card">
          <div class="row-between">
            <span class="pill">{humanize(selected.mode)}</span>
            <span class="subtle">Difficulty {selected.difficulty}/5</span>
          </div>
          <h2>{selected.prompt}</h2>
          {#if selected.choices?.length}
            <ol class="choice-list">
              {#each selected.choices as choice}<li>{choice}</li>{/each}
            </ol>
          {/if}

          {#if form && form.questionId === selected.id && (form.action === 'submit' || form.action === 'reveal') && form.expectedAnswer}
            <div
              class:correct={form?.result === 'correct'}
              class:incorrect={form?.result === 'incorrect'}
              class="answer-result"
            >
              {#if form?.action === 'submit'}
                <p class="result-title">
                  {#if form.result === 'correct'}<Check size={18} /> Correct{:else}<CircleAlert
                      size={18}
                    /> Review this answer{/if}
                </p>
              {:else}
                <p class="result-title"><Target size={18} /> Answer revealed</p>
              {/if}
              <p><strong>Expected answer</strong></p>
              <p class="expected-answer">{form.expectedAnswer}</p>
              {#if form.explanation}
                <p><strong>Explanation</strong></p>
                <p>{form.explanation}</p>
              {/if}
              <a
                class="button"
                href={`/practice?question=${selected.id}`}
                onclick={() => (startedAt = Date.now())}
              >
                <RotateCcw size={15} /> Try again
              </a>
            </div>
          {:else}
            <form
              method="POST"
              action="?/submit"
              class="answer-form"
              onsubmit={() =>
                (secondsTaken = Math.max(0, Math.round((Date.now() - startedAt) / 1000)))}
            >
              <input type="hidden" name="questionId" value={selected.id} />
              <input type="hidden" name="secondsTaken" value={secondsTaken} />
              <div class="field">
                <label for="practice-answer">Your answer</label>
                <textarea id="practice-answer" name="answer" rows="6" autocomplete="off"></textarea>
              </div>
              <details class="answer-options">
                <summary>More options</summary>
                <div class="form-grid compact-grid">
                  <div class="field">
                    <label for="practice-self-result">How should this be graded?</label>
                    <select id="practice-self-result" name="selfResult">
                      <option value="">Auto-check exact answer</option>
                      <option value="correct">Correct</option>
                      <option value="partially_correct">Partially correct</option>
                      <option value="incorrect">Incorrect</option>
                      <option value="skipped">Skipped</option>
                    </select>
                  </div>
                  <div class="field">
                    <label for="practice-hints">Hints used</label>
                    <input
                      id="practice-hints"
                      name="hintsUsed"
                      type="number"
                      min="0"
                      max="20"
                      value="0"
                    />
                  </div>
                  <div class="field">
                    <label for="practice-mistake">Likely mistake category</label>
                    <select id="practice-mistake" name="mistake">
                      <option value="">Choose if useful</option>
                      {#each ['concept_not_understood', 'formula_forgotten', 'calculation_error', 'misread_question', 'logic_error', 'algorithm_error', 'syntax_error', 'insufficient_practice', 'careless_mistake', 'other'] as mistake}
                        <option value={mistake}>{humanize(mistake)}</option>
                      {/each}
                    </select>
                  </div>
                </div>
              </details>
              {#if form?.action === 'submit' && form?.error}
                <p class="error-message" role="alert">{form.error}</p>
              {/if}
              <div class="form-actions">
                <button class="button" type="submit" formaction="?/reveal" formnovalidate>
                  Reveal answer
                </button>
                <button class="button button-primary" type="submit">Submit answer</button>
              </div>
            </form>
          {/if}
        </div>
      {:else}
        <EmptyState
          title="No practice questions yet"
          description="Add a question from lecture notes, an exercise, or a topic you want to remember."
        />
      {/if}
    </section>
  </div>

  <Modal bind:open={createOpen} title="Add question">
    <form method="POST" action="?/create">
      {#if form?.action === 'create' && form?.error}
        <p class="error-message" role="alert">{form.error}</p>
      {/if}
      <div class="form-grid">
        <div class="field">
          <label for="question-module">Module</label>
          <select id="question-module" name="moduleId" bind:value={moduleId}>
            <option value="">General</option>
            {#each data.modules as module}<option value={module.id}
                >{module.code} · {module.name}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="question-chapter">Chapter</label>
          <select id="question-chapter" name="chapterId">
            <option value="">No chapter</option>
            {#each filteredChapters as chapter}<option value={chapter.id}>{chapter.title}</option
              >{/each}
          </select>
        </div>
        <div class="field">
          <label for="question-mode">Mode</label>
          <select id="question-mode" name="mode">
            {#each ['multiple_choice', 'short_answer', 'explanation', 'coding', 'sql', 'algorithm_tracing', 'numerical_computation', 'physics_calculation', 'formula_recall', 'mixed_topic', 'timed_mock'] as mode}
              <option value={mode}>{humanize(mode)}</option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="question-difficulty">Difficulty</label>
          <select id="question-difficulty" name="difficulty">
            {#each [1, 2, 3, 4, 5] as value}<option {value} selected={value === 3}>{value}/5</option
              >{/each}
          </select>
        </div>
        <div class="field form-span">
          <label for="question-prompt">Question</label>
          <textarea id="question-prompt" name="prompt" required></textarea>
        </div>
        <div class="field form-span">
          <label for="question-answer">Expected answer</label>
          <textarea id="question-answer" name="answer" required></textarea>
        </div>
        <div class="field">
          <label for="question-choices">Choices (one per line)</label>
          <textarea id="question-choices" name="choices"></textarea>
        </div>
        <div class="field">
          <label for="question-explanation">Explanation</label>
          <textarea id="question-explanation" name="explanation"></textarea>
        </div>
      </div>
      <div class="form-actions">
        <button class="button button-primary" type="submit">Save question</button>
      </div>
    </form>
  </Modal>
</div>

<style>
  .practice-layout {
    display: grid;
    grid-template-columns: minmax(220px, 300px) minmax(0, 1fr);
    gap: 24px;
  }

  .question-index {
    max-height: 680px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .index-summary {
    display: grid;
    padding: 12px;
    border-bottom: 1px solid var(--border);
    background: var(--surface-hover);
  }

  .index-summary span {
    color: var(--text-soft);
    font-size: 11px;
  }

  .question-link {
    display: flex;
    min-height: 62px;
    align-items: flex-start;
    gap: 9px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border);
  }

  .question-link:hover,
  .question-link.active {
    background: var(--surface-hover);
  }

  .question-link > span:last-child {
    display: grid;
    min-width: 0;
  }

  .question-link strong {
    display: -webkit-box;
    overflow: hidden;
    font-size: 12px;
    font-weight: 550;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .question-link small {
    color: var(--text-faint);
    font-size: 10px;
  }

  .question-link .module-dot {
    margin-top: 5px;
  }

  .question-card {
    min-height: 430px;
    padding: 24px;
  }

  .question-card > h2 {
    margin: 28px 0 18px;
    font-size: 20px;
    white-space: pre-wrap;
  }

  .choice-list {
    display: grid;
    gap: 8px;
    margin: 0 0 24px;
    padding-left: 26px;
  }

  .choice-list li {
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .answer-form {
    display: grid;
    gap: 16px;
  }

  .compact-grid {
    margin-top: 4px;
  }

  .answer-options {
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 7px;
  }

  .answer-options > summary {
    min-height: 40px;
    padding: 10px 12px;
    color: var(--text-soft);
    font-weight: 600;
  }

  .answer-options > .compact-grid {
    padding: 12px;
    border-top: 1px solid var(--border);
  }

  .answer-result {
    padding: 18px;
    border-radius: 8px;
    background: var(--surface-hover);
  }

  .answer-result.correct {
    background: var(--success-soft);
  }

  .answer-result.incorrect {
    background: var(--warning-soft);
  }

  .result-title {
    display: flex;
    align-items: center;
    gap: 7px;
    font-weight: 650;
  }

  .expected-answer {
    white-space: pre-wrap;
  }

  @media (max-width: 760px) {
    .practice-layout {
      grid-template-columns: 1fr;
    }

    .question-index {
      display: flex;
      max-width: calc(100vw - 36px);
      overflow-x: auto;
    }

    .index-summary,
    .question-link {
      width: 210px;
      min-width: 210px;
      border-right: 1px solid var(--border);
      border-bottom: 0;
    }

    .question-card {
      min-height: 0;
      padding: 18px;
    }
  }
</style>
