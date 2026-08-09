import { fail } from '@sveltejs/kit';
import { and, eq, gte, inArray, isNull, lte } from 'drizzle-orm';
import {
  dateKeyAddDays,
  dateKeyInTimeZone,
  dateTimeInTimeZone,
  minutesFromTime,
  weekdayForDateKey
} from '$lib/domain/time';
import { scheduleWeek } from '$lib/domain/scheduler';
import { getDatabase } from '$lib/server/db';
import {
  assessments,
  chapters,
  modules,
  revisionItems,
  tasks,
  timetableEntries
} from '$lib/server/db/schema';
import {
  listOpenTasksForScheduling,
  listTimetable,
  userSchedulePreferences
} from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const excluded = new Set((url.searchParams.get('exclude') ?? '').split(',').filter(Boolean));
  const result = await createPlan(locals.user!.id, excluded);
  return { ...result, excluded: [...excluded] };
};

export const actions: Actions = {
  approve: async ({ request, locals }) => {
    const form = await request.formData();
    const selected = new Set(
      form.getAll('session').filter((value): value is string => typeof value === 'string')
    );
    if (!selected.size) {
      return fail(400, { error: 'Select at least one study session.' });
    }
    const excluded = new Set((form.get('excluded')?.toString() ?? '').split(',').filter(Boolean));
    const { proposals } = await createPlan(locals.user!.id, excluded);
    const approvedProposals = proposals
      .filter((proposal) => selected.has(sessionKey(proposal)))
      .map((proposal) => {
        const key = sessionKey(proposal);
        const startTime = form.get(`start:${key}`)?.toString() ?? proposal.startTime;
        const endTime = form.get(`end:${key}`)?.toString() ?? proposal.endTime;
        return {
          ...proposal,
          startTime,
          endTime,
          minutes:
            isClockTime(startTime) && isClockTime(endTime)
              ? minutesFromTime(endTime) - minutesFromTime(startTime)
              : 0,
          locked: form.has(`lock:${key}`)
        };
      });
    if (!approvedProposals.length)
      return fail(400, { error: 'The plan changed. Preview it again.' });
    const editError = await validateSessionEdits(locals.user!.id, approvedProposals);
    if (editError) return fail(409, { error: editError });

    const db = getDatabase();
    await db.transaction(async (tx) => {
      const taskIds = new Map<string, string>();
      for (const sourceKey of new Set(
        approvedProposals.map((session) => session.taskId).filter((taskId) => taskId.includes(':'))
      )) {
        const [existing] = await tx
          .select({ id: tasks.id })
          .from(tasks)
          .where(and(eq(tasks.userId, locals.user!.id), eq(tasks.clientId, sourceKey)))
          .limit(1);
        if (existing) {
          taskIds.set(sourceKey, existing.id);
          continue;
        }
        const [kind, sourceId] = sourceKey.split(':');
        if (kind === 'revision') {
          const [source] = await tx
            .select()
            .from(revisionItems)
            .where(and(eq(revisionItems.id, sourceId), eq(revisionItems.userId, locals.user!.id)))
            .limit(1);
          if (!source) continue;
          const [created] = await tx
            .insert(tasks)
            .values({
              userId: locals.user!.id,
              moduleId: source.moduleId,
              chapterId: source.chapterId,
              clientId: sourceKey,
              title: source.title,
              type: 'revision',
              status: 'this_week',
              priority: 'normal',
              difficulty: 3,
              estimatedMinutes: 20,
              deadline: source.dueAt,
              nextRevisionAt: source.dueAt
            })
            .returning({ id: tasks.id });
          taskIds.set(sourceKey, created.id);
        } else if (kind === 'assessment') {
          const [source] = await tx
            .select()
            .from(assessments)
            .where(and(eq(assessments.id, sourceId), eq(assessments.userId, locals.user!.id)))
            .limit(1);
          if (!source) continue;
          const [created] = await tx
            .insert(tasks)
            .values({
              userId: locals.user!.id,
              moduleId: source.moduleId,
              clientId: sourceKey,
              title: `Prepare for ${source.name}`,
              type: 'practice_test',
              status: 'this_week',
              priority: 'high',
              difficulty: 4,
              estimatedMinutes: 90,
              deadline: dateTimeInTimeZone(source.assessmentDate, '17:00', locals.user!.timezone)
            })
            .returning({ id: tasks.id });
          taskIds.set(sourceKey, created.id);
        }
      }
      const approved = approvedProposals
        .map((session) => ({
          ...session,
          taskId: taskIds.get(session.taskId) ?? session.taskId
        }))
        .filter((session) => !session.taskId.includes(':'));

      for (const session of approved) {
        const [existing] = await tx
          .select({ id: timetableEntries.id })
          .from(timetableEntries)
          .where(
            and(
              eq(timetableEntries.userId, locals.user!.id),
              eq(timetableEntries.taskId, session.taskId),
              eq(timetableEntries.oneTimeDate, session.date),
              eq(timetableEntries.startTime, session.startTime)
            )
          )
          .limit(1);
        if (existing) continue;

        await tx.insert(timetableEntries).values({
          userId: locals.user!.id,
          moduleId: session.moduleId,
          taskId: session.taskId,
          title: session.title,
          kind: 'study',
          isRecurring: false,
          oneTimeDate: session.date,
          dayOfWeek: null,
          startTime: session.startTime,
          endTime: session.endTime,
          reason: session.reason,
          timezone: locals.user!.timezone,
          approved: true,
          locked: session.locked
        });
      }

      for (const taskId of new Set(approved.map((session) => session.taskId))) {
        const first = approved
          .filter((session) => session.taskId === taskId)
          .sort((a, b) => `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`))[0];
        await tx
          .update(tasks)
          .set({
            scheduledStart: dateTimeInTimeZone(first.date, first.startTime, locals.user!.timezone),
            scheduledEnd: dateTimeInTimeZone(first.date, first.endTime, locals.user!.timezone),
            scheduleReason: first.reason,
            status: 'this_week',
            updatedAt: new Date()
          })
          .where(and(eq(tasks.id, taskId), eq(tasks.userId, locals.user!.id)));
      }
    });

    return { success: true, count: approvedProposals.length };
  }
};

