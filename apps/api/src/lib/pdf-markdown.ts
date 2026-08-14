import { getDocumentProxy, getMeta } from "unpdf";
import { logger } from "./logger.js";

/**
 * PDF → Markdown for the page archive. Readers link public-sector PDFs
 * (lausunnot, pöytäkirjat, tilinpäätökset) as often as news articles, and the
 * bytes are useless to everything downstream — the LLM extraction, the
 * editor's viewer, the paywall classification all want text.
 *
 * pdf.js hands out positioned glyph runs, not paragraphs: a PDF has no notion
 * of a heading or a paragraph, only ink at coordinates. So the structure is
 * reconstructed from geometry — lines from shared baselines, paragraphs from
 * line spacing and where a line stops relative to the text margin, headings
 * from font size and font changes (a bold section title is the same 11pt as
 * the body, but a different font resource). Fidelity degrades gracefully:
 * anything the heuristics don't recognise still comes out as a text block, and
 * a PDF with no text layer at all (a scan) comes out empty, which the archive
 * classifies the same way it classifies a walled page — little text, ask the
 * editor to paste it.
 *
 * Every axis is bounded, because the submitted URL is attacker-chosen and
 * pdf.js is pure JS sharing this server's single event loop: bytes at the fetch
 * site (see MAX_PDF_BYTES in lib/page-preview.ts), pages and wall clock here,
 * and parses run one at a time process-wide ({@link serialize}) so a flood of
 * submissions can't multiply the peak — the API container has 512 MB and a
 * 13 MB PDF costs ~70 MB to walk.
 */

/** Pages past this are dropped: enough for any article-length document. */
const MAX_PAGES = 40;
/** Wall-clock budget for one document; a slower PDF keeps the pages it got. */
const PARSE_BUDGET_MS = 10_000;
/** Parses waiting for the lock beyond this are refused rather than queued. */
const MAX_PENDING_PARSES = 4;
/** Fraction of page height at top and bottom where running heads/feet live. */
const MARGIN_BAND = 0.18;
/** A block longer than this is body text, whatever its font says. */
const MAX_HEADING_CHARS = 120;
/** Font size (relative to body) from which a line reads as a heading / title. */
const HEADING_SIZE_RATIO = 1.08;
const TITLE_SIZE_RATIO = 1.25;
/** Bullet glyphs Word and InDesign emit; rewritten to Markdown list markers. */
const BULLET = /^[•▪◦·‣∙]\s*/u;
/** A dash-led line starts a list item — kept verbatim (`- x` is already Markdown). */
const DASH_LEAD = /^[-–—]\s+/u;
/**
 * A lowercase run of three or more letters before a line-ending hyphen: the
 * shape of justified hyphenation, which InDesign-set publications are full of
 * ("eko-\nlogista"). Joining those back matters — a split word is lost to the
 * LLM extraction and to keyword search alike. Shorter and all-caps stems are
 * left alone: they are abbreviations carrying a hyphen of their own.
 */
const SOFT_HYPHEN = /(\p{Ll}{3,})-$/u;
/**
 * Finnish elides the shared half of a compound before a conjunction ("liikunta-
 * ja kulttuuritilat"), where the hyphen is the text's own, not a line break.
 */
const ELIDING = /^(?:ja|tai|sekä|eli|että|vai)\b/i;

export interface PdfExtract {
  /** The document's own title: PDF metadata, else its first heading, else "". */
  title: string;
  /** The PDF's Subject metadata (often an abstract), collapsed to one line; "" when absent. */
  subject: string;
  /** The document text as Markdown; "" when the PDF has no text layer. */
  markdown: string;
}

/** One glyph run's worth of geometry, accumulated into a visual line. */
interface Line {
  text: string;
  /** Right edge of the last run — how far the line reaches toward the margin. */
  right: number;
  /** Baseline in PDF user space (origin bottom-left, so larger is higher). */
  y: number;
  /** Largest font size on the line. */
  size: number;
  /** pdf.js font resource of the line's longest run — proxy for bold/italic. */
  font: string;
  /** Length of that longest run, so a later run can take the slot. */
  fontLen: number;
}

interface Page {
  height: number;
  lines: Line[];
}

interface Block {
  text: string;
  size: number;
  font: string;
  bullet: boolean;
}

