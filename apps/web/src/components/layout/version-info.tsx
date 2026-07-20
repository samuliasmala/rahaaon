import { cn } from "../../lib/cn.js";

/**
 * Reduce an ISO 8601 commit timestamp to a compact "YYYY-MM-DD HH:mm" in the
 * committer's recorded local time (a plain slice, so no timezone reinterpretation
 * and nothing to go stale). Returns "" for an empty/unparseable value.
 */
function formatCommitTime(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : "";
}

/**
 * Build identifier line — "v0.1.0 (9cf0e26)" in production images, the standard
 * `git describe` form "v0.1.0-5-g9cf0e26" (commits past the latest release tag)
 * in dev/local builds — followed by the commit timestamp so you can tell how
 * fresh a deploy is. Both values are inlined at build time (vite.config.ts
 * `define`); color/size come from the caller so the same component works on the
 * login card and the admin page footer.
 */
export function VersionInfo({ className }: { className?: string }) {
  const committed = formatCommitTime(__BUILD_TIME__);
  return (
    <p data-testid="version-info" className={cn("text-[12px]", className)}>
      {__BUILD_VERSION__}
      {committed && <span className="opacity-70"> · {committed}</span>}
    </p>
  );
}
