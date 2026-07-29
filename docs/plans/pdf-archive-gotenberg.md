# PDF snapshots of submitted articles (Gotenberg sidecar)

Status: planned, not implemented (2026-07-29).

## Context

Archive worker currently stores submitted article text as Markdown in S3. Editors want a PDF snapshot too — faithful visual copy of the source page, downloadable from admin UI. Chosen approach: Gotenberg sidecar (`gotenberg/gotenberg:8`, headless Chromium behind HTTP) on the compose network; worker calls it best-effort during the existing archive attempt; PDF stored in S3 next to the `.md`; admin downloads via same-origin `<a href>` (cookie auth). Feature optional: off when `GOTENBERG_URL` unset.

Key decisions:

- PDF rendered only when archive classifies `ok` (paywalled pages = consent-wall junk).
- Best-effort: PDF failure never changes archive status, no PDF-specific retries (retries ride the text retry path). Warn-log on failure.
- No status machine — just nullable `archive_pdf_key`; `hasArchivedPdf = key !== null`.
- SSRF: prod Gotenberg runs `--chromium-deny-private-ips` (v8.32+ also DNS-pins, mirrors `guardedLookup` posture). Dev leaves it off (localhost fixtures).

## Steps

1. **Schema**: `apps/api/src/db/schema/content.ts` — add `archivePdfKey: text("archive_pdf_key")` (nullable) after `archiveTextKey`. Run `pnpm --filter @rahaaon/api db:generate` (→ `drizzle/0009_*.sql`) + `db:migrate`.

2. **Env**: `apps/api/src/config/env.ts` — `GOTENBERG_URL: z.preprocess(emptyToUndefined, z.string().optional())` after S3 block. `.env.example`: `GOTENBERG_URL=http://localhost:3010` (base-compose host port). `.env.prod.example`: `GOTENBERG_URL=http://gotenberg:3000`. `deploy/init-env.sh` unchanged (value identical across envs).

