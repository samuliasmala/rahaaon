CREATE TYPE "public"."amount_type" AS ENUM('exact', 'approx', 'min', 'unknown');--> statement-breakpoint
ALTER TABLE "suggestion" ADD COLUMN "amount_type" "amount_type" DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "suggestion" ADD COLUMN "amount_max_eur" integer;--> statement-breakpoint
ALTER TABLE "waste_item" ADD COLUMN "amount_type" "amount_type" DEFAULT 'exact' NOT NULL;--> statement-breakpoint
ALTER TABLE "waste_item" ADD COLUMN "amount_max_eur" integer;