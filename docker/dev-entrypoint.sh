#!/bin/sh
set -e

# Install workspace deps into the container-managed node_modules volumes. This is
# idempotent — a fast no-op once the volumes are populated — so a cold start
# installs once and subsequent `up`s start almost immediately.
echo "[dev] installing dependencies (pnpm install)…"
pnpm install --frozen-lockfile

# Download the Chromium build matching apps/web's @playwright/test into the
# ms-playwright volume (system libs are baked into the image). Idempotent — a
# fast no-op once the volume holds the right build, re-downloads only after a
# Playwright bump. Skipped while apps/web has no Playwright dependency.
if pnpm --filter @rahaaon/web exec playwright --version >/dev/null 2>&1; then
  echo "[dev] installing Playwright chromium…"
  pnpm --filter @rahaaon/web exec playwright install chromium
fi

# Hand off to the container command (default: pnpm dev → turbo runs web + api).
exec "$@"
