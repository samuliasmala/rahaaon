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

/** A published waste-of-money story on the public feed. */
export interface WasteItem {
  id: number;
  title: string;
  /** Whole euros. */
  amount: number;
  /** Who spent the money: a municipality or a national body ("Valtio", "ELY-keskus"…). */
  entity: string;
  category: Category;
  /** Publication the story came from, e.g. "Helsingin Sanomat". */
  source: string;
  /** Link to the original article. */
  url: string;
  /** Age in days — the prototype's stand-in for a published date. */
  days: number;
  votes: number;
  /** Hidden items stay in the admin list but are removed from the feed and the total. */
  hidden: boolean;
  summary: string;
  quote: string;
}

/** An AI-preprocessed reader suggestion waiting for editorial review. */
export interface QueueItem {
  id: number;
  title: string;
  /** Kept as the raw string — the editor edits it as free text before publishing. */
  amount: string;
  entity: string;
  category: Category;
  sourceName: string;
  url: string;
  /** AI extraction confidence, 0–100. */
  confidence: number;
  /** When the suggestion arrived, e.g. "2 h sitten". */
  received: string;
  summary: string;
  aiNote: string;
}
