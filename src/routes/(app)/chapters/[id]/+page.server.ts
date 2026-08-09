import { error, fail } from '@sveltejs/kit';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { defaultChapterBoardColumns } from '$lib/server/chapter-board';
import { getDatabase } from '$lib/server/db';
import { chapterBoardColumns, chapterPrerequisites, chapters, tasks } from '$lib/server/db/schema';
import { formInteger, formString, issueMessage, optionalFormString } from '$lib/server/forms';
import { getChapterPage } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

const updateSchema = z.object({
  title: z.string().min(2).max(240),
  description: z.string().max(4000).nullable(),
  importantFormulas: z.string().max(20_000).nullable(),
  annotations: z.string().max(20_000).nullable(),
  lecturerQuestions: z.string().max(20_000).nullable()
});

export const load: PageServerLoad = async ({ locals, params, url }) => {
  let page = await getChapterPage(locals.user!.id, params.id);
  if (!page) error(404, 'Chapter not found');
  const db = getDatabase();
  if (!page.boardColumns.length) {
    await db
      .insert(chapterBoardColumns)
      .values(defaultChapterBoardColumns(locals.user!.id, params.id));
    page = await getChapterPage(locals.user!.id, params.id);
    if (!page) error(404, 'Chapter not found');
  }
  const [options, prerequisites] = await Promise.all([
    db
      .select({ id: chapters.id, title: chapters.title })
      .from(chapters)
      .where(
        and(
          eq(chapters.userId, locals.user!.id),
          eq(chapters.moduleId, page.chapter.moduleId),
          ne(chapters.id, params.id)
        )
      )
      .orderBy(asc(chapters.position), asc(chapters.title)),
    db
      .select({ prerequisiteId: chapterPrerequisites.prerequisiteId })
      .from(chapterPrerequisites)
      .where(eq(chapterPrerequisites.chapterId, params.id))
  ]);
  return {
    ...page,
    selectedSection: url.searchParams.get('section'),
    prerequisiteOptions: options,
    prerequisites: prerequisites.map((item) => item.prerequisiteId)
  };
};