/**
 * A pdf.js text item: one run of glyphs with the transform that placed it.
 * Declared here rather than imported — pdf.js's own types reach this package
 * only through unpdf's bundled copy, which is not a public entry point.
 */
interface GlyphRun {
  str: string;
  /** Advance width in text space. */
  width: number;
  /** Font height, the fallback when the transform carries no scale. */
  height: number;
  /** [scaleX, skewY, skewX, scaleY, x, y] in PDF user space. */
  transform: number[];
  /** Page-local font resource name, e.g. "g_d0_f2". */
  fontName: string;
  /** Whether pdf.js saw a line break after this run. */
  hasEOL: boolean;
}

const isGlyphRun = (item: unknown): item is GlyphRun =>
  typeof (item as GlyphRun | undefined)?.str === "string";

/**
 * Run PDF parses one at a time, process-wide. pdf.js does its work on the event
 * loop, so concurrent parses would both stall request handling and multiply
 * peak memory — and the archive worker claims up to four rows per cycle.
 * Waiters past {@link MAX_PENDING_PARSES} are refused: the archive retries with
 * backoff and a preview degrades to the bare URL, both better than an unbounded
 * queue behind an anonymous endpoint.
 */
let tail: Promise<void> = Promise.resolve();
let pending = 0;

function serialize<T>(work: () => Promise<T>): Promise<T> {
  if (pending >= MAX_PENDING_PARSES) return Promise.reject(new Error("pdf parse queue full"));
  pending++;
  const run = tail.then(work);
  // The chain must never carry a rejection forward, or one bad PDF would fail
  // every parse behind it.
  tail = run.then(
    () => undefined,
    () => undefined,
  );
  return run.finally(() => {
    pending--;
  });
}

/**
 * Group glyph runs into visual lines. pdf.js emits runs in content-stream
 * order, which for text documents is reading order, and flags the run that ends
 * a line (`hasEOL`) — but justified text arrives word by word and footnote
 * markers arrive as raised runs, so the baseline decides and the flag only
 * confirms. A run smaller than the line it lands in is treated as
 * super/subscript and kept on that line: otherwise every footnote reference
 * would split its paragraph in three.
 */
function linesFrom(items: readonly unknown[]): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  for (const run of items) {
    // The item stream also carries marked-content markers, which have no text.
    if (!isGlyphRun(run)) continue;
    const x = run.transform[4]!;
    const y = run.transform[5]!;
    const size = Math.abs(run.transform[3]!) || run.height || 1;
    if (run.str === "") {
      // Zero-width run: pdf.js uses it to mark a line break before the text.
      if (run.hasEOL) current = null;
      continue;
    }
    if (current) {
      const raised = size < 0.9 * current.size ? 0.6 * current.size : Math.max(1, 0.5 * size);
      if (Math.abs(current.y - y) > raised) current = null;
    }
    if (!current) {
      current = { text: "", right: x, y, size: 0, font: "", fontLen: 0 };
      lines.push(current);
    }
    // Justified text stretches the gaps between words instead of emitting
    // spaces, so a gap wider than a hair is a word boundary.
    if (current.text && x - current.right > 0.2 * size) current.text += " ";
    current.text += run.str;
    current.right = Math.max(current.right, x + (run.width || 0));
    current.size = Math.max(current.size, size);
    const runLength = run.str.trim().length;
    if (runLength > current.fontLen) {
      current.font = run.fontName;
      current.fontLen = runLength;
    }
    if (run.hasEOL) current = null;
  }
  for (const line of lines) line.text = line.text.replace(/\s+/g, " ").trim();
  return lines.filter((line) => line.text);
}

/** Length-weighted most common value of `pick` — the document's body value. */
function dominant<T>(pages: Page[], pick: (line: Line) => T): T | undefined {
  const weights = new Map<T, number>();
  for (const page of pages) {
    for (const line of page.lines) {
      const key = pick(line);
      weights.set(key, (weights.get(key) ?? 0) + line.text.length);
    }
  }
  return [...weights].sort((a, b) => b[1] - a[1])[0]?.[0];
}

/** Page numbers and dates differ per page; compare them with digits masked. */
const masked = (text: string): string => text.replace(/\d+/g, "#");

