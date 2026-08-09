import { fail } from '@sveltejs/kit';
import { and, eq, gt, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import {
  dateKeyInTimeZone,
  minutesFromTime,
  minutesInTimeZone,
  parseZonedDateTime,
  weekdayInTimeZone
} from '$lib/domain/time';
import { chapterBoardPlacement } from '$lib/server/chapter-board';
import { getDatabase } from '$lib/server/db';
import {
  chapters,
  checklistItems,
  documents,
  focusSessions,
  modules,
  taskDependencies,
  tasks,
  timetableEntries
} from '$lib/server/db/schema';
import {
  formInteger,
  formString,
  intendedOwnerMatches,
  issueMessage,
  optionalFormString
} from '$lib/server/forms';
import { listModules, listTasks } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

const taskSchema = z
  .object({
    title: z.string().min(2, 'Enter a task title.').max(300),
    description: z.string().max(10_000).nullable(),
    moduleId: z.uuid().nullable(),
    chapterId: z.uuid().nullable(),
    section: z.string().max(80).nullable(),
    type: z.enum([
      'lecture_review',
      'reading',
      'notes_review',
      'exercise',
      'assignment',
      'project',
      'coding_work',
      'practice_test',
      'revision',
      'physics_preparation',
      'question_for_lecturer',
      'administrative_work',
      'other'
    ]),
    status: z.enum(['inbox', 'this_week', 'doing', 'waiting', 'done', 'skipped']),
    priority: z.enum(['low', 'normal', 'high', 'urgent']),
    difficulty: z.number().int().min(1).max(5),
    estimatedMinutes: z.number().int().min(5).max(720),
    deadline: z.date().nullable(),
    scheduledStart: z.date().nullable(),
    scheduledEnd: z.date().nullable(),
    recurrenceRule: z.string().max(500).nullable(),
    nextRevisionAt: z.date().nullable(),
    notes: z.string().max(20_000).nullable(),
    sourceDocumentId: z.uuid().nullable(),
    clientId: z.string().max(100).nullable()
  })
  .refine(
    (value) =>
      (!value.scheduledStart && !value.scheduledEnd) ||
      (Boolean(value.scheduledStart) &&
        Boolean(value.scheduledEnd) &&
        value.scheduledEnd! > value.scheduledStart!),
    { message: 'Scheduled end must be after the start.' }
  );

export const load: PageServerLoad = async ({ locals, url }) => {
  const view = url.searchParams.get('view') ?? 'all';
  const db = getDatabase();
  const [taskRows, moduleRows, chapterRows, documentRows, taskOptions] = await Promise.all([
    listTasks(locals.user!.id, view, locals.user!.timezone),
    listModules(locals.user!.id),
    db
      .select({ id: chapters.id, moduleId: chapters.moduleId, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.userId, locals.user!.id)),
    db
      .select({ id: documents.id, moduleId: documents.moduleId, title: documents.title })
      .from(documents)
      .where(eq(documents.userId, locals.user!.id))
      .limit(200),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        estimatedMinutes: tasks.estimatedMinutes,
        status: tasks.status
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, locals.user!.id),
          inArray(tasks.status, ['inbox', 'this_week', 'doing', 'waiting'])
        )
      )
      .orderBy(tasks.title)
      .limit(500)
  ]);
  const taskIds = taskRows.map((row) => row.task.id);
  const checklistRows = taskIds.length
    ? await db
        .select()
        .from(checklistItems)
        .where(inArray(checklistItems.taskId, taskIds))
        .orderBy(checklistItems.position)
    : [];
  return {
    tasks: taskRows,
    modules: moduleRows,
    chapters: chapterRows,
    documents: documentRows,
    taskOptions,
    checklists: checklistRows,
    view
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const form = await request.formData();
    if (!intendedOwnerMatches(form, locals.user!.id)) {
      return fail(409, {
        error: 'Task draft belongs to a different signed-in account.',
        action: 'create',
        code: 'owner_mismatch'
      });
    }
    const parsed = taskSchema.safeParse({
      title: formString(form, 'title'),
      description: optionalFormString(form, 'description'),
      moduleId: optionalFormString(form, 'moduleId'),
      chapterId: optionalFormString(form, 'chapterId'),
      section: optionalFormString(form, 'section'),
      type: formString(form, 'type') || 'other',
      status: formString(form, 'status') || 'inbox',
      priority: formString(form, 'priority') || 'normal',
      difficulty: formInteger(form, 'difficulty', 3),
      estimatedMinutes: formInteger(form, 'estimatedMinutes', 30),
      deadline: parseZonedDateTime(formString(form, 'deadline'), locals.user!.timezone),
      scheduledStart: parseZonedDateTime(formString(form, 'scheduledStart'), locals.user!.timezone),
      scheduledEnd: parseZonedDateTime(formString(form, 'scheduledEnd'), locals.user!.timezone),
      recurrenceRule: optionalFormString(form, 'recurrenceRule'),
      nextRevisionAt: parseZonedDateTime(formString(form, 'nextRevisionAt'), locals.user!.timezone),
      notes: optionalFormString(form, 'notes'),
      sourceDocumentId: optionalFormString(form, 'sourceDocumentId'),
      clientId: optionalFormString(form, 'clientId')
    });
    if (!parsed.success) return fail(400, { error: issueMessage(parsed.error), action: 'create' });
    if (parsed.data.moduleId) {
      const [owned] = await getDatabase()
        .select({ id: modules.id })
        .from(modules)
        .where(and(eq(modules.id, parsed.data.moduleId), eq(modules.userId, locals.user!.id)))
        .limit(1);
      if (!owned) return fail(400, { error: 'Choose a valid module.', action: 'create' });
    }
    let boardPlacement: Awaited<ReturnType<typeof chapterBoardPlacement>> = null;
    if (parsed.data.chapterId) {
      const [owned] = await getDatabase()
        .select({ id: chapters.id, moduleId: chapters.moduleId })
        .from(chapters)
        .where(and(eq(chapters.id, parsed.data.chapterId), eq(chapters.userId, locals.user!.id)))
        .limit(1);
      if (!owned || owned.moduleId !== parsed.data.moduleId) {
        return fail(400, { error: 'Choose a chapter from the selected module.', action: 'create' });
      }
      boardPlacement = await chapterBoardPlacement({
        userId: locals.user!.id,
        chapterId: parsed.data.chapterId
      });
    }
    if (parsed.data.sourceDocumentId) {
      const [owned] = await getDatabase()
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(eq(documents.id, parsed.data.sourceDocumentId), eq(documents.userId, locals.user!.id))
        )
        .limit(1);
      if (!owned) {
        return fail(400, { error: 'Choose one of your documents.', action: 'create' });
      }
    }
    if (
      parsed.data.scheduledStart &&
      parsed.data.scheduledEnd &&
      (await hasScheduleConflict(
        locals.user!.id,
        parsed.data.scheduledStart,
        parsed.data.scheduledEnd,
        locals.user!.timezone
      ))
    ) {
      return fail(409, {
        error: 'That study time overlaps a class, blocked period, or another task.',
        action: 'create'
      });
    }
    const checklist = form
      .getAll('checklist')
      .flatMap((value) => value.toString().split(/\r?\n/))
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 100);
    const dependencyIds = form
      .getAll('dependencyId')
      .map(String)
      .filter((value) => z.uuid().safeParse(value).success)
      .slice(0, 50);
    if (dependencyIds.length) {
      const ownedDependencies = await getDatabase()
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.userId, locals.user!.id), inArray(tasks.id, dependencyIds)));
      if (ownedDependencies.length !== new Set(dependencyIds).size) {
        return fail(400, { error: 'Choose valid task dependencies.', action: 'create' });
      }
    }
    try {
      await getDatabase().transaction(async (tx) => {
        const [created] = await tx
          .insert(tasks)
          .values({
            userId: locals.user!.id,
            ...parsed.data,
            boardColumnId: boardPlacement?.column.id ?? null,
            boardPosition: boardPlacement?.position ?? 0,
            status: boardPlacement?.column.isDone
              ? 'done'
              : boardPlacement
                ? 'this_week'
                : parsed.data.status,
            completedAt:
              boardPlacement?.column.isDone || (!boardPlacement && parsed.data.status === 'done')
                ? new Date()
                : null
          })
          .returning({ id: tasks.id });
        if (checklist.length) {
          await tx.insert(checklistItems).values(
            checklist.map((title, position) => ({
              taskId: created.id,
              title,
              position
            }))
          );
        }
        if (dependencyIds.length) {
          await tx.insert(taskDependencies).values(
            [...new Set(dependencyIds)].map((dependsOnTaskId) => ({
              taskId: created.id,
              dependsOnTaskId
            }))
          );
        }
      });
    } catch (error) {
      if (isUniqueViolation(error) && parsed.data.clientId) {
        return { success: true, action: 'create', deduplicated: true };
      }
      throw error;
    }
    return { success: true, action: 'create' };
  },
  status: async ({ request, locals }) => {
    const form = await request.formData();
    const taskId = formString(form, 'taskId');
    const status = formString(form, 'status');
    const parsed = z
      .object({
        taskId: z.uuid(),
        status: z.enum(['inbox', 'this_week', 'doing', 'waiting', 'done', 'skipped'])
      })
      .safeParse({ taskId, status });
    if (!parsed.success) return fail(400, { error: 'Invalid task update.', action: 'status' });
    const db = getDatabase();
    const [task] = await db
      .select({
        id: tasks.id,
        chapterId: tasks.chapterId,
        boardColumnId: tasks.boardColumnId,
        boardPosition: tasks.boardPosition
      })
      .from(tasks)
      .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.userId, locals.user!.id)))
      .limit(1);
    if (!task) return fail(404, { error: 'Task not found.', action: 'status' });
    const placement = task.chapterId
      ? await chapterBoardPlacement({
          userId: locals.user!.id,
          chapterId: task.chapterId,
          mode: ['done', 'skipped'].includes(parsed.data.status) ? 'done' : 'open',
          currentColumnId: task.boardColumnId
        })
      : null;
    await db
      .update(tasks)
      .set({
        status: parsed.data.status,
        completedAt: parsed.data.status === 'done' ? new Date() : null,
        boardColumnId: placement?.column.id ?? task.boardColumnId,
        boardPosition: placement?.position ?? task.boardPosition,
        updatedAt: new Date()
      })
      .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.userId, locals.user!.id)));
    return { success: true, action: 'status' };
  },
  checklist: async ({ request, locals }) => {
    const form = await request.formData();
    const id = z.uuid().safeParse(formString(form, 'checklistId'));
    if (!id.success) return fail(400, { error: 'Invalid checklist item.', action: 'checklist' });
    const db = getDatabase();
    const [item] = await db
      .select({ completed: checklistItems.completed })
      .from(checklistItems)
      .innerJoin(tasks, eq(checklistItems.taskId, tasks.id))
      .where(and(eq(checklistItems.id, id.data), eq(tasks.userId, locals.user!.id)))
      .limit(1);
    if (!item) return fail(404, { error: 'Checklist item not found.', action: 'checklist' });
    await db
      .update(checklistItems)
      .set({ completed: !item.completed })
      .where(eq(checklistItems.id, id.data));
    return { success: true, action: 'checklist' };
  },
  finishFocus: async ({ request, locals }) => {
    const form = await request.formData();
    const parsed = z
      .object({
        taskId: z.uuid(),
        plannedMinutes: z.number().int().min(1).max(720),
        actualMinutes: z.number().int().min(1).max(720),
        outcome: z.enum([
          'completed',
          'partly_completed',
          'still_confused',
          'needs_more_practice',
          'interrupted'
        ]),
        notes: z.string().max(4000).nullable()
      })
      .safeParse({
        taskId: formString(form, 'taskId'),
        plannedMinutes: formInteger(form, 'plannedMinutes'),
        actualMinutes: formInteger(form, 'actualMinutes'),
        outcome: formString(form, 'outcome'),
        notes: optionalFormString(form, 'notes')
      });
    if (!parsed.success) {
      return fail(400, { error: issueMessage(parsed.error), action: 'finishFocus' });
    }
    const db = getDatabase();
    const [ownedTask] = await db
      .select({ id: tasks.id, actualMinutes: tasks.actualMinutes })
      .from(tasks)
      .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.userId, locals.user!.id)))
      .limit(1);
    if (!ownedTask) return fail(404, { error: 'Task not found.', action: 'finishFocus' });
    await db.transaction(async (tx) => {
      await tx.insert(focusSessions).values({
        userId: locals.user!.id,
        taskId: parsed.data.taskId,
        plannedMinutes: parsed.data.plannedMinutes,
        actualMinutes: parsed.data.actualMinutes,
        finishedAt: new Date(),
        outcome: parsed.data.outcome,
        notes: parsed.data.notes
      });
      await tx
        .update(tasks)
        .set({
          actualMinutes: ownedTask.actualMinutes + parsed.data.actualMinutes,
          status: parsed.data.outcome === 'completed' ? 'done' : 'doing',
          completedAt: parsed.data.outcome === 'completed' ? new Date() : null,
          updatedAt: new Date()
        })
        .where(and(eq(tasks.id, parsed.data.taskId), eq(tasks.userId, locals.user!.id)));
    });
    return {
      success: true,
      action: 'finishFocus',
      nextAction:
        parsed.data.outcome === 'completed'
          ? 'Choose the next priority when you are ready.'
          : 'Keep the task in Doing and note the smallest next step.'
    };
  }
};

