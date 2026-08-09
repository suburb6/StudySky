import { fail } from '@sveltejs/kit';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '$lib/server/db';
import {
  chapters,
  modules,
  practiceAttempts,
  practiceQuestions,
  revisionItems
} from '$lib/server/db/schema';
import { formInteger, formString, issueMessage, optionalFormString } from '$lib/server/forms';
import { listModules } from '$lib/server/services/study';
import type { Actions, PageServerLoad } from './$types';

const modes = [
  'multiple_choice',
  'short_answer',
  'explanation',
  'coding',
  'sql',
  'algorithm_tracing',
  'numerical_computation',
  'physics_calculation',
  'formula_recall',
  'mixed_topic',
  'timed_mock'
] as const;

const mistakes = [
  'concept_not_understood',
  'formula_forgotten',
  'calculation_error',
  'misread_question',
  'logic_error',
  'algorithm_error',
  'syntax_error',
  'insufficient_practice',
  'careless_mistake',
  'other'
] as const;

const createSchema = z.object({
  moduleId: z.uuid().nullable(),
  chapterId: z.uuid().nullable(),
  mode: z.enum(modes),
  prompt: z.string().min(3, 'Enter a question.').max(20_000),
  answer: z.string().min(1, 'Enter the expected answer.').max(20_000),
  choices: z.array(z.string().min(1).max(1_000)).max(8).nullable(),
  explanation: z.string().max(20_000).nullable(),
  difficulty: z.number().int().min(1).max(5)
});

export const load: PageServerLoad = async ({ locals, url }) => {
  const userId = locals.user!.id;
  const db = getDatabase();
  const selectedId = z.uuid().safeParse(url.searchParams.get('question')).data;
  const [moduleRows, chapterRows, questionRows, attemptRows] = await Promise.all([
    listModules(userId),
    db
      .select({ id: chapters.id, moduleId: chapters.moduleId, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.userId, userId))
      .orderBy(asc(chapters.position)),
    db
      .select({
        id: practiceQuestions.id,
        moduleId: practiceQuestions.moduleId,
        chapterId: practiceQuestions.chapterId,
        mode: practiceQuestions.mode,
        prompt: practiceQuestions.prompt,
        choices: practiceQuestions.choices,
        difficulty: practiceQuestions.difficulty,
        createdAt: practiceQuestions.createdAt,
        moduleCode: modules.code,
        moduleColor: modules.color,
        chapterTitle: chapters.title
      })
      .from(practiceQuestions)
      .leftJoin(modules, eq(practiceQuestions.moduleId, modules.id))
      .leftJoin(chapters, eq(practiceQuestions.chapterId, chapters.id))
      .where(eq(practiceQuestions.userId, userId))
      .orderBy(desc(practiceQuestions.createdAt)),
    db
      .select({
        questionId: practiceAttempts.questionId,
        result: practiceAttempts.result,
        createdAt: practiceAttempts.createdAt
      })
      .from(practiceAttempts)
      .where(eq(practiceAttempts.userId, userId))
      .orderBy(desc(practiceAttempts.createdAt))
  ]);

  const enrichedQuestions = questionRows.map((question) => {
    const attempts = attemptRows.filter((attempt) => attempt.questionId === question.id);
    const correct = attempts.filter((attempt) => attempt.result === 'correct').length;
    return {
      ...question,
      attemptCount: attempts.length,
      accuracy: attempts.length ? Math.round((correct / attempts.length) * 100) : null,
      lastResult: attempts[0]?.result ?? null
    };
  });

  return {
    modules: moduleRows,
    chapters: chapterRows,
    questions: enrichedQuestions,
    selected:
      enrichedQuestions.find((question) => question.id === selectedId) ??
      enrichedQuestions[0] ??
      null,
    totals: {
      attempts: attemptRows.length,
      correct: attemptRows.filter((attempt) => attempt.result === 'correct').length
    }
  };
};

