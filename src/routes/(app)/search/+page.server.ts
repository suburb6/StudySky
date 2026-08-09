import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { dateTimeInTimeZone } from '$lib/domain/time';
import { getDatabase } from '$lib/server/db';
import {
  chapters,
  documentShares,
  documentType,
  documents,
  modules,
  practiceAttempts,
  practiceQuestions,
  revisionItems,
  revisionState,
  taskStatus,
  tasks
} from '$lib/server/db/schema';
import { listModules } from '$lib/server/services/study';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
  const db = getDatabase();
  const userId = locals.user!.id;
  const query = url.searchParams.get('q')?.trim().slice(0, 300) ?? '';
  const moduleId = url.searchParams.get('module') || null;
  const chapterId = url.searchParams.get('chapter') || null;
  const section = url.searchParams.get('section')?.slice(0, 80) || null;
  const typeValue = url.searchParams.get('type');
  const statusValue = url.searchParams.get('taskStatus');
  const revisionValue = url.searchParams.get('revisionStatus');
  const confidenceValue = Number(url.searchParams.get('confidence'));
  const fromValue = url.searchParams.get('from');
  const toValue = url.searchParams.get('to');
  const documentTypeFilter = documentType.enumValues.includes(
    typeValue as (typeof documentType.enumValues)[number]
  )
    ? (typeValue as (typeof documentType.enumValues)[number])
    : null;
  const taskStatusFilter = taskStatus.enumValues.includes(
    statusValue as (typeof taskStatus.enumValues)[number]
  )
    ? (statusValue as (typeof taskStatus.enumValues)[number])
    : null;
  const revisionStatusFilter = revisionState.enumValues.includes(
    revisionValue as (typeof revisionState.enumValues)[number]
  )
    ? (revisionValue as (typeof revisionState.enumValues)[number])
    : null;
  const confidence =
    Number.isInteger(confidenceValue) && confidenceValue >= 1 && confidenceValue <= 5
      ? confidenceValue
      : null;
  const from = fromValue && /^\d{4}-\d{2}-\d{2}$/.test(fromValue) ? fromValue : null;
  const to = toValue && /^\d{4}-\d{2}-\d{2}$/.test(toValue) ? toValue : null;

  const [moduleRows, chapterOptions] = await Promise.all([
    listModules(userId),
    db
      .select({ id: chapters.id, moduleId: chapters.moduleId, title: chapters.title })
      .from(chapters)
      .where(eq(chapters.userId, userId))
      .orderBy(asc(chapters.title))
  ]);

  if (!query) {
    return {
      query,
      filters: {
        moduleId,
        chapterId,
        section,
        documentType: documentTypeFilter,
        taskStatus: taskStatusFilter,
        revisionStatus: revisionStatusFilter,
        confidence,
        from,
        to
      },
      modules: moduleRows,
      chapters: chapterOptions,
      results: emptyResults()
    };
  }

  const pattern = `%${escapeLike(query)}%`;
  const chapterConditions = [
    eq(chapters.userId, userId),
    or(
      ilike(chapters.title, pattern),
      ilike(chapters.description, pattern),
      ilike(chapters.importantFormulas, pattern),
      ilike(chapters.annotations, pattern),
      ilike(chapters.lecturerQuestions, pattern)
    )!
  ];
  if (moduleId) chapterConditions.push(eq(chapters.moduleId, moduleId));
  if (chapterId) chapterConditions.push(eq(chapters.id, chapterId));
  if (confidence) chapterConditions.push(eq(chapters.confidence, confidence));

  const taskConditions = [
    eq(tasks.userId, userId),
    sql`to_tsvector('english', coalesce(${tasks.title}, '') || ' ' || coalesce(${tasks.description}, '') || ' ' || coalesce(${tasks.notes}, '')) @@ websearch_to_tsquery('english', ${query})`
  ];
  if (moduleId) taskConditions.push(eq(tasks.moduleId, moduleId));
  if (chapterId) taskConditions.push(eq(tasks.chapterId, chapterId));
  if (section) taskConditions.push(eq(tasks.section, section));
  if (taskStatusFilter) taskConditions.push(eq(tasks.status, taskStatusFilter));
  if (from)
    taskConditions.push(
      gte(tasks.createdAt, dateTimeInTimeZone(from, '00:00', locals.user!.timezone))
    );
  if (to)
    taskConditions.push(
      lte(tasks.createdAt, dateTimeInTimeZone(to, '23:59:59', locals.user!.timezone))
    );

  const documentConditions = [
    or(
      eq(documents.userId, userId),
      sql`exists (
        select 1 from ${documentShares}
        where ${documentShares.documentId} = ${documents.id}
          and ${documentShares.sharedWithUserId} = ${userId}
          and ${documentShares.revokedAt} is null
      )`
    )!,
    or(
      sql`to_tsvector('english', coalesce(${documents.title}, '') || ' ' || coalesce(${documents.description}, '') || ' ' || coalesce(${documents.extractedText}, '') || ' ' || coalesce(${documents.correctedText}, '')) @@ websearch_to_tsquery('english', ${query})`,
      sql`exists (select 1 from unnest(${documents.tags}) as tag where tag ilike ${pattern})`
    )!
  ];
  if (moduleId) documentConditions.push(eq(documents.moduleId, moduleId));
  if (chapterId) documentConditions.push(eq(documents.chapterId, chapterId));
  if (section) documentConditions.push(eq(documents.section, section));
  if (documentTypeFilter) documentConditions.push(eq(documents.type, documentTypeFilter));
  if (from) documentConditions.push(gte(documents.documentDate, from));
  if (to) documentConditions.push(lte(documents.documentDate, to));

  const practiceConditions = [
    eq(practiceQuestions.userId, userId),
    or(
      ilike(practiceQuestions.prompt, pattern),
      ilike(practiceQuestions.explanation, pattern),
      sql`exists (
        select 1 from ${practiceAttempts}
        where ${practiceAttempts.questionId} = ${practiceQuestions.id}
          and ${practiceAttempts.userId} = ${userId}
          and (
            coalesce(${practiceAttempts.answer}, '') ilike ${pattern}
            or coalesce(${practiceAttempts.mistake}::text, '') ilike ${pattern}
            or ${practiceAttempts.result}::text ilike ${pattern}
          )
      )`
    )!
  ];
  if (moduleId) practiceConditions.push(eq(practiceQuestions.moduleId, moduleId));
  if (chapterId) practiceConditions.push(eq(practiceQuestions.chapterId, chapterId));

  const revisionConditions = [
    eq(revisionItems.userId, userId),
    ilike(revisionItems.title, pattern)
  ];
  if (moduleId) revisionConditions.push(eq(revisionItems.moduleId, moduleId));
  if (chapterId) revisionConditions.push(eq(revisionItems.chapterId, chapterId));
  if (revisionStatusFilter) revisionConditions.push(eq(revisionItems.state, revisionStatusFilter));

  const [
    matchingModules,
    matchingChapters,
    matchingTasks,
    matchingDocuments,
    matchingPractice,
    matchingRevisions
  ] = await Promise.all([
    db
      .select({ id: modules.id, code: modules.code, name: modules.name, color: modules.color })
      .from(modules)
      .where(
        and(
          eq(modules.userId, userId),
          isNull(modules.archivedAt),
          or(
            ilike(modules.code, pattern),
            ilike(modules.name, pattern),
            ilike(modules.description, pattern)
          )
        )
      )
      .limit(30),
    db
      .select({
        id: chapters.id,
        title: chapters.title,
        status: chapters.status,
        confidence: chapters.confidence,
        moduleCode: modules.code,
        moduleColor: modules.color
      })
      .from(chapters)
      .leftJoin(modules, eq(chapters.moduleId, modules.id))
      .where(and(...chapterConditions))
      .limit(50),
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        type: tasks.type,
        deadline: tasks.deadline,
        moduleCode: modules.code,
        moduleColor: modules.color,
        chapterTitle: chapters.title
      })
      .from(tasks)
      .leftJoin(modules, eq(tasks.moduleId, modules.id))
      .leftJoin(chapters, eq(tasks.chapterId, chapters.id))
      .where(and(...taskConditions))
      .orderBy(desc(tasks.createdAt))
      .limit(50),
    db
      .select({
        id: documents.id,
        title: documents.title,
        type: documents.type,
        mimeType: documents.mimeType,
        createdAt: documents.createdAt,
        isOwner: sql<boolean>`${documents.userId} = ${userId}`,
        moduleCode: sql<
          string | null
        >`case when ${documents.userId} = ${userId} then ${modules.code} else null end`,
        moduleColor: sql<
          string | null
        >`case when ${documents.userId} = ${userId} then ${modules.color} else null end`,
        chapterTitle: sql<
          string | null
        >`case when ${documents.userId} = ${userId} then ${chapters.title} else null end`
      })
      .from(documents)
      .leftJoin(modules, eq(documents.moduleId, modules.id))
      .leftJoin(chapters, eq(documents.chapterId, chapters.id))
      .where(and(...documentConditions))
      .orderBy(desc(documents.createdAt))
      .limit(50),
    db
      .select({
        id: practiceQuestions.id,
        prompt: practiceQuestions.prompt,
        mode: practiceQuestions.mode,
        difficulty: practiceQuestions.difficulty,
        moduleCode: modules.code,
        moduleColor: modules.color,
        chapterTitle: chapters.title
      })
      .from(practiceQuestions)
      .leftJoin(modules, eq(practiceQuestions.moduleId, modules.id))
      .leftJoin(chapters, eq(practiceQuestions.chapterId, chapters.id))
      .where(and(...practiceConditions))
      .orderBy(desc(practiceQuestions.createdAt))
      .limit(50),
    db
      .select({
        id: revisionItems.id,
        title: revisionItems.title,
        state: revisionItems.state,
        dueAt: revisionItems.dueAt,
        moduleCode: modules.code,
        moduleColor: modules.color,
        chapterTitle: chapters.title
      })
      .from(revisionItems)
      .leftJoin(modules, eq(revisionItems.moduleId, modules.id))
      .leftJoin(chapters, eq(revisionItems.chapterId, chapters.id))
      .where(and(...revisionConditions))
      .orderBy(desc(revisionItems.createdAt))
      .limit(50)
  ]);

  return {
    query,
    filters: {
      moduleId,
      chapterId,
      section,
      documentType: documentTypeFilter,
      taskStatus: taskStatusFilter,
      revisionStatus: revisionStatusFilter,
      confidence,
      from,
      to
    },
    modules: moduleRows,
    chapters: chapterOptions,
    results: {
      modules: matchingModules,
      chapters: matchingChapters,
      tasks: matchingTasks,
      documents: matchingDocuments,
      practice: matchingPractice,
      revisions: matchingRevisions
    }
  };
};

function escapeLike(value: string) {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function emptyResults() {
  return {
    modules: [],
    chapters: [],
    tasks: [],
    documents: [],
    practice: [],
    revisions: []
  };
}
