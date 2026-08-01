# Ritual Builder

A scheduler for team rituals. Teams lay out a deliberate cadence — weekly
rotations, standalone rituals, campaigns spanning weeks — across a period of
up to a year. See [PLAN.md](./PLAN.md) for the full design and phasing; this
README covers through Phase 3 (year view + ICS).

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

- **Phase 2** — the planner: `plans`, `slots`, `rotation_items`, `occurrences`,
  `reflections`. Occurrence-generation date math lives in `worker/schedule.ts`
  (unit tests: `node worker/schedule.test.mjs`) and is deliberately separate
  from calendar-display math in `src/lib/calendar.ts` — one runs on the
  server and drives generation, the other only lays out a grid in the browser.

  D1's bound-parameter limit per statement is well below plain SQLite's
  default — `worker/planner.ts` batches inserts (10 rows at a time) to stay
  under it. If you see `D1_ERROR: too many SQL variables` after changing a
  batch insert, that's what happened; lower the batch size.

  The regeneration rule: editing a slot's rotation deletes and rebuilds only
  the occurrences that are still exactly what the rotation would have
  produced on its own — planned, unedited, rotation-origin, not yet in the
  past. Anything a human touched survives. See PLAN.md §4.

- **Phase 3** — the year grid and calendar export. No new tables: `plans.ics_token`
  (already in the schema from Phase 2) is generated at plan creation and
  exposed via the "Subscribe" panel. RFC 5545 formatting is pure and
  DB-free in `worker/ics-format.ts` (unit tests: `npm run test:ics`) —
  split out from `worker/ics.ts`'s routing/D1 code the same way
  `schedule.ts` is split from `planner.ts`, so the formatting logic can be
  run directly under plain Node/tsx without a Workers runtime.

  The subscribe feed (`GET /ics/:token.ics`) is deliberately **outside**
  `/api` and the session middleware — calendar apps poll it with no cookie,
  so the token in the URL is the only authorization. Rotating it
  (`POST /api/plans/:id/ics-token/rotate`) invalidates the old URL
  immediately. A single occurrence can also be downloaded as its own `.ics`
  via the authenticated `GET /api/occurrences/:id/ics` — a different route
  for a different trust model, not the same endpoint with a flag.

## Authentication status

There is no login yet. Every visitor gets a signed anonymous session cookie
bound to an auto-created "personal workspace" team (`worker/session.ts`), so
the app is fully usable before auth exists. `users.google_sub` already exists
as a unique column — it's the merge key for the eventual identity-sharing with
[TeamRitualAudit](https://github.com/czhengjuarez/TeamRitualAudit), and the
verified-Google-token auth module already lives in that repo
(`src/auth/`), written app-agnostic so it ports here in Phase 2 without
rewriting. See PLAN.md §7 for the full sequencing.

## The planner UI, and one deliberate scope trim

`/plan` is the home screen (PLAN.md §1): create a plan, add a slot with a
rotation of rituals, view it as a month or quarter calendar, click an
occurrence to edit facilitator/notes/status or log a reflection. Assigning a
ritual to a rotation position and to the calendar is done via a **picker
(search + click)**, not drag-and-drop — same functional outcome as PLAN.md
§3's `CycleBoard` description, without a DnD dependency for this first pass.
True drag interactions are a natural Phase 9 polish item.

Campaigns and multi-week rituals (a research week, a year-long mentorship)
render as a separate banner list above the month/quarter calendar rather
than as inline bars across day cells — solving that overlay inside a
day-cell grid isn't worth it there. The **year view** (`YearGrid`, Phase 3)
is where they render as real bars spanning their weeks, alongside one lane
per slot across all ~52 weeks of the plan — the signature view PLAN.md §5.1
describes: an empty stretch of cells reads at a glance as "no learning this
quarter," which month/quarter view can't show since each only displays one
month at a time. Quarter-boundary dividers are real calendar quarters
(Jan/Apr/Jul/Oct), not just every 13th column, so they don't drift for a
plan that doesn't start in January.

## Project structure

```
worker/
  index.ts       route mounting, session middleware
  library.ts     categories/jobs/rituals routes
  planner.ts     plans/slots/occurrences/reflections/warnings routes
  schedule.ts    occurrence-generation date math (+ schedule.test.mjs)
  ics-format.ts  pure RFC 5545 formatting (+ ics.test.mjs)
  ics.ts         /ics/:token.ics route + D1 reads (uses ics-format.ts)
  session.ts     anonymous session cookies
db/
  schema.ts      Drizzle schema
  migrations/
  seed/          generated seed SQL (see scripts/seed-rituals.mjs)
scripts/         seed-rituals.mjs — edit this, not the generated .sql
src/
  components/    Layout, ThemeToggle, Chip, RitualCard, Modal — built on Keel tokens
  pages/         PlanPage (the home screen), CadencesPage, LibraryPage, AdminPage
  planner/       CycleEditorModal, RitualPickerModal, OccurrenceDrawer,
                 MonthCalendar, CampaignBanner, YearGrid, SubscribePanel, WarningsPanel
  hooks/         useTheme, useSession, useLibrary, usePlanner
  lib/calendar.ts  client-side month-grid + year-week layout (display only — see above)
```