export const actions: Actions = {
  update: async ({ request, locals, params }) => {
    const chapter = await requireChapter(locals.user!.id, params.id);
    const form = await request.formData();
    const parsed = updateSchema.safeParse({
      title: formString(form, 'title'),
      description: optionalFormString(form, 'description'),
      importantFormulas: optionalFormString(form, 'importantFormulas'),
      annotations: optionalFormString(form, 'annotations'),
      lecturerQuestions: optionalFormString(form, 'lecturerQuestions')
    });
    if (!parsed.success) return fail(400, { error: issueMessage(parsed.error), action: 'update' });
    const prerequisiteIds = [
      ...new Set(
        form
          .getAll('prerequisiteId')
          .map(String)
          .filter((value) => z.uuid().safeParse(value).success && value !== params.id)
      )
    ].slice(0, 100);
    if (prerequisiteIds.length) {
      const owned = await getDatabase()
        .select({ id: chapters.id })
        .from(chapters)
        .where(
          and(
            eq(chapters.userId, locals.user!.id),
            eq(chapters.moduleId, chapter.moduleId),
            inArray(chapters.id, prerequisiteIds)
          )
        );
      if (owned.length !== prerequisiteIds.length) {
        return fail(400, { error: 'Choose prerequisites from this module.', action: 'update' });
      }
    }
    await getDatabase().transaction(async (tx) => {
      await tx
        .update(chapters)
        .set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(chapters.id, params.id), eq(chapters.userId, locals.user!.id)));
      await tx.delete(chapterPrerequisites).where(eq(chapterPrerequisites.chapterId, params.id));
      if (prerequisiteIds.length) {
        await tx.insert(chapterPrerequisites).values(
          prerequisiteIds.map((prerequisiteId) => ({
            chapterId: params.id,
            prerequisiteId
          }))
        );
      }
    });
    return { success: true, action: 'update' };
  },
  addTask: async ({ request, locals, params }) => {
    const chapter = await requireChapter(locals.user!.id, params.id);
    const form = await request.formData();
    const title = formString(form, 'title');
    if (title.length < 2) return fail(400, { error: 'Enter a task title.', action: 'addTask' });
    const columns = await ownedColumns(locals.user!.id, params.id);
    const requestedColumn = optionalFormString(form, 'columnId');
    const column = columns.find((item) => item.id === requestedColumn) ?? columns[0];
    if (!column) return fail(409, { error: 'Add a board column first.', action: 'addTask' });
    const [position] = await getDatabase()
      .select({ value: sql<number>`coalesce(max(${tasks.boardPosition}), -1) + 1` })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, locals.user!.id),
          eq(tasks.chapterId, params.id),
          eq(tasks.boardColumnId, column.id)
        )
      );
    await getDatabase()
      .insert(tasks)
      .values({
        userId: locals.user!.id,
        moduleId: chapter.moduleId,
        chapterId: chapter.id,
        boardColumnId: column.id,
        boardPosition: Number(position.value),
        title,
        type: 'other',
        status: column.isDone ? 'done' : 'this_week',
        completedAt: column.isDone ? new Date() : null,
        estimatedMinutes: Math.min(Math.max(formInteger(form, 'estimatedMinutes', 30), 5), 720)
      });
    return { success: true, action: 'addTask' };
  },
  updateCard: async ({ request, locals, params }) => {
    const form = await request.formData();
    const parsed = z
      .object({
        taskId: z.uuid(),
        title: z.string().trim().min(2).max(300),
        estimatedMinutes: z.number().int().min(5).max(720)
      })
      .safeParse({
        taskId: formString(form, 'taskId'),
        title: formString(form, 'title'),
        estimatedMinutes: formInteger(form, 'estimatedMinutes', 30)
      });
    if (!parsed.success) {
      return fail(400, { error: 'Enter a task title and duration.', action: 'updateCard' });
    }
    const [updated] = await getDatabase()
      .update(tasks)
      .set({
        title: parsed.data.title,
        estimatedMinutes: parsed.data.estimatedMinutes,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(tasks.id, parsed.data.taskId),
          eq(tasks.userId, locals.user!.id),
          eq(tasks.chapterId, params.id)
        )
      )
      .returning({ id: tasks.id });
    if (!updated) return fail(404, { error: 'Card not found.', action: 'updateCard' });
    return { success: true, action: 'updateCard' };
  },
  moveCard: async ({ request, locals, params }) => {
    const form = await request.formData();
    const parsed = z
      .object({
        taskId: z.uuid(),
        columnId: z.uuid(),
        position: z.number().int().min(0).max(10_000)
      })
      .safeParse({
        taskId: formString(form, 'taskId'),
        columnId: formString(form, 'columnId'),
        position: formInteger(form, 'position', 0)
      });
    if (!parsed.success) {
      return fail(400, { error: 'Card move is out of date.', action: 'moveCard' });
    }
    const db = getDatabase();
    const [[task], [column]] = await Promise.all([
      db
        .select()
        .from(tasks)
        .where(
          and(
            eq(tasks.id, parsed.data.taskId),
            eq(tasks.userId, locals.user!.id),
            eq(tasks.chapterId, params.id)
          )
        )
        .limit(1),
      db
        .select()
        .from(chapterBoardColumns)
        .where(
          and(
            eq(chapterBoardColumns.id, parsed.data.columnId),
            eq(chapterBoardColumns.userId, locals.user!.id),
            eq(chapterBoardColumns.chapterId, params.id)
          )
        )
        .limit(1)
    ]);
    if (!task || !column)
      return fail(404, { error: 'Card or column not found.', action: 'moveCard' });
    const targetCards = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, locals.user!.id),
          eq(tasks.chapterId, params.id),
          eq(tasks.boardColumnId, column.id),
          ne(tasks.id, task.id)
        )
      )
      .orderBy(asc(tasks.boardPosition), asc(tasks.createdAt));
    targetCards.splice(Math.min(parsed.data.position, targetCards.length), 0, { id: task.id });
    const previousCards =
      task.boardColumnId && task.boardColumnId !== column.id
        ? await db
            .select({ id: tasks.id })
            .from(tasks)
            .where(
              and(
                eq(tasks.userId, locals.user!.id),
                eq(tasks.chapterId, params.id),
                eq(tasks.boardColumnId, task.boardColumnId),
                ne(tasks.id, task.id)
              )
            )
            .orderBy(asc(tasks.boardPosition), asc(tasks.createdAt))
        : [];
    await db.transaction(async (tx) => {
      await tx
        .update(tasks)
        .set({
          boardColumnId: column.id,
          status: column.isDone ? 'done' : task.status === 'done' ? 'this_week' : task.status,
          completedAt: column.isDone ? (task.completedAt ?? new Date()) : null,
          updatedAt: new Date()
        })
        .where(and(eq(tasks.id, task.id), eq(tasks.userId, locals.user!.id)));
      for (const [position, card] of targetCards.entries()) {
        await tx
          .update(tasks)
          .set({ boardPosition: position })
          .where(and(eq(tasks.id, card.id), eq(tasks.userId, locals.user!.id)));
      }
      for (const [position, card] of previousCards.entries()) {
        await tx
          .update(tasks)
          .set({ boardPosition: position })
          .where(and(eq(tasks.id, card.id), eq(tasks.userId, locals.user!.id)));
      }
    });
    return { success: true, action: 'moveCard' };
  },
  deleteCard: async ({ request, locals, params }) => {
    const form = await request.formData();
    const taskId = formString(form, 'taskId');
    if (!z.uuid().safeParse(taskId).success) {
      return fail(400, { error: 'Card not found.', action: 'deleteCard' });
    }
    const [deleted] = await getDatabase()
      .delete(tasks)
      .where(
        and(eq(tasks.id, taskId), eq(tasks.userId, locals.user!.id), eq(tasks.chapterId, params.id))
      )
      .returning({ id: tasks.id });
    if (!deleted) return fail(404, { error: 'Card not found.', action: 'deleteCard' });
    return { success: true, action: 'deleteCard' };
  },
  createColumn: async ({ request, locals, params }) => {
    await requireChapter(locals.user!.id, params.id);
    const form = await request.formData();
    const name = formString(form, 'name').trim();
    if (name.length < 1 || name.length > 80) {
      return fail(400, { error: 'Enter a column name.', action: 'createColumn' });
    }
    const db = getDatabase();
    const [position] = await db
      .select({ value: sql<number>`coalesce(max(${chapterBoardColumns.position}), -1) + 1` })
      .from(chapterBoardColumns)
      .where(
        and(
          eq(chapterBoardColumns.userId, locals.user!.id),
          eq(chapterBoardColumns.chapterId, params.id)
        )
      );
    await db.insert(chapterBoardColumns).values({
      userId: locals.user!.id,
      chapterId: params.id,
      name,
      position: Number(position.value),
      isDone: form.has('isDone')
    });
    return { success: true, action: 'createColumn' };
  },
  updateColumn: async ({ request, locals, params }) => {
    const form = await request.formData();
    const parsed = z
      .object({ columnId: z.uuid(), name: z.string().trim().min(1).max(80) })
      .safeParse({
        columnId: formString(form, 'columnId'),
        name: formString(form, 'name')
      });
    if (!parsed.success) {
      return fail(400, { error: 'Enter a column name.', action: 'updateColumn' });
    }
    const isDone = form.has('isDone');
    const updated = await getDatabase().transaction(async (tx) => {
      const [column] = await tx
        .update(chapterBoardColumns)
        .set({ name: parsed.data.name, isDone, updatedAt: new Date() })
        .where(
          and(
            eq(chapterBoardColumns.id, parsed.data.columnId),
            eq(chapterBoardColumns.userId, locals.user!.id),
            eq(chapterBoardColumns.chapterId, params.id)
          )
        )
        .returning({ id: chapterBoardColumns.id });
      if (!column) return null;
      await tx
        .update(tasks)
        .set({
          status: isDone ? 'done' : 'this_week',
          completedAt: isDone ? new Date() : null,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(tasks.userId, locals.user!.id),
            eq(tasks.chapterId, params.id),
            eq(tasks.boardColumnId, column.id)
          )
        );
      return column;
    });
    if (!updated) return fail(404, { error: 'Column not found.', action: 'updateColumn' });
    return { success: true, action: 'updateColumn' };
  },
  reorderColumns: async ({ request, locals, params }) => {
    const form = await request.formData();
    const ids = [
      ...new Set(
        form
          .getAll('columnId')
          .map(String)
          .filter((id) => z.uuid().safeParse(id).success)
      )
    ].slice(0, 50);
    const columns = await ownedColumns(locals.user!.id, params.id);
    if (ids.length !== columns.length || columns.some((column) => !ids.includes(column.id))) {
      return fail(400, { error: 'Column order is out of date.', action: 'reorderColumns' });
    }
    await getDatabase().transaction(async (tx) => {
      for (const [position, columnId] of ids.entries()) {
        await tx
          .update(chapterBoardColumns)
          .set({ position, updatedAt: new Date() })
          .where(
            and(
              eq(chapterBoardColumns.id, columnId),
              eq(chapterBoardColumns.userId, locals.user!.id)
            )
          );
      }
    });
    return { success: true, action: 'reorderColumns' };
  },
  deleteColumn: async ({ request, locals, params }) => {
    const form = await request.formData();
    const columnId = formString(form, 'columnId');
    const columns = await ownedColumns(locals.user!.id, params.id);
    const column = columns.find((item) => item.id === columnId);
    if (!column) return fail(404, { error: 'Column not found.', action: 'deleteColumn' });
    if (columns.length < 2) {
      return fail(400, { error: 'A board needs at least one column.', action: 'deleteColumn' });
    }
    const fallback = columns.find((item) => item.id !== column.id)!;
    const db = getDatabase();
    const [position] = await db
      .select({ value: sql<number>`coalesce(max(${tasks.boardPosition}), -1) + 1` })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, locals.user!.id),
          eq(tasks.chapterId, params.id),
          eq(tasks.boardColumnId, fallback.id)
        )
      );
    const moving = await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, locals.user!.id),
          eq(tasks.chapterId, params.id),
          eq(tasks.boardColumnId, column.id)
        )
      )
      .orderBy(asc(tasks.boardPosition), asc(tasks.createdAt));
    await db.transaction(async (tx) => {
      for (const [offset, task] of moving.entries()) {
        await tx
          .update(tasks)
          .set({
            boardColumnId: fallback.id,
            boardPosition: Number(position.value) + offset,
            status: fallback.isDone ? 'done' : 'this_week',
            completedAt: fallback.isDone ? new Date() : null,
            updatedAt: new Date()
          })
          .where(and(eq(tasks.id, task.id), eq(tasks.userId, locals.user!.id)));
      }
      await tx
        .delete(chapterBoardColumns)
        .where(
          and(
            eq(chapterBoardColumns.id, column.id),
            eq(chapterBoardColumns.userId, locals.user!.id)
          )
        );
      for (const [position, item] of columns.filter((item) => item.id !== column.id).entries()) {
        await tx
          .update(chapterBoardColumns)
          .set({ position, updatedAt: new Date() })
          .where(
            and(
              eq(chapterBoardColumns.id, item.id),
              eq(chapterBoardColumns.userId, locals.user!.id)
            )
          );
      }
    });
    return { success: true, action: 'deleteColumn' };
  }
};

async function requireChapter(userId: string, chapterId: string) {
  const [chapter] = await getDatabase()
    .select()
    .from(chapters)
    .where(and(eq(chapters.userId, userId), eq(chapters.id, chapterId)))
    .limit(1);
  if (!chapter) error(404, 'Chapter not found');
  return chapter;
}

async function ownedColumns(userId: string, chapterId: string) {
  return getDatabase()
    .select()
    .from(chapterBoardColumns)
    .where(
      and(eq(chapterBoardColumns.userId, userId), eq(chapterBoardColumns.chapterId, chapterId))
    )
    .orderBy(asc(chapterBoardColumns.position), asc(chapterBoardColumns.createdAt));
}
