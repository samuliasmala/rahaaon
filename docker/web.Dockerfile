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
RUN pnpm --filter @rahaaon/web build

# ---- runtime ----------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
