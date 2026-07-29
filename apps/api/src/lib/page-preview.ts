import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { pipeline, Readable } from "node:stream";
import zlib from "node:zlib";
import { logger } from "./logger.js";
import { env } from "../config/env.js";

/**
 * Fetches the metadata a reader confirms before submitting a link — the
 * "google-like" result card (site, title, description). Best-effort by design:
 * an unreachable or unparsable page degrades to `fetched: false` with just the
 * hostname, and the reader can still submit. The submitted link is only a
 * pointer for the editorial/AI pipeline, so nothing downstream trusts this.
 */

export interface PagePreview {
  url: string;
  /** Domain shown in the result card, e.g. "hs.fi". */
  siteName: string;
  title: string;
  description: string;
  /** False when the page couldn't be read — the card falls back to the bare URL. */
  fetched: boolean;
}

const FETCH_TIMEOUT_MS = 5_000;
/**
 * The body read stops at this many bytes. Sized for the archive, not the
 * preview (metadata lives in <head>): news pages carry hundreds of KB of
 * inline JSON state before the story markup, and a cap that cuts the page
 * before the story's closing tag makes extractArticleMarkdown fall back to
 * converting the whole document, nav furniture and all. All downstream
 * parsers are single-pass linear scans, so a few MB stays cheap.
 */
const MAX_HTML_BYTES = 5 * 1024 * 1024;
/** Redirect hops followed manually, so the SSRF guard applies to every hop. */
const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; RahaaOnBot/0.1; +https://rahaaon.fi)";

/**
 * Submit re-uses the preview the reader just confirmed instead of re-fetching
 * the page. TTL map with a hard size cap (the endpoint is anonymous, so the
 * key space is attacker-controlled); oldest entries are evicted first.
 */
