import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql
} from 'drizzle-orm';
import {
  calculateCpa,
  calculateModuleMark,
  normalizeGradingPreferences
} from '$lib/domain/grading';
import { dateKeyInTimeZone, dateTimeInTimeZone } from '$lib/domain/time';
import { getDatabase } from '../db';
import {
  assessments,
  chapterBoardColumns,
  chapters,
  documentAssets,
  documents,
  focusSessions,
  modules,
  practiceAttempts,
  practiceQuestions,
  revisionItems,
  tasks,
  timetableEntries,
  users
} from '../db/schema';

const unfinishedTaskStatuses = ['inbox', 'this_week', 'doing', 'waiting'] as const;

export async function listModules(userId: string) {
  const db = getDatabase();
  const [moduleRows, chapterRows, taskRows, documentRows] = await Promise.all([
    db
      .select()
      .from(modules)
      .where(and(eq(modules.userId, userId), isNull(modules.archivedAt)))
      .orderBy(desc(modules.isCurrent), asc(modules.code)),
    db
      .select({
        moduleId: chapters.moduleId,
        confidence: chapters.confidence,
        status: chapters.status
      })
      .from(chapters)
      .where(eq(chapters.userId, userId)),
    db
      .select({ moduleId: tasks.moduleId })
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.status, unfinishedTaskStatuses))),
    db.select({ moduleId: documents.moduleId }).from(documents).where(eq(documents.userId, userId))
  ]);

  return moduleRows.map((module) => {
    const moduleChapters = chapterRows.filter((chapter) => chapter.moduleId === module.id);
    const activeTasks = taskRows.filter((task) => task.moduleId === module.id).length;
    const materialCount = documentRows.filter((document) => document.moduleId === module.id).length;
    const confidence = moduleChapters.length
      ? moduleChapters.reduce((sum, chapter) => sum + chapter.confidence, 0) / moduleChapters.length
      : null;
    const progress = moduleChapters.length
      ? Math.round(
          (moduleChapters.filter((chapter) =>
            ['practising', 'revision_needed', 'confident'].includes(chapter.status)
          ).length /
            moduleChapters.length) *
            100
        )
      : 0;
    return {
      ...module,
      chapterCount: moduleChapters.length,
      activeTasks,
      materialCount,
      confidence,
      progress
    };
  });
}