async function createPlan(userId: string, excluded: Set<string>) {
  const db = getDatabase();
  const preferences = await userSchedulePreferences(userId);
  const startDate = dateKeyInTimeZone(new Date(), preferences.timezone);
  const endDate = dateKeyAddDays(startDate, 7);
  const [taskRows, timetableRows, revisionRows, assessmentRows, sourceTasks] = await Promise.all([
    listOpenTasksForScheduling(userId),
    listTimetable(userId),
    db
      .select({
        id: revisionItems.id,
        title: revisionItems.title,
        moduleId: revisionItems.moduleId,
        moduleCode: modules.code,
        moduleName: modules.name,
        moduleWeight: modules.schedulingWeight,
        dueAt: revisionItems.dueAt,
        chapterConfidence: chapters.confidence,
        createdAt: revisionItems.createdAt
      })
      .from(revisionItems)
      .leftJoin(modules, eq(revisionItems.moduleId, modules.id))
      .leftJoin(chapters, eq(revisionItems.chapterId, chapters.id))
      .where(
        and(
          eq(revisionItems.userId, userId),
          inArray(revisionItems.state, ['due', 'upcoming']),
          lte(revisionItems.dueAt, dateTimeInTimeZone(endDate, '23:59:59', preferences.timezone))
        )
      ),
    db
      .select({
        id: assessments.id,
        name: assessments.name,
        moduleId: assessments.moduleId,
        moduleCode: modules.code,
        moduleName: modules.name,
        moduleWeight: modules.schedulingWeight,
        assessmentDate: assessments.assessmentDate,
        createdAt: assessments.createdAt
      })
      .from(assessments)
      .leftJoin(modules, eq(assessments.moduleId, modules.id))
      .where(
        and(
          eq(assessments.userId, userId),
          gte(assessments.assessmentDate, startDate),
          lte(assessments.assessmentDate, dateKeyAddDays(startDate, 30))
        )
      ),
    db
      .select({ clientId: tasks.clientId })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), isNull(tasks.completedAt)))
  ]);
  const existingSources = new Set(
    sourceTasks.map((task) => task.clientId).filter((value): value is string => Boolean(value))
  );
  const tasksForPlan = taskRows
    .filter((task) => !excluded.has(task.id))
    .map((task) => ({ ...task, moduleWeight: task.moduleWeight ?? 1 }));
  for (const revision of revisionRows) {
    const id = `revision:${revision.id}`;
    if (excluded.has(id) || existingSources.has(id)) continue;
    tasksForPlan.push({
      id,
      title: revision.title,
      moduleId: revision.moduleId,
      moduleCode: revision.moduleCode,
      moduleName: revision.moduleName,
      moduleWeight: revision.moduleWeight ?? 1,
      deadline: revision.dueAt,
      estimatedMinutes: 20,
      priority: 'normal',
      type: 'revision',
      chapterConfidence: revision.chapterConfidence,
      nextRevisionAt: revision.dueAt,
      createdAt: revision.createdAt
    });
  }
  for (const assessment of assessmentRows) {
    const id = `assessment:${assessment.id}`;
    if (excluded.has(id) || existingSources.has(id)) continue;
    tasksForPlan.push({
      id,
      title: `Prepare for ${assessment.name}`,
      moduleId: assessment.moduleId,
      moduleCode: assessment.moduleCode,
      moduleName: assessment.moduleName,
      moduleWeight: assessment.moduleWeight ?? 1,
      deadline: dateTimeInTimeZone(assessment.assessmentDate, '17:00', preferences.timezone),
      estimatedMinutes: 90,
      priority: 'high',
      type: 'practice_test',
      chapterConfidence: null,
      nextRevisionAt: null,
      createdAt: assessment.createdAt
    });
  }
  const constraints = timetableRows.map((row) => ({
    id: row.entry.id,
    dayOfWeek: row.entry.dayOfWeek,
    oneTimeDate: row.entry.oneTimeDate,
    isRecurring: row.entry.isRecurring,
    startTime: row.entry.startTime,
    endTime: row.entry.endTime,
    kind: row.entry.kind,
    location: row.entry.location,
    approved: row.entry.approved
  }));
  return {
    startDate,
    taskCount: tasksForPlan.length,
    preferences,
    proposals: scheduleWeek({
      startDate,
      tasks: tasksForPlan,
      constraints,
      preferences,
      timeZone: preferences.timezone
    })
  };
}