const inMargin = (page: Page, line: Line): boolean =>
  line.y > page.height - page.height * MARGIN_BAND || line.y < page.height * MARGIN_BAND;

/**
 * Running heads and feet: a line in the top or bottom margin band that either
 * repeats (digits masked) across pages, or carries no letters at all — "1/3",
 * "12.2.2026", "2 (7)". The letterless rule is confined to the bands because a
 * numbers-only line in the body is a table row, and in this app the numbers are
 * the story.
 */
function droppable(pages: Page[]): Set<string> {
  const counts = new Map<string, number>();
  for (const page of pages) {
    const keys = new Set(
      page.lines.filter((line) => inMargin(page, line)).map((line) => masked(line.text)),
    );
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return new Set(
    [...counts].filter(([, n]) => n >= 2 && n >= pages.length * 0.5).map(([key]) => key),
  );
}

const letterless = (text: string): boolean => text.length <= 40 && !/\p{L}/u.test(text);

/**
 * Where body text stops on the right, measured document-wide over body-size
 * lines: a wrapped line reaches this margin, a paragraph's last line falls
 * short of it. Document-wide because a page holding one short paragraph would
 * otherwise make its own lines look full-width — and body-size only because a
 * running head sitting in the right margin would otherwise raise the bar past
 * every real line.
 */
function textRight(pages: Page[], body: number): number {
  let right = 0;
  for (const page of pages) {
    for (const line of page.lines) {
      if (Math.abs(line.size - body) < 0.6) right = Math.max(right, line.right);
    }
  }
  return right;
}

/** Whether `line` starts a new block rather than continuing `prev`'s. */
function startsBlock(line: Line, prev: Line, body: number, right: number): boolean {
  if (BULLET.test(line.text) || DASH_LEAD.test(line.text)) return true;
  // A font or size change is a heading, a footnote or a caption — never a
  // continuation of the paragraph above.
  if (line.font !== prev.font) return true;
  if (Math.abs(line.size - prev.size) > 0.1 * body) return true;
  // The previous line stopped short of the margin: it ended its paragraph.
  if (prev.right < right - 3 * body) return true;
  // Extra leading between the baselines: paragraph spacing, not line spacing.
  return prev.y - line.y > 1.5 * Math.max(line.size, prev.size);
}

/**
 * Append a wrapped line to the block. A line ending in a hyphen is the
 * interesting case, and it has three readings: justification split a word and
 * the hyphen goes ("eko-\nlogisesti"); the hyphen is the words' own and the
 * line break is nothing ("korona-\naikana"); or Finnish elided the compound's
 * shared half before a conjunction, where hyphen and space both belong
 * ("liikunta-\nja kulttuuritilat").
 */
function appendLine(text: string, next: string): string {
  if (!text.endsWith("-") || ELIDING.test(next)) return `${text} ${next}`;
  const stem = SOFT_HYPHEN.exec(text)?.[1];
  const head = next.charAt(0);
  // The hyphen belongs to the text when the break is into a capital
  // ("Helsinki-Vantaa" — hyphenation never breaks into one), when the same
  // vowel meets across it (Finnish spells "korona-aikana" that way), or when
  // what precedes it is no syllable at all ("EU-", "e-", "3-").
  const own = !stem || head !== head.toLowerCase() || head.toLowerCase() === stem.slice(-1);
  return own ? text + next : text.slice(0, -1) + next;
}

function blocksFrom(pages: Page[], body: number, right: number): Block[] {
  const blocks: Block[] = [];
  for (const page of pages) {
    let block: Block | null = null;
    let prev: Line | null = null;
    for (const line of page.lines) {
      if (!block || !prev || startsBlock(line, prev, body, right)) {
        block = {
          text: line.text.replace(BULLET, ""),
          size: line.size,
          font: line.font,
          bullet: BULLET.test(line.text),
        };
        blocks.push(block);
      } else {
        block.text = appendLine(block.text, line.text);
        block.size = Math.max(block.size, line.size);
      }
      prev = line;
    }
  }
  return blocks;
}

/**
 * Prefix each block: `#`/`##` for headings, `- ` for bullets, nothing for body
 * text. Headings are decided per block, not per line, so that a wholly bold
 * paragraph (the verdict at the end of a lausunto is typically set that way)
 * stays one paragraph instead of shattering into a stack of headings. The first
 * heading is promoted to `#` — a PDF's title is set in the same bold body size
 * as its section heads, and the archive reads better with one top-level title.
 */
function render(blocks: Block[], body: number, bodyFont: string | undefined): string {
  let titled = false;
  const lines = blocks.map((block) => {
    if (block.bullet) return `- ${block.text}`;
    const heading =
      block.text.length <= MAX_HEADING_CHARS &&
      (block.size >= body * HEADING_SIZE_RATIO ||
        (block.font !== bodyFont && block.size >= body && bodyFont !== undefined));
    if (!heading) return block.text;
    const prefix = block.size >= body * TITLE_SIZE_RATIO || !titled ? "# " : "## ";
    titled = true;
    return prefix + block.text;
  });
  return lines.join("\n\n").trim();
}

/**
 * Metadata title, cleaned. Word and its PDF exporters fill Title with the
 * source file name as often as with a real title ("Microsoft Word -
 * lausunto_final.docx"), which is worse than nothing on the reader's
 * confirmation card, so those are unwrapped to the bare stem.
 */
function metaTitle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const title = collapse(raw)
    .replace(/^Microsoft Word\s*-\s*/i, "")
    .replace(/\.(?:docx?|pdf|rtf|odt|pptx?)$/i, "")
    .trim();
  return /^untitled$/i.test(title) ? "" : title;
}

