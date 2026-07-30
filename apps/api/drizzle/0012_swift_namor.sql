ALTER TABLE "suggestion" ADD COLUMN "article_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "waste_item" ADD COLUMN "article_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "suggestion" s SET "article_title" = left(us."title", 300) FROM "url_submission" us WHERE us."suggestion_id" = s."id" AND us."title" <> '';--> statement-breakpoint
UPDATE "waste_item" w SET "article_title" = s."article_title" FROM "suggestion" s WHERE s."published_item_id" = w."id" AND s."article_title" <> '';
