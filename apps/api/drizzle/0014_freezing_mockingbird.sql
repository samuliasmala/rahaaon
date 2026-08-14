ALTER TABLE "url_submission" ADD COLUMN "url_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "waste_item" ADD COLUMN "url_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX "url_submission_url_key_idx" ON "url_submission" USING btree ("url_key");--> statement-breakpoint
CREATE INDEX "waste_item_url_key_idx" ON "waste_item" USING btree ("url_key");