const cache = new Map<string, { preview: PagePreview; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Whether an IP address (v4, v6, or v4-mapped v6) is non-public — private,
 * loopback, link-local, ULA, multicast or otherwise not global unicast. The
 * SSRF guard treats a `true` result as "do not connect". Exported for tests.
 */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast + reserved + broadcast
    );
  }
  // IPv6. First unwrap any embedded IPv4 (v4-mapped, either dotted
  // `::ffff:127.0.0.1` or the hex form `::ffff:7f00:1` that URL normalises to)
  // and classify that instead. Otherwise treat everything that is not global
  // unicast (2000::/3) as non-public: loopback (::1), unspecified (::), ULA
  // (fc00::/7), link-local (fe80::/10), multicast (ff00::/8) and the deprecated
  // ::a.b.c.d forms all fall outside that range. An allowlist here is far more
  // robust than trying to enumerate every private-form prefix.
  const lower = address.toLowerCase();
  const mapped =
    /^(?:::|(?:0:){5})ffff:(?:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(
      lower,
    );
  if (mapped) {
    if (mapped[1]) return isPrivateAddress(mapped[1]);
    const hi = parseInt(mapped[2]!, 16);
    const lo = parseInt(mapped[3]!, 16);
    return isPrivateAddress(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
  }
  // "::1" etc. split to a leading "" → NaN → correctly falls outside the range.
  const firstHextet = parseInt(lower.split(":")[0] ?? "", 16);
  if (!(firstHextet >= 0x2000 && firstHextet <= 0x3fff)) return true;
  // Within global unicast, 6to4 (2002::/16) and Teredo (2001:0000::/32) tunnel
  // an embedded IPv4 that could target an internal host, so reject them too.
  if (firstHextet === 0x2002) return true;
  return /^2001:0{1,4}:/.test(lower) || /^2001::/.test(lower);
}

/** First capture group of the first matching pattern, entity-decoded. */
function firstMatch(html: string, patterns: RegExp[]): string {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return decodeEntities(match[1]).replace(/\s+/g, " ").trim();
  }
  return "";
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#39);/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** `<meta … property="og:title" … content="…">` in either attribute order. */
function metaPatterns(attr: "property" | "name", key: string): RegExp[] {
  return [
    // eslint-disable-next-line security/detect-non-literal-regexp -- attr/key are compile-time constants from this module's call sites, never user input
    new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"),
    // eslint-disable-next-line security/detect-non-literal-regexp -- same as above
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+${attr}=["']${key}["']`, "i"),
  ];
}

function parseMetadata(html: string, url: string): Omit<PagePreview, "url" | "fetched"> {
  const title = firstMatch(html, [
    ...metaPatterns("property", "og:title"),
    /<title[^>]*>([^<]+)<\/title>/i,
  ]);
  const description = firstMatch(html, [
    ...metaPatterns("property", "og:description"),
    ...metaPatterns("name", "description"),
  ]);
  const siteName = firstMatch(html, metaPatterns("property", "og:site_name")) || hostnameOf(url);
  return { title, description, siteName };
}

/** Read at most `max` bytes of the body, then cancel the rest of the stream. */
async function readBodyCapped(res: Response, max: number): Promise<string> {
  if (!res.body) return "";
  // Node's fetch types the stream chunks as `any`; they are Uint8Array.
  const reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let html = "";
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    html += decoder.decode(value, { stream: true });
    if (received >= max) {
      await reader.cancel();
      break;
    }
  }
  return html;
}

/**
 * DNS resolver used for the guarded fetch's socket connection (production only).
 * Resolves the hostname, drops every private/loopback address, and hands only
 * the remaining public address(es) to the connector — so the IP the socket
 * actually dials is the exact one vetted here. Because this lookup is the
 * connection's *only* resolution, there is no window between the SSRF check and
 * the connect for DNS rebinding to swing the target to an internal host (the
 * TOCTOU that a resolve-then-fetch guard leaves open). Yields an error — which
 * aborts the connection — when nothing public remains.
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) {
      callback(err, "", 0);
      return;
    }
    const publicAddrs = addresses.filter((a) => !isPrivateAddress(a.address));
    if (publicAddrs.length === 0) {
      callback(new Error(`refusing to connect to non-public host ${hostname}`), "", 0);
      return;
    }
    if (options.all) callback(null, publicAddrs);
    else callback(null, publicAddrs[0]!.address, publicAddrs[0]!.family);
  });
};

/**
 * Transparently decode a compressed body; pass anything else through. We only
 * advertise `gzip, br` (see requestOnce), so `deflate` is a defensive branch for
 * a server that sends it unsolicited — and `deflate` is skipped deliberately in
 * the request because it is ambiguous (zlib-wrapped vs raw), whereas gzip/br
 * cover the real web.
 *
 * Uses `pipeline`, not `res.pipe(decoder)`: a truncated or reset *compressed*
 * body must propagate the source's abort/error to the decoder so the stream
 * ends. With a bare pipe the decoder never sees the source die, the web stream
 * never closes, and `readBodyCapped`'s `reader.read()` hangs forever — a hang
 * the request timeout can't cancel once the response has started, and one an
 * anonymous submitter can trigger by controlling the origin. The callback
 * swallows the error; it also surfaces on the returned decoder, which the reader
 * observes and the call sites already catch.
 */
function decodeBody(res: http.IncomingMessage): Readable {
  const decoder =
    (res.headers["content-encoding"] ?? "").toLowerCase() === "gzip"
      ? zlib.createGunzip()
      : (res.headers["content-encoding"] ?? "").toLowerCase() === "br"
        ? zlib.createBrotliDecompress()
        : (res.headers["content-encoding"] ?? "").toLowerCase() === "deflate"
          ? zlib.createInflate()
          : undefined;
  if (!decoder) return res;
  pipeline(res, decoder, () => {});
  return decoder;
}

/**
 * One GET, no auto-redirect, returned as a web `Response` so the rest of the
 * module keeps its fetch-style API. Uses node http(s) rather than global
 * `fetch` because only the low-level client exposes a per-connection `lookup`
 * hook — the mechanism that lets {@link guardedLookup} pin the dialed IP while
 * TLS still validates against the original hostname (SNI and cert unchanged).
 * Content-encoding is decoded here since, unlike `fetch`, the raw client does
 * not; `readBodyCapped` bounds the decoded size, so a decompression bomb can't
 * blow past the byte budget.
 */
function requestOnce(url: string): Promise<Response> {
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html",
          // Not deflate: it's ambiguous (zlib vs raw) and gzip/br cover the web.
          "Accept-Encoding": "gzip, br",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        // Pin the connection to a vetted public IP in production. Dev/test skip
        // the guard so E2E can reach localhost.
        ...(env.isProd ? { lookup: guardedLookup } : {}),
      },
      (res) => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (Array.isArray(value)) for (const v of value) headers.append(key, v);
          else if (value !== undefined) headers.set(key, value);
        }
        const body = Readable.toWeb(decodeBody(res)) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status: res.statusCode ?? 502, headers }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Fetch the URL following redirects manually, http(s)-only per hop and with the
 * per-connection SSRF guard ({@link requestOnce} + {@link guardedLookup})
 * re-applied to every hop — auto-follow would let a public page bounce the
 * request to an internal address on a connection that never re-ran the check.
 */
