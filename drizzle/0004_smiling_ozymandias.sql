CREATE TABLE "chapter_board_columns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"chapter_id" uuid NOT NULL,
	"name" varchar(80) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "board_column_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "board_position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "chapter_board_columns" ADD CONSTRAINT "chapter_board_columns_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chapter_board_columns" ADD CONSTRAINT "chapter_board_columns_chapter_id_chapters_id_fk" FOREIGN KEY ("chapter_id") REFERENCES "public"."chapters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chapter_board_columns_user_idx" ON "chapter_board_columns" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "chapter_board_columns_chapter_position_idx" ON "chapter_board_columns" USING btree ("chapter_id","position");--> statement-breakpoint
INSERT INTO "chapter_board_columns" ("user_id", "chapter_id", "name", "position", "is_done")
SELECT "chapters"."user_id", "chapters"."id", defaults."name", defaults."position", defaults."is_done"
FROM "chapters"
CROSS JOIN (
	VALUES
		('To do', 0, false),
		('In progress', 1, false),
		('Done', 2, true)
) AS defaults("name", "position", "is_done");--> statement-breakpoint
UPDATE "tasks"
SET "board_column_id" = "chapter_board_columns"."id"
FROM "chapter_board_columns"
WHERE "tasks"."chapter_id" = "chapter_board_columns"."chapter_id"
	AND "chapter_board_columns"."position" = CASE
		WHEN "tasks"."status" IN ('done', 'skipped') THEN 2
		WHEN "tasks"."status" = 'doing' THEN 1
		ELSE 0
	END;--> statement-breakpoint
WITH ranked AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "board_column_id"
			ORDER BY "created_at", "id"
		) - 1 AS "position"
	FROM "tasks"
	WHERE "board_column_id" IS NOT NULL
)
UPDATE "tasks"
SET "board_position" = ranked."position"
FROM ranked
WHERE "tasks"."id" = ranked."id";--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_board_column_id_chapter_board_columns_id_fk" FOREIGN KEY ("board_column_id") REFERENCES "public"."chapter_board_columns"("id") ON DELETE set null ON UPDATE no action;
