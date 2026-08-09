import {
  dateKeyAddDays,
  dateTimeInTimeZone,
  minutesFromTime,
  timeFromMinutes,
  weekdayForDateKey
} from './time';

export type SchedulePriority = 'low' | 'normal' | 'high' | 'urgent';
export type ScheduleTaskType =
  | 'lecture_review'
  | 'reading'
  | 'notes_review'
  | 'exercise'
  | 'assignment'
  | 'project'
  | 'coding_work'
  | 'practice_test'
  | 'revision'
  | 'physics_preparation'
  | 'question_for_lecturer'
  | 'administrative_work'
  | 'other';

export interface ScheduleTask {
  id: string;
  title: string;
  moduleId: string | null;
  moduleCode: string | null;
  moduleName: string | null;
  moduleWeight: number;
  deadline: Date | null;
  estimatedMinutes: number;
  priority: SchedulePriority;
  type: ScheduleTaskType;
  chapterConfidence: number | null;
  nextRevisionAt: Date | null;
  createdAt: Date;
}

export interface ScheduleConstraint {
  id: string;
  dayOfWeek: number | null;
  oneTimeDate: string | null;
  isRecurring: boolean;
  startTime: string;
  endTime: string;
  kind: string;
  location?: string | null;
  approved?: boolean;
}

export interface SchedulerPreferences {
  preferredSessionMinutes: number;
  maxWeekdayStudyMinutes: number;
  maxWeekendStudyMinutes: number;
  preferredRestDay: number;
  eveningStudy: boolean;
  sleepStart: string;
  sleepEnd: string;
  travelMinutes: number;
  preparationMinutes: number;
  bufferRatio?: number;
}

export interface ProposedSession {
  taskId: string;
  title: string;
  moduleId: string | null;
  moduleCode: string | null;
  date: string;
  startTime: string;
  endTime: string;
  minutes: number;
  reason: string;
  score: number;
}

interface Interval {
  start: number;
  end: number;
}

const priorityScore: Record<SchedulePriority, number> = {
  low: 0,
  normal: 120,
  high: 320,
  urgent: 600
};

const taskTypeScore: Record<ScheduleTaskType, number> = {
  assignment: 480,
  project: 400,
  practice_test: 380,
  lecture_review: 300,
  exercise: 260,
  revision: 240,
  notes_review: 190,
  coding_work: 180,
  reading: 150,
  question_for_lecturer: 130,
  administrative_work: 90,
  physics_preparation: 50,
  other: 100
};

export function scoreTask(task: ScheduleTask, reference: Date): number {
  let score = priorityScore[task.priority] + taskTypeScore[task.type];
  if (task.deadline) {
    const days = (task.deadline.getTime() - reference.getTime()) / 86_400_000;
    if (days < 0) score += 800;
    else if (days <= 1) score += 650;
    else if (days <= 3) score += 450;
    else if (days <= 7) score += 260;
    else if (days <= 14) score += 120;
  }
  if (task.chapterConfidence) score += (6 - task.chapterConfidence) * 45;
  if (task.nextRevisionAt && task.nextRevisionAt <= reference) score += 260;
  if (task.type === 'physics_preparation') score -= 260;
  return Math.round(score * Math.max(task.moduleWeight, 0.2));
}

export function explainTask(task: ScheduleTask, reference: Date): string {
  if (task.deadline && task.deadline < reference)
    return 'Deadline has passed; recover this work first.';
  if (task.deadline) {
    const days = Math.ceil((task.deadline.getTime() - reference.getTime()) / 86_400_000);
    if (days <= 1) return 'Due within 24 hours.';
    if (days <= 3) return `Due in ${days} days.`;
  }
  if (task.type === 'lecture_review') return 'Review soon after the lecture.';
  if (task.nextRevisionAt && task.nextRevisionAt <= reference) return 'Spaced revision is due.';
  if (task.chapterConfidence && task.chapterConfidence <= 2)
    return 'This chapter has low confidence.';
  if (task.type === 'physics_preparation') {
    return 'Keeps foundation preparation moving after nearer deadlines.';
  }
  if (task.priority === 'high' || task.priority === 'urgent') return 'Marked as a high priority.';
  return 'Next available work by deadline, priority, and learning value.';
}

export function rankTasks(tasks: ScheduleTask[], reference = new Date()): ScheduleTask[] {
  return [...tasks].sort((a, b) => {
    const scoreDifference = scoreTask(b, reference) - scoreTask(a, reference);
    if (scoreDifference !== 0) return scoreDifference;
    const aDeadline = a.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
    const bDeadline = b.deadline?.getTime() ?? Number.POSITIVE_INFINITY;
    if (aDeadline !== bDeadline) return aDeadline - bDeadline;
    const createdDifference = a.createdAt.getTime() - b.createdAt.getTime();
    if (createdDifference !== 0) return createdDifference;
    return a.id.localeCompare(b.id);
  });
}

