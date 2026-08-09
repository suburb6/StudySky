import { fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  dateKeyAddDays,
  dateKeyInTimeZone,
  dateTimeInTimeZone,
  formatDateInTimeZone
} from '$lib/domain/time';
import { getDatabase } from '$lib/server/db';
import { modules, tasks, timetableEntries } from '$lib/server/db/schema';
import { formInteger, formString, issueMessage, optionalFormString } from '$lib/server/forms';
import { listModules, listTimetable } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

const entrySchema = z
  .object({
    title: z.string().min(2, 'Enter a title.').max(240),
    kind: z.enum([
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
    ]),
    moduleId: z.uuid().nullable(),
    location: z.string().max(240).nullable(),
    isRecurring: z.boolean(),
    dayOfWeek: z.number().int().min(0).max(6).nullable(),
    oneTimeDate: z.string().date().nullable(),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/)
  })
  .refine((entry) => entry.startTime < entry.endTime, {
    message: 'End time must be after start time.'
  })
  .refine(
    (entry) =>
      (entry.isRecurring && entry.dayOfWeek !== null) ||
      (!entry.isRecurring && entry.oneTimeDate !== null),
    { message: 'Choose a recurring day or one-time date.' }
  );

export const load: PageServerLoad = async ({ locals, url }) => {
  const today = dateKeyInTimeZone(new Date(), locals.user!.timezone);
  const date = url.searchParams.get('date') ?? today;
  const currentDay = new Date(`${date}T00:00:00Z`).getUTCDay();
  const daysSinceMonday = (currentDay + 6) % 7;
  const weekStart = dateKeyAddDays(date, -daysSinceMonday);
  return {
    entries: await listTimetable(locals.user!.id),
    modules: await listModules(locals.user!.id),
    date,
    dates: Array.from({ length: 7 }, (_, index) => dateKeyAddDays(weekStart, index))
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = parseEntry(form);
    if (!parsed.success) return fail(400, { error: issueMessage(parsed.error), action: 'create' });
    if (parsed.data.moduleId && !(await ownsModule(locals.user!.id, parsed.data.moduleId))) {
      return fail(400, { error: 'Choose a valid module.', action: 'create' });
    }
    await getDatabase()
      .insert(timetableEntries)
      .values({
        userId: locals.user!.id,
        ...parsed.data,
        timezone: locals.user!.timezone,
        approved: true
      });
    return { success: true, action: 'create' };
  },
  importIcs: async ({ request, locals }) => {
    const form = await request.formData();
    const file = form.get('calendar');
    const kind = z
      .enum([
        'class',
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
      ])
      .safeParse(formString(form, 'kind'));
    if (!(file instanceof File) || !file.size || file.size > 1024 * 1024 || !kind.success) {
      return fail(400, {
        error: 'Choose an iCalendar file up to 1 MB and an import type.',
        action: 'importIcs'
      });
    }
    const text = await file.text();
    if (text.includes('\u0000') || !/BEGIN:VCALENDAR/i.test(text)) {
      return fail(400, { error: 'That is not a valid iCalendar file.', action: 'importIcs' });
    }
    const importedEntries = parseICalendar(text, locals.user!.timezone).slice(0, 200);
    if (!importedEntries.length) {
      return fail(400, {
        error: 'No supported timed events were found. All-day events are skipped.',
        action: 'importIcs'
      });
    }
    let imported = 0;
    for (const entry of importedEntries) {
      const value = { ...entry, kind: kind.data };
      await getDatabase()
        .insert(timetableEntries)
        .values({
          userId: locals.user!.id,
          ...value,
          timezone: locals.user!.timezone,
          approved: true
        });
      imported += 1;
    }
    return { success: true, action: 'importIcs', imported };
  },
  move: async ({ request, locals }) => {
    const form = await request.formData();
    const entryId = formString(form, 'entryId');
    const dayOfWeek = formInteger(form, 'dayOfWeek', -1);
    const oneTimeDate = formString(form, 'oneTimeDate');
    const startTime = formString(form, 'startTime');
    const endTime = formString(form, 'endTime');
    const parsed = z
      .object({
        entryId: z.uuid(),
        dayOfWeek: z.number().int().min(0).max(6),
        oneTimeDate: z.string().date(),
        startTime: z.string().regex(/^\d{2}:\d{2}$/),
        endTime: z.string().regex(/^\d{2}:\d{2}$/)
      })
      .refine((value) => value.startTime < value.endTime)
      .safeParse({ entryId, dayOfWeek, oneTimeDate, startTime, endTime });
    if (!parsed.success) return fail(400, { error: 'Invalid calendar move.', action: 'move' });
    const db = getDatabase();
    const [entry] = await db
      .select()
      .from(timetableEntries)
      .where(
        and(
          eq(timetableEntries.id, parsed.data.entryId),
          eq(timetableEntries.userId, locals.user!.id)
        )
      )
      .limit(1);
    if (!entry || entry.locked) {
      return fail(403, { error: 'This calendar entry cannot be moved.', action: 'move' });
    }
    const proposal = {
      ...entry,
      dayOfWeek: entry.isRecurring ? parsed.data.dayOfWeek : null,
      oneTimeDate: entry.isRecurring ? null : parsed.data.oneTimeDate,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime
    };
    await db
      .update(timetableEntries)
      .set({
        dayOfWeek: proposal.dayOfWeek,
        oneTimeDate: proposal.oneTimeDate,
        startTime: proposal.startTime,
        endTime: proposal.endTime,
        updatedAt: new Date()
      })
      .where(and(eq(timetableEntries.id, entry.id), eq(timetableEntries.userId, locals.user!.id)));
    if (entry.taskId) await syncTaskSchedule(locals.user!.id, entry.taskId, locals.user!.timezone);
    return { success: true, action: 'move' };
  },
  edit: async ({ request, locals }) => {
    const form = await request.formData();
    const entryId = z.uuid().safeParse(formString(form, 'entryId'));
    const parsed = parseEntry(form);
    if (!entryId.success || !parsed.success) {
      return fail(400, {
        error: !parsed.success ? issueMessage(parsed.error) : 'Invalid calendar entry.',
        action: 'edit'
      });
    }
    const db = getDatabase();
    const [entry] = await db
      .select()
      .from(timetableEntries)
      .where(
        and(eq(timetableEntries.id, entryId.data), eq(timetableEntries.userId, locals.user!.id))
      )
      .limit(1);
    if (!entry) return fail(404, { error: 'Calendar entry not found.', action: 'edit' });
    if (
      entry.locked &&
      (entry.isRecurring !== parsed.data.isRecurring ||
        entry.dayOfWeek !== parsed.data.dayOfWeek ||
        entry.oneTimeDate !== parsed.data.oneTimeDate ||
        entry.startTime.slice(0, 5) !== parsed.data.startTime ||
        entry.endTime.slice(0, 5) !== parsed.data.endTime)
    ) {
      return fail(409, {
        error: 'Unlock this entry before changing its date or time.',
        action: 'edit'
      });
    }
    if (parsed.data.moduleId && !(await ownsModule(locals.user!.id, parsed.data.moduleId))) {
      return fail(400, { error: 'Choose a valid module.', action: 'edit' });
    }
    if (entry.taskId && parsed.data.isRecurring) {
      return fail(400, {
        error: 'A planned task session must remain a one-time entry.',
        action: 'edit'
      });
    }
    await db
      .update(timetableEntries)
      .set({ ...parsed.data, timezone: locals.user!.timezone, updatedAt: new Date() })
      .where(
        and(eq(timetableEntries.id, entryId.data), eq(timetableEntries.userId, locals.user!.id))
      );
    if (entry.taskId) await syncTaskSchedule(locals.user!.id, entry.taskId, locals.user!.timezone);
    return { success: true, action: 'edit' };
  },
  toggleLock: async ({ request, locals }) => {
    const form = await request.formData();
    const entryId = z.uuid().safeParse(formString(form, 'entryId'));
    if (!entryId.success) {
      return fail(400, { error: 'Invalid calendar entry.', action: 'toggleLock' });
    }
    const db = getDatabase();
    const [entry] = await db
      .select({ locked: timetableEntries.locked })
      .from(timetableEntries)
      .where(
        and(eq(timetableEntries.id, entryId.data), eq(timetableEntries.userId, locals.user!.id))
      )
      .limit(1);
    if (!entry) return fail(404, { error: 'Calendar entry not found.', action: 'toggleLock' });
    await db
      .update(timetableEntries)
      .set({ locked: !entry.locked, updatedAt: new Date() })
      .where(
        and(eq(timetableEntries.id, entryId.data), eq(timetableEntries.userId, locals.user!.id))
      );
    return { success: true, action: 'toggleLock' };
  },
  delete: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = z.uuid().safeParse(formString(form, 'entryId'));
    if (!parsed.success) return fail(400, { error: 'Invalid calendar entry.', action: 'delete' });
    const db = getDatabase();
    const [entry] = await db
      .select({ taskId: timetableEntries.taskId, locked: timetableEntries.locked })
      .from(timetableEntries)
      .where(
        and(eq(timetableEntries.id, parsed.data), eq(timetableEntries.userId, locals.user!.id))
      )
      .limit(1);
    if (!entry) return fail(404, { error: 'Calendar entry not found.', action: 'delete' });
    if (entry.locked) {
      return fail(409, { error: 'Unlock this entry before deleting it.', action: 'delete' });
    }
    await db
      .delete(timetableEntries)
      .where(
        and(eq(timetableEntries.id, parsed.data), eq(timetableEntries.userId, locals.user!.id))
      );
    if (entry.taskId) await syncTaskSchedule(locals.user!.id, entry.taskId, locals.user!.timezone);
    return { success: true, action: 'delete' };
  }
};