export async function getModulePage(userId: string, moduleId: string) {
  const db = getDatabase();
  const [module] = await db
    .select()
    .from(modules)
    .where(and(eq(modules.userId, userId), eq(modules.id, moduleId)))
    .limit(1);
  if (!module) return null;

  const [
    chapterRows,
    taskRows,
    documentRows,
    timetableRows,
    assessmentRows,
    revisionRows,
    practiceRows
  ] = await Promise.all([
    db
      .select()
      .from(chapters)
      .where(and(eq(chapters.userId, userId), eq(chapters.moduleId, moduleId)))
      .orderBy(asc(chapters.position), asc(chapters.title)),
    db
      .select()
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          eq(tasks.moduleId, moduleId),
          inArray(tasks.status, unfinishedTaskStatuses)
        )
      )
      .orderBy(asc(tasks.deadline), desc(tasks.createdAt))
      .limit(8),
    db
      .select()
      .from(documents)
      .where(and(eq(documents.userId, userId), eq(documents.moduleId, moduleId)))
      .orderBy(desc(documents.createdAt))
      .limit(8),
    db
      .select()
      .from(timetableEntries)
      .where(and(eq(timetableEntries.userId, userId), eq(timetableEntries.moduleId, moduleId)))
      .orderBy(asc(timetableEntries.dayOfWeek), asc(timetableEntries.startTime)),
    db
      .select()
      .from(assessments)
      .where(and(eq(assessments.userId, userId), eq(assessments.moduleId, moduleId)))
      .orderBy(desc(assessments.assessmentDate))
      .limit(20),
    db
      .select()
      .from(revisionItems)
      .where(
        and(
          eq(revisionItems.userId, userId),
          eq(revisionItems.moduleId, moduleId),
          inArray(revisionItems.state, ['due', 'upcoming'])
        )
      )
      .orderBy(asc(revisionItems.dueAt))
      .limit(8),
    db
      .select({ result: practiceAttempts.result, createdAt: practiceAttempts.createdAt })
      .from(practiceAttempts)
      .innerJoin(practiceQuestions, eq(practiceAttempts.questionId, practiceQuestions.id))
      .where(
        and(
          eq(practiceAttempts.userId, userId),
          eq(practiceQuestions.userId, userId),
          eq(practiceQuestions.moduleId, moduleId)
        )
      )
      .orderBy(desc(practiceAttempts.createdAt))
      .limit(200)
  ]);

  const confidence = chapterRows.length
    ? chapterRows.reduce((sum, chapter) => sum + chapter.confidence, 0) / chapterRows.length
    : null;
  const weakChapters = chapterRows
    .filter((chapter) => chapter.confidence <= 2 || chapter.status === 'revision_needed')
    .slice(0, 5);
  const completedPractice = practiceRows.filter((attempt) => attempt.result !== 'skipped');
  const practiceAccuracy = completedPractice.length
    ? completedPractice.reduce(
        (sum, attempt) =>
          sum +
          (attempt.result === 'correct' ? 1 : attempt.result === 'partially_correct' ? 0.5 : 0),
        0
      ) / completedPractice.length
    : null;
  const scoredAssessments = assessmentRows.filter((assessment) => assessment.achievedMark !== null);
  const assessmentWeight = scoredAssessments.reduce(
    (sum, assessment) => sum + Number(assessment.weight ?? 1),
    0
  );
  const weightedPerformance = assessmentWeight
    ? scoredAssessments.reduce(
        (sum, assessment) =>
          sum +
          (Number(assessment.achievedMark) / Number(assessment.maximumMark)) *
            Number(assessment.weight ?? 1),
        0
      ) / assessmentWeight
    : null;
  const progress = chapterRows.length
    ? Math.round(
        (chapterRows.filter((chapter) =>
          ['practising', 'revision_needed', 'confident'].includes(chapter.status)
        ).length /
          chapterRows.length) *
          100
      )
    : 0;

  return {
    module,
    chapters: chapterRows,
    tasks: taskRows,
    documents: documentRows,
    timetable: timetableRows,
    assessments: assessmentRows,
    revisions: revisionRows,
    weakChapters,
    confidence,
    progress,
    practiceAttempts: practiceRows.length,
    practiceAccuracy,
    weightedPerformance
  };
}

export async function getChapterPage(userId: string, chapterId: string) {
  const db = getDatabase();
  const [chapter] = await db
    .select({
      chapter: chapters,
      module: modules
    })
    .from(chapters)
    .innerJoin(modules, eq(chapters.moduleId, modules.id))
    .where(and(eq(chapters.userId, userId), eq(chapters.id, chapterId)))
    .limit(1);
  if (!chapter) return null;

  const [columnRows, taskRows, documentRows, revisionRows, questionRows, attemptRows] =
    await Promise.all([
      db
        .select()
        .from(chapterBoardColumns)
        .where(
          and(eq(chapterBoardColumns.userId, userId), eq(chapterBoardColumns.chapterId, chapterId))
        )
        .orderBy(asc(chapterBoardColumns.position), asc(chapterBoardColumns.createdAt)),
      db
        .select()
        .from(tasks)
        .where(and(eq(tasks.userId, userId), eq(tasks.chapterId, chapterId)))
        .orderBy(asc(tasks.boardPosition), asc(tasks.createdAt)),
      db
        .select()
        .from(documents)
        .where(and(eq(documents.userId, userId), eq(documents.chapterId, chapterId)))
        .orderBy(desc(documents.createdAt)),
      db
        .select()
        .from(revisionItems)
        .where(and(eq(revisionItems.userId, userId), eq(revisionItems.chapterId, chapterId)))
        .orderBy(asc(revisionItems.dueAt)),
      db
        .select()
        .from(practiceQuestions)
        .where(
          and(eq(practiceQuestions.userId, userId), eq(practiceQuestions.chapterId, chapterId))
        )
        .orderBy(desc(practiceQuestions.createdAt)),
      db
        .select()
        .from(practiceAttempts)
        .where(eq(practiceAttempts.userId, userId))
        .orderBy(desc(practiceAttempts.createdAt))
    ]);
  const questionIds = new Set(questionRows.map((question) => question.id));
  return {
    ...chapter,
    boardColumns: columnRows,
    tasks: taskRows,
    documents: documentRows,
    revisions: revisionRows,
    questions: questionRows,
    attempts: attemptRows.filter((attempt) => questionIds.has(attempt.questionId))
  };
}