const collapse = (raw: unknown): string =>
  typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";

/**
 * Subject metadata is often an abstract pasted with the layout's own hard line
 * breaks — and its hyphenation, so it is unwrapped the same way body text is.
 */
function unwrap(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .reduce((text, line) => (text ? appendLine(text, line) : line), "");
}

/** The document's first heading, for a PDF whose metadata carries no title. */
function firstHeading(markdown: string): string {
  const heading = /^#{1,2} (.+)$/m.exec(markdown);
  return heading?.[1]?.slice(0, 200) ?? "";
}

/**
 * The Markdown (plus what metadata is worth showing) of a PDF's text layer.
 * Rejects rather than queues when parses are already backed up, and throws on
 * a PDF pdf.js can't open — callers treat both as "page not readable", which
 * puts the archive on its normal retry path.
 */
export function pdfToMarkdown(
  bytes: Uint8Array,
  options: { maxPages?: number } = {},
): Promise<PdfExtract> {
  return serialize(() => extract(bytes, options.maxPages ?? MAX_PAGES));
}

async function extract(bytes: Uint8Array, maxPages: number): Promise<PdfExtract> {
  // verbosity 0 = errors only: pdf.js warns to the console — outside pino, so
  // unstructured and unfiltered — about font quirks in perfectly ordinary
  // documents.
  const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
  try {
    const deadline = Date.now() + PARSE_BUDGET_MS;
    const count = Math.min(pdf.numPages, maxPages);
    const pages: Page[] = [];
    for (let n = 1; n <= count; n++) {
      const page = await pdf.getPage(n);
      try {
        const content = await page.getTextContent();
        pages.push({
          height: page.view[3]! - page.view[1]!,
          lines: linesFrom(content.items),
        });
      } finally {
        page.cleanup();
      }
      if (Date.now() > deadline) {
        logger.debug(
          { pages: n, of: pdf.numPages },
          "pdf parse budget spent, keeping pages so far",
        );
        break;
      }
    }

    // Furniture goes first, so it weighs on neither the body measurements nor
    // the block structure.
    const repeated = droppable(pages);
    for (const page of pages) {
      page.lines = page.lines.filter(
        (line) =>
          !(inMargin(page, line) && (repeated.has(masked(line.text)) || letterless(line.text))),
      );
    }
    const body = dominant(pages, (line) => Math.round(line.size * 2) / 2) ?? 0;
    const bodyFont = dominant(pages, (line) => line.font);
    const markdown = render(blocksFrom(pages, body, textRight(pages, body)), body, bodyFont);

    const { info } = await getMeta(pdf);
    return {
      title: metaTitle(info.Title) || firstHeading(markdown),
      subject: unwrap(info.Subject),
      markdown,
    };
  } finally {
    // Frees the document's caches and its transport (pdf.js 6 dropped
    // PDFDocumentProxy.destroy in favour of the loading task's).
    await pdf.loadingTask.destroy();
  }
}
