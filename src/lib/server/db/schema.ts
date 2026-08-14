import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from 'drizzle-orm/pg-core';

export const userRole = pgEnum('user_role', ['admin', 'member']);
export const chapterStatus = pgEnum('chapter_status', [
  'not_started',
  'introduced',
  'learning',
  'practising',
  'revision_needed',
  'confident'
]);
export const taskStatus = pgEnum('task_status', [
  'inbox',
  'this_week',
  'doing',
  'waiting',
  'done',
  'skipped'
]);
export const taskType = pgEnum('task_type', [
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
]);
export const taskPriority = pgEnum('task_priority', ['low', 'normal', 'high', 'urgent']);
export const timetableKind = pgEnum('timetable_kind', [
  'class',
  'study',
  'work',
  'travel',
  'sleep',
  'meal',
  'religious',
  'family',
  'appointment',
  'rest',
  'examination',
  'university_event',
  'other'
]);
export const documentType = pgEnum('document_type', [
  'lecturer_notes',
  'my_notes',
  'worked_exercises',
  'assignment',
  'tutorial_sheet',
  'past_paper',
  'test',
  'examination',
  'formula_sheet',
  'module_catalogue',
  'reference',
  'other'
]);
export const processingStatus = pgEnum('processing_status', [
  'uploaded',
  'queued',
  'processing',
  'ready',
  'failed'
]);
export const ocrStatus = pgEnum('ocr_status', [
  'not_requested',
  'queued',
  'processing',
  'complete',
  'failed',
  'needs_review'
]);
export const assetKind = pgEnum('asset_kind', ['original', 'processed', 'thumbnail', 'generated']);
export const practiceMode = pgEnum('practice_mode', [
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
]);
export const attemptResult = pgEnum('attempt_result', [
  'correct',
  'incorrect',
  'partially_correct',
  'skipped'
]);
export const mistakeCategory = pgEnum('mistake_category', [
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
]);
export const revisionState = pgEnum('revision_state', [
  'due',
  'upcoming',
  'completed',
  'dismissed'
]);
export const focusOutcome = pgEnum('focus_outcome', [
  'completed',
  'partly_completed',
  'still_confused',
  'needs_more_practice',
  'interrupted'
]);
export const sharingPermission = pgEnum('sharing_permission', ['read', 'collaborate']);
export const notificationKind = pgEnum('notification_kind', [
  'class_upcoming',
  'study_session',
  'assignment_deadline',
  'revision_due',
  'task_overdue',
  'scan_unprocessed',
  'weekly_planning',
  'system'
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    role: userRole('role').notNull().default('member'),
    timezone: varchar('timezone', { length: 80 }).notNull().default('UTC'),
    storageQuotaBytes: bigint('storage_quota_bytes', { mode: 'number' })
      .notNull()
      .default(10 * 1024 * 1024 * 1024),
    storageUsedBytes: bigint('storage_used_bytes', { mode: 'number' }).notNull().default(0),
    onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
    sleepStart: time('sleep_start').notNull().default('23:00'),
    sleepEnd: time('sleep_end').notNull().default('07:00'),
    travelMinutes: integer('travel_minutes').notNull().default(30),
    preparationMinutes: integer('preparation_minutes').notNull().default(15),
    preferredSessionMinutes: integer('preferred_session_minutes').notNull().default(45),
    maxWeekdayStudyMinutes: integer('max_weekday_study_minutes').notNull().default(180),
    maxWeekendStudyMinutes: integer('max_weekend_study_minutes').notNull().default(240),
    preferredRestDay: integer('preferred_rest_day').notNull().default(0),
    eveningStudy: boolean('evening_study').notNull().default(true),
    automaticReschedule: boolean('automatic_reschedule').notNull().default(false),
    reminderPreferences: jsonb('reminder_preferences')
      .$type<Record<string, boolean>>()
      .notNull()
      .default({}),
    gradingPreferences: jsonb('grading_preferences')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('users_email_unique').on(sql`lower(${table.email})`),
    check('users_quota_positive', sql`${table.storageQuotaBytes} > 0`),
    check('users_storage_nonnegative', sql`${table.storageUsedBytes} >= 0`),
    check('users_rest_day_valid', sql`${table.preferredRestDay} between 0 and 6`)
  ]
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 500 }),
    ipAddress: varchar('ip_address', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
    index('sessions_user_idx').on(table.userId),
    index('sessions_expiry_idx').on(table.expiresAt)
  ]
);

