ALTER TABLE "suggestion" ADD COLUMN "quote" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Until now approval stamped every item with the placeholder "Lähde: <source>."
-- (the feed already shows the source separately); clear it so those items stop
-- rendering a redundant pseudo-quote. Hand-written quotes don't match and survive.
UPDATE "waste_item" SET "quote" = '' WHERE "quote" = 'Lähde: ' || "source_name" || '.';