export function scheduleWeek(input: {
  startDate: string;
  tasks: ScheduleTask[];
  constraints: ScheduleConstraint[];
  preferences: SchedulerPreferences;
  timeZone?: string;
  days?: number;
  now?: Date;
}): ProposedSession[] {
  const {
    startDate,
    constraints,
    preferences,
    timeZone = 'UTC',
    days = 7,
    now = new Date()
  } = input;
  const tasks = rankTasks(input.tasks, now);
  const remaining = new Map(tasks.map((task) => [task.id, task.estimatedMinutes]));
  const proposals: ProposedSession[] = [];
  const preferred = clamp(preferences.preferredSessionMinutes, 20, 120);
  const bufferRatio = clamp(preferences.bufferRatio ?? 0.15, 0, 0.4);

  for (let dayIndex = 0; dayIndex < days; dayIndex += 1) {
    const date = dateKeyAddDays(startDate, dayIndex);
    const weekday = weekdayForDateKey(date);
    if (weekday === preferences.preferredRestDay) continue;

    const weekend = weekday === 0 || weekday === 6;
    const configuredLimit = weekend
      ? preferences.maxWeekendStudyMinutes
      : preferences.maxWeekdayStudyMinutes;
    const dailyLimit = Math.floor(Math.max(configuredLimit, 0) * (1 - bufferRatio));
    if (dailyLimit < 20) continue;

    const occupied = constraintsForDate(constraints, date, preferences);
    const workingEnd = preferences.eveningStudy ? 21 * 60 : 18 * 60;
    const free = subtractIntervals([{ start: 7 * 60, end: workingEnd }], occupied);
    const modulesToday = new Set<string>();
    const taskMinutesToday = new Map<string, number>();
    let usedToday = 0;

    for (const interval of free) {
      let cursor = interval.start;
      while (cursor + 15 <= interval.end && usedToday < dailyLimit) {
        const task = tasks.find((candidate) => {
          const left = remaining.get(candidate.id) ?? 0;
          if (left <= 0) return false;
          const moduleKey = candidate.moduleId ?? `general:${candidate.id}`;
          if (
            candidate.moduleId &&
            !modulesToday.has(moduleKey) &&
            modulesToday.size >= 3 &&
            candidate.priority !== 'urgent'
          ) {
            return false;
          }
          return (taskMinutesToday.get(candidate.id) ?? 0) < preferred * 2;
        });
        if (!task) break;

        const left = remaining.get(task.id) ?? 0;
        const available = Math.min(interval.end - cursor, dailyLimit - usedToday);
        const duration = Math.min(preferred, left, available);
        if (duration < 15) break;

        const startTime = timeFromMinutes(cursor);
        const endTime = timeFromMinutes(cursor + duration);
        const reference = dateTimeInTimeZone(date, startTime, timeZone);
        proposals.push({
          taskId: task.id,
          title: task.title,
          moduleId: task.moduleId,
          moduleCode: task.moduleCode,
          date,
          startTime,
          endTime,
          minutes: duration,
          reason: explainTask(task, reference),
          score: scoreTask(task, reference)
        });

        remaining.set(task.id, left - duration);
        taskMinutesToday.set(task.id, (taskMinutesToday.get(task.id) ?? 0) + duration);
        if (task.moduleId) modulesToday.add(task.moduleId);
        usedToday += duration;
        cursor += duration + 10;
      }
    }
  }

  return proposals;
}

function constraintsForDate(
  constraints: ScheduleConstraint[],
  date: string,
  preferences: SchedulerPreferences
): Interval[] {
  const weekday = weekdayForDateKey(date);
  const result: Interval[] = sleepIntervals(preferences.sleepStart, preferences.sleepEnd);

  for (const entry of constraints) {
    const applies = entry.isRecurring ? entry.dayOfWeek === weekday : entry.oneTimeDate === date;
    if (!applies || entry.approved === false) continue;

    let start = minutesFromTime(entry.startTime);
    let end = minutesFromTime(entry.endTime);
    if (entry.kind === 'class') {
      start -= preferences.preparationMinutes;
      if (entry.location && !/online/i.test(entry.location)) {
        start -= preferences.travelMinutes;
        end += preferences.travelMinutes;
      }
    }
    result.push({ start: Math.max(0, start), end: Math.min(1440, end) });
  }
  return mergeIntervals(result);
}

function sleepIntervals(startTime: string, endTime: string): Interval[] {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start === end) return [{ start: 0, end: 1440 }];
  if (start < end) return [{ start, end }];
  return [
    { start: 0, end },
    { start, end: 1440 }
  ];
}

function subtractIntervals(base: Interval[], occupied: Interval[]): Interval[] {
  let current = base;
  for (const block of mergeIntervals(occupied)) {
    const next: Interval[] = [];
    for (const slot of current) {
      if (block.end <= slot.start || block.start >= slot.end) {
        next.push(slot);
        continue;
      }
      if (block.start > slot.start) next.push({ start: slot.start, end: block.start });
      if (block.end < slot.end) next.push({ start: block.end, end: slot.end });
    }
    current = next;
  }
  return current.filter((slot) => slot.end - slot.start >= 15);
}

function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const previous = merged.at(-1);
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
    } else {
      previous.end = Math.max(previous.end, interval.end);
    }
  }
  return merged;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
