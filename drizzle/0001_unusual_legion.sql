CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"original_filename" varchar(500) NOT NULL,
	"expected_bytes" bigint NOT NULL,
	"received_bytes" bigint DEFAULT 0 NOT NULL,
	"temp_storage_key" varchar(700) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_sessions_expected_positive" CHECK ("upload_sessions"."expected_bytes" > 0),
	CONSTRAINT "upload_sessions_received_valid" CHECK ("upload_sessions"."received_bytes" >= 0 and "upload_sessions"."received_bytes" <= "upload_sessions"."expected_bytes")
);
--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "upload_sessions_user_idx" ON "upload_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "upload_sessions_expiry_idx" ON "upload_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "upload_sessions_temp_key_unique" ON "upload_sessions" USING btree ("temp_storage_key");