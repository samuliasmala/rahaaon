# Dev image: toolchain only (Node + pnpm). The repo is bind-mounted at runtime
# and the dev servers (Vite + `tsx watch`) reload in-process, so editing code
# never requires rebuilding this image — rebuild only when the Node/pnpm version
# changes. Deps are installed into container-managed node_modules volumes by the
# entrypoint (see docker-compose.dev.yml).
#
# Runs as the image's built-in `node` user (uid/gid 1000), not root. The repo is
# bind-mounted, so every file the container writes into it lands on the host
# owned by whoever wrote it — husky's hook scripts on each `pnpm install`,
# turbo's cache, `drizzle-kit generate` migrations, orval's client. As root
# those come out unwritable by the host user, and the breakage surfaces far from
# the cause: a stale root-owned .husky/_/h fails every later `pnpm install` with
# EACCES. uid 1000 is the usual host user, so the files stay yours.
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
# is correct on every Vite start regardless of how the stack was launched.
# --system rather than --global: the exemption has to hold for the `node` user
# this image runs as, and still for root if someone debugs with `docker run -u 0`.
# It only bites when the host uid isn't 1000 — git's dubious-ownership check
# passes on its own when the repo's owner matches the process.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/* \
    && git config --system --add safe.directory /app

# Every path a named volume mounts on has to exist here, owned by `node`.
# Docker seeds a fresh volume from the *image's* directory at that path,
# ownership included, and falls back to root:root when the path is absent —
# the bind-mounted host directory underneath does not seed it. Without this the
# volumes come up root-owned and the entrypoint's `pnpm install` cannot write a
# byte as a non-root user.
RUN mkdir -p /app/node_modules /app/apps/api/node_modules /app/apps/web/node_modules \
      /pnpm/store /home/node/.cache/ms-playwright \
    && chown -R node:node /app /pnpm /home/node/.cache

WORKDIR /app

COPY docker/dev-entrypoint.sh /usr/local/bin/dev-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-entrypoint.sh

# Last, so the layers above keep the root privileges they need (apt, npm -g).
USER node

ENTRYPOINT ["/usr/local/bin/dev-entrypoint.sh"]
CMD ["pnpm", "dev"]