function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
}

async function hasScheduleConflict(userId: string, start: Date, end: Date, timeZone: string) {
  const db = getDatabase();
  const dateKey = dateKeyInTimeZone(start, timeZone);
  if (dateKeyInTimeZone(end, timeZone) !== dateKey) return true;
  const dayOfWeek = weekdayInTimeZone(start, timeZone);
  const startMinutes = minutesInTimeZone(start, timeZone);
  const endMinutes = minutesInTimeZone(end, timeZone);
  const [taskConflict, blocks] = await Promise.all([
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          lt(tasks.scheduledStart, end),
          gt(tasks.scheduledEnd, start),
          inArray(tasks.status, ['inbox', 'this_week', 'doing', 'waiting'])
        )
      )
      .limit(1),
    db
      .select({ startTime: timetableEntries.startTime, endTime: timetableEntries.endTime })
      .from(timetableEntries)
      .where(
        and(
          eq(timetableEntries.userId, userId),
          or(
            and(eq(timetableEntries.isRecurring, true), eq(timetableEntries.dayOfWeek, dayOfWeek)),
            and(eq(timetableEntries.isRecurring, false), eq(timetableEntries.oneTimeDate, dateKey))
          )
        )
      )
  ]);
  return (
    taskConflict.length > 0 ||
    blocks.some(
      (block) =>
        minutesFromTime(block.startTime) < endMinutes &&
        minutesFromTime(block.endTime) > startMinutes
    )
  );
}
