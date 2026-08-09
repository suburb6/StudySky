ALTER TABLE "notifications" ADD COLUMN "source_key" varchar(300);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "grading_preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_user_source_unique" ON "notifications" USING btree ("user_id","source_key");