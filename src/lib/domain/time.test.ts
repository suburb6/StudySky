import { describe, expect, it } from 'vitest';
import {
  canonicalTimeZone,
  dateKeyInTimeZone,
  dateTimeInTimeZone,
  isValidTimeZone,
  minutesFromTime,
  parseZonedDateTime
} from './time';

describe('IANA timezone helpers', () => {
  it('handles UTC and validates timezone identifiers', () => {
    expect(dateTimeInTimeZone('2026-08-04', '09:30', 'UTC').toISOString()).toBe(
      '2026-08-04T09:30:00.000Z'
    );
    expect(canonicalTimeZone('UTC')).toBe('UTC');
    expect(isValidTimeZone('Not/A_Timezone')).toBe(false);
  });

  it('handles Mauritius without making it a global default', () => {
    expect(parseZonedDateTime('2026-08-04T09:30', 'Indian/Mauritius')?.toISOString()).toBe(
      '2026-08-04T05:30:00.000Z'
    );
    expect(dateKeyInTimeZone(new Date('2026-08-03T22:30:00.000Z'), 'Indian/Mauritius')).toBe(
      '2026-08-04'
    );
  });

  it('handles a fractional UTC offset', () => {
    expect(dateTimeInTimeZone('2026-08-04', '09:30', 'Asia/Kathmandu').toISOString()).toBe(
      '2026-08-04T03:45:00.000Z'
    );
  });

  it('disambiguates a repeated DST time deterministically', () => {
    expect(
      parseZonedDateTime('2026-11-01T01:30', 'America/New_York', 'earlier')?.toISOString()
    ).toBe('2026-11-01T05:30:00.000Z');
    expect(parseZonedDateTime('2026-11-01T01:30', 'America/New_York', 'later')?.toISOString()).toBe(
      '2026-11-01T06:30:00.000Z'
    );
    expect(parseZonedDateTime('2026-11-01T01:30', 'America/New_York', 'reject')).toBeNull();
  });

  it('moves a nonexistent DST time forward only in compatible mode', () => {
    expect(parseZonedDateTime('2026-03-08T02:30', 'America/New_York')?.toISOString()).toBe(
      '2026-03-08T07:30:00.000Z'
    );
    expect(parseZonedDateTime('2026-03-08T02:30', 'America/New_York', 'reject')).toBeNull();
  });

  it('rejects malformed dates and times', () => {
    expect(parseZonedDateTime('2026-02-30T09:00', 'UTC')).toBeNull();
    expect(() => minutesFromTime('25:00')).toThrow();
  });
});
