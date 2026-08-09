<script lang="ts">
  import { page } from '$app/state';
  import {
    CalendarDays,
    CalendarPlus,
    Download,
    FileUp,
    LockKeyhole,
    LockKeyholeOpen,
    MapPin,
    Pencil,
    Repeat2,
    Settings2,
    Trash2
  } from '@lucide/svelte';
  import Modal from '$lib/components/Modal.svelte';
  import PageHeader from '$lib/components/PageHeader.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import WeekCalendar from '$lib/components/WeekCalendar.svelte';
  import { humanize } from '$lib/domain/labels';

  let { data, form } = $props();
  let createOpen = $state(false);
  let editorOpen = $state(false);
  let selectedEntry = $state<(typeof data.entries)[number] | null>(null);
  let recurrence = $state<'weekly' | 'once'>('weekly');
  let editRecurrence = $state<'weekly' | 'once'>('weekly');
  const view = $derived(page.url.searchParams.get('view') === 'manage' ? 'manage' : 'calendar');
  const dayOptions = [
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' },
    { value: 0, label: 'Sunday' }
  ];
  const daysByIndex = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday'
  ];
  const entryKinds = [
    'class',
    'study',
    'work',
    'travel',
    'sleep',
    'meal',
    'religious',
    'family',
    'appointment',
    'rest',
    'examination',
    'university_event',
    'other'
  ];
  const scheduleEntries = $derived(
    [...data.entries].sort((a, b) => {
      const aDay = a.entry.isRecurring ? ((a.entry.dayOfWeek ?? 0) + 6) % 7 : 7;
      const bDay = b.entry.isRecurring ? ((b.entry.dayOfWeek ?? 0) + 6) % 7 : 7;
      return (
        aDay - bDay ||
        (a.entry.oneTimeDate ?? '').localeCompare(b.entry.oneTimeDate ?? '') ||
        a.entry.startTime.localeCompare(b.entry.startTime)
      );
    })
  );
  const weekLabel = $derived(
    `${new Date(`${data.dates[0]}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC'
    })} – ${new Date(`${data.dates[6]}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    })}`
  );

  $effect(() => {
    if (form?.action === 'create' && form?.error) createOpen = true;
    if (form?.action === 'edit' && form?.error && selectedEntry) editorOpen = true;
  });

  function openEditor(row: { entry: { id: string; isRecurring: boolean } }) {
    const entry = data.entries.find((candidate) => candidate.entry.id === row.entry.id);
    if (!entry) return;
    selectedEntry = entry;
    editRecurrence = entry.entry.isRecurring ? 'weekly' : 'once';
    editorOpen = true;
  }
</script>

<svelte:head>
  <title>Timetable · StudySky</title>
</svelte:head>

<div class="page calendar-page">
  <PageHeader title="Timetable" description="Classes and blocked time, repeating Monday–Sunday.">
    {#snippet actions()}
      <a class="button" href="/api/calendar.ics"><Download size={16} /> Export</a>
      <button class="button button-primary" type="button" onclick={() => (createOpen = true)}>
        <CalendarPlus size={16} /> Add entry
      </button>
    {/snippet}
  </PageHeader>

  <nav class="page-tabs" aria-label="Timetable views">
    <a class:active={view === 'calendar'} href="/timetable">
      <CalendarDays size={15} /> Calendar
    </a>
    <a class:active={view === 'manage'} href="/timetable?view=manage">
      <Settings2 size={15} /> Manage schedule
      <span>{data.entries.length}</span>
    </a>
  </nav>

  <Toast
    message={form?.error
      ? form.error
      : form?.success
        ? form.action === 'importIcs'
          ? `Imported ${form.imported} event${form.imported === 1 ? '' : 's'}.`
          : 'Timetable updated.'
        : ''}
    tone={form?.error ? 'error' : 'success'}
    token={form}
  />

  {#if view === 'calendar'}
    <section class="calendar-view" aria-labelledby="current-week-title">
      <div class="calendar-heading">
        <div>
          <h2 id="current-week-title">Current week</h2>
          <p>{weekLabel} · {data.user.timezone}</p>
        </div>
        <p class="calendar-hint">
          Drag to move · resize from the bottom · click or right-click to edit
        </p>
      </div>
      <WeekCalendar
        entries={data.entries}
        dates={data.dates}
        today={data.date}
        onEdit={openEditor}
      />
    </section>
  {:else}
    <section class="manage-view" aria-labelledby="schedule-title">
      <div class="section-heading">
        <div>
          <h2 id="schedule-title">Manage schedule</h2>
          <p>Edit details or fix permanent entries so they cannot be moved accidentally.</p>
        </div>
      </div>

      {#if data.entries.length}
        <div class="schedule-list">
          {#each scheduleEntries as row}
            <article class="schedule-row">
              <span
                class="module-dot"
                style={`--module-color: ${row.moduleColor ?? 'var(--accent)'}`}
              ></span>
              <span class="schedule-when">
                <strong>
                  {row.entry.isRecurring
                    ? daysByIndex[row.entry.dayOfWeek ?? 0]
                    : row.entry.oneTimeDate}
                </strong>
                <span>{row.entry.startTime.slice(0, 5)}–{row.entry.endTime.slice(0, 5)}</span>
              </span>
              <span class="schedule-main">
                <strong>{row.entry.title}</strong>
                <small>
                  {humanize(row.entry.kind)}
                  {#if row.moduleCode}
                    · {row.moduleCode}{/if}
                  {#if row.entry.location}
                    · <MapPin size={10} /> {row.entry.location}{/if}
                </small>
              </span>
              <span class="schedule-state">
                {#if row.entry.isRecurring}
                  <span class="pill"><Repeat2 size={11} /> Weekly</span>
                {:else}
                  <span class="pill">One time</span>
                {/if}
                {#if row.entry.locked}<span class="pill fixed-pill">Fixed</span>{/if}
              </span>
              <form method="POST" action="?/toggleLock">
                <input type="hidden" name="entryId" value={row.entry.id} />
                <button
                  class="button button-icon button-quiet"
                  type="submit"
                  aria-label={`${row.entry.locked ? 'Unlock' : 'Fix'} ${row.entry.title}`}
                  title={row.entry.locked ? 'Unlock entry' : 'Keep this entry fixed'}
                >
                  {#if row.entry.locked}
                    <LockKeyhole size={15} />
                  {:else}
                    <LockKeyholeOpen size={15} />
                  {/if}
                </button>
              </form>
              <button
                class="button button-icon button-quiet"
                type="button"
                onclick={() => openEditor(row)}
                aria-label={`Edit ${row.entry.title}`}
                title="Edit entry"
              >
                <Pencil size={15} />
              </button>
              <form
                method="POST"
                action="?/delete"
                onsubmit={(event) => {
                  if (!confirm(`Delete ${row.entry.title}?`)) event.preventDefault();
                }}
              >
                <input type="hidden" name="entryId" value={row.entry.id} />
                <button
                  class="button button-icon button-quiet"
                  type="submit"
                  aria-label={`Delete ${row.entry.title}`}
                  disabled={row.entry.locked}
                  title={row.entry.locked ? 'Unlock before deleting' : 'Delete entry'}
                >
                  <Trash2 size={15} />
                </button>
              </form>
            </article>
          {/each}
        </div>
      {:else}
        <div class="empty-schedule"><p>No timetable entries yet.</p></div>
      {/if}

      <details class="surface disclosure import-section" open={form?.action === 'importIcs'}>
        <summary><FileUp size={16} /> Import iCalendar</summary>
        <form
          method="POST"
          action="?/importIcs"
          enctype="multipart/form-data"
          class="panel form-grid"
        >
          <div class="field">
            <label for="calendar-file">iCalendar file</label>
            <input
              id="calendar-file"
              name="calendar"
              type="file"
              accept=".ics,text/calendar"
              required
            />
          </div>
          <div class="field">
            <label for="calendar-kind">Import as</label>
            <select id="calendar-kind" name="kind">
              <option value="class">Class</option>
              <option value="university_event">University event</option>
              <option value="work">Work</option>
              <option value="appointment">Appointment</option>
              <option value="other">Other blocked time</option>
            </select>
          </div>
          <p class="muted form-span">
            Weekly and timed one-off events are supported. Overlapping events remain visible
            side-by-side.
          </p>
          <div class="form-actions form-span">
            <button class="button button-primary" type="submit">Import calendar</button>
          </div>
        </form>
      </details>
    </section>
  {/if}

  {#if selectedEntry}
    <Modal bind:open={editorOpen} title="Edit timetable entry">
      <form method="POST" action="?/edit" class="form-grid">
        <input type="hidden" name="entryId" value={selectedEntry.entry.id} />
        {#if selectedEntry.entry.locked}
          <p class="info-message form-span">
            This entry is fixed. Unlock it in Manage schedule before changing its day or time.
          </p>
        {/if}
        <div class="field form-span">
          <label for="edit-entry-title">Title</label>
          <input id="edit-entry-title" name="title" value={selectedEntry.entry.title} required />
        </div>
        <div class="field">
          <label for="edit-entry-kind">Type</label>
          <select id="edit-entry-kind" name="kind">
            {#each entryKinds as kind}
              <option value={kind} selected={kind === selectedEntry.entry.kind}
                >{humanize(kind)}</option
              >
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="edit-entry-module">Module</label>
          <select id="edit-entry-module" name="moduleId">
            <option value="">No module</option>
            {#each data.modules as module}
              <option value={module.id} selected={module.id === selectedEntry.entry.moduleId}>
                {module.code} · {module.name}
              </option>
            {/each}
          </select>
        </div>
        <div class="field">
          <label for="edit-entry-location">Location</label>
          <input
            id="edit-entry-location"
            name="location"
            value={selectedEntry.entry.location ?? ''}
          />
        </div>
        <div class="field">
          <label for="edit-entry-recurrence">Repeats</label>
          <select id="edit-entry-recurrence" name="recurrence" bind:value={editRecurrence}>
            <option value="weekly">Every week</option>
            <option value="once">One time</option>
          </select>
        </div>
        {#if editRecurrence === 'weekly'}
          <div class="field form-span">
            <label for="edit-entry-day">Day</label>
            <select id="edit-entry-day" name="dayOfWeek">
              {#each dayOptions as day}
                <option value={day.value} selected={day.value === selectedEntry.entry.dayOfWeek}>
                  {day.label}
                </option>
              {/each}
            </select>
          </div>
        {:else}
          <div class="field form-span">
            <label for="edit-entry-date">Date</label>
            <input
              id="edit-entry-date"
              name="oneTimeDate"
              type="date"
              value={selectedEntry.entry.oneTimeDate ?? data.date}
              required
            />
          </div>
        {/if}
        <div class="field">
          <label for="edit-entry-start">Start</label>
          <input
            id="edit-entry-start"
            name="startTime"
            type="time"
            value={selectedEntry.entry.startTime.slice(0, 5)}
            required
          />
        </div>
        <div class="field">
          <label for="edit-entry-end">End</label>
          <input
            id="edit-entry-end"
            name="endTime"
            type="time"
            value={selectedEntry.entry.endTime.slice(0, 5)}
            required
          />
        </div>
        <div class="form-actions form-span">
          <button class="button" type="button" onclick={() => (editorOpen = false)}>Cancel</button>
          <button class="button button-primary" type="submit">Save entry</button>
        </div>
      </form>
    </Modal>
  {/if}

  <Modal
    bind:open={createOpen}
    title="Add timetable entry"
    description="Weekly entries repeat automatically; one-time entries appear only on their date."
  >
    <form method="POST" action="?/create" class="form-grid">
      {#if form?.action === 'create' && form?.error}
        <p class="error-message form-span" role="alert">{form.error}</p>
      {/if}
      <div class="field form-span">
        <label for="entry-title">Title</label>
        <input id="entry-title" name="title" required />
      </div>
      <div class="field">
        <label for="entry-kind">Type</label>
        <select id="entry-kind" name="kind">
          {#each entryKinds as kind}<option value={kind}>{humanize(kind)}</option>{/each}
        </select>
      </div>
      <div class="field">
        <label for="entry-module">Module</label>
        <select id="entry-module" name="moduleId">
          <option value="">No module</option>
          {#each data.modules as module}
            <option value={module.id}>{module.code} · {module.name}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="entry-location">Location</label>
        <input id="entry-location" name="location" placeholder="Online or room" />
      </div>
      <div class="field">
        <label for="entry-recurrence">Repeats</label>
        <select id="entry-recurrence" name="recurrence" bind:value={recurrence}>
          <option value="weekly">Every week</option>
          <option value="once">One time</option>
        </select>
      </div>
      {#if recurrence === 'weekly'}
        <div class="field form-span">
          <label for="entry-day">Day</label>
          <select id="entry-day" name="dayOfWeek">
            {#each dayOptions as day}<option value={day.value}>{day.label}</option>{/each}
          </select>
        </div>
      {:else}
        <div class="field form-span">
          <label for="entry-date">Date</label>
          <input id="entry-date" name="oneTimeDate" type="date" value={data.date} required />
        </div>
      {/if}
      <div class="field">
        <label for="entry-start">Start</label>
        <input id="entry-start" name="startTime" type="time" required />
      </div>
      <div class="field">
        <label for="entry-end">End</label>
        <input id="entry-end" name="endTime" type="time" required />
      </div>
      <div class="form-actions form-span">
        <button class="button" type="button" onclick={() => (createOpen = false)}>Cancel</button>
        <button class="button button-primary" type="submit">Add to timetable</button>
      </div>
    </form>
  </Modal>
</div>

<style>
  .page-tabs {
    display: flex;
    gap: 3px;
    margin: -5px 0 20px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .page-tabs a {
    display: inline-flex;
    min-height: 36px;
    align-items: center;
    gap: 7px;
    padding: 7px 10px;
    border-radius: 6px;
    color: var(--text-soft);
    font-size: 12px;
  }

  .page-tabs a:hover,
  .page-tabs a.active {
    color: var(--text);
    background: var(--surface-hover);
  }

  .page-tabs span {
    color: var(--text-faint);
    font-size: 10px;
  }

  .calendar-heading,
  .section-heading {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 10px;
  }

  .calendar-heading h2,
  .section-heading h2 {
    margin-bottom: 2px;
  }

  .calendar-heading p,
  .section-heading p {
    margin: 0;
    color: var(--text-soft);
    font-size: 11px;
  }

  .calendar-hint {
    text-align: right;
  }

  .schedule-list {
    margin-top: 12px;
    border-top: 1px solid var(--border);
  }

  .schedule-row {
    display: flex;
    min-height: 66px;
    align-items: center;
    gap: 10px;
    padding: 8px 2px;
    border-bottom: 1px solid var(--border);
  }

  .schedule-when {
    display: grid;
    width: 142px;
    flex: 0 0 auto;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .schedule-when span,
  .schedule-main small {
    color: var(--text-soft);
    font-size: 11px;
  }

  .schedule-main {
    display: grid;
    min-width: 180px;
    flex: 1;
  }

  .schedule-main small {
    display: flex;
    align-items: center;
    gap: 3px;
  }

  .schedule-state {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .fixed-pill {
    color: var(--accent);
    background: var(--accent-soft);
  }

  .empty-schedule {
    display: grid;
    min-height: 150px;
    place-items: center;
    margin-top: 12px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius);
    color: var(--text-soft);
  }

  .import-section {
    max-width: 760px;
    margin-top: 28px;
  }

  .disclosure {
    overflow: hidden;
  }

  .disclosure summary {
    display: flex;
    min-height: 48px;
    align-items: center;
    gap: 8px;
    padding: 12px 14px;
    font-weight: 600;
    list-style: none;
  }

  .disclosure[open] summary {
    border-bottom: 1px solid var(--border);
  }

  @media (max-width: 760px) {
    .calendar-heading,
    .section-heading {
      align-items: stretch;
      flex-direction: column;
    }

    .calendar-hint {
      text-align: left;
    }

    .schedule-row {
      align-items: flex-start;
      flex-wrap: wrap;
      padding: 12px 2px;
    }

    .schedule-when {
      width: 112px;
    }

    .schedule-main {
      width: calc(100% - 145px);
    }

    .schedule-state {
      width: 100%;
      padding-left: 19px;
    }
  }
</style>
