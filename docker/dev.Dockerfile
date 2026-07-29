# Dev image: toolchain only (Node + pnpm). The repo is bind-mounted at runtime
# and the dev servers (Vite + `tsx watch`) reload in-process, so editing code
# never requires rebuilding this image — rebuild only when the Node/pnpm version
# changes. Deps are installed into container-managed node_modules volumes by the
# entrypoint (see docker-compose.dev.yml).
FROM node:24-bookworm-slim

# pnpm via npm, not corepack (dropped from newer Node majors). Version matches
# "packageManager" in package.json.
RUN npm install -g pnpm@11.10.0

# System libraries Chromium needs for Playwright e2e runs inside the container.
# Only the apt packages are baked in (the list is stable across Playwright
# versions); the browser binaries themselves are downloaded by the entrypoint
# into the ms-playwright volume so they track @playwright/test in apps/web
# without an image rebuild.
RUN npx -y playwright@1.61.1 install-deps chromium

# git for the version footer: vite.config.ts runs `git describe` against the
# bind-mounted repo when GIT_DESCRIBE isn't in the environment, so the footer
# is correct on every Vite start regardless of how the stack was launched. The
# repo is owned by the host user while the container runs as root, so /app must
# be marked safe or git refuses with "dubious ownership".
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && git config --global --add safe.directory /app

WORKDIR /app

COPY docker/dev-entrypoint.sh /usr/local/bin/dev-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-entrypoint.sh

ENTRYPOINT ["/usr/local/bin/dev-entrypoint.sh"]
CMD ["pnpm", "dev"]
