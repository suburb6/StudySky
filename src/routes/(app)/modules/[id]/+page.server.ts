import { fail, error, redirect } from '@sveltejs/kit';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { parseZonedDateTime } from '$lib/domain/time';
import { chapterBoardPlacement, defaultChapterBoardColumns } from '$lib/server/chapter-board';
import { getDatabase } from '$lib/server/db';
import { chapterBoardColumns, chapters, modules, tasks } from '$lib/server/db/schema';
import { formInteger, formString, issueMessage, optionalFormString } from '$lib/server/forms';
import { getModulePage } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

const chapterSchema = z.object({
  title: z.string().min(2, 'Enter a chapter title.').max(240),
  description: z.string().max(4000).nullable()
});

const taskSchema = z.object({
  title: z.string().min(2, 'Enter a task title.').max(300),
  chapterId: z.uuid().nullable(),
  estimatedMinutes: z.number().int().min(5).max(720),
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
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  deadline: z.date().nullable()
});

export const load: PageServerLoad = async ({ locals, params }) => {
  const page = await getModulePage(locals.user!.id, params.id);
  if (!page) error(404, 'Module not found');
  return page;
};

export const actions: Actions = {
  createChapter: async ({ request, locals, params }) => {
    await requireOwnedModule(locals.user!.id, params.id);
    const form = await request.formData();
    const parsed = chapterSchema.safeParse({
      title: formString(form, 'title'),
      description: optionalFormString(form, 'description')
    });
    if (!parsed.success) {
      return fail(400, { error: issueMessage(parsed.error), action: 'createChapter' });
    }
    const db = getDatabase();
    const [position] = await db
      .select({ value: sql<number>`coalesce(max(${chapters.position}), -1) + 1` })
      .from(chapters)
      .where(and(eq(chapters.userId, locals.user!.id), eq(chapters.moduleId, params.id)));
    await db.transaction(async (tx) => {
      const [chapter] = await tx
        .insert(chapters)
        .values({
          userId: locals.user!.id,
          moduleId: params.id,
          ...parsed.data,
          position: Number(position.value)
        })
        .returning({ id: chapters.id });
      await tx
        .insert(chapterBoardColumns)
        .values(defaultChapterBoardColumns(locals.user!.id, chapter.id));
    });
    return { success: true, action: 'createChapter' };
  },
  renameChapter: async ({ request, locals, params }) => {
    await requireOwnedModule(locals.user!.id, params.id);
    const form = await request.formData();
    const parsed = z
      .object({ chapterId: z.uuid(), title: z.string().trim().min(2).max(240) })
      .safeParse({
        chapterId: formString(form, 'chapterId'),
        title: formString(form, 'title')
      });
    if (!parsed.success) {
      return fail(400, { error: 'Enter a chapter title.', action: 'renameChapter' });
    }
    const [updated] = await getDatabase()
      .update(chapters)
      .set({ title: parsed.data.title, updatedAt: new Date() })
      .where(
        and(
          eq(chapters.id, parsed.data.chapterId),
          eq(chapters.userId, locals.user!.id),
          eq(chapters.moduleId, params.id)
        )
      )
      .returning({ id: chapters.id });
    if (!updated) {
      return fail(404, { error: 'Chapter not found.', action: 'renameChapter' });
    }
    return { success: true, action: 'renameChapter' };
  },
  reorderChapters: async ({ request, locals, params }) => {
    await requireOwnedModule(locals.user!.id, params.id);
    const form = await request.formData();
    const ids = [
      ...new Set(
        form
          .getAll('chapterId')
          .map(String)
          .filter((id) => z.uuid().safeParse(id).success)
      )
    ].slice(0, 300);
    const db = getDatabase();
    const owned = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.userId, locals.user!.id), eq(chapters.moduleId, params.id)));
    if (ids.length !== owned.length || owned.some((chapter) => !ids.includes(chapter.id))) {
      return fail(400, { error: 'Chapter order is out of date.', action: 'reorderChapters' });
    }
    await db.transaction(async (tx) => {
      for (const [position, chapterId] of ids.entries()) {
        await tx
          .update(chapters)
          .set({ position, updatedAt: new Date() })
          .where(
            and(
              eq(chapters.id, chapterId),
              eq(chapters.userId, locals.user!.id),
              eq(chapters.moduleId, params.id)
            )
          );
      }
    });
    return { success: true, action: 'reorderChapters' };
  },
  moveChapter: async ({ request, locals, params }) => {
    await requireOwnedModule(locals.user!.id, params.id);
    const form = await request.formData();
    const chapterId = formString(form, 'chapterId');
    const direction = formString(form, 'direction') === 'up' ? -1 : 1;
    if (!z.uuid().safeParse(chapterId).success) {
      return fail(400, { error: 'Chapter not found.', action: 'moveChapter' });
    }
    const db = getDatabase();
    const ordered = await db
      .select({ id: chapters.id })
      .from(chapters)
      .where(and(eq(chapters.userId, locals.user!.id), eq(chapters.moduleId, params.id)))
      .orderBy(asc(chapters.position), asc(chapters.title));
    const current = ordered.findIndex((chapter) => chapter.id === chapterId);
    const target = current + direction;
    if (current < 0 || target < 0 || target >= ordered.length) {
      return { success: true, action: 'moveChapter' };
    }
    [ordered[current], ordered[target]] = [ordered[target], ordered[current]];
    await db.transaction(async (tx) => {
      for (const [position, chapter] of ordered.entries()) {
        await tx
          .update(chapters)
          .set({ position, updatedAt: new Date() })
          .where(and(eq(chapters.id, chapter.id), eq(chapters.userId, locals.user!.id)));
      }
    });
    return { success: true, action: 'moveChapter' };
  },
  addTask: async ({ request, locals, params }) => {
    await requireOwnedModule(locals.user!.id, params.id);
    const form = await request.formData();
    const chapterValue = optionalFormString(form, 'chapterId');
    const parsed = taskSchema.safeParse({
      title: formString(form, 'title'),
      chapterId: chapterValue,
      estimatedMinutes: formInteger(form, 'estimatedMinutes', 30),
      type: formString(form, 'type') || 'other',
      priority: formString(form, 'priority') || 'normal',
      deadline: parseZonedDateTime(formString(form, 'deadline'), locals.user!.timezone)
    });
    if (!parsed.success) return fail(400, { error: issueMessage(parsed.error), action: 'addTask' });
    let boardPlacement: Awaited<ReturnType<typeof chapterBoardPlacement>> = null;
    if (parsed.data.chapterId) {
      const [owned] = await getDatabase()
        .select({ id: chapters.id })
        .from(chapters)
        .where(
          and(
            eq(chapters.id, parsed.data.chapterId),
            eq(chapters.userId, locals.user!.id),
            eq(chapters.moduleId, params.id)
          )
        )
        .limit(1);
      if (!owned) return fail(400, { error: 'Choose a valid chapter.', action: 'addTask' });
      boardPlacement = await chapterBoardPlacement({
        userId: locals.user!.id,
        chapterId: parsed.data.chapterId
      });
    }
    await getDatabase()
      .insert(tasks)
      .values({
        userId: locals.user!.id,
        moduleId: params.id,
        ...parsed.data,
        boardColumnId: boardPlacement?.column.id ?? null,
        boardPosition: boardPlacement?.position ?? 0,
        status: boardPlacement?.column.isDone ? 'done' : boardPlacement ? 'this_week' : 'inbox',
        completedAt: boardPlacement?.column.isDone ? new Date() : null
      });
    return { success: true, action: 'addTask' };
  },
  updateModule: async ({ request, locals, params }) => {
    await requireOwnedModule(locals.user!.id, params.id);
    const form = await request.formData();
    const parsed = z
      .object({
        name: z.string().min(2).max(180),
        code: z.string().min(1).max(40),
        lecturerName: z.string().max(180).nullable(),
        lecturerEmail: z.email().max(320).nullable(),
        description: z.string().max(10_000).nullable(),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
        notebookName: z.string().max(120).nullable(),
        notebookNumber: z.number().int().min(1).max(999).nullable(),
        schedulingWeight: z.number().min(0.05).max(5),
        creditUnits: z.number().positive().max(10_000).nullable(),
        gradeWeight: z.number().positive().max(1_000),
        isCurrent: z.boolean()
      })
      .safeParse({
        name: formString(form, 'name'),
        code: formString(form, 'code').toUpperCase(),
        lecturerName: optionalFormString(form, 'lecturerName'),
        lecturerEmail: optionalFormString(form, 'lecturerEmail'),
        description: optionalFormString(form, 'description'),
        color: formString(form, 'color'),
        notebookName: optionalFormString(form, 'notebookName'),
        notebookNumber: optionalFormString(form, 'notebookNumber')
          ? formInteger(form, 'notebookNumber')
          : null,
        schedulingWeight: Number(formString(form, 'schedulingWeight')),
        creditUnits: optionalFormString(form, 'creditUnits')
          ? Number(formString(form, 'creditUnits'))
          : null,
        gradeWeight: Number(formString(form, 'gradeWeight') || '1'),
        isCurrent: form.has('isCurrent')
      });
    if (!parsed.success) {
      return fail(400, { error: issueMessage(parsed.error), action: 'updateModule' });
    }
    try {
      const { creditUnits, gradeWeight, ...moduleValues } = parsed.data;
      await getDatabase()
        .update(modules)
        .set({
          ...moduleValues,
          creditUnits: creditUnits === null ? null : String(creditUnits),
          gradeWeight: String(gradeWeight),
          updatedAt: new Date()
        })
        .where(and(eq(modules.id, params.id), eq(modules.userId, locals.user!.id)));
    } catch (caught) {
      if (caught && typeof caught === 'object' && 'code' in caught && caught.code === '23505') {
        return fail(409, { error: 'That module code already exists.', action: 'updateModule' });
      }
      throw caught;
    }
    return { success: true, action: 'updateModule' };
  },
  deleteModule: async ({ request, locals, params }) => {
    const module = await requireOwnedModule(locals.user!.id, params.id);
    const form = await request.formData();
    if (formString(form, 'confirmation').trim().toUpperCase() !== module.code.toUpperCase()) {
      return fail(400, {
        error: `Type ${module.code} to confirm deletion.`,
        action: 'deleteModule'
      });
    }
    await getDatabase()
      .delete(modules)
      .where(and(eq(modules.id, params.id), eq(modules.userId, locals.user!.id)));
    redirect(303, '/modules?deleted=1');
  },
  importChapters: async ({ request, locals, params }) => {
    await requireOwnedModule(locals.user!.id, params.id);
    const form = await request.formData();
    const input = formString(form, 'chapters');
    const parsedRows = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line, index) => !(index === 0 && /^title\s*[,|]/i.test(line)))
      .slice(0, 200)
      .map((line) => {
        const separator = line.includes('|') ? '|' : ',';
        const [title, ...description] = line.split(separator);
        return {
          title: title.trim().replace(/^"|"$/g, ''),
          description: description.join(separator).trim().replace(/^"|"$/g, '') || null
        };
      })
      .filter((row) => row.title.length >= 2 && row.title.length <= 240);
    if (!parsedRows.length) {
      return fail(400, {
        error: 'Paste at least one chapter title, one per line.',
        action: 'importChapters'
      });
    }
    const db = getDatabase();
    const existing = await db
      .select({ title: chapters.title, position: chapters.position })
      .from(chapters)
      .where(and(eq(chapters.userId, locals.user!.id), eq(chapters.moduleId, params.id)));
    const titles = new Set(existing.map((row) => row.title.toLocaleLowerCase('en')));
    const additions = parsedRows
      .filter((row) => !titles.has(row.title.toLocaleLowerCase('en')))
      .map((row, index) => ({
        userId: locals.user!.id,
        moduleId: params.id,
        ...row,
        position: Math.max(-1, ...existing.map((item) => item.position)) + index + 1
      }));
    if (additions.length) {
      await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(chapters)
          .values(additions)
          .returning({ id: chapters.id, userId: chapters.userId });
        await tx
          .insert(chapterBoardColumns)
          .values(
            inserted.flatMap((chapter) => defaultChapterBoardColumns(chapter.userId, chapter.id))
          );
      });
    }
    return {
      success: true,
      action: 'importChapters',
      count: additions.length,
      skipped: parsedRows.length - additions.length
    };
  }
};

async function requireOwnedModule(userId: string, moduleId: string) {
  const [module] = await getDatabase()
    .select({ id: modules.id, code: modules.code })
    .from(modules)
    .where(and(eq(modules.id, moduleId), eq(modules.userId, userId)))
    .limit(1);
  if (!module) error(404, 'Module not found');
  return module;
}
