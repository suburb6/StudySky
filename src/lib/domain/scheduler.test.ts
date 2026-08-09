import { describe, expect, it } from 'vitest';
import { rankTasks, scheduleWeek, scoreTask, type ScheduleTask } from './scheduler';
import { minutesFromTime, weekdayForDateKey } from './time';

const reference = new Date('2026-08-04T08:00:00Z');
const baseTask: ScheduleTask = {
  id: 'task-a',
  title: 'Review linked lists',
  moduleId: 'module-a',
  moduleCode: 'TEST101',
  moduleName: 'Synthetic module',
  moduleWeight: 1,
  deadline: new Date('2026-08-06T12:00:00Z'),
  estimatedMinutes: 120,
  priority: 'high',
  type: 'exercise',
  chapterConfidence: 2,
  nextRevisionAt: null,
  createdAt: new Date('2026-08-01T08:00:00Z')
};

const syntheticSchedule = [
  [1, '09:00', '10:00', 'Online'],
  [2, '13:00', '15:00', 'Campus'],
  [4, '10:30', '12:00', 'Library']
] as const;

const preferences = {
  preferredSessionMinutes: 45,
  maxWeekdayStudyMinutes: 180,
  maxWeekendStudyMinutes: 240,
  preferredRestDay: 0,
  eveningStudy: true,
  sleepStart: '23:00',
  sleepEnd: '07:00',
  travelMinutes: 30,
  preparationMinutes: 15
};

describe('deterministic scheduler', () => {
  it('ranks urgent assessed work above lower-priority foundation work', () => {
    const physics = {
      ...baseTask,
      id: 'physics',
      moduleId: 'physics-module',
      moduleCode: 'SCI',
      type: 'physics_preparation' as const,
      priority: 'normal' as const,
      deadline: null
    };
    expect(scoreTask(baseTask, reference)).toBeGreaterThan(scoreTask(physics, reference));
    expect(rankTasks([physics, baseTask], reference)[0]?.id).toBe(baseTask.id);
  });

  it('never schedules during classes, preparation, or physical travel buffers', () => {
    const sessions = scheduleWeek({
      startDate: '2026-08-03',
      tasks: [baseTask],
      constraints: [
        {
          id: 'class',
          dayOfWeek: 2,
          oneTimeDate: null,
          isRecurring: true,
          startTime: '09:00',
          endTime: '12:00',
          kind: 'class',
          location: 'Campus building',
          approved: true
        }
      ],
      preferences,
      timeZone: 'UTC',
      now: reference
    });
    const tuesday = sessions.filter((session) => session.date === '2026-08-04');
    for (const session of tuesday) {
      expect(overlaps(session.startTime, session.endTime, '08:15', '12:30')).toBe(false);
    }
  });

  it('is stable for the same inputs and preserves unscheduled buffer time', () => {
    const input = {
      startDate: '2026-08-03',
      tasks: [baseTask],
      constraints: [],
      preferences,
      timeZone: 'UTC',
      now: reference
    };
    const first = scheduleWeek(input);
    expect(scheduleWeek(input)).toEqual(first);
    const mondayMinutes = first
      .filter((session) => session.date === '2026-08-03')
      .reduce((sum, session) => sum + session.minutes, 0);
    expect(mondayMinutes).toBeLessThanOrEqual(Math.floor(180 * 0.85));
  });

  it('never overlaps synthetic class fixtures', () => {
    const tasks = Array.from({ length: 6 }, (_, index) => ({
      ...baseTask,
      id: `seed-check-${index}`,
      moduleId: `module-${index}`,
      moduleCode: `M${index}`,
      title: `Fixture schedule check ${index}`,
      deadline: null,
      estimatedMinutes: 2_000
    }));
    const constraints = syntheticSchedule.map(
      ([dayOfWeek, startTime, endTime, location], index) => ({
        id: `fixture-class-${index}`,
        dayOfWeek,
        oneTimeDate: null,
        isRecurring: true,
        startTime,
        endTime,
        kind: 'class',
        location,
        approved: true
      })
    );
    const sessions = scheduleWeek({
      startDate: '2026-08-03',
      tasks,
      constraints,
      preferences,
      timeZone: 'UTC',
      now: reference
    });
    expect(sessions.length).toBeGreaterThan(0);

    for (const session of sessions) {
      const weekday = weekdayForDateKey(session.date);
      for (const [dayOfWeek, startTime, endTime, location] of syntheticSchedule) {
        if (dayOfWeek !== weekday) continue;
        const physical = !/online/i.test(location);
        const blockedStart =
          minutesFromTime(startTime) -
          preferences.preparationMinutes -
          (physical ? preferences.travelMinutes : 0);
        const blockedEnd = minutesFromTime(endTime) + (physical ? preferences.travelMinutes : 0);
        expect(
          overlapsMinutes(
            minutesFromTime(session.startTime),
            minutesFromTime(session.endTime),
            blockedStart,
            blockedEnd
          )
        ).toBe(false);
      }
    }
  });
});

function overlaps(startA: string, endA: string, startB: string, endB: string) {
  return startA < endB && endA > startB;
}

function overlapsMinutes(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB;
}