export const actions: Actions = {
  create: async ({ request, locals }) => {
    const form = await request.formData();
    const choices = formString(form, 'choices')
      .split('\n')
      .map((choice) => choice.trim())
      .filter(Boolean);
    const parsed = createSchema.safeParse({
      moduleId: optionalFormString(form, 'moduleId'),
      chapterId: optionalFormString(form, 'chapterId'),
      mode: formString(form, 'mode'),
      prompt: formString(form, 'prompt'),
      answer: formString(form, 'answer'),
      choices: choices.length ? choices : null,
      explanation: optionalFormString(form, 'explanation'),
      difficulty: formInteger(form, 'difficulty', 3)
    });
    if (!parsed.success) {
      return fail(400, { action: 'create', error: issueMessage(parsed.error) });
    }
    if (
      !(await academicSelectionBelongsToUser(
        locals.user!.id,
        parsed.data.moduleId,
        parsed.data.chapterId
      ))
    ) {
      return fail(400, { action: 'create', error: 'Choose a valid module and chapter.' });
    }
    const [question] = await getDatabase()
      .insert(practiceQuestions)
      .values({ userId: locals.user!.id, ...parsed.data })
      .returning({ id: practiceQuestions.id });
    return { action: 'create', success: true, questionId: question.id };
  },

  submit: async ({ request, locals }) => {
    const form = await request.formData();
    const questionId = z.uuid().safeParse(formString(form, 'questionId'));
    const answer = formString(form, 'answer');
    const confidence = formInteger(form, 'confidence', 3);
    const seconds = Math.max(0, Math.min(formInteger(form, 'secondsTaken', 0), 86_400));
    const hints = Math.max(0, Math.min(formInteger(form, 'hintsUsed', 0), 20));
    const selfResultValue = optionalFormString(form, 'selfResult');
    const selfResult = selfResultValue
      ? z.enum(['correct', 'incorrect', 'partially_correct', 'skipped']).safeParse(selfResultValue)
          .data
      : null;
    const mistakeValue = optionalFormString(form, 'mistake');
    const mistake = mistakeValue ? z.enum(mistakes).safeParse(mistakeValue).data : null;
    if (!questionId.success || (!answer && selfResult !== 'skipped')) {
      return fail(400, { action: 'submit', error: 'Enter an answer before submitting.' });
    }
    if (confidence < 1 || confidence > 5) {
      return fail(400, { action: 'submit', error: 'Confidence must be between 1 and 5.' });
    }
    const db = getDatabase();
    const [question] = await db
      .select({
        id: practiceQuestions.id,
        moduleId: practiceQuestions.moduleId,
        chapterId: practiceQuestions.chapterId,
        prompt: practiceQuestions.prompt,
        answer: practiceQuestions.answer,
        explanation: practiceQuestions.explanation
      })
      .from(practiceQuestions)
      .where(
        and(
          eq(practiceQuestions.id, questionId.data),
          eq(practiceQuestions.userId, locals.user!.id)
        )
      )
      .limit(1);
    if (!question) return fail(404, { action: 'submit', error: 'Question not found.' });

    const result =
      selfResult ??
      (normalizeAnswer(answer) === normalizeAnswer(question.answer) ? 'correct' : 'incorrect');
    await db.insert(practiceAttempts).values({
      userId: locals.user!.id,
      questionId: question.id,
      answer,
      result,
      confidenceBefore: confidence,
      secondsTaken: seconds,
      hintsUsed: hints,
      mistake: result === 'incorrect' || result === 'partially_correct' ? mistake : null
    });
    if (result === 'incorrect' || result === 'partially_correct') {
      const [history] = await db
        .select({ count: sql<number>`count(*)` })
        .from(practiceAttempts)
        .where(
          and(
            eq(practiceAttempts.userId, locals.user!.id),
            eq(practiceAttempts.questionId, question.id),
            inArray(practiceAttempts.result, ['incorrect', 'partially_correct'])
          )
        );
      if (Number(history?.count ?? 0) >= 2) {
        const [existingRevision] = await db
          .select({ id: revisionItems.id })
          .from(revisionItems)
          .where(
            and(
              eq(revisionItems.userId, locals.user!.id),
              eq(revisionItems.practiceQuestionId, question.id),
              ne(revisionItems.state, 'dismissed')
            )
          )
          .limit(1);
        if (!existingRevision) {
          await db.insert(revisionItems).values({
            userId: locals.user!.id,
            moduleId: question.moduleId,
            chapterId: question.chapterId,
            practiceQuestionId: question.id,
            title: `Revisit: ${question.prompt.slice(0, 280)}`,
            state: 'upcoming',
            dueAt: new Date(Date.now() + 24 * 60 * 60 * 1_000)
          });
        }
      }
    }
    return {
      action: 'submit',
      success: true,
      questionId: question.id,
      result,
      expectedAnswer: question.answer,
      explanation: question.explanation
    };
  },

  reveal: async ({ request, locals }) => {
    const form = await request.formData();
    const questionId = z.uuid().safeParse(formString(form, 'questionId'));
    if (!questionId.success) {
      return fail(400, { action: 'reveal', error: 'Invalid question.' });
    }
    const [question] = await getDatabase()
      .select({
        id: practiceQuestions.id,
        answer: practiceQuestions.answer,
        explanation: practiceQuestions.explanation
      })
      .from(practiceQuestions)
      .where(
        and(
          eq(practiceQuestions.id, questionId.data),
          eq(practiceQuestions.userId, locals.user!.id)
        )
      )
      .limit(1);
    if (!question) return fail(404, { action: 'reveal', error: 'Question not found.' });
    return {
      action: 'reveal',
      success: true,
      questionId: question.id,
      expectedAnswer: question.answer,
      explanation: question.explanation
    };
  }
};

async function academicSelectionBelongsToUser(
  userId: string,
  moduleId: string | null,
  chapterId: string | null
): Promise<boolean> {
  const db = getDatabase();
  if (moduleId) {
    const [module] = await db
      .select({ id: modules.id })
      .from(modules)
      .where(and(eq(modules.id, moduleId), eq(modules.userId, userId)))
      .limit(1);
    if (!module) return false;
  }
  if (chapterId) {
    const [chapter] = await db
      .select({ moduleId: chapters.moduleId })
      .from(chapters)
      .where(and(eq(chapters.id, chapterId), eq(chapters.userId, userId)))
      .limit(1);
    if (!chapter || chapter.moduleId !== moduleId) return false;
  }
  return true;
}

function normalizeAnswer(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/\s+/g, ' ')
    .replace(/[.,;:!?]+$/g, '');
}
