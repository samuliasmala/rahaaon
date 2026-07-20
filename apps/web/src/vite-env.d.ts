/// <reference types="vite/client" />

/** CSS-only packages (no types); imported for their @font-face side effects. */
declare module "@fontsource-variable/space-grotesk";
declare module "@fontsource/ibm-plex-sans/*.css";

/**
 * Display string for the version footer, inlined at build time (vite.config.ts
 * `define`): `git describe` form ("v0.1.0-5-gf03b527") when built from a git
 * checkout, a bare short SHA before the first release tag.
 */
declare const __BUILD_VERSION__: string;
/**
 * Commit timestamp of the build in ISO 8601 form ("2026-07-12T22:33:11+03:00"),
 * inlined at build time (vite.config.ts `define`); "" when the build had no git
 * or env source.
 */
declare const __BUILD_TIME__: string;
