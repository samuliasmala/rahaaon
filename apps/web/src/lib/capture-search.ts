/**
 * The admin's capture parameter: `/admin?kaappaus=<artikkelin osoite>`, the
 * link the capture bookmarklet opens (see `runCapture` in
 * lib/capture-bookmarklet.ts, which spells the name out again — its source
 * ships to the publisher's page and can't import anything from here).
 *
 * Both routes that touch the parameter go through these: TanStack Router's
 * `validateSearch` decides the search type for every `Link` to /admin, so an
 * always-present `kaappaus: string | undefined` would make every link in the
 * app declare it. Absent when there is no capture.
 */
export function captureSearch(url: unknown): { kaappaus?: string } {
  if (typeof url !== "string" || !url) return {};
  // Only an article address is a capture. The parameter reaches an `href` in
  // the admin, and a `javascript:`/`data:` URL in a query string must not get
  // that far — the same reason the API refuses them on submit.
  try {
    const { protocol } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return {};
  } catch {
    return {};
  }
  return { kaappaus: url };
}

/** `validateSearch` for the routes that carry a capture. */
export function parseCaptureSearch(search: Record<string, unknown>): { kaappaus?: string } {
  return captureSearch(search.kaappaus);
}
