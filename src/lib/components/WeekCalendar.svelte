<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  type CalendarRow = {
    entry: {
      id: string;
      title: string;
      kind: string;
      location: string | null;
      dayOfWeek: number | null;
      oneTimeDate: string | null;
      startTime: string;
      endTime: string;
      isRecurring: boolean;
      locked: boolean;
    };
    moduleCode: string | null;
    moduleColor: string | null;
  };

  let {
    entries,
    dates,
    today,
    onEdit
  }: {
    entries: CalendarRow[];
    dates: string[];
    today: string;
    onEdit?: (row: CalendarRow) => void;
  } = $props();

  let host: HTMLDivElement;
  let calendar: import('@fullcalendar/core').Calendar | null = null;
  let ready = $state(false);
  let moveForm: HTMLFormElement;
  let entryField: HTMLInputElement;
  let dayField: HTMLInputElement;
  let dateField: HTMLInputElement;
  let startField: HTMLInputElement;
  let endField: HTMLInputElement;

  onMount(async () => {
    const [{ Calendar }, { default: timeGridPlugin }, { default: interactionPlugin }] =
      await Promise.all([
        import('@fullcalendar/core'),
        import('@fullcalendar/timegrid'),
        import('@fullcalendar/interaction')
      ]);

    calendar = new Calendar(host, {
      plugins: [timeGridPlugin, interactionPlugin],
      initialView: 'timeGridWeek',
      initialDate: today,
      firstDay: 1,
      headerToolbar: false,
      height: 'auto',
      expandRows: true,
      allDaySlot: false,
      slotMinTime: '07:00:00',
      slotMaxTime: '21:00:00',
      slotDuration: '00:30:00',
      snapDuration: '00:15:00',
      scrollTime: '08:00:00',
      nowIndicator: true,
      editable: true,
      eventOverlap: true,
      eventStartEditable: true,
      eventDurationEditable: true,
      dayHeaderContent: ({ date }) =>
        `${date.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })} ${date.getUTCDate()}`,
      slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
      events: calendarEvents(),
      eventClick: ({ event }) => openEditor(event.id),
      eventDrop: ({ event }) => submitMove(event),
      eventResize: ({ event }) => submitMove(event),
      eventDidMount: ({ event, el }) => {
        const row = entries.find((candidate) => candidate.entry.id === event.id);
        if (!row) return;
        el.title = row.entry.locked
          ? `${row.entry.title} · fixed`
          : `${row.entry.title} · click or right-click to edit`;
        el.addEventListener('contextmenu', (contextEvent) => {
          contextEvent.preventDefault();
          openEditor(event.id);
        });
      },
      eventContent: ({ event, timeText }) => {
        const row = entries.find((candidate) => candidate.entry.id === event.id);
        const body = document.createElement('div');
        body.className = 'studysky-event';
        const time = document.createElement('span');
        time.className = 'studysky-event-time';
        time.textContent = timeText;
        const title = document.createElement('strong');
        title.textContent = event.title;
        body.append(time, title);
        if (row?.entry.location || row?.moduleCode) {
          const detail = document.createElement('small');
          detail.textContent = [row.moduleCode, row.entry.location].filter(Boolean).join(' · ');
          body.append(detail);
        }
        return { domNodes: [body] };
      }
    });
    calendar.render();
    ready = true;
  });

  onDestroy(() => {
    calendar?.destroy();
    calendar = null;
  });

  function calendarEvents() {
    return entries.flatMap((row) => {
      const date = occurrenceDate(row);
      if (!date) return [];
      const color = row.moduleColor ?? '#126bfa';
      return [
        {
          id: row.entry.id,
          title: row.entry.title,
          start: `${date}T${row.entry.startTime.slice(0, 5)}:00`,
          end: `${date}T${row.entry.endTime.slice(0, 5)}:00`,
          editable: !row.entry.locked,
          startEditable: !row.entry.locked,
          durationEditable: !row.entry.locked,
          overlap: true,
          borderColor: color,
          backgroundColor: transparentColor(color),
          textColor: 'var(--text)',
          classNames: [
            row.entry.locked ? 'is-fixed' : 'is-editable',
            row.entry.kind === 'study' ? 'is-study' : ''
          ].filter(Boolean)
        }
      ];
    });
  }

  function occurrenceDate(row: CalendarRow): string | null {
    if (!row.entry.isRecurring) {
      return row.entry.oneTimeDate && dates.includes(row.entry.oneTimeDate)
        ? row.entry.oneTimeDate
        : null;
    }
    return (
      dates.find((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === row.entry.dayOfWeek) ??
      null
    );
  }

  function transparentColor(color: string): string {
    return /^#[0-9a-f]{6}$/i.test(color) ? `${color}18` : 'rgba(18, 107, 250, 0.09)';
  }

  function openEditor(id: string) {
    const row = entries.find((candidate) => candidate.entry.id === id);
    if (row) onEdit?.(row);
  }

  function submitMove(event: import('@fullcalendar/core').EventApi) {
    if (!event.start || !event.end) return;
    const row = entries.find((candidate) => candidate.entry.id === event.id);
    if (!row || row.entry.locked) return;
    entryField.value = row.entry.id;
    dayField.value = String(event.start.getDay());
    dateField.value = localDateKey(event.start);
    startField.value = localTime(event.start);
    endField.value = localTime(event.end);
    moveForm.requestSubmit();
  }

  function localDateKey(value: Date): string {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(
      value.getDate()
    ).padStart(2, '0')}`;
  }

  function localTime(value: Date): string {
    return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(
      2,
      '0'
    )}`;
  }
