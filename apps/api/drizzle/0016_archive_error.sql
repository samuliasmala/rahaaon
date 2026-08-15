CREATE TYPE "public"."archive_error" AS ENUM('page', 'storage');--> statement-breakpoint
ALTER TABLE "url_submission" ADD COLUMN "archive_error" "archive_error";