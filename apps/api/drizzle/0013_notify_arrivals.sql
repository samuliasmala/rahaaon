ALTER TABLE "url_submission" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
UPDATE "url_submission" SET "notified_at" = "created_at";--> statement-breakpoint
CREATE INDEX "url_submission_notify_claim_idx" ON "url_submission" USING btree ("created_at") WHERE "url_submission"."notified_at" is null;