3. **Gotenberg client**: new `apps/api/src/lib/gotenberg.ts`:
   - `pdfArchiveEnabled = s3Configured && Boolean(env.GOTENBERG_URL)`
   - `renderUrlToPdf(url): Promise<Uint8Array<ArrayBuffer> | null>` — never throws. Native fetch + FormData to `POST {GOTENBERG_URL}/forms/chromium/convert/url`, fields `url`, `emulatedMediaType=screen`, `printBackground=true`. `AbortSignal.timeout(60_000)`. Stream-read body with running total, bail >25 MB (attacker-chosen URLs; don't `arrayBuffer()` blindly). Sanity-check `%PDF` prefix. Warn-log + null on any failure.

4. **S3**: `apps/api/src/lib/s3.ts` — add `putBinaryObject(key, body: Uint8Array, contentType)` + `getBinaryObject(key): Promise<Uint8Array>` (`transformToByteArray`). Bump `requestTimeout` 10s→30s, update sizing comment.

5. **Worker**: `apps/api/src/lib/article-archive.ts`:
   - `archivePdfKeyFor(id)` → `archive/submissions/${id}.pdf`
   - `markTerminal(id, status, textKey, pdfKey = null)` — add `archivePdfKey: pdfKey` to the guarded update (manual-paste race stays safe).
   - In `archiveRow` ok-branch: `if (status === "ok" && pdfArchiveEnabled) pdfKey = await capturePdf(id, url)` between text put and `markTerminal`. `capturePdf` = render → `putBinaryObject` in try/catch (S3 put failure must not fall into the text retry path) → key or null.
   - Comment at `LEASE_MS`: 5s text + 60s render + 30s puts < 120s lease.

6. **API surface**:
   - `schemas.ts` (submissions feature): `hasArchivedPdf: z.boolean()` in `urlSubmissionSchema`.
   - `submissions.repo.ts`: `toView` adds `hasArchivedPdf: row.archivePdfKey !== null`; new `getSubmissionArchivePdf(id)` mirroring `getSubmissionArchiveText` (404 if key null, `getBinaryObject`, 503 on S3 error, filename `ehdotus-${id}.pdf`).
   - `submissions.routes.ts`: GET `/admin/submissions/{id}/archive/pdf`, `requireAuth`, `?download=1` → attachment disposition, response content `application/pdf` with `z.string().openapi({ format: "binary" })`, handler returns `c.body(new Uint8Array(bytes), 200)` (wrap needed for Hono's `Uint8Array<ArrayBuffer>` type).

7. **Codegen**: `pnpm --filter @rahaaon/api openapi:export && pnpm --filter @rahaaon/web api:generate`. Commit regenerated `openapi.json` + `apps/web/src/api/**`; no hand edits.

8. **Admin UI**: `apps/web/src/components/admin/archive-info.tsx` — after existing `Lataa` link:
   `{entry.hasArchivedPdf && <a href={…/archive/pdf?download=1} className={linkClasses}>Lataa PDF</a>}`

9. **Compose**:
   - `docker-compose.yml` (base): `gotenberg` service, `image: gotenberg/gotenberg:8`, `ports: ["127.0.0.1:3010:3000"]`, curl healthcheck on `/health`.
   - `docker-compose.dev.yml`: `app.environment` += `GOTENBERG_URL: http://gotenberg:3000`. No depends_on (minio precedent).
   - `docker-compose.prod.yml`: `gotenberg` service with `logging: *default-logging`, `mem_limit: 1g`, `expose: ["3000"]`, healthcheck, command `["gotenberg", "--chromium-max-concurrency=2", "--api-timeout=45s", "--chromium-deny-private-ips"]` (concurrency 2: worker offers ≤4 renders, VPS runs 3 stacks; 45s api-timeout < 60s client abort). `api.depends_on` unchanged (optional-dependency precedent = minio). Verify flag names via `docker run --rm gotenberg/gotenberg:8 gotenberg --help` before shipping.

10. **Integration tests**: `apps/api/src/archive.int.test.ts` — Gotenberg stub (`node:http`, POST `/forms/chromium/convert/url` → fake `%PDF-1.4` bytes; mutable `mode: ok|error|down`); set `process.env.GOTENBERG_URL` in `beforeAll` before `import("./app.js")` (env parsed once). Cases: happy path (`hasArchivedPdf` true, S3 object starts `%PDF`, GET pdf endpoint 200 `application/pdf`, `?download=1` disposition `ehdotus-{id}.pdf`); paywalled/thin → no PDF, endpoint 404; stub error/down → text archive still `ok`, `hasArchivedPdf` false; unauthenticated → 401. Flip mode only between in-flight submissions; close stub in `afterAll`.

11. **Deployment note** (DEPLOYMENT.md): append `GOTENBERG_URL=http://gotenberg:3000` by hand to existing `.env.dev/.env.test/.env.prod` on VPS (init-env.sh never rewrites); until then feature silently off — intended degradation.

## Verification

```
pnpm --filter @rahaaon/api db:generate && pnpm --filter @rahaaon/api db:migrate
pnpm --filter @rahaaon/api openapi:export && pnpm --filter @rahaaon/web api:generate
pnpm typecheck && pnpm lint
pnpm --filter @rahaaon/api test:integration   # needs Docker (testcontainers)
docker compose -f docker-compose.prod.yml --env-file .env.example config   # parse check
```

Manual smoke: `docker compose up -d` (db/minio/gotenberg), run app, submit real news URL, admin card gains "Lataa PDF", download opens PDF; object visible in MinIO console (localhost:9003).

## Risks (accepted)

- PDF = second independent page fetch; Chromium may show consent overlays the text fetch didn't. Best-effort; `waitDelay` future knob.
- Manual-paste race can orphan a PDF object in S3 (key never recorded). Harmless, same posture as text race; comment it.
- orval maps `format: binary` → `Blob` in generated client; unused (plain `<a>`), but confirm typecheck after regen.

## Unresolved questions

1. `emulatedMediaType=screen` + `printBackground=true` chosen for max visual fidelity (page as seen). Alternative: `print` media often gives cleaner article layout on news sites. OK with `screen`?
2. Existing "Lataa" link downloads the Markdown; next to new "Lataa PDF" it's slightly ambiguous. Rename to "Lataa teksti"? (Copy change, checked against design proto at implementation time.)
3. 25 MB PDF cap + 1 GB mem / concurrency 2 for Gotenberg — fine, or want different limits?
