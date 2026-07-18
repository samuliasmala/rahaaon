# Rahaa on.

Rahaaon.fi — kansalaisten ilmoittamia, tekoälyn tiivistämiä ja toimituksen tarkistamia julkisen rahankäytön rahareikiä.

A crowdsourced tracker of wasteful public spending in Finland: citizens submit a link to a news
article, an AI pass extracts the amount, entity and category and drafts a summary, and an editorial
queue reviews everything before it is published to the public feed.

## Status

Frontend prototype. The web app implements the full UI (public feed + editorial admin) against an
in-memory store with seed data; the AI ingestion pipeline and backend API are not built yet.

## Stack

pnpm + Turborepo monorepo, TypeScript (strict, ESM).

- `apps/web` — React 19 SPA: Vite, TanStack Router (file-based), Tailwind CSS v4 (CSS-first theme),
  zustand, sonner. UI text is Finnish.

## Development

```bash
pnpm install
pnpm dev        # Vite dev server on :5173
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Design

The UI implements `docs/design/rahaaon-proto.dc.html` (Claude Design project
"Rahaaon.fi turhien menojen keruu"). Design tokens (colors, fonts) are defined in
`apps/web/src/styles/globals.css`.
