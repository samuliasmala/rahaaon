ALTER TABLE "suggestion" ADD COLUMN "keywords" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "waste_item" ADD COLUMN "keywords" text[] DEFAULT '{}'::text[] NOT NULL;