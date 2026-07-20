import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Story categories — must stay in sync with the admin category select. */
export const CATEGORIES = [
  "Rakentaminen",
  "IT-hankkeet",
  "Konsultit",
  "Kulttuuri",
  "Viestintä",
  "Matkustus",
  "Muu",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const categoryEnum = pgEnum("category", CATEGORIES);

export const suggestionStatusEnum = pgEnum("suggestion_status", [
  "pending",
  "approved",
  "rejected",
]);

export const urlSubmissionStatusEnum = pgEnum("url_submission_status", [
  "new",
  "processed",
  "rejected",
]);

/**
 * Outcome of the submit-time page archive (raw text to S3). NULL when
 * archiving was never attempted (S3 not configured / pre-feature rows).
 */
export const archiveStatusEnum = pgEnum("archive_status", ["pending", "ok", "paywalled", "failed"]);

/** A published waste-of-money story on the public feed. */
export const wasteItem = pgTable("waste_item", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  /** Whole euros. */
  amountEur: integer("amount_eur").notNull(),
  /** Who spent the money: a municipality or a national body ("Valtio", "ELY-keskus"…). */
  entity: text("entity").notNull(),
  category: categoryEnum("category").notNull(),
  /** Publication the story came from, e.g. "Helsingin Sanomat". */
  sourceName: text("source_name").notNull(),
  /** Link to the original article. */
  sourceUrl: text("source_url").notNull(),
  summary: text("summary").notNull(),
  quote: text("quote").notNull().default(""),
  /** Hidden items stay in the admin list but are removed from the feed and the total. */
  hidden: boolean("hidden").notNull().default(false),
  /** When the item went live on the feed (approval time). */
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  /** The source article's own publication date (AI-extracted); null when unknown. */
  articlePublishedAt: date("article_published_at", { mode: "string" }),
});

/** An AI-preprocessed reader suggestion; the editorial queue is `status = 'pending'`. */
export const suggestion = pgTable("suggestion", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  amountEur: integer("amount_eur").notNull(),
  entity: text("entity").notNull(),
  category: categoryEnum("category").notNull(),
  sourceName: text("source_name").notNull(),
  summary: text("summary").notNull(),
  /** The source article's own publication date (AI-extracted); null when unknown. */
  articlePublishedAt: date("article_published_at", { mode: "string" }),
  /** The AI's caveats for the editor ("summa mainitaan vain otsikossa…"). */
  aiNote: text("ai_note").notNull().default(""),
  /** AI extraction confidence, 0–100. */
  confidence: integer("confidence").notNull(),
  status: suggestionStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  /** Set when approved — the feed item this suggestion became. */
  publishedItemId: uuid("published_item_id").references(() => wasteItem.id, {
    onDelete: "set null",
  }),
});

/**
 * A raw reader-submitted link (the public "Ehdota kohde" flow). Lands here as
 * `status = 'new'`; an editor either sends it onward to the AI queue
 * ("process", which creates a {@link suggestion} row) or rejects it into the
 * archive — from where it can be restored back to `new`.
 */
export const urlSubmission = pgTable(
  "url_submission",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    url: text("url").notNull(),
    /** Page metadata captured at submit time (the preview the reader confirmed). */
    title: text("title").notNull().default(""),
    description: text("description").notNull().default(""),
    siteName: text("site_name").notNull().default(""),
    status: urlSubmissionStatusEnum("status").notNull().default("new"),
    /**
     * Submit-time page archive: a background worker (lib/article-archive.ts)
     * claims `pending` rows, fetches the text and stores it to S3. `paywalled` =
     * fetched but suspiciously little text. The S3 key is set whenever any text
     * was saved — also for paywalled pages, so the editor can see what little
     * there was. Null status = archiving was never attempted (S3 not configured).
     */
    archiveStatus: archiveStatusEnum("archive_status"),
    archiveTextKey: text("archive_text_key"),
    /** How many times the archive worker has claimed this row (retry budget). */
    archiveAttempts: integer("archive_attempts").notNull().default(0),
    /**
     * Earliest time the worker may (re)attempt archiving — set to a backoff in the
     * future after a failure, and to a short lease when a worker claims the row so
     * a concurrent/duplicate worker skips it. Null means "claimable now". Only
     * meaningful while `archive_status = 'pending'`.
     */
    archiveNextAttemptAt: timestamp("archive_next_attempt_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** When the entry left the queue — set on process AND reject, cleared on restore. */
    processedAt: timestamp("processed_at", { withTimezone: true }),
    /** Set when processed — the AI-queue entry this submission became. */
    suggestionId: uuid("suggestion_id").references(() => suggestion.id, {
      onDelete: "set null",
    }),
  },
  (t) => [
    // Backs the archive worker's claim query, which the poll runs on an interval
    // forever. Partial (only 'pending' rows are ever claimed, and terminal rows
    // dominate the table), so the index stays small.
    index("url_submission_archive_claim_idx")
      .on(t.archiveNextAttemptAt)
      .where(sql`${t.archiveStatus} = 'pending'`),
  ],
);

/**
 * One "this is a waste" vote per anonymous visitor per item. The visitor id
 * comes from a long-lived cookie; voting again deletes the row (toggle).
 */
export const itemVote = pgTable(
  "item_vote",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => wasteItem.id, { onDelete: "cascade" }),
    voterId: text("voter_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.voterId] })],
);
