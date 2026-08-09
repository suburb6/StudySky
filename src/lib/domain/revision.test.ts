import { describe, expect, it } from 'vitest';
import { calculateNextRevision } from './revision';

describe('revision interval calculation', () => {
  const completedAt = new Date('2026-08-04T12:00:00.000Z');

  it('starts with the suggested 1, 3, 7, and 14 day progression', () => {
    const first = calculateNextRevision(completedAt, 0, 'correct', 4);
    const second = calculateNextRevision(completedAt, first.nextStep, 'correct', 4);
    const third = calculateNextRevision(completedAt, second.nextStep, 'correct', 4);
    expect([first.intervalDays, second.intervalDays, third.intervalDays]).toEqual([3, 7, 14]);
  });

  it('returns an incorrect review to the 24-hour interval', () => {
    const result = calculateNextRevision(completedAt, 4, 'incorrect', 1);
    expect(result.nextStep).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.nextDueAt.toISOString()).toBe('2026-08-05T12:00:00.000Z');
  });

  it('keeps partial low-confidence recall close', () => {
    const result = calculateNextRevision(completedAt, 3, 'partially_correct', 2);
    expect(result.nextStep).toBe(2);
    expect(result.intervalDays).toBe(7);
  });
});
