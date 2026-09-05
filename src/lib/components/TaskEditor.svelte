<script lang="ts">
  import { enhance } from '$app/forms';
  import Modal from './Modal.svelte';
  import { dateKeyInTimeZone, minutesInTimeZone } from '$lib/domain/time';

  let {
    open = $bindable(false),
    task,
    timezone
  }: {
    open?: boolean;
    task: {
      id: string;
      title: string;
      deadline: Date | string | null;
      scheduledStart: Date | string | null;
      estimatedMinutes: number;
    } | null;
    timezone: string;
  } = $props();
  let error = $state('');
  let saving = $state(false);
  $effect(() => {
    if (open) error = '';
  });
  function localValue(value: Date | string | null) {
    if (!value) return '';
    const date = new Date(value);
    const minutes = minutesInTimeZone(date, timezone);
    return `${dateKeyInTimeZone(date, timezone)}T${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
</script>

<Modal bind:open title="Edit task" size="small">
  {#if task && open}
    {#key task.id}
      <form
        method="POST"
        action="/tasks?/edit"
        class="stack"
        use:enhance={() => {
          saving = true;
          error = '';
          return async ({ result, update }) => {
            saving = false;
            if (result.type === 'success') {
              await update();
              open = false;
            } else
              error =
                result.type === 'failure'
                  ? String(result.data?.error ?? 'Could not save task.')
                  : 'Could not save task. Try again.';
          };
        }}
      >
        <input type="hidden" name="taskId" value={task.id} />
        <label class="field"
          >Title<input
            name="title"
            value={task.title}
            required
            minlength="2"
            maxlength="300"
          /></label
        >
        <label class="field"
          >Study time<input
            name="scheduledStart"
            type="datetime-local"
            value={localValue(task.scheduledStart)}
          /></label
        >
        <label class="field"
          >Deadline<input
            name="deadline"
            type="datetime-local"
            value={localValue(task.deadline)}
          /></label
        >
        <label class="field"
          >Estimated minutes<input
            name="estimatedMinutes"
            type="number"
            min="5"
            max="720"
            value={task.estimatedMinutes}
            required
          /></label
        >
        <p class="subtle">Times use your account timezone: {timezone}.</p>
        {#if error}<p role="alert">{error}</p>{/if}
        <div class="form-actions">
          <button class="button" type="button" onclick={() => (open = false)}>Cancel</button>
          <button class="button button-primary" disabled={saving}
            >{saving ? 'Saving…' : 'Save task'}</button
          >
        </div>
      </form>
    {/key}
  {/if}
</Modal>