export async function listTasks(userId: string, view = 'today', timeZone = 'UTC') {
  const db = getDatabase();
  const conditions = [eq(tasks.userId, userId)];
  const now = new Date();
  const weekEnd = new Date(now.getTime() + 7 * 86_400_000);

  if (view === 'all') conditions.push(inArray(tasks.status, unfinishedTaskStatuses));
  else if (view === 'inbox') conditions.push(eq(tasks.status, 'inbox'));
  else if (view === 'this_week') conditions.push(eq(tasks.status, 'this_week'));
  else if (view === 'completed') conditions.push(eq(tasks.status, 'done'));
  else if (view === 'calendar') {
    conditions.push(
      and(
        inArray(tasks.status, unfinishedTaskStatuses),
        or(isNotNull(tasks.scheduledStart), isNotNull(tasks.deadline))
      )!
    );
  } else if (view === 'by_module') {
    conditions.push(inArray(tasks.status, unfinishedTaskStatuses));
  } else if (view === 'upcoming') {
    conditions.push(
      and(
        inArray(tasks.status, unfinishedTaskStatuses),
        isNotNull(tasks.deadline),
        lte(tasks.deadline, weekEnd)
      )!
    );
  } else {
    const today = dateKeyInTimeZone(now, timeZone);
    const start = dateTimeInTimeZone(today, '00:00', timeZone);
    const end = dateTimeInTimeZone(today, '23:59:59', timeZone);
    conditions.push(
      and(
        inArray(tasks.status, unfinishedTaskStatuses),
        or(
          eq(tasks.status, 'doing'),
          and(gte(tasks.scheduledStart, start), lte(tasks.scheduledStart, end)),
          and(gte(tasks.deadline, start), lte(tasks.deadline, end))
        )
      )!
    );
  }

  const order =
    view === 'by_module'
      ? [asc(modules.code), asc(tasks.deadline), desc(tasks.createdAt)]
      : view === 'calendar'
        ? [
            sql`coalesce(${tasks.scheduledStart}, ${tasks.deadline}) asc nulls last`,
            desc(tasks.createdAt)
          ]
        : [
            sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
            asc(tasks.deadline),
            desc(tasks.createdAt)
          ];
  return db
    .select({
      task: tasks,
      moduleCode: modules.code,
      moduleName: modules.name,
      moduleColor: modules.color,
      chapterTitle: chapters.title
    })
    .from(tasks)
    .leftJoin(modules, eq(tasks.moduleId, modules.id))
    .leftJoin(chapters, eq(tasks.chapterId, chapters.id))
    .where(and(...conditions))
    .orderBy(...order);
}

export async function listOpenTasksForScheduling(userId: string) {
  const db = getDatabase();
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      moduleId: tasks.moduleId,
      moduleCode: modules.code,
      moduleName: modules.name,
      moduleWeight: modules.schedulingWeight,
      deadline: tasks.deadline,
      estimatedMinutes: tasks.estimatedMinutes,
      priority: tasks.priority,
      type: tasks.type,
      chapterConfidence: chapters.confidence,
      nextRevisionAt: tasks.nextRevisionAt,
      createdAt: tasks.createdAt
    })
    .from(tasks)
    .leftJoin(modules, eq(tasks.moduleId, modules.id))
    .leftJoin(chapters, eq(tasks.chapterId, chapters.id))
    .where(and(eq(tasks.userId, userId), inArray(tasks.status, unfinishedTaskStatuses)));
}

export async function listTimetable(userId: string) {
  const db = getDatabase();
  return db
    .select({
      entry: timetableEntries,
      moduleCode: modules.code,
      moduleColor: modules.color
    })
    .from(timetableEntries)
    .leftJoin(modules, eq(timetableEntries.moduleId, modules.id))
    .where(eq(timetableEntries.userId, userId))
    .orderBy(asc(timetableEntries.dayOfWeek), asc(timetableEntries.startTime));
}