function parseEntry(form: FormData) {
  const recurrence = formString(form, 'recurrence') !== 'once';
  return entrySchema.safeParse({
    title: formString(form, 'title'),
    kind: formString(form, 'kind') || 'other',
    moduleId: optionalFormString(form, 'moduleId'),
    location: optionalFormString(form, 'location'),
    isRecurring: recurrence,
    dayOfWeek: recurrence ? formInteger(form, 'dayOfWeek', -1) : null,
    oneTimeDate: recurrence ? null : optionalFormString(form, 'oneTimeDate'),
    startTime: formString(form, 'startTime'),
    endTime: formString(form, 'endTime')
  });
}

async function ownsModule(userId: string, moduleId: string): Promise<boolean> {
  const [module] = await getDatabase()
    .select({ id: modules.id })
    .from(modules)
    .where(and(eq(modules.userId, userId), eq(modules.id, moduleId)))
    .limit(1);
  return Boolean(module);
}

async function syncTaskSchedule(userId: string, taskId: string, timeZone: string): Promise<void> {
  const db = getDatabase();
  const [first] = await db
    .select({
      date: timetableEntries.oneTimeDate,
      startTime: timetableEntries.startTime,
      endTime: timetableEntries.endTime,
      reason: timetableEntries.reason
    })
    .from(timetableEntries)
    .where(
      and(
        eq(timetableEntries.userId, userId),
        eq(timetableEntries.taskId, taskId),
        eq(timetableEntries.isRecurring, false)
      )
    )
    .orderBy(asc(timetableEntries.oneTimeDate), asc(timetableEntries.startTime))
    .limit(1);
  await db
    .update(tasks)
    .set({
      scheduledStart: first?.date
        ? dateTimeInTimeZone(first.date, first.startTime, timeZone)
        : null,
      scheduledEnd: first?.date ? dateTimeInTimeZone(first.date, first.endTime, timeZone) : null,
      scheduleReason: first?.reason ?? null,
      updatedAt: new Date()
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)));
}

