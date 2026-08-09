export const suggestedRevisionIntervals = [1, 3, 7, 14] as const;

export type RevisionPerformance = 'correct' | 'incorrect' | 'partially_correct' | 'skipped';

export interface RevisionSchedule {
  nextDueAt: Date;
  nextStep: number;
  intervalDays: number;
  reason: string;
}

export function calculateNextRevision(
  completedAt: Date,
  currentStep: number,
  result: RevisionPerformance,
  confidence: number
): RevisionSchedule {
  const safeStep = Math.max(0, Math.floor(currentStep));
  let nextStep: number;
  let reason: string;

  if (result === 'incorrect' || result === 'skipped') {
    nextStep = 0;
    reason = 'Returned to the 24-hour interval after an incorrect or skipped review.';
  } else if (result === 'partially_correct' || confidence <= 2) {
    nextStep = Math.max(0, safeStep - 1);
    reason = 'Kept close because recall was partial or confidence was low.';
  } else {
    nextStep = safeStep + 1;
    reason =
      confidence >= 4
        ? 'Extended after a confident correct review.'
        : 'Advanced one interval after a correct review.';
  }

  const intervalDays =
    nextStep < suggestedRevisionIntervals.length
      ? suggestedRevisionIntervals[nextStep]
      : Math.min(180, Math.round(14 * 2 ** (nextStep - 3)));
  const nextDueAt = new Date(completedAt);
  nextDueAt.setUTCDate(nextDueAt.getUTCDate() + intervalDays);
  return { nextDueAt, nextStep, intervalDays, reason };
}
