CREATE TYPE "public"."url_submission_status" AS ENUM('new', 'processed');--> statement-breakpoint
CREATE TABLE "url_submission" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"url" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"site_name" text DEFAULT '' NOT NULL,
	"status" "url_submission_status" DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"suggestion_id" uuid
);
--> statement-breakpoint
ALTER TABLE "url_submission" ADD CONSTRAINT "url_submission_suggestion_id_suggestion_id_fk" FOREIGN KEY ("suggestion_id") REFERENCES "public"."suggestion"("id") ON DELETE set null ON UPDATE no action;