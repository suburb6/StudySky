import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { calculateNextRevision } from '$lib/domain/revision';
import {
  dateKeyAddDays,
  dateKeyInTimeZone,
  dateTimeInTimeZone,
  parseZonedDateTime
} from '$lib/domain/time';
import { getDatabase } from '$lib/server/db';
import {
  chapters,
  documents,
  modules,
  practiceAttempts,
  practiceQuestions,
  revisionItems,
  revisionRecords
} from '$lib/server/db/schema';
import { formInteger, formString, optionalFormString } from '$lib/server/forms';
import { listModules } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

const results = ['correct', 'incorrect', 'partially_correct', 'skipped'] as const;

export const load: PageServerLoad = async ({ locals }) => {
  const db = getDatabase();
  const userId = locals.user!.id;
  const now = new Date();
  const tomorrow = dateTimeInTimeZone(
    dateKeyAddDays(dateKeyInTimeZone(now, locals.user!.timezone), 1),
    '23:59:59',
    locals.user!.timezone
  );
  const [moduleRows, chapterRows, documentRows, questionRows, itemRows, recordRows, attemptRows] =
    await Promise.all([
      listModules(userId),
      db
        .select({
          id: chapters.id,
          moduleId: chapters.moduleId,
          title: chapters.title,
          confidence: chapters.confidence,
          status: chapters.status
        })
        .from(chapters)
        .where(eq(chapters.userId, userId))
        .orderBy(asc(chapters.position)),
      db
        .select({ id: documents.id, moduleId: documents.moduleId, title: documents.title })
        .from(documents)
        .where(eq(documents.userId, userId))
        .orderBy(desc(documents.createdAt))
        .limit(100),
      db
        .select({
          id: practiceQuestions.id,
          moduleId: practiceQuestions.moduleId,
          chapterId: practiceQuestions.chapterId,
          prompt: practiceQuestions.prompt
        })
        .from(practiceQuestions)
        .where(eq(practiceQuestions.userId, userId))
        .orderBy(desc(practiceQuestions.createdAt))
        .limit(100),
      db
        .select({
          item: revisionItems,
          moduleCode: modules.code,
          moduleColor: modules.color,
          chapterTitle: chapters.title
        })
        .from(revisionItems)
        .leftJoin(modules, eq(revisionItems.moduleId, modules.id))
        .leftJoin(chapters, eq(revisionItems.chapterId, chapters.id))
        .where(and(eq(revisionItems.userId, userId), ne(revisionItems.state, 'dismissed')))
        .orderBy(asc(revisionItems.dueAt)),
      db
        .select({
          record: revisionRecords,
          title: revisionItems.title,
          moduleCode: modules.code
        })
        .from(revisionRecords)
        .innerJoin(revisionItems, eq(revisionRecords.revisionItemId, revisionItems.id))
        .leftJoin(modules, eq(revisionItems.moduleId, modules.id))
        .where(eq(revisionRecords.userId, userId))
        .orderBy(desc(revisionRecords.completedAt))
        .limit(50),
      db
        .select({
          questionId: practiceAttempts.questionId,
          result: practiceAttempts.result
        })
        .from(practiceAttempts)
        .where(eq(practiceAttempts.userId, userId))
    ]);

  const questionAttempts = new Map<string, { attempts: number; correct: number }>();
  for (const attempt of attemptRows) {
    const current = questionAttempts.get(attempt.questionId) ?? { attempts: 0, correct: 0 };
    current.attempts += 1;
    if (attempt.result === 'correct') current.correct += 1;
    questionAttempts.set(attempt.questionId, current);
  }
  const chapterQuestionIds = new Map<string, string[]>();
  for (const question of questionRows) {
    if (!question.chapterId) continue;
    chapterQuestionIds.set(question.chapterId, [
      ...(chapterQuestionIds.get(question.chapterId) ?? []),
      question.id
    ]);
  }
  const weakTopics = chapterRows
    .map((chapter) => {
      const ids = chapterQuestionIds.get(chapter.id) ?? [];
      const summary = ids.reduce(
        (total, id) => {
          const value = questionAttempts.get(id);
          return {
            attempts: total.attempts + (value?.attempts ?? 0),
            correct: total.correct + (value?.correct ?? 0)
          };
        },
        { attempts: 0, correct: 0 }
      );
      return {
        ...chapter,
        accuracy: summary.attempts ? Math.round((summary.correct / summary.attempts) * 100) : null
      };
    })
    .filter(
      (chapter) =>
        chapter.confidence <= 2 ||
        chapter.status === 'revision_needed' ||
        (chapter.accuracy !== null && chapter.accuracy < 60)
    )
    .slice(0, 8);

  return {
    modules: moduleRows,
    chapters: chapterRows,
    documents: documentRows,
    questions: questionRows,
    due: itemRows.filter((row) => row.item.dueAt <= tomorrow),
    overdue: itemRows.filter((row) => row.item.dueAt < now),
    upcoming: itemRows.filter((row) => row.item.dueAt > tomorrow),
    completed: recordRows,
    weakTopics
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const form = await request.formData();
    const title = formString(form, 'title');
    const moduleId = optionalFormString(form, 'moduleId');
    const chapterId = optionalFormString(form, 'chapterId');
    const documentId = optionalFormString(form, 'documentId');
    const practiceQuestionId = optionalFormString(form, 'practiceQuestionId');
    const dueAt = parseZonedDateTime(formString(form, 'dueAt'), locals.user!.timezone);
    if (!title || title.length > 300 || !dueAt) {
      return fail(400, { action: 'create', error: 'Enter a title and valid due time.' });
    }
    if (
      !(await referencesBelongToUser(locals.user!.id, {
        moduleId,
        chapterId,
        documentId,
        practiceQuestionId
      }))
    ) {
      return fail(400, { action: 'create', error: 'Choose valid study materials.' });
    }
    await getDatabase()
      .insert(revisionItems)
      .values({
        userId: locals.user!.id,
        title,
        moduleId,
        chapterId,
        documentId,
        practiceQuestionId,
        dueAt,
        state: dueAt <= new Date() ? 'due' : 'upcoming'
      });
    return { action: 'create', success: true };
  },

  complete: async ({ request, locals }) => {
    const form = await request.formData();
    const id = z.uuid().safeParse(formString(form, 'revisionId'));
    const result = z.enum(results).safeParse(formString(form, 'result'));
    const confidence = formInteger(form, 'confidence', 3);
    const minutesSpent = Math.max(0, Math.min(formInteger(form, 'minutesSpent', 0), 1_440));
    if (!id.success || !result.success || confidence < 1 || confidence > 5) {
      return fail(400, { action: 'complete', error: 'Check the revision result.' });
    }
    const db = getDatabase();
    const [item] = await db
      .select()
      .from(revisionItems)
      .where(and(eq(revisionItems.id, id.data), eq(revisionItems.userId, locals.user!.id)))
      .limit(1);
    if (!item) return fail(404, { action: 'complete', error: 'Revision not found.' });

    const completedAt = new Date();
    const schedule = calculateNextRevision(completedAt, item.intervalStep, result.data, confidence);
    await db.transaction(async (tx) => {
      await tx.insert(revisionRecords).values({
        userId: locals.user!.id,
        revisionItemId: item.id,
        confidence,
        result: result.data,
        minutesSpent,
        notes: optionalFormString(form, 'notes'),
        completedAt
      });
      await tx
        .update(revisionItems)
        .set({
          dueAt: schedule.nextDueAt,
          intervalStep: schedule.nextStep,
          state: 'upcoming',
          completedAt,
          updatedAt: completedAt
        })
        .where(and(eq(revisionItems.id, item.id), eq(revisionItems.userId, locals.user!.id)));
      if (item.chapterId) {
        await tx
          .update(chapters)
          .set({
            confidence,
            lastStudiedAt: completedAt,
            nextRevisionAt: schedule.nextDueAt,
            updatedAt: completedAt
          })
          .where(and(eq(chapters.id, item.chapterId), eq(chapters.userId, locals.user!.id)));
      }
    });
    return {
      action: 'complete',
      success: true,
      nextDueAt: schedule.nextDueAt.toISOString(),
      intervalDays: schedule.intervalDays,
      reason: schedule.reason
    };
  },

  dismiss: async ({ request, locals }) => {
    const form = await request.formData();
    const id = z.uuid().safeParse(formString(form, 'revisionId'));
    if (!id.success) return fail(400, { action: 'dismiss', error: 'Invalid revision.' });
    await getDatabase()
      .update(revisionItems)
      .set({ state: 'dismissed', updatedAt: new Date() })
      .where(and(eq(revisionItems.id, id.data), eq(revisionItems.userId, locals.user!.id)));
    return { action: 'dismiss', success: true };
  }
};

async function referencesBelongToUser(
  userId: string,
  input: {
    moduleId: string | null;
    chapterId: string | null;
    documentId: string | null;
    practiceQuestionId: string | null;
  }
) {
  const db = getDatabase();
  if (input.moduleId) {
    const [row] = await db
      .select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.id, input.moduleId), eq(modules.userId, userId)))
      .limit(1);
    if (!row) return false;
  }
  if (input.chapterId) {
    const [row] = await db
      .select({ moduleId: chapters.moduleId })
      .from(chapters)
      .where(and(eq(chapters.id, input.chapterId), eq(chapters.userId, userId)))
      .limit(1);
    if (!row || (input.moduleId && row.moduleId !== input.moduleId)) return false;
  }
  if (input.documentId) {
    const [row] = await db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.id, input.documentId), eq(documents.userId, userId)))
      .limit(1);
    if (!row) return false;
  }
  if (input.practiceQuestionId) {
    const [row] = await db
      .select({ id: practiceQuestions.id })
      .from(practiceQuestions)
      .where(
        and(
          eq(practiceQuestions.id, input.practiceQuestionId),
          eq(practiceQuestions.userId, userId)
        )
      )
      .limit(1);
    if (!row) return false;
  }
  return true;
}