async function fetchGuarded(url: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    // A numeric host bypasses the connect-time guard entirely — net.connect
    // skips `lookup` when the host is already an IP literal — so a private
    // literal (e.g. 169.254.169.254 or [::1]) must be rejected here. URL keeps
    // the brackets on IPv6 literals; strip them so net.isIP recognises it.
    // Hostnames still go through guardedLookup, which vets the address it dials.
    const literalHost = parsed.hostname.replace(/^\[|\]$/g, "");
    if (env.isProd && net.isIP(literalHost) && isPrivateAddress(literalHost)) return null;

    const res = await requestOnce(current);
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    await res.body?.cancel();
    if (!location) return null;
    current = new URL(location, current).toString();
  }
  return null; // too many redirects
}

/**
 * Remove every `open…close` block (script/style bodies, comments) with a
 * linear indexOf scan. The regex equivalent (`<script[\s\S]*?<\/script>`) goes
 * quadratic on adversarial input — 512KB of unclosed `<script` openers costs
 * seconds of blocked event loop — and the fetched pages are submitter-chosen.
 * When `close` doesn't end the block itself (`</script` needs its `>`), the
 * scan skips to the next `>`. An unclosed block drops the rest of the document.
 */
function stripBlocks(html: string, open: string, close: string): string {
  const lower = html.toLowerCase();
  const parts: string[] = [];
  let pos = 0;
  for (;;) {
    const start = lower.indexOf(open, pos);
    if (start === -1) {
      parts.push(html.slice(pos));
      break;
    }
    parts.push(html.slice(pos, start), " ");
    const closeAt = lower.indexOf(close, start + open.length);
    if (closeAt === -1) break;
    const blockEnd = close.endsWith(">") ? closeAt + close.length - 1 : lower.indexOf(">", closeAt);
    if (blockEnd === -1) break;
    pos = blockEnd + 1;
  }
  return parts.join("");
}

const NON_CONTENT_TAGS = ["script", "style", "noscript", "svg", "template"];

/** Tags whose boundaries don't separate words ("bo<b>ld</b>" is one word). */
// prettier-ignore
const INLINE_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i",
  "kbd", "mark", "q", "s", "samp", "small", "span", "strong", "sub", "sup",
  "time", "u", "var", "wbr",
]);

const EMPHASIS_MARK: Record<string, string> = { strong: "**", b: "**", em: "*", i: "*" };

/** First http(s) href in a tag's attributes; "" for relative/other schemes. */
function hrefOf(tag: string): string {
  const m = /\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag);
  const href = decodeEntities(m?.[1] ?? m?.[2] ?? m?.[3] ?? "");
  return /^https?:\/\//i.test(href) ? href : "";
}

/**
 * Convert an HTML document to light Markdown (headings, links, lists,
 * emphasis, blockquotes) for the archive and the LLM prompt. Deliberately
 * hand-rolled as a single linear pass: submitted pages are attacker-chosen,
 * and a real converter library (turndown + its DOM) measured multi-second
 * synchronous stalls on adversarial 512 KB inputs, which this in-process,
 * shared-event-loop server can't afford. Fidelity degrades gracefully —
 * tables and unknown structures fall back to plain text blocks.
 */
