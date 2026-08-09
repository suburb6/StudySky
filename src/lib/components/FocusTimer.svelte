<script lang="ts">
  import { onDestroy } from 'svelte';
  import { CirclePause, Play, RotateCcw, Square } from '@lucide/svelte';

  let {
    tasks
  }: {
    tasks: Array<{ id: string; title: string; estimatedMinutes: number }>;
  } = $props();

  let selectedId = $state('');
  let plannedMinutes = $state(30);
  let elapsedSeconds = $state(0);
  let running = $state(false);
  let finishing = $state(false);
  let timer: ReturnType<typeof setInterval> | undefined;
  let initialized = false;

  $effect(() => {
    if (!initialized && tasks.length) {
      selectedId = tasks[0].id;
      plannedMinutes = tasks[0].estimatedMinutes;
      initialized = true;
    }
  });

  const display = $derived(
    `${String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:${String(elapsedSeconds % 60).padStart(2, '0')}`
  );

  function selectTask(event: Event) {
    selectedId = (event.currentTarget as HTMLSelectElement).value;
    const selected = tasks.find((task) => task.id === selectedId);
    if (selected) plannedMinutes = selected.estimatedMinutes;
  }

  function start() {
    if (running) return;
    running = true;
    timer = setInterval(() => {
      elapsedSeconds += 1;
    }, 1000);
  }

  function pause() {
    running = false;
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function reset() {
    pause();
    elapsedSeconds = 0;
    finishing = false;
  }

  function finish() {
    pause();
    finishing = true;
  }

  onDestroy(pause);
</script>

<section class="focus-panel surface" aria-labelledby="focus-heading">
  <div class="focus-copy">
    <p class="eyebrow">Focus mode</p>
    <h2 id="focus-heading">One task, nothing else</h2>
    {#if tasks.length}
      <div class="focus-fields">
        <div class="field">
          <label for="focus-task">Task</label>
          <select id="focus-task" value={selectedId} onchange={selectTask} disabled={running}>
            {#each tasks as task}<option value={task.id}>{task.title}</option>{/each}
          </select>
        </div>
        <div class="field duration-field">
          <label for="focus-duration">Plan</label>
          <input
            id="focus-duration"
            type="number"
            min="5"
            max="240"
            bind:value={plannedMinutes}
            disabled={running}
          />
        </div>
      </div>
    {:else}
      <p class="muted">Add a task before starting a focus session.</p>
    {/if}
  </div>

  <div class="timer-area">
    <strong class="timer" aria-live="off">{display}</strong>
    <span class="subtle">of {plannedMinutes} min planned</span>
    <div class="timer-actions">
      {#if running}
        <button class="button button-icon" type="button" onclick={pause} aria-label="Pause timer">
          <CirclePause size={18} />
        </button>
      {:else}
        <button
          class="button button-primary"
          type="button"
          onclick={start}
          disabled={!selectedId || finishing}
        >
          <Play size={16} />
          {elapsedSeconds ? 'Resume' : 'Start'}
        </button>
      {/if}
      {#if elapsedSeconds}
        <button class="button button-icon" type="button" onclick={reset} aria-label="Reset timer">
          <RotateCcw size={17} />
        </button>
        <button class="button" type="button" onclick={finish}>
          <Square size={15} /> Finish
        </button>
      {/if}
    </div>
  </div>
</section>

{#if finishing}
  <form method="POST" action="?/finishFocus" class="surface panel finish-form">
    <input type="hidden" name="taskId" value={selectedId} />
    <input type="hidden" name="plannedMinutes" value={plannedMinutes} />
    <h2>How did it go?</h2>
    <div class="form-grid">
      <div class="field">
        <label for="actual-minutes">Actual minutes</label>
        <input
          id="actual-minutes"
          name="actualMinutes"
          type="number"
          min="1"
          max="720"
          value={Math.max(1, Math.ceil(elapsedSeconds / 60))}
          required
        />
      </div>
      <div class="field">
        <label for="focus-outcome">Outcome</label>
        <select id="focus-outcome" name="outcome" required>
          <option value="completed">Completed</option>
          <option value="partly_completed">Partly completed</option>
          <option value="still_confused">Still confused</option>
          <option value="needs_more_practice">Needs more practice</option>
          <option value="interrupted">Interrupted</option>
        </select>
      </div>
      <div class="field form-span">
        <label for="focus-notes">Short outcome note (optional)</label>
        <textarea id="focus-notes" name="notes" rows="2"></textarea>
      </div>
    </div>
    <div class="form-actions">
      <button class="button" type="button" onclick={() => (finishing = false)}>Keep timing</button>
      <button class="button button-primary" type="submit">Save session</button>
    </div>
  </form>
{/if}

<style>
  .focus-panel {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 30px;
    padding: 20px;
  }

  .focus-copy h2 {
    margin-bottom: 16px;
  }

  .focus-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 84px;
    gap: 10px;
  }

  .timer-area {
    display: flex;
    min-width: 210px;
    align-items: flex-end;
    justify-content: center;
    flex-direction: column;
  }

  .timer {
    font-size: 30px;
    line-height: 1;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .timer-actions {
    display: flex;
    gap: 8px;
    margin-top: 14px;
  }

  .finish-form {
    margin-top: 12px;
  }

  @media (max-width: 620px) {
    .focus-panel {
      grid-template-columns: 1fr;
    }

    .timer-area {
      min-width: 0;
      align-items: flex-start;
    }
  }
</style>
