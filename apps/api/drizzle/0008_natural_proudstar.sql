ALTER TYPE "public"."url_submission_status" ADD VALUE 'processing';--> statement-breakpoint
ALTER TABLE "url_submission" ADD COLUMN "process_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "url_submission" ADD COLUMN "process_next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "url_submission" ADD COLUMN "process_error" text;--> statement-breakpoint
CREATE INDEX "url_submission_process_claim_idx" ON "url_submission" USING btree ("status","process_next_attempt_at");