export function htmlToMarkdown(html: string): string {
  let cleaned = stripBlocks(html, "<!--", "-->");
  for (const tag of NON_CONTENT_TAGS) {
    cleaned = stripBlocks(cleaned, `<${tag}`, `</${tag}`);
  }

  const blocks: string[] = [];
  // The current block accumulates as an array of chunks, joined only at
  // flush. Appending to a growing string and slicing it back (closeLink)
  // forces V8 to flatten the rope on every slice — measured quadratic on
  // link-heavy input.
  let chunks: string[] = [];
  // Index of the last chunk holding non-whitespace text. Lets closeLink
  // decide "did this link capture any text" in O(1) — materializing the tail
  // (chunks.slice().join()) measured quadratic on nested unclosed <a> tags.
  let lastContentIndex = -1;
  let prefix = "";
  let quoteDepth = 0;
  const listStack: ("ul" | "ol")[] = [];
  const openLinks: { href: string; index: number }[] = [];
  const openMarks: string[] = [];

  const pushText = (text: string) => {
    chunks.push(text);
    if (text.trim()) lastContentIndex = chunks.length - 1;
  };

  /** Close a link: `](url)` when it captured text, otherwise drop the `[`. */
  const closeLink = () => {
    const link = openLinks.pop();
    if (!link) return;
    if (lastContentIndex > link.index) chunks.push(`](${link.href})`);
    else chunks.length = link.index;
  };

  const flush = (nextPrefix = "") => {
    while (openMarks.length) chunks.push(openMarks.pop()!);
    while (openLinks.length) closeLink();
    const text = chunks.join("").replace(/\s+/g, " ").trim();
    if (text) blocks.push("> ".repeat(quoteDepth) + prefix + text);
    chunks = [];
    lastContentIndex = -1;
    prefix = nextPrefix;
  };

  const handleTag = (token: string) => {
    const parsed = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(token);
    if (!parsed) return; // <!doctype …> and other non-elements
    const closing = parsed[1] === "/";
    const name = parsed[2]!.toLowerCase();

    if (/^h[1-6]$/.test(name)) {
      flush(closing ? "" : "#".repeat(Number(name[1])) + " ");
    } else if (name === "li") {
      flush(closing ? "" : listStack.at(-1) === "ol" ? "1. " : "- ");
    } else if (name === "ul" || name === "ol") {
      flush();
      if (closing) listStack.pop();
      else listStack.push(name);
    } else if (name === "blockquote") {
      flush();
      quoteDepth = Math.max(0, quoteDepth + (closing ? -1 : 1));
    } else if (name === "a") {
      if (closing) {
        closeLink();
      } else {
        const href = hrefOf(token);
        if (href) {
          openLinks.push({ href, index: chunks.length });
          chunks.push("[");
        }
      }
    } else if (name in EMPHASIS_MARK) {
      const mark = EMPHASIS_MARK[name]!;
      if (!closing) {
        openMarks.push(mark);
        chunks.push(mark);
      } else if (openMarks.at(-1) === mark) {
        openMarks.pop();
        chunks.push(mark);
      }
    } else if (INLINE_TAGS.has(name)) {
      // word-internal boundary — no separator
    } else if (name === "td" || name === "th") {
      if (closing) chunks.push(" ");
    } else {
      flush(); // p, div, br, tr, figure, … and anything unknown: block boundary
    }
  };

  // Manual indexOf tokenizer: a `(<[^>]*>)` split looks equivalent but its
  // backtracking goes quadratic on adversarial `>`-free input (measured
  // >1.5 s on 512 KB); indexOf keeps the whole pass linear.
  let pos = 0;
  while (pos < cleaned.length) {
    const lt = cleaned.indexOf("<", pos);
    if (lt === -1) {
      pushText(decodeEntities(cleaned.slice(pos)));
      break;
    }
    if (lt > pos) pushText(decodeEntities(cleaned.slice(pos, lt)));
    const gt = cleaned.indexOf(">", lt + 1);
    if (gt === -1) break; // truncated trailing tag — drop it
    handleTag(cleaned.slice(lt, gt + 1));
    pos = gt + 1;
  }
  flush();
  return blocks.join("\n\n");
}

/**
 * Length of the Markdown with link targets removed — URLs would otherwise
 * inflate link-heavy but content-free text (nav lists, teaser cards) past any
 * comparison or threshold. Shared with the archive's paywall classification.
 */
export function markdownContentLength(markdown: string): number {
  return markdown.replace(/\]\([^)]*\)/g, "]").length;
}