export const loginAttempts = pgTable('login_attempts', {
  key: varchar('key', { length: 180 }).primaryKey(),
  attempts: integer('attempts').notNull().default(0),
  windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull().defaultNow(),
  blockedUntil: timestamp('blocked_until', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const modules = pgTable(
  'modules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 180 }).notNull(),
    lecturerName: varchar('lecturer_name', { length: 180 }),
    lecturerEmail: varchar('lecturer_email', { length: 320 }),
    description: text('description'),
    color: varchar('color', { length: 16 }).notNull().default('#787774'),
    notebookName: varchar('notebook_name', { length: 120 }),
    notebookNumber: integer('notebook_number'),
    isCurrent: boolean('is_current').notNull().default(true),
    schedulingWeight: real('scheduling_weight').notNull().default(1),
    creditUnits: numeric('credit_units', { precision: 8, scale: 2 }),
    gradeWeight: numeric('grade_weight', { precision: 8, scale: 3 }).notNull().default('1'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('modules_user_code_unique').on(table.userId, table.code),
    index('modules_user_idx').on(table.userId),
    check(
      'modules_credit_units_positive',
      sql`${table.creditUnits} is null or ${table.creditUnits} > 0`
    ),
    check('modules_grade_weight_positive', sql`${table.gradeWeight} > 0`)
  ]
);

export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 240 }).notNull(),
    description: text('description'),
    position: integer('position').notNull().default(0),
    status: chapterStatus('status').notNull().default('not_started'),
    confidence: integer('confidence').notNull().default(1),
    importantFormulas: text('important_formulas'),
    annotations: text('annotations'),
    lecturerQuestions: text('lecturer_questions'),
    lastStudiedAt: timestamp('last_studied_at', { withTimezone: true }),
    nextRevisionAt: timestamp('next_revision_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('chapters_user_idx').on(table.userId),
    index('chapters_module_position_idx').on(table.moduleId, table.position),
    check('chapters_confidence_range', sql`${table.confidence} between 1 and 5`)
  ]
);

export const chapterPrerequisites = pgTable(
  'chapter_prerequisites',
  {
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    prerequisiteId: uuid('prerequisite_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.chapterId, table.prerequisiteId] }),
    check('chapter_not_own_prerequisite', sql`${table.chapterId} <> ${table.prerequisiteId}`)
  ]
);

export const chapterBoardColumns = pgTable(
  'chapter_board_columns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id')
      .notNull()
      .references(() => chapters.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    position: integer('position').notNull().default(0),
    isDone: boolean('is_done').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('chapter_board_columns_user_idx').on(table.userId),
    index('chapter_board_columns_chapter_position_idx').on(table.chapterId, table.position)
  ]
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    boardColumnId: uuid('board_column_id').references(() => chapterBoardColumns.id, {
      onDelete: 'set null'
    }),
    boardPosition: integer('board_position').notNull().default(0),
    sourceDocumentId: uuid('source_document_id'),
    clientId: varchar('client_id', { length: 100 }),
    section: varchar('section', { length: 80 }),
    title: varchar('title', { length: 300 }).notNull(),
    description: text('description'),
    type: taskType('type').notNull().default('other'),
    status: taskStatus('status').notNull().default('inbox'),
    priority: taskPriority('priority').notNull().default('normal'),
    difficulty: integer('difficulty').notNull().default(3),
    deadline: timestamp('deadline', { withTimezone: true }),
    estimatedMinutes: integer('estimated_minutes').notNull().default(30),
    actualMinutes: integer('actual_minutes').notNull().default(0),
    scheduledStart: timestamp('scheduled_start', { withTimezone: true }),
    scheduledEnd: timestamp('scheduled_end', { withTimezone: true }),
    recurrenceRule: text('recurrence_rule'),
    nextRevisionAt: timestamp('next_revision_at', { withTimezone: true }),
    notes: text('notes'),
    scheduleReason: text('schedule_reason'),
    scheduleLocked: boolean('schedule_locked').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('tasks_user_status_idx').on(table.userId, table.status),
    index('tasks_user_deadline_idx').on(table.userId, table.deadline),
    index('tasks_module_idx').on(table.moduleId),
    uniqueIndex('tasks_user_client_id_unique').on(table.userId, table.clientId),
    check('tasks_difficulty_range', sql`${table.difficulty} between 1 and 5`),
    check('tasks_duration_positive', sql`${table.estimatedMinutes} > 0`),
    check('tasks_actual_nonnegative', sql`${table.actualMinutes} >= 0`)
  ]
);

