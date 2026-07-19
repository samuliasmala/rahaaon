CREATE TYPE "public"."archive_status" AS ENUM('pending', 'ok', 'paywalled', 'failed');--> statement-breakpoint
ALTER TABLE "url_submission" ADD COLUMN "archive_status" "archive_status";--> statement-breakpoint
ALTER TABLE "url_submission" ADD COLUMN "archive_text_key" text;