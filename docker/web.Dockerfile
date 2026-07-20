# Production web image. Build the static Vite bundle, then serve it with nginx,
# which also reverse-proxies /api to the api service (so the browser stays
# same-origin — cookies work, no CORS).

# ---- builder ----------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
# pnpm via npm, not corepack (dropped from newer Node majors). Version matches
# "packageManager" in package.json.
RUN npm install -g pnpm@11.10.0
WORKDIR /repo

COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

COPY apps/web ./apps/web
# Build identity for the in-app version footer — the build context has no .git,
# so vite.config.ts reads these env vars instead. GIT_DESCRIBE is
# `git describe --tags --always` output; GIT_COMMIT the full SHA;
# GIT_COMMIT_TIME the commit's ISO 8601 timestamp (`git log -1 --format=%cI`).
ARG GIT_COMMIT
ENV GIT_COMMIT=$GIT_COMMIT
ARG GIT_DESCRIBE
ENV GIT_DESCRIBE=$GIT_DESCRIBE
ARG GIT_COMMIT_TIME
ENV GIT_COMMIT_TIME=$GIT_COMMIT_TIME
RUN pnpm --filter @rahaaon/web build

# ---- runtime ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
