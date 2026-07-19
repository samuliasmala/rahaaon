import dns from "node:dns/promises";
import net from "node:net";
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
/** Metadata lives in <head>; the body read stops at this many bytes. */
const MAX_HTML_BYTES = 512 * 1024;
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
 * SSRF guard for the production deployment: refuse to fetch hosts that resolve
 * to private/loopback ranges, so the preview endpoint can't be pointed at
 * internal services. Dev/test skip it (local URLs are used in E2E). Best-effort
 * (the fetch re-resolves DNS) — proportional to what the endpoint exposes:
 * title/description of a page the submitter already controls or can read.
 */
async function isPubliclyRoutable(hostname: string): Promise<boolean> {
  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    return addresses.every(({ address }) => !isPrivateAddress(address));
  } catch {
    return false; // unresolvable — nothing to fetch anyway
  }
}

function isPrivateAddress(address: string): boolean {
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
  const lower = address.toLowerCase();
  // IPv4-mapped IPv6 (::ffff:10.0.0.1, also the expanded form) — check the embedded IPv4.
  const mapped = /^(?:::|(?:0:){5})ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateAddress(mapped[1]!);
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fc") ||
    lower.startsWith("fd") ||
    lower.startsWith("fe8") ||
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb")
  );
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
 * Fetch the URL following redirects manually, re-applying the SSRF guard to
 * every hop — `redirect: "follow"` would let a public page bounce the request
 * to an internal address unchecked. Also http(s)-only per hop.
 */
async function fetchGuarded(url: string): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (env.isProd && !(await isPubliclyRoutable(parsed.hostname))) return null;

    const res = await fetch(current, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      redirect: "manual",
    });
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

/** Strip an HTML document down to its readable text, whitespace-collapsed. */
function htmlToText(html: string): string {
  let text = stripBlocks(html, "<!--", "-->");
  for (const tag of NON_CONTENT_TAGS) {
    text = stripBlocks(text, `<${tag}`, `</${tag}`);
  }
  return decodeEntities(text.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export interface PageText {
  /** False when the page couldn't be read at all (network, non-HTML, blocked). */
  fetched: boolean;
  text: string;
}

/**
 * Fetch a page and reduce it to plain text for the archive/AI pipeline. Same
 * guarded fetch as the preview (SSRF check per redirect hop, timeout, size
 * cap). Best-effort like the preview: `fetched: false` with empty text when
 * the page can't be read — callers fall back to the submit-time metadata.
 */
export async function fetchPageText(url: string, maxChars = 15_000): Promise<PageText> {
  try {
    const res = await fetchGuarded(url);
    if (!res) return { fetched: false, text: "" };
    const contentType = res.headers.get("content-type") ?? "";
    if (!res.ok || !contentType.includes("text/html")) {
      await res.body?.cancel();
      return { fetched: false, text: "" };
    }
    const html = await readBodyCapped(res, MAX_HTML_BYTES);
    return { fetched: true, text: htmlToText(html).slice(0, maxChars) };
  } catch (err) {
    logger.debug({ url, err: (err as Error).message }, "page text fetch failed");
    return { fetched: false, text: "" };
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
