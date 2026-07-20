import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

// Human-readable build id for the version footer, in the standard `git describe`
// form: "v0.1.0-5-gf03b527" = 5 commits past the v0.1.0 tag ("-dirty" when the
// tree has uncommitted changes), collapsing to a plain "v0.1.0" at a release tag
// and to a bare short SHA when there are no tags yet. Environments without git
// or .git pass the string in as GIT_DESCRIBE instead: CI image builds via a
// build arg (docker/web.Dockerfile), the dev container via the compose
// environment (Makefile computes it).
function buildVersion(): string {
  const described = process.env.GIT_DESCRIBE;
  if (described) return described;
  try {
    return execSync("git describe --tags --always --dirty", { encoding: "utf8" }).trim();
  } catch {
    const sha = process.env.GIT_COMMIT;
    return sha ? `v${pkg.version} (${sha.slice(0, 7)})` : `v${pkg.version} (unknown)`;
  }
}

// Commit timestamp (ISO 8601, e.g. "2026-07-12T22:33:11+03:00") for the version
// footer — tells you at a glance how fresh a deploy is. Same sourcing as
// GIT_DESCRIBE: env var when there's no .git (Docker/CI via build arg, dev
// container via compose), git otherwise. Empty string when unavailable so the
// footer just omits it.
function commitTime(): string {
  const fromEnv = process.env.GIT_COMMIT_TIME;
  if (fromEnv) return fromEnv;
  try {
    return execSync("git log -1 --format=%cI", { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

export default defineConfig({
  define: {
    __BUILD_VERSION__: JSON.stringify(buildVersion()),
    __BUILD_TIME__: JSON.stringify(commitTime()),
  },
  plugins: [
    // Router plugin must precede the React plugin.
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    // Listen on all interfaces so the dev server is reachable when run inside a
    // container (harmless on the host).
    host: true,
    // 5173/3000 belong to the vesi dev stack on the same machine; rahaaon uses 5174/3001.
    port: 5174,
    proxy: {
      // Forward API + auth calls to the Hono server (path preserved), so the
      // browser treats them as same-origin and the session cookie is shared.
      "/api": { target: "http://localhost:3001", changeOrigin: true },
    },
    // Published through the host Caddy (TLS + reverse proxy to this port).
    allowedHosts: ["rahaaon.asmala.fi"],
  },
  test: {
    environment: "node",
    globals: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