export async function userSchedulePreferences(userId: string) {
  const db = getDatabase();
  const [user] = await db
    .select({
      preferredSessionMinutes: users.preferredSessionMinutes,
      maxWeekdayStudyMinutes: users.maxWeekdayStudyMinutes,
      maxWeekendStudyMinutes: users.maxWeekendStudyMinutes,
      preferredRestDay: users.preferredRestDay,
      eveningStudy: users.eveningStudy,
      sleepStart: users.sleepStart,
      sleepEnd: users.sleepEnd,
      travelMinutes: users.travelMinutes,
      preparationMinutes: users.preparationMinutes,
      timezone: users.timezone
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) throw new Error('User not found');
  return user;
}

export async function todayOverview(userId: string, start: Date, end: Date) {
  const db = getDatabase();
  const [scheduled, revisions, nextEvents, storage] = await Promise.all([
    db
      .select({
        task: tasks,
        moduleCode: modules.code,
        moduleName: modules.name,
        moduleColor: modules.color,
        chapterTitle: chapters.title
      })
      .from(tasks)
      .leftJoin(modules, eq(tasks.moduleId, modules.id))
      .leftJoin(chapters, eq(tasks.chapterId, chapters.id))
      .where(
        and(
          eq(tasks.userId, userId),
          inArray(tasks.status, unfinishedTaskStatuses),
          or(
            and(gte(tasks.scheduledStart, start), lt(tasks.scheduledStart, end)),
            lt(tasks.deadline, end)
          )
        )
      )
      .orderBy(asc(tasks.scheduledStart), asc(tasks.deadline)),
    db
      .select({
        revision: revisionItems,
        moduleCode: modules.code,
        moduleColor: modules.color
      })
      .from(revisionItems)
      .leftJoin(modules, eq(revisionItems.moduleId, modules.id))
      .where(
        and(
          eq(revisionItems.userId, userId),
          ne(revisionItems.state, 'dismissed'),
          lt(revisionItems.dueAt, end)
        )
      )
      .orderBy(asc(revisionItems.dueAt))
      .limit(6),
    listTimetable(userId),
    db
      .select({
        used: users.storageUsedBytes,
        quota: users.storageQuotaBytes
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  ]);

  return {
    scheduled,
    revisions,
    timetable: nextEvents,
    storage: storage[0] ?? { used: 0, quota: 10 * 1024 ** 3 }
  };
}

export async function progressOverview(userId: string) {
  const db = getDatabase();
  const [moduleRows, chapterRows, attempts, assessmentRows, focusRows, assetRows, accountRows] =
    await Promise.all([
      db.select().from(modules).where(eq(modules.userId, userId)).orderBy(asc(modules.code)),
      db.select().from(chapters).where(eq(chapters.userId, userId)),
      db.select().from(practiceAttempts).where(eq(practiceAttempts.userId, userId)),
      db
        .select()
        .from(assessments)
        .where(eq(assessments.userId, userId))
        .orderBy(desc(assessments.assessmentDate)),
      db.select().from(focusSessions).where(eq(focusSessions.userId, userId)),
      db
        .select({ bytes: sql<number>`coalesce(sum(${documentAssets.byteSize}), 0)` })
        .from(documentAssets)
        .where(eq(documentAssets.userId, userId)),
      db
        .select({ gradingPreferences: users.gradingPreferences })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)
    ]);

  const moduleOverview = moduleRows.map((module) => {
    const ownedChapters = chapterRows.filter((chapter) => chapter.moduleId === module.id);
    const moduleAssessments = assessmentRows.filter(
      (assessment) => assessment.moduleId === module.id
    );
    return {
      ...module,
      chapterCount: ownedChapters.length,
      confidence: ownedChapters.length
        ? ownedChapters.reduce((sum, chapter) => sum + chapter.confidence, 0) / ownedChapters.length
        : null,
      result: calculateModuleMark(moduleAssessments)
    };
  });
  const grading = normalizeGradingPreferences(accountRows[0]?.gradingPreferences);
  const cpa = calculateCpa(
    moduleOverview.map((module) => ({
      id: module.id,
      code: module.code,
      markPercent: module.result,
      creditUnits: module.creditUnits,
      gradeWeight: module.gradeWeight
    })),
    grading
  );

  return {
    modules: moduleOverview,
    attempts,
    assessments: assessmentRows,
    focusMinutes: focusRows.reduce((sum, session) => sum + (session.actualMinutes ?? 0), 0),
    storageBytes: Number(assetRows[0]?.bytes ?? 0),
    grading,
    cpa
  };
}