function parseICalendar(
  text: string,
  timeZone: string
): Array<{
  title: string;
  location: string | null;
  isRecurring: boolean;
  dayOfWeek: number | null;
  oneTimeDate: string | null;
  startTime: string;
  endTime: string;
}> {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) ?? [];
  const result: Array<{
    title: string;
    location: string | null;
    isRecurring: boolean;
    dayOfWeek: number | null;
    oneTimeDate: string | null;
    startTime: string;
    endTime: string;
  }> = [];
  const valueFor = (block: string, name: string) => {
    const line = block
      .split(/\r?\n/)
      .find(
        (candidate) =>
          candidate.toUpperCase().startsWith(`${name}:`) ||
          candidate.toUpperCase().startsWith(`${name};`)
      );
    return line?.slice(line.indexOf(':') + 1).trim() ?? null;
  };
  const weekday = new Map([
    ['SU', 0],
    ['MO', 1],
    ['TU', 2],
    ['WE', 3],
    ['TH', 4],
    ['FR', 5],
    ['SA', 6]
  ]);

  for (const block of blocks.slice(0, 200)) {
    const start = parseCalendarDateTime(valueFor(block, 'DTSTART'), timeZone);
    const end = parseCalendarDateTime(valueFor(block, 'DTEND'), timeZone);
    if (!start || !end || start.date !== end.date || start.time >= end.time) continue;
    const title = unescapeCalendarText(valueFor(block, 'SUMMARY') ?? 'Imported event').slice(
      0,
      240
    );
    const location = unescapeCalendarText(valueFor(block, 'LOCATION') ?? '').slice(0, 240) || null;
    const recurrence = valueFor(block, 'RRULE');
    const days = recurrence
      ?.split(';')
      .find((part) => part.toUpperCase().startsWith('BYDAY='))
      ?.slice(6)
      .split(',')
      .map((day) => weekday.get(day.slice(-2).toUpperCase()))
      .filter((day): day is number => day !== undefined);
    if (recurrence?.toUpperCase().includes('FREQ=WEEKLY') && days?.length) {
      for (const dayOfWeek of days) {
        result.push({
          title,
          location,
          isRecurring: true,
          dayOfWeek,
          oneTimeDate: null,
          startTime: start.time,
          endTime: end.time
        });
      }
    } else {
      result.push({
        title,
        location,
        isRecurring: false,
        dayOfWeek: null,
        oneTimeDate: start.date,
        startTime: start.time,
        endTime: end.time
      });
    }
  }
  return result;
}

function parseCalendarDateTime(
  value: string | null,
  timeZone: string
): { date: string; time: string } | null {
  if (!value || /^\d{8}$/.test(value)) return null;
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(?:\d{2})?(Z)?$/.exec(value);
  if (!match) return null;
  if (match[6]) {
    const instant = new Date(
      Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5])
      )
    );
    return {
      date: dateKeyInTimeZone(instant, timeZone),
      time: formatDateInTimeZone(instant, timeZone, {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23'
      })
    };
  }
  return {
    date: `${match[1]}-${match[2]}-${match[3]}`,
    time: `${match[4]}:${match[5]}`
  };
}

function unescapeCalendarText(value: string): string {
  return value
    .replaceAll('\\n', ' ')
    .replaceAll('\\N', ' ')
    .replaceAll('\\,', ',')
    .replaceAll('\\;', ';')
    .replaceAll('\\\\', '\\');
}
