CREATE TYPE "public"."asset_kind" AS ENUM('original', 'processed', 'thumbnail', 'generated');--> statement-breakpoint
CREATE TYPE "public"."attempt_result" AS ENUM('correct', 'incorrect', 'partially_correct', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."chapter_status" AS ENUM('not_started', 'introduced', 'learning', 'practising', 'revision_needed', 'confident');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('lecturer_notes', 'my_notes', 'worked_exercises', 'assignment', 'tutorial_sheet', 'past_paper', 'test', 'examination', 'formula_sheet', 'module_catalogue', 'reference', 'other');--> statement-breakpoint
CREATE TYPE "public"."focus_outcome" AS ENUM('completed', 'partly_completed', 'still_confused', 'needs_more_practice', 'interrupted');--> statement-breakpoint
CREATE TYPE "public"."mistake_category" AS ENUM('concept_not_understood', 'formula_forgotten', 'calculation_error', 'misread_question', 'logic_error', 'algorithm_error', 'syntax_error', 'insufficient_practice', 'careless_mistake', 'other');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('class_upcoming', 'study_session', 'assignment_deadline', 'revision_due', 'task_overdue', 'scan_unprocessed', 'weekly_planning', 'system');--> statement-breakpoint
CREATE TYPE "public"."ocr_status" AS ENUM('not_requested', 'queued', 'processing', 'complete', 'failed', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."practice_mode" AS ENUM('multiple_choice', 'short_answer', 'explanation', 'coding', 'sql', 'algorithm_tracing', 'numerical_computation', 'physics_calculation', 'formula_recall', 'mixed_topic', 'timed_mock');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('uploaded', 'queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."revision_state" AS ENUM('due', 'upcoming', 'completed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."sharing_permission" AS ENUM('read', 'collaborate');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('inbox', 'this_week', 'doing', 'waiting', 'done', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('lecture_review', 'reading', 'notes_review', 'exercise', 'assignment', 'project', 'coding_work', 'practice_test', 'revision', 'physics_preparation', 'question_for_lecturer', 'administrative_work', 'other');--> statement-breakpoint
CREATE TYPE "public"."timetable_kind" AS ENUM('class', 'study', 'work', 'travel', 'sleep', 'meal', 'religious', 'family', 'appointment', 'rest', 'examination', 'university_event', 'other');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TABLE "ai_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" varchar(40) DEFAULT 'none' NOT NULL,
	"base_url" varchar(500),
	"model" varchar(200),
	"encrypted_api_key" text,
	"context_limit" integer DEFAULT 8192 NOT NULL,
	"timeout_ms" integer DEFAULT 60000 NOT NULL,
	"max_generated_tokens" integer DEFAULT 800 NOT NULL,
	"embedding_provider" varchar(200),
	"document_analysis_enabled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"name" varchar(240) NOT NULL,
	"type" varchar(100) NOT NULL,
	"maximum_mark" numeric(8, 2) NOT NULL,
	"achieved_mark" numeric(8, 2),
	"weight" numeric(6, 3),
	"assessment_date" date NOT NULL,
	"target_mark" numeric(8, 2),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assessment_maximum_positive" CHECK ("assessments"."maximum_mark" > 0),
	CONSTRAINT "assessment_mark_valid" CHECK ("assessments"."achieved_mark" is null or ("assessments"."achieved_mark" >= 0 and "assessments"."achieved_mark" <= "assessments"."maximum_mark")),
	CONSTRAINT "assessment_weight_valid" CHECK ("assessments"."weight" is null or ("assessments"."weight" >= 0 and "assessments"."weight" <= 100))
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"target_user_id" uuid,
	"action" varchar(120) NOT NULL,
	"entity_type" varchar(80),
	"entity_id" uuid,
	"ip_address" varchar(64),
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chapter_prerequisites" (
	"chapter_id" uuid NOT NULL,
	"prerequisite_id" uuid NOT NULL,
	CONSTRAINT "chapter_prerequisites_chapter_id_prerequisite_id_pk" PRIMARY KEY("chapter_id","prerequisite_id"),
	CONSTRAINT "chapter_not_own_prerequisite" CHECK ("chapter_prerequisites"."chapter_id" <> "chapter_prerequisites"."prerequisite_id")
);
--> statement-breakpoint
CREATE TABLE "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"status" "chapter_status" DEFAULT 'not_started' NOT NULL,
	"confidence" integer DEFAULT 1 NOT NULL,
	"important_formulas" text,
	"annotations" text,
	"lecturer_questions" text,
	"last_studied_at" timestamp with time zone,
	"next_revision_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chapters_confidence_range" CHECK ("chapters"."confidence" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"title" varchar(300) NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "asset_kind" NOT NULL,
	"storage_key" varchar(700) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"byte_size" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_assets_size_positive" CHECK ("document_assets"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "document_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"shared_with_user_id" uuid NOT NULL,
	"permission" "sharing_permission" DEFAULT 'read' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "document_share_not_self" CHECK ("document_shares"."owner_id" <> "document_shares"."shared_with_user_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_id" uuid,
	"chapter_id" uuid,
	"original_filename" varchar(500) NOT NULL,
	"safe_filename" varchar(500) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"mime_type" varchar(160) NOT NULL,
	"byte_size" bigint NOT NULL,
	"page_count" integer,
	"section" varchar(80),
	"type" "document_type" DEFAULT 'other' NOT NULL,
	"document_date" date,
	"title" varchar(300) NOT NULL,
	"description" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"notebook_name" varchar(120),
	"notebook_number" integer,
	"notebook_page_range" varchar(60),
	"ocr_status" "ocr_status" DEFAULT 'not_requested' NOT NULL,
	"ocr_confidence" real,
	"processing_status" "processing_status" DEFAULT 'uploaded' NOT NULL,
	"processing_error" text,
	"extracted_text" text,
	"corrected_text" text,
	"ai_generated_content" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "documents_size_positive" CHECK ("documents"."byte_size" > 0)
);
--> statement-breakpoint
CREATE TABLE "focus_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"planned_minutes" integer NOT NULL,
	"actual_minutes" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" "focus_outcome",
	"notes" text,
	CONSTRAINT "focus_planned_positive" CHECK ("focus_sessions"."planned_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"key" varchar(180) PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"blocked_until" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(180) NOT NULL,
	"lecturer_name" varchar(180),
	"lecturer_email" varchar(320),
	"description" text,
	"color" varchar(16) DEFAULT '#787774' NOT NULL,
	"notebook_name" varchar(120),
	"notebook_number" integer,
	"is_current" boolean DEFAULT true NOT NULL,
	"scheduling_weight" real DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" varchar(240) NOT NULL,
	"body" varchar(500),
	"href" varchar(500),
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer" text,
	"result" "attempt_result" NOT NULL,
	"confidence_before" integer,
	"seconds_taken" integer DEFAULT 0 NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"mistake" "mistake_category",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_attempt_confidence_range" CHECK ("practice_attempts"."confidence_before" is null or "practice_attempts"."confidence_before" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "practice_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_id" uuid,
	"chapter_id" uuid,
	"source_document_id" uuid,
	"mode" "practice_mode" NOT NULL,
	"prompt" text NOT NULL,
	"answer" text NOT NULL,
	"choices" jsonb,
	"explanation" text,
	"difficulty" integer DEFAULT 3 NOT NULL,
	"ai_generated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_question_difficulty_range" CHECK ("practice_questions"."difficulty" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revision_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_id" uuid,
	"chapter_id" uuid,
	"document_id" uuid,
	"practice_question_id" uuid,
	"title" varchar(300) NOT NULL,
	"state" "revision_state" DEFAULT 'upcoming' NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"interval_step" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_interval_nonnegative" CHECK ("revision_items"."interval_step" >= 0)
);
--> statement-breakpoint
CREATE TABLE "revision_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"revision_item_id" uuid NOT NULL,
	"confidence" integer NOT NULL,
	"result" "attempt_result" NOT NULL,
	"minutes_spent" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revision_record_confidence_range" CHECK ("revision_records"."confidence" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_agent" varchar(500),
	"ip_address" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id"),
	CONSTRAINT "task_not_own_dependency" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_id" uuid,
	"chapter_id" uuid,
	"source_document_id" uuid,
	"client_id" varchar(100),
	"section" varchar(80),
	"title" varchar(300) NOT NULL,
	"description" text,
	"type" "task_type" DEFAULT 'other' NOT NULL,
	"status" "task_status" DEFAULT 'inbox' NOT NULL,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"difficulty" integer DEFAULT 3 NOT NULL,
	"deadline" timestamp with time zone,
	"estimated_minutes" integer DEFAULT 30 NOT NULL,
	"actual_minutes" integer DEFAULT 0 NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"recurrence_rule" text,
	"next_revision_at" timestamp with time zone,
	"notes" text,
	"schedule_reason" text,
	"schedule_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_difficulty_range" CHECK ("tasks"."difficulty" between 1 and 5),
	CONSTRAINT "tasks_duration_positive" CHECK ("tasks"."estimated_minutes" > 0),
	CONSTRAINT "tasks_actual_nonnegative" CHECK ("tasks"."actual_minutes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "timetable_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"module_id" uuid,
	"task_id" uuid,
	"title" varchar(240) NOT NULL,
	"kind" timetable_kind NOT NULL,
	"location" varchar(240),
	"timezone" varchar(80) DEFAULT 'Indian/Mauritius' NOT NULL,
	"day_of_week" integer,
	"one_time_date" date,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"recurrence_rule" text,
	"is_recurring" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"approved" boolean DEFAULT true NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timetable_has_occurrence" CHECK (("timetable_entries"."is_recurring" and "timetable_entries"."day_of_week" between 0 and 6) or (not "timetable_entries"."is_recurring" and "timetable_entries"."one_time_date" is not null)),
	CONSTRAINT "timetable_time_order" CHECK ("timetable_entries"."start_time" < "timetable_entries"."end_time")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(320) NOT NULL,
	"password_hash" text NOT NULL,
	"name" varchar(120) NOT NULL,
	"role" "user_role" DEFAULT 'member' NOT NULL,
	"timezone" varchar(80) DEFAULT 'Indian/Mauritius' NOT NULL,
	"storage_quota_bytes" bigint DEFAULT 10737418240 NOT NULL,
	"storage_used_bytes" bigint DEFAULT 0 NOT NULL,
	"onboarding_completed" boolean DEFAULT false NOT NULL,
	"sleep_start" time DEFAULT '23:00' NOT NULL,
	"sleep_end" time DEFAULT '07:00' NOT NULL,
	"travel_minutes" integer DEFAULT 30 NOT NULL,
	"preparation_minutes" integer DEFAULT 15 NOT NULL,
	"preferred_session_minutes" integer DEFAULT 45 NOT NULL,
	"max_weekday_study_minutes" integer DEFAULT 180 NOT NULL,
	"max_weekend_study_minutes" integer DEFAULT 240 NOT NULL,
	"preferred_rest_day" integer DEFAULT 0 NOT NULL,
	"evening_study" boolean DEFAULT true NOT NULL,
	"automatic_reschedule" boolean DEFAULT false NOT NULL,
	"reminder_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_quota_positive" CHECK ("users"."storage_quota_bytes" > 0),
	CONSTRAINT "users_storage_nonnegative" CHECK ("users"."storage_used_bytes" >= 0),
	CONSTRAINT "users_rest_day_valid" CHECK ("users"."preferred_rest_day" between 0 and 6)
);
--> statement-breakpoint
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessments" ADD CONSTRAINT "assessments_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_prerequisites" ADD CONSTRAINT "chapter_prerequisites_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_prerequisites" ADD CONSTRAINT "chapter_prerequisites_prerequisite_id_chapters_id_fk" FOREIGN KEY ("prerequisite_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapters" ADD CONSTRAINT "chapters_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_assets" ADD CONSTRAINT "document_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_shares" ADD CONSTRAINT "document_shares_shared_with_user_id_users_id_fk" FOREIGN KEY ("shared_with_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_attempts" ADD CONSTRAINT "practice_attempts_question_id_practice_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."practice_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_questions" ADD CONSTRAINT "practice_questions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_questions" ADD CONSTRAINT "practice_questions_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_questions" ADD CONSTRAINT "practice_questions_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_questions" ADD CONSTRAINT "practice_questions_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_items" ADD CONSTRAINT "revision_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_items" ADD CONSTRAINT "revision_items_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_items" ADD CONSTRAINT "revision_items_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_items" ADD CONSTRAINT "revision_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_items" ADD CONSTRAINT "revision_items_practice_question_id_practice_questions_id_fk" FOREIGN KEY ("practice_question_id") REFERENCES "public"."practice_questions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_records" ADD CONSTRAINT "revision_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revision_records" ADD CONSTRAINT "revision_records_revision_item_id_revision_items_id_fk" FOREIGN KEY ("revision_item_id") REFERENCES "public"."revision_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_entries" ADD CONSTRAINT "timetable_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assessments_user_date_idx" ON "assessments" USING btree ("user_id","assessment_date");--> statement-breakpoint
CREATE INDEX "audit_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "chapters_user_idx" ON "chapters" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chapters_module_position_idx" ON "chapters" USING btree ("module_id","position");--> statement-breakpoint
CREATE INDEX "checklist_task_idx" ON "checklist_items" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_assets_storage_key_unique" ON "document_assets" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "document_assets_document_idx" ON "document_assets" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "document_assets_user_idx" ON "document_assets" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_share_unique" ON "document_shares" USING btree ("document_id","shared_with_user_id");--> statement-breakpoint
CREATE INDEX "document_share_recipient_idx" ON "document_shares" USING btree ("shared_with_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_user_hash_unique" ON "documents" USING btree ("user_id","sha256");--> statement-breakpoint
CREATE INDEX "documents_user_created_idx" ON "documents" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_module_idx" ON "documents" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "focus_sessions_user_idx" ON "focus_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "modules_user_code_unique" ON "modules" USING btree ("user_id","code");--> statement-breakpoint
CREATE INDEX "modules_user_idx" ON "modules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_user_read_idx" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "practice_attempts_user_created_idx" ON "practice_attempts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "practice_questions_user_idx" ON "practice_questions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_unique" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "revision_user_due_idx" ON "revision_items" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "revision_records_user_idx" ON "revision_records" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_user_deadline_idx" ON "tasks" USING btree ("user_id","deadline");--> statement-breakpoint
CREATE INDEX "tasks_module_idx" ON "tasks" USING btree ("module_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_user_client_id_unique" ON "tasks" USING btree ("user_id","client_id");--> statement-breakpoint
CREATE INDEX "timetable_user_day_idx" ON "timetable_entries" USING btree ("user_id","day_of_week");--> statement-breakpoint
CREATE INDEX "timetable_user_date_idx" ON "timetable_entries" USING btree ("user_id","one_time_date");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "documents_fts_idx" ON "documents" USING gin (
  to_tsvector(
    'english',
    coalesce("title", '') || ' ' ||
    coalesce("description", '') || ' ' ||
    coalesce("extracted_text", '') || ' ' ||
    coalesce("corrected_text", '')
  )
);--> statement-breakpoint
CREATE INDEX "tasks_fts_idx" ON "tasks" USING gin (
  to_tsvector(
    'english',
    coalesce("title", '') || ' ' ||
    coalesce("description", '') || ' ' ||
    coalesce("notes", '')
  )
);
