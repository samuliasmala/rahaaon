# Production API image. Multi-stage: install + build (tsdown bundles the app,
# keeps npm deps external) in the builder, then `pnpm deploy` assembles a
# self-contained /app (built dist + drizzle migrations + pruned prod node_modules)
# for a slim runtime.

# ---- builder ----------------------------------------------------------------
FROM node:24-bookworm-slim AS builder
# pnpm via npm, not corepack (dropped from newer Node majors). Version matches
# "packageManager" in package.json.
RUN npm install -g pnpm@11.10.0
WORKDIR /repo

# Install with the full workspace. Copying only manifests first caches the
# install layer across source-only changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

# Build the API (server + migrate + seed entries).
COPY apps/api ./apps/api
RUN pnpm --filter @rahaaon/api build

# Assemble a deployable dir: prod-only node_modules + the api's files (dist,
# drizzle, package.json). --legacy: pnpm otherwise refuses to deploy a
# workspace that doesn't use injected dependencies.
RUN pnpm --filter @rahaaon/api deploy --prod --legacy /app

# ---- runtime ----------------------------------------------------------------
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app ./
USER node
EXPOSE 3001
CMD ["node", "dist/server.js"]