</script>

<div class="calendar-scroll">
  <div class="calendar-frame">
    {#if !ready}<div class="calendar-loading">Loading calendar…</div>{/if}
    <div class:ready bind:this={host}></div>
  </div>
</div>

<form method="POST" action="?/move" class="sr-only" bind:this={moveForm}>
  <input name="entryId" bind:this={entryField} />
  <input name="dayOfWeek" bind:this={dayField} />
  <input name="oneTimeDate" bind:this={dateField} />
  <input name="startTime" bind:this={startField} />
  <input name="endTime" bind:this={endField} />
  <button type="submit">Move entry</button>
</form>

<style>
  .calendar-scroll {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--surface);
  }

  .calendar-frame {
    position: relative;
    min-width: 920px;
  }

  .calendar-loading {
    position: absolute;
    z-index: 2;
    inset: 0;
    display: grid;
    min-height: 680px;
    place-items: center;
    color: var(--text-faint);
    background: var(--surface);
  }

  :global(.fc) {
    --fc-border-color: var(--border);
    --fc-page-bg-color: var(--surface);
    --fc-neutral-bg-color: var(--surface-muted);
    --fc-today-bg-color: color-mix(in srgb, var(--accent-soft) 48%, transparent);
    --fc-now-indicator-color: var(--danger);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 11px;
  }

  :global(.fc-theme-standard td),
  :global(.fc-theme-standard th) {
    border-color: var(--border);
  }

  :global(.fc .fc-scrollgrid) {
    border: 0;
  }

  :global(.fc .fc-col-header-cell-cushion) {
    padding: 11px 4px;
    color: var(--text-soft);
    font-size: 11px;
    font-weight: 650;
  }

  :global(.fc .fc-timegrid-slot-label-cushion) {
    padding: 0 8px;
    color: var(--text-faint);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
  }

  :global(.fc .fc-timegrid-slot) {
    height: 24px;
  }

  :global(.fc .fc-timegrid-event) {
    overflow: hidden;
    border-width: 1px 1px 1px 3px;
    border-radius: 5px;
    box-shadow: none;
    cursor: grab;
  }

  :global(.fc .fc-timegrid-event:active) {
    cursor: grabbing;
  }

  :global(.fc .fc-timegrid-event.is-fixed) {
    cursor: pointer;
  }

  :global(.fc .fc-timegrid-event.is-study) {
    border-style: dashed;
  }

  :global(.fc .fc-event-resizer-end) {
    height: 7px;
    border: 0;
    cursor: ns-resize;
  }

  :global(.fc .fc-event-resizer-end::after) {
    position: absolute;
    right: 35%;
    bottom: 2px;
    left: 35%;
    height: 2px;
    border-radius: 999px;
    background: currentColor;
    content: '';
    opacity: 0.45;
  }

  :global(.studysky-event) {
    display: grid;
    min-width: 0;
    gap: 1px;
    padding: 3px 5px;
  }

  :global(.studysky-event-time),
  :global(.studysky-event small) {
    overflow: hidden;
    color: var(--text-soft);
    font-size: 8px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.studysky-event strong) {
    overflow: hidden;
    font-size: 10px;
    line-height: 1.2;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
