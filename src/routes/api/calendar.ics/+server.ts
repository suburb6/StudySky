import {
  canonicalTimeZone,
  dateKeyAddDays,
  dateKeyInTimeZone,
  weekdayForDateKey
} from '$lib/domain/time';
import { listTimetable } from '$lib/server/services/study';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.user) return new Response('Authentication required', { status: 401 });
  const timeZone = canonicalTimeZone(locals.user.timezone) ?? 'UTC';
  const rows = await listTimetable(locals.user.id);
  const today = dateKeyInTimeZone(new Date(), timeZone);
  const sunday = dateKeyAddDays(today, -weekdayForDateKey(today));
  const events = rows
    .map(({ entry }) => {
      const date = entry.isRecurring
        ? dateKeyAddDays(sunday, entry.dayOfWeek ?? 0)
        : entry.oneTimeDate;
      if (!date) return '';
      const stamp = date.replaceAll('-', '');
      const start = entry.startTime.slice(0, 5).replace(':', '') + '00';
      const end = entry.endTime.slice(0, 5).replace(':', '') + '00';
      return [
        'BEGIN:VEVENT',
        `UID:${entry.id}@studysky`,
        `DTSTAMP:${new Date(entry.createdAt).toISOString().replaceAll(/[-:]/g, '').replace('.000', '')}`,
        `DTSTART;TZID=${timeZone}:${stamp}T${start}`,
        `DTEND;TZID=${timeZone}:${stamp}T${end}`,
        `SUMMARY:${escapeIcs(entry.title)}`,
        entry.location ? `LOCATION:${escapeIcs(entry.location)}` : '',
        entry.isRecurring ? 'RRULE:FREQ=WEEKLY' : '',
        `CATEGORIES:${entry.kind.toUpperCase()}`,
        'END:VEVENT'
      ]
        .filter(Boolean)
        .join('\r\n');
    })
    .filter(Boolean)
    .join('\r\n');
  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StudySky//Study calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-TIMEZONE:${timeZone}`,
    events,
    'END:VCALENDAR',
    ''
  ].join('\r\n');

  return new Response(body, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'attachment; filename="studysky-calendar.ics"',
      'cache-control': 'private, no-store'
    }
  });
};

function escapeIcs(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n');
}
