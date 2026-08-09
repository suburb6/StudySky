DELETE FROM "push_subscriptions";--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD COLUMN "session_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_session_idx" ON "push_subscriptions" USING btree ("session_id");