export const checklistItems = pgTable(
  'checklist_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 300 }).notNull(),
    completed: boolean('completed').notNull().default(false),
    position: integer('position').notNull().default(0)
  },
  (table) => [index('checklist_task_idx').on(table.taskId)]
);

export const taskDependencies = pgTable(
  'task_dependencies',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    dependsOnTaskId: uuid('depends_on_task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' })
  },
  (table) => [
    primaryKey({ columns: [table.taskId, table.dependsOnTaskId] }),
    check('task_not_own_dependency', sql`${table.taskId} <> ${table.dependsOnTaskId}`)
  ]
);

export const timetableEntries = pgTable(
  'timetable_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    title: varchar('title', { length: 240 }).notNull(),
    kind: timetableKind('kind').notNull(),
    location: varchar('location', { length: 240 }),
    timezone: varchar('timezone', { length: 80 }).notNull().default('UTC'),
    dayOfWeek: integer('day_of_week'),
    oneTimeDate: date('one_time_date'),
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    recurrenceRule: text('recurrence_rule'),
    isRecurring: boolean('is_recurring').notNull().default(true),
    locked: boolean('locked').notNull().default(false),
    approved: boolean('approved').notNull().default(true),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('timetable_user_day_idx').on(table.userId, table.dayOfWeek),
    index('timetable_user_date_idx').on(table.userId, table.oneTimeDate),
    check(
      'timetable_has_occurrence',
      sql`(${table.isRecurring} and ${table.dayOfWeek} between 0 and 6) or (not ${table.isRecurring} and ${table.oneTimeDate} is not null)`
    ),
    check('timetable_time_order', sql`${table.startTime} < ${table.endTime}`)
  ]
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    originalFilename: varchar('original_filename', { length: 500 }).notNull(),
    safeFilename: varchar('safe_filename', { length: 500 }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    pageCount: integer('page_count'),
    section: varchar('section', { length: 80 }),
    type: documentType('type').notNull().default('other'),
    documentDate: date('document_date'),
    title: varchar('title', { length: 300 }).notNull(),
    description: text('description'),
    tags: text('tags')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    notebookName: varchar('notebook_name', { length: 120 }),
    notebookNumber: integer('notebook_number'),
    notebookPageRange: varchar('notebook_page_range', { length: 60 }),
    ocrStatus: ocrStatus('ocr_status').notNull().default('not_requested'),
    ocrConfidence: real('ocr_confidence'),
    processingStatus: processingStatus('processing_status').notNull().default('uploaded'),
    processingError: text('processing_error'),
    extractedText: text('extracted_text'),
    correctedText: text('corrected_text'),
    aiGeneratedContent: jsonb('ai_generated_content').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('documents_user_hash_unique').on(table.userId, table.sha256),
    index('documents_user_created_idx').on(table.userId, table.createdAt),
    index('documents_module_idx').on(table.moduleId),
    check('documents_size_positive', sql`${table.byteSize} > 0`)
  ]
);