function sessionKey(session: { taskId: string; date: string; startTime: string }): string {
  return `${session.taskId}|${session.date}|${session.startTime}`;
}

function isClockTime(value: string): boolean {
  return (
    /^\d{2}:\d{2}$/.test(value) &&
    (() => {
      try {
        minutesFromTime(value);
        return true;
      } catch {
        return false;
      }
    })()
  );
}

async function validateSessionEdits(
  userId: string,
  proposals: Array<{
    date: string;
    startTime: string;
    endTime: string;
    minutes: number;
    moduleId: string | null;
  }>
): Promise<string | null> {
  if (
    proposals.some(
      (session) =>
        !isClockTime(session.startTime) ||
        !isClockTime(session.endTime) ||
        session.minutes < 15 ||
        session.minutes > 120
    )
  ) {
    return 'Each edited session must be between 15 and 120 minutes.';
  }

  const [existing, preferences] = await Promise.all([
    listTimetable(userId),
    userSchedulePreferences(userId)
  ]);
  for (const session of proposals) {
    const weekday = weekdayForDateKey(session.date);
    const start = minutesFromTime(session.startTime);
    const end = minutesFromTime(session.endTime);
    const workingEnd = preferences.eveningStudy ? 21 * 60 : 18 * 60;
    if (start < 7 * 60 || end > workingEnd || weekday === preferences.preferredRestDay) {
      return 'Edited sessions must stay inside allowed study hours and outside the rest day.';
    }
    for (const row of existing) {
      const entry = row.entry;
      const applies = entry.isRecurring
        ? entry.dayOfWeek === weekday
        : entry.oneTimeDate === session.date;
      if (!applies || entry.approved === false) continue;
      let blockedStart = minutesFromTime(entry.startTime);
      let blockedEnd = minutesFromTime(entry.endTime);
      if (entry.kind === 'class') {
        blockedStart -= preferences.preparationMinutes;
        if (entry.location && !/online/i.test(entry.location)) {
          blockedStart -= preferences.travelMinutes;
          blockedEnd += preferences.travelMinutes;
        }
      }
      if (start < blockedEnd && end > blockedStart) {
        return 'An edited session overlaps a class, buffer, blocked period, or existing study session.';
      }
    }
  }

  for (let index = 0; index < proposals.length; index += 1) {
    const current = proposals[index];
    const currentStart = minutesFromTime(current.startTime);
    const currentEnd = minutesFromTime(current.endTime);
    for (let otherIndex = index + 1; otherIndex < proposals.length; otherIndex += 1) {
      const other = proposals[otherIndex];
      if (
        current.date === other.date &&
        currentStart < minutesFromTime(other.endTime) &&
        currentEnd > minutesFromTime(other.startTime)
      ) {
        return 'Two edited sessions overlap each other.';
      }
    }
  }

  for (const date of new Set(proposals.map((session) => session.date))) {
    const weekday = weekdayForDateKey(date);
    const limit =
      weekday === 0 || weekday === 6
        ? preferences.maxWeekendStudyMinutes
        : preferences.maxWeekdayStudyMinutes;
    const dailyMinutes = proposals
      .filter((session) => session.date === date)
      .reduce((sum, session) => sum + session.minutes, 0);
    if (dailyMinutes > Math.floor(limit * 0.85)) {
      return 'Edited sessions exceed the configured daily study limit and buffer.';
    }
    const moduleCount = new Set(
      proposals
        .filter((session) => session.date === date && session.moduleId)
        .map((session) => session.moduleId)
    ).size;
    if (moduleCount > 3) return 'A study day can contain at most three modules.';
  }
  return null;
}
