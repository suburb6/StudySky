CREATE TABLE "ocr_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(120) NOT NULL,
	"base_url" varchar(500) NOT NULL,
	"encrypted_token" text,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer DEFAULT 90000 NOT NULL,
	"max_image_bytes" integer DEFAULT 6291456 NOT NULL,
	"max_pixels" integer DEFAULT 16000000 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ocr_providers" ADD CONSTRAINT "ocr_providers_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ocr_providers_enabled_idx" ON "ocr_providers" USING btree ("enabled");