export const documentAssets = pgTable(
  'document_assets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: assetKind('kind').notNull(),
    storageKey: varchar('storage_key', { length: 700 }).notNull(),
    mimeType: varchar('mime_type', { length: 160 }).notNull(),
    byteSize: bigint('byte_size', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('document_assets_storage_key_unique').on(table.storageKey),
    index('document_assets_document_idx').on(table.documentId),
    index('document_assets_user_idx').on(table.userId),
    check('document_assets_size_positive', sql`${table.byteSize} > 0`)
  ]
);

export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    originalFilename: varchar('original_filename', { length: 500 }).notNull(),
    expectedBytes: bigint('expected_bytes', { mode: 'number' }).notNull(),
    receivedBytes: bigint('received_bytes', { mode: 'number' }).notNull().default(0),
    tempStorageKey: varchar('temp_storage_key', { length: 700 }).notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('upload_sessions_user_idx').on(table.userId),
    index('upload_sessions_expiry_idx').on(table.expiresAt),
    uniqueIndex('upload_sessions_temp_key_unique').on(table.tempStorageKey),
    check('upload_sessions_expected_positive', sql`${table.expectedBytes} > 0`),
    check(
      'upload_sessions_received_valid',
      sql`${table.receivedBytes} >= 0 and ${table.receivedBytes} <= ${table.expectedBytes}`
    )
  ]
);

export const practiceQuestions = pgTable(
  'practice_questions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    sourceDocumentId: uuid('source_document_id').references(() => documents.id, {
      onDelete: 'set null'
    }),
    mode: practiceMode('mode').notNull(),
    prompt: text('prompt').notNull(),
    answer: text('answer').notNull(),
    choices: jsonb('choices').$type<string[]>(),
    explanation: text('explanation'),
    difficulty: integer('difficulty').notNull().default(3),
    aiGenerated: boolean('ai_generated').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('practice_questions_user_idx').on(table.userId),
    check('practice_question_difficulty_range', sql`${table.difficulty} between 1 and 5`)
  ]
);

export const practiceAttempts = pgTable(
  'practice_attempts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => practiceQuestions.id, { onDelete: 'cascade' }),
    answer: text('answer'),
    result: attemptResult('result').notNull(),
    confidenceBefore: integer('confidence_before'),
    secondsTaken: integer('seconds_taken').notNull().default(0),
    hintsUsed: integer('hints_used').notNull().default(0),
    mistake: mistakeCategory('mistake'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('practice_attempts_user_created_idx').on(table.userId, table.createdAt),
    check(
      'practice_attempt_confidence_range',
      sql`${table.confidenceBefore} is null or ${table.confidenceBefore} between 1 and 5`
    )
  ]
);

export const revisionItems = pgTable(
  'revision_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    practiceQuestionId: uuid('practice_question_id').references(() => practiceQuestions.id, {
      onDelete: 'set null'
    }),
    title: varchar('title', { length: 300 }).notNull(),
    state: revisionState('state').notNull().default('upcoming'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    intervalStep: integer('interval_step').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('revision_user_due_idx').on(table.userId, table.dueAt),
    check('revision_interval_nonnegative', sql`${table.intervalStep} >= 0`)
  ]
);

export const revisionRecords = pgTable(
  'revision_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    revisionItemId: uuid('revision_item_id')
      .notNull()
      .references(() => revisionItems.id, { onDelete: 'cascade' }),
    confidence: integer('confidence').notNull(),
    result: attemptResult('result').notNull(),
    minutesSpent: integer('minutes_spent').notNull().default(0),
    notes: text('notes'),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('revision_records_user_idx').on(table.userId),
    check('revision_record_confidence_range', sql`${table.confidence} between 1 and 5`)
  ]
);

export const focusSessions = pgTable(
  'focus_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    plannedMinutes: integer('planned_minutes').notNull(),
    actualMinutes: integer('actual_minutes'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome: focusOutcome('outcome'),
    notes: text('notes')
  },
  (table) => [
    index('focus_sessions_user_idx').on(table.userId),
    check('focus_planned_positive', sql`${table.plannedMinutes} > 0`)
  ]
);

