/**
 * Duplicate detection for reader-submitted links. The same article reaches the
 * Ehdotusjono in many shapes — pasted from the address bar, from a share sheet
 * with campaign parameters, with or without `www.` — and each shape would
 * otherwise cost the desk a second AI extraction and a second queue card.
 * {@link normalizeUrl} folds those shapes into one comparison key, stored as
 * `url_key` on url_submission and waste_item.
 */

/**
 * Query parameters that identify how the reader arrived, never which page they
 * arrived at. Dropping them is always safe.
 */
const TRACKING_PARAMS = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "gbraid",
  "wbraid",
  "msclkid",
  "yclid",
  "igshid",
  "twclid",
  "ttclid",
  "li_fat_id",
  "mc_cid",
  "mc_eid",
  "_ga",
  "xtor",
  "at_medium",
  "at_campaign",
]);

/**
 * Deliberately NOT dropped: `ref`, `s`, `share`, `id`, `page`. Some sites route
 * on them, and collapsing two distinct articles into one key would silently
 * swallow a real suggestion — a far worse failure than missing a duplicate.
 */
function isTrackingParam(key: string): boolean {
  return key.startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase());
}

/**
 * The comparison key for a submitted link — NOT a displayable URL (the scheme
 * is flattened, so it may not even resolve). Everything that varies without
 * changing which article is meant is removed: scheme, `www.`, default port,
 * host case, fragment, campaign parameters, parameter order and a trailing
 * slash. Never throws — an unparsable value keys as its own trimmed self, so a
 * link the URL parser rejects still dedupes against a byte-identical repost.
 */
export function normalizeUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }

  // `host`, not `hostname`: it already omits the scheme's default port and
  // keeps any other one, which is part of the page's identity.
  const host = url.host.toLowerCase().replace(/^www\./, "");

  // Sorted by key, then value: a repeated key (?tag=a&tag=b) must key the same
  // however the two arrived.
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(
      ([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue),
    );
  const search = new URLSearchParams(params).toString();

  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");

  // http and https of one page are one page, so the scheme is flattened rather
  // than preserved — which is also why the result is a key and not a URL.
  return `https://${host}${path}${search ? `?${search}` : ""}`;
}
