export type ZonedDateTimeDisambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(value: string): boolean {
  if (!value || value.length > 80) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function canonicalTimeZone(value: string): string | null {
  if (!isValidTimeZone(value)) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: value }).resolvedOptions().timeZone;
}

export function minutesFromTime(value: string): number {
  const [hours, minutes] = value.split(':').map(Number);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    throw new Error(`Invalid time: ${value}`);
  }
  return hours * 60 + minutes;
}

export function timeFromMinutes(value: number): string {
  const bounded = Math.min(Math.max(Math.round(value), 0), 24 * 60 - 1);
  return `${String(Math.floor(bounded / 60)).padStart(2, '0')}:${String(bounded % 60).padStart(2, '0')}`;
}

export function dateKeyInTimeZone(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}`;
}

export function dateKeyAddDays(dateKey: string, days: number): string {
  const value = new Date(`${dateKey}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function weekdayForDateKey(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay();
}

export function weekdayInTimeZone(date: Date, timeZone: string): number {
  return weekdayForDateKey(dateKeyInTimeZone(date, timeZone));
}

export function minutesInTimeZone(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone);
  return parts.hour * 60 + parts.minute;
}

export function dateTimeInTimeZone(
  dateKey: string,
  time: string,
  timeZone: string,
  disambiguation: ZonedDateTimeDisambiguation = 'compatible'
): Date {
  const result = parseZonedDateTime(`${dateKey}T${time}`, timeZone, disambiguation);
  if (!result) throw new Error(`Invalid local date-time ${dateKey}T${time} in ${timeZone}`);
  return result;
}

export function parseZonedDateTime(
  value: string,
  timeZone: string,
  disambiguation: ZonedDateTimeDisambiguation = 'compatible'
): Date | null {
  if (!isValidTimeZone(timeZone)) return null;
  const requested = parseLocalDateTime(value);
  if (!requested) return null;

  const exact = candidatesForLocalDateTime(requested, timeZone);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    if (disambiguation === 'reject') return null;
    return disambiguation === 'later' ? exact.at(-1)! : exact[0];
  }
  if (disambiguation !== 'compatible') return null;

  // During a forward DST transition some wall-clock times do not exist. Match
  // Temporal's compatible behavior by moving the local time forward by the gap.
  const naive = localPartsAsUtc(requested);
  const beforeOffset = offsetMilliseconds(new Date(naive - 36 * 60 * 60_000), timeZone);
  const afterOffset = offsetMilliseconds(new Date(naive + 36 * 60 * 60_000), timeZone);
  const gap = afterOffset - beforeOffset;
  if (gap <= 0) return null;
  const shifted = utcParts(naive + gap);
  return candidatesForLocalDateTime(shifted, timeZone)[0] ?? null;
}

export function formatDateInTimeZone(
  value: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions
): string {
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid IANA timezone: ${timeZone}`);
  return new Intl.DateTimeFormat('en-GB', { timeZone, ...options }).format(value);
}

function formatter(timeZone: string): Intl.DateTimeFormat {
  const existing = formatterCache.get(timeZone);
  if (existing) return existing;
  if (!isValidTimeZone(timeZone)) throw new Error(`Invalid IANA timezone: ${timeZone}`);
  const created = new Intl.DateTimeFormat('en-GB-u-ca-iso8601', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  formatterCache.set(timeZone, created);
  return created;
}

function localParts(date: Date, timeZone: string): LocalDateTimeParts {
  const values = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second
  };
}

function parseLocalDateTime(value: string): LocalDateTimeParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0)
  };
  const asDate = new Date(localPartsAsUtc(parts));
  if (
    asDate.getUTCFullYear() !== parts.year ||
    asDate.getUTCMonth() + 1 !== parts.month ||
    asDate.getUTCDate() !== parts.day ||
    asDate.getUTCHours() !== parts.hour ||
    asDate.getUTCMinutes() !== parts.minute ||
    asDate.getUTCSeconds() !== parts.second
  ) {
    return null;
  }
  return parts;
}

function candidatesForLocalDateTime(requested: LocalDateTimeParts, timeZone: string): Date[] {
  const naive = localPartsAsUtc(requested);
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    offsets.add(offsetMilliseconds(new Date(naive + hours * 60 * 60_000), timeZone));
  }
  const candidates = [...offsets]
    .map((offset) => new Date(naive - offset))
    .filter((candidate) => sameParts(localParts(candidate, timeZone), requested));
  return [
    ...new Map(candidates.map((candidate) => [candidate.getTime(), candidate])).values()
  ].sort((left, right) => left.getTime() - right.getTime());
}

function offsetMilliseconds(date: Date, timeZone: string): number {
  const parts = localParts(date, timeZone);
  const instantWithoutMilliseconds = Math.floor(date.getTime() / 1_000) * 1_000;
  return localPartsAsUtc(parts) - instantWithoutMilliseconds;
}

function localPartsAsUtc(parts: LocalDateTimeParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

function utcParts(value: number): LocalDateTimeParts {
  const date = new Date(value);
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds()
  };
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts): boolean {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}