export const assessments = pgTable(
  'assessments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    moduleId: uuid('module_id')
      .notNull()
      .references(() => modules.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 240 }).notNull(),
    type: varchar('type', { length: 100 }).notNull(),
    maximumMark: numeric('maximum_mark', { precision: 8, scale: 2 }).notNull(),
    achievedMark: numeric('achieved_mark', { precision: 8, scale: 2 }),
    weight: numeric('weight', { precision: 6, scale: 3 }),
    assessmentDate: date('assessment_date').notNull(),
    targetMark: numeric('target_mark', { precision: 8, scale: 2 }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('assessments_user_date_idx').on(table.userId, table.assessmentDate),
    check('assessment_maximum_positive', sql`${table.maximumMark} > 0`),
    check(
      'assessment_mark_valid',
      sql`${table.achievedMark} is null or (${table.achievedMark} >= 0 and ${table.achievedMark} <= ${table.maximumMark})`
    ),
    check(
      'assessment_weight_valid',
      sql`${table.weight} is null or (${table.weight} >= 0 and ${table.weight} <= 100)`
    )
  ]
);

export const aiSettings = pgTable('ai_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 40 }).notNull().default('none'),
  baseUrl: varchar('base_url', { length: 500 }),
  model: varchar('model', { length: 200 }),
  encryptedApiKey: text('encrypted_api_key'),
  contextLimit: integer('context_limit').notNull().default(8192),
  timeoutMs: integer('timeout_ms').notNull().default(60000),
  maxGeneratedTokens: integer('max_generated_tokens').notNull().default(800),
  embeddingProvider: varchar('embedding_provider', { length: 200 }),
  documentAnalysisEnabled: boolean('document_analysis_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
});

export const ocrProviders = pgTable(
  'ocr_providers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 120 }).notNull(),
    baseUrl: varchar('base_url', { length: 500 }).notNull(),
    encryptedToken: text('encrypted_token'),
    capabilities: jsonb('capabilities').$type<string[]>().notNull().default([]),
    languages: jsonb('languages').$type<string[]>().notNull().default([]),
    enabled: boolean('enabled').notNull().default(false),
    timeoutMs: integer('timeout_ms').notNull().default(90000),
    maxImageBytes: integer('max_image_bytes').notNull().default(6291456),
    maxPixels: integer('max_pixels').notNull().default(16000000),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('ocr_providers_enabled_idx').on(table.enabled)]
);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKind('kind').notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    body: varchar('body', { length: 500 }),
    href: varchar('href', { length: 500 }),
    sourceKey: varchar('source_key', { length: 300 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    index('notifications_user_read_idx').on(table.userId, table.readAt),
    uniqueIndex('notifications_user_source_unique').on(table.userId, table.sourceKey)
  ]
);

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [
    uniqueIndex('push_endpoint_unique').on(table.endpoint),
    index('push_session_idx').on(table.sessionId)
  ]
);

export const documentShares = pgTable(
  'document_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sharedWithUserId: uuid('shared_with_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: sharingPermission('permission').notNull().default('read'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true })
  },
  (table) => [
    uniqueIndex('document_share_unique').on(table.documentId, table.sharedWithUserId),
    index('document_share_recipient_idx').on(table.sharedWithUserId),
    check('document_share_not_self', sql`${table.ownerId} <> ${table.sharedWithUserId}`)
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: varchar('action', { length: 120 }).notNull(),
    entityType: varchar('entity_type', { length: 80 }),
    entityId: uuid('entity_id'),
    ipAddress: varchar('ip_address', { length: 64 }),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow()
  },
  (table) => [index('audit_actor_created_idx').on(table.actorUserId, table.createdAt)]
);

export type User = typeof users.$inferSelect;
export type Module = typeof modules.$inferSelect;
export type Chapter = typeof chapters.$inferSelect;
export type StudyTask = typeof tasks.$inferSelect;
export type TimetableEntry = typeof timetableEntries.$inferSelect;
export type StudyDocument = typeof documents.$inferSelect;
export type PracticeQuestion = typeof practiceQuestions.$inferSelect;
export type RevisionItem = typeof revisionItems.$inferSelect;
