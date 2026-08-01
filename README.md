# Ritual Builder

A scheduler for team rituals. Teams lay out a deliberate cadence — weekly
rotations, standalone rituals, campaigns spanning weeks — across a period of
up to a year. See [PLAN.md](./PLAN.md) for the full design and phasing; this
README covers Phase 0 (scaffold) only.

## Tech stack

- **Frontend**: React 19 + TypeScript + Vite + React Router + TanStack Query
- **API**: Hono, served from the same Cloudflare Worker as the static assets
- **Database**: Cloudflare D1 (SQLite) via Drizzle ORM
- **Design system**: [Keel](https://github.com/czhengjuarez/Keel) (`@ops-forward/keel`) + Tailwind CSS
- **Icons**: Lucide React
- **Deploy**: Cloudflare Workers (`wrangler`)

## Development

```bash
npm install

# Local secrets (session signing key) — see .dev.vars.example
cp .dev.vars.example .dev.vars   # then fill in SESSION_SECRET

# D1: create once per environment, then point wrangler.jsonc at the real id
npx wrangler d1 create ritual-builder
npx wrangler d1 migrations apply ritual-builder --local

npm run dev
```

`npm run dev` runs the real Workers runtime via `@cloudflare/vite-plugin`, so
D1 bindings behave the same locally as in production.

**Local D1 data lives in `.wrangler/state/`, gitignored.** Deleting `.wrangler/`
(e.g. as part of a general "clean" pass) wipes your local database along with
build cache — re-run the migrate + seed steps below to restore it. This has no
effect on the remote database.

## Build & deploy

```bash
npm run build
npx wrangler secret put SESSION_SECRET   # production secret, once
npx wrangler d1 migrations apply ritual-builder --remote
npm run deploy
```

## Database

Schema lives in `db/schema.ts` (Drizzle):

- **Phase 0** — identity and tenancy: `users`, `teams`, `memberships`.
- **Phase 1** — the ritual library: `categories`, `jobs`, `rituals`,
  `ritual_jobs`. Seeded with 9 categories, 12 jobs, and 82 rituals drawn from
  design-team practice, IDEO/human-centered design, and named industry rituals
  (Google's TGIF, Amazon's six-pager, Coda's Dory/Pulse, and others — see
  PLAN.md §6 for sourcing and §6c for the attribution policy).

```bash
npm run db:generate         # after changing db/schema.ts
npm run db:migrate:local
npm run db:migrate:remote

# Seed data (run once per fresh database; safe to re-run — inserts only):
npx wrangler d1 execute ritual-builder --local  --file=db/seed/seed-categories-jobs.sql
npx wrangler d1 execute ritual-builder --local  --file=db/seed/seed-rituals.sql
npx wrangler d1 execute ritual-builder --remote --file=db/seed/seed-categories-jobs.sql
npx wrangler d1 execute ritual-builder --remote --file=db/seed/seed-rituals.sql
```

Ritual content is generated from structured data, not hand-written SQL — edit
`scripts/seed-rituals.mjs` and re-run `node scripts/seed-rituals.mjs` to change
it, rather than hand-editing `db/seed/seed-rituals.sql` directly.

## Authentication status

There is no login yet. Every visitor gets a signed anonymous session cookie
bound to an auto-created "personal workspace" team (`worker/session.ts`), so
the app is fully usable before auth exists. `users.google_sub` already exists
as a unique column — it's the merge key for the eventual identity-sharing with
[TeamRitualAudit](https://github.com/czhengjuarez/TeamRitualAudit), and the
verified-Google-token auth module already lives in that repo
(`src/auth/`), written app-agnostic so it ports here in Phase 2 without
rewriting. See PLAN.md §7 for the full sequencing.

## Project structure

```
worker/          Hono API — session middleware, library routes (categories/
                 jobs/rituals); planner/admin/ai routes in later phases
db/
  schema.ts      Drizzle schema
  migrations/
  seed/          generated seed SQL (see scripts/seed-rituals.mjs)
scripts/         seed-rituals.mjs — edit this, not the generated .sql
src/
  components/    Layout, ThemeToggle, Chip, RitualCard — built on Keel tokens
  pages/         PlanPage, CadencesPage, LibraryPage (filter/search/browse), AdminPage
  hooks/         useTheme, useSession, useLibrary (jobs/categories/rituals)
```