/**
 * Top-level `<tag …>…</tag>` slices of the document, in order. Nested
 * same-tag elements are depth-counted so only the outermost boundaries
 * delimit; an element left unclosed is dropped rather than guessed at.
 * Single forward indexOf scan (each hit advances the cursor) for the same
 * linear-time guarantee as the converter — pages are submitter-chosen.
 */
function elementSlices(html: string, tag: string): string[] {
  const lower = html.toLowerCase();
  const slices: string[] = [];
  let depth = 0;
  let start = -1;
  let pos = 0;
  for (;;) {
    const at = lower.indexOf(tag, pos);
    if (at === -1) break;
    pos = at + tag.length;
    // Only `<tag` / `</tag` followed by a tag-name boundary counts — not
    // prose ("mainonta") or a longer name (`<articleish>`, `</maintag>`).
    const next = lower.charAt(pos);
    const boundary = next === "" || next === ">" || next === "/" || /\s/.test(next);
    const opening = lower[at - 1] === "<";
    const closing = lower[at - 1] === "/" && lower[at - 2] === "<";
    if (!boundary || (!opening && !closing)) continue;
    if (opening) {
      if (depth === 0) start = at - 1;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) {
        const end = lower.indexOf(">", pos);
        if (end === -1) break; // truncated close tag — drop the candidate
        slices.push(html.slice(start, end + 1));
        pos = end + 1;
      }
    }
  }
  return slices;
}

/** The h1 the story element carries as its headline (flush emits `# ` at block start). */
const H1_BLOCK = /(^|\n)# /;

/**
 * Reduce a full page to the Markdown of its main content. News pages mark the
 * story with `<article>`, but rarely alone — hs.fi pages carry five or six
 * top-level `<article>` elements (the story plus teaser lists and a comments
 * container) — so every candidate is converted and the one with the most
 * content wins, preferring candidates that carry an h1: the headline lives in
 * the story element, while teaser lists and comment blocks head with h2/h3 or
 * nothing. Falls back to `<main>`, then to the whole document, so a page
 * without semantic markup degrades to exactly the whole-page conversion.
 */
export function extractArticleMarkdown(html: string): string {
  // Strip comments and script/style/… blocks up front so an `<article` inside
  // a JSON state blob or comment can't skew the slice boundaries. The
  // conversion pass re-strips its input; on this pre-cleaned text that finds
  // nothing and costs one linear scan.
  let cleaned = stripBlocks(html, "<!--", "-->");
  for (const tag of NON_CONTENT_TAGS) {
    cleaned = stripBlocks(cleaned, `<${tag}`, `</${tag}`);
  }

  for (const tag of ["article", "main"]) {
    // Top-level slices are disjoint, so converting all of them costs no more
    // than one whole-page pass.
    const candidates = elementSlices(cleaned, tag).map(htmlToMarkdown);
    const withH1 = candidates.filter((md) => H1_BLOCK.test(md));
    const best = (withH1.length ? withH1 : candidates).reduce(
      (a, b) => (markdownContentLength(b) > markdownContentLength(a) ? b : a),
      "",
    );
    if (best) return best;
  }
  return htmlToMarkdown(cleaned);
}

/**
 * Contents of every `<script type="application/ld+json">` block, via the same
 * forward indexOf scan as the other passes. A stray `</script` inside a JSON
 * string ends the block early; the resulting parse failure reads as "no
 * signal", which is the safe direction.
 */
function ldJsonBlocks(html: string): string[] {
  const lower = html.toLowerCase();
  const blocks: string[] = [];
  let pos = 0;
  for (;;) {
    const start = lower.indexOf("<script", pos);
    if (start === -1) break;
    const tagEnd = lower.indexOf(">", start);
    if (tagEnd === -1) break;
    const close = lower.indexOf("</script", tagEnd);
    if (close === -1) break;
    pos = close + "</script".length;
    if (lower.slice(start, tagEnd).includes("application/ld+json")) {
      blocks.push(html.slice(tagEnd + 1, close));
    }
  }
  return blocks;
}

/**
 * schema.org types that identify the page's own story. Deliberately NOT plain
 * `hasPart` descendants like WebPageElement: Google's paywall markup nests a
 * `WebPageElement { isAccessibleForFree: false, cssSelector: … }` under the
 * article to point at the walled section, and it stays `false` even on free
 * pages — reading the flag off anything but an Article node inverts the
 * signal.
 */
