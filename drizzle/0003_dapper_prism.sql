ALTER TABLE "modules" ADD COLUMN "credit_units" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "modules" ADD COLUMN "grade_weight" numeric(8, 3) DEFAULT '1' NOT NULL;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_credit_units_positive" CHECK ("modules"."credit_units" is null or "modules"."credit_units" > 0);--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_grade_weight_positive" CHECK ("modules"."grade_weight" > 0);