const ARTICLE_TYPE = /(?:article|posting)$/i;

/** Depth-first search for the first Article-typed node carrying a usable flag. */
function articleFreeFlag(node: unknown): boolean | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const flag = articleFreeFlag(item);
      if (flag !== null) return flag;
    }
    return null;
  }
  if (typeof node !== "object" || node === null) return null;
  const record = node as Record<string, unknown>;
  const type = record["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((t) => typeof t === "string" && ARTICLE_TYPE.test(t))) {
    // Booleans per the spec, "True"/"False" strings in the wild.
    const raw = record["isAccessibleForFree"];
    const value = typeof raw === "string" ? raw.toLowerCase() : raw;
    if (value === true || value === "true") return true;
    if (value === false || value === "false") return false;
  }
  // No flag here — the article may sit under @graph, mainEntity or the like.
  for (const value of Object.values(record)) {
    const flag = articleFreeFlag(value);
    if (flag !== null) return flag;
  }
  return null;
}

/**
 * The page's own paywall marking: schema.org `isAccessibleForFree` on an
 * Article-typed JSON-LD node (the markup Google requires for paywalled
 * content, so paywalled sites reliably carry it). Returns `true`/`false` as
 * marked, or null when the page doesn't say — malformed JSON and absurdly
 * nested structures also read as null rather than throwing.
 */
export function isAccessibleForFree(html: string): boolean | null {
  for (const block of ldJsonBlocks(html)) {
    try {
      const flag = articleFreeFlag(JSON.parse(block));
      if (flag !== null) return flag;
    } catch {
      // not JSON (or nested past the call stack) — treat as signal-less
    }
  }
  return null;
}

export interface PageText {
  /** False when the page couldn't be read at all (network, non-HTML, blocked). */
  fetched: boolean;
  /** The page content as Markdown (headings/links/lists preserved). */
  text: string;
  /** The page's schema.org paywall marking; null when the page doesn't carry one. */
  accessibleForFree: boolean | null;
}

/**
 * Fetch a page and reduce its main content to Markdown for the archive/AI
 * pipeline (see {@link extractArticleMarkdown} — nav/footer furniture is
 * sliced away when the page marks its main content). Same guarded fetch as
 * the preview (SSRF check per redirect hop, timeout, size cap). Best-effort
 * like the preview: `fetched: false` with empty text when the page can't be
 * read — callers fall back to the submit-time metadata.
 */
export async function fetchPageText(url: string, maxChars = 30_000): Promise<PageText> {
  try {
    const res = await fetchGuarded(url);
    if (!res) return { fetched: false, text: "", accessibleForFree: null };
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) {
      await res.body?.cancel();
      return { fetched: false, text: "", accessibleForFree: null };
    }
    const html = await readBodyCapped(res, MAX_HTML_BYTES);
    return {
      fetched: true,
      text: extractArticleMarkdown(html).slice(0, maxChars),
      accessibleForFree: isAccessibleForFree(html),
    };
  } catch (err) {
    logger.debug({ url, err: (err as Error).message }, "page text fetch failed");
    return { fetched: false, text: "", accessibleForFree: null };
  }
}

export async function fetchPagePreview(url: string): Promise<PagePreview> {
  const cached = cache.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.preview;
  cache.delete(url);

  const fallback: PagePreview = {
    url,
    siteName: hostnameOf(url),
    title: "",
    description: "",
    fetched: false,
  };

  try {
    const res = await fetchGuarded(url);
    if (!res) return fallback;
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) {
      await res.body?.cancel();
      return fallback;
    }

    const html = await readBodyCapped(res, MAX_HTML_BYTES);
    const preview: PagePreview = { url, fetched: true, ...parseMetadata(html, url) };
    if (cache.size >= CACHE_MAX_ENTRIES) {
      cache.delete(cache.keys().next().value!); // Map iterates in insertion order
    }
    cache.set(url, { preview, expiresAt: Date.now() + CACHE_TTL_MS });
    return preview;
  } catch (err) {
    logger.debug({ url, err: (err as Error).message }, "page preview fetch failed");
    return fallback;
  }
}
