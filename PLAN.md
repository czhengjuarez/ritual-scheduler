# Ritual Builder — Project Plan

**A scheduler for team rituals.** It helps a team lay out a deliberate cadence
across a period of up to a year. A ritual library ships with it, but the library
is an *input* — raw material for the schedule — not the product.

This document is the source of truth for scope and phasing. Update it as phases land.

---

## 1. What this app is (and isn't)

Most teams' calendars are an accident of history: things got added, nothing got
removed, and nobody chose the shape. Ritual Builder makes the calendar an
**intentional design artifact**.

**This app is a scheduler.** Its job is placement — what happens, how often, in
what order, with what spacing, over the next week or the next year.

**It is not a ritual encyclopedia.** We seed a good library and let people add
to it, but only so there is something to schedule. Any design decision that
trades depth-of-content against quality-of-scheduling goes to scheduling.

| Decision | Resolution |
|---|---|
| Entry point | **The job to be done** — what are you trying to change? Not a browse page. |
| Ritual fields | **Scheduling metadata** first (cadence, span, duration, prep lead, load, spacing) — prose second. |
| Primary shareable unit | **A cadence** — a whole plan someone clones — not a single ritual entry. |
| Home screen | Your plan. |
| Success metric | "This team has a plan they actually follow," not "the library has N entries." |
| AI's main job | Arranging rituals across time. Not writing ritual descriptions. |

### 1.1 Jobs to be done — the entry point

Intent comes first. A user doesn't arrive wanting "a ritual"; they arrive
wanting something to change. The app opens with **"What are you trying to
do?"**, and that answer drives everything downstream: which cadences surface,
which rituals the picker ranks, and what the AI optimizes for.

Starter job taxonomy (a first-class table, not a tag):

| Job | Typical span |
|---|---|
| Raise the quality of our craft | ongoing |
| Get aligned / cut the chaos | ongoing |
| Learn faster, build skills | ongoing |
| Make better decisions | ongoing |
| Get closer to our customers | ongoing or bounded |
| Build cohesion and belonging | ongoing |
| Onboard new people well | bounded (4–8 weeks) |
| Explore new tech / AI | bounded or ongoing |
| Make our work visible | ongoing |
| Run a research study | **bounded (1–6 weeks)** |
| Ship a launch well | bounded (per launch) |
| Reset after a hard stretch | one-off + short follow-through |

Jobs attach **many-to-many to both rituals and cadence templates**, because one
job is usually served by rituals from several different categories. Jobs are
also the primary filter in the cadence gallery and the primary input to the AI
suggester.

### 1.2 Rituals have very different spans

A ritual is not always a recurring meeting. Research might be a **one-week**
engagement; a mentorship program might run **the whole year**. The model has to
carry that, and the calendar has to draw it.

Four **engagement** shapes:

| Engagement | Meaning | Examples | Drawn as |
|---|---|---|---|
| `session` | one sitting, once | pre-mortem, offsite day, kickoff | a point |
| `recurring` | repeats indefinitely at a cadence | weekly crit, monthly roadmap review | repeated cells |
| `series` | fixed number of sessions over a window | 6-week onboarding, 4-part workshop | a dotted run |
| `campaign` | a continuous block of time, not a meeting | research week, design sprint, no-meeting month, year-long mentorship | **a bar spanning weeks** |

This is why `occurrences` carries a nullable `end_date` and the year grid
renders spans as bars rather than dots (§4, §5.1). Getting this wrong would
force every ritual into "recurring meeting" shape — which is exactly the
flattening that makes generic calendar tools useless for this.

### 1.3 The anchor use case (drives the rotation model)

A design team has **one weekly meeting slot** — say Thursday 10:00. Its *content
rotates* on a four-week cycle:

| Week | Theme | Example ritual |
|---|---|---|
| 1 | **Learning** | design crit, book club, craft workshop |
| 2 | **Innovation** | AI/new-tech demo, tech radar, prototype jam, guest speaker |
| 3 | **Team alignment** | staff meeting, roadmap review, planning |
| 4 | **Showcase + Spotlight** | low-key product showcase, person/work spotlight |

This is *not* four separate recurring meetings. It is one slot with a rotation,
and it's the thing generic calendar tools do worst.

### 1.4 Audiences

- **Team lead / design manager** — builds the plan, owns the year. *Primary.*
- **Team member** — sees what's coming, signs up to facilitate, prepares.
- **Admin (curator)** — approves published cadences and rituals into the public
  gallery. Team and private content never enters a queue.

### 1.5 Relationship to Team Ritual Audit

**[TeamRitualAudit](../TeamRitualAudit)** *diagnoses* process health across four
weighted pillars (Weekly Rhythm 25%, Decision Making 30%, Handoff Quality 25%,
Adaptability 20%), tracked quarterly. Audit diagnoses; builder prescribes.

Agreed sequencing:

1. **Now** — build Ritual Builder standalone. **Cross-link only** (a link out
   from each app, plus optional audit-score import).
2. **Next** — a **third project to deepen the ritual library** (research,
   sourcing, editorial). This lands **before** any merge.
3. **Eventually** — merge into one suite: audit → recommended cadence →
   schedule it → re-audit → watch the trend move.

Audit-score input to the AI suggester is **always optional**. The app must be
fully useful to someone who has never opened the audit.

The one thing to get right now for the merge: **a shared identity shape** (§7).

**The planned AI-native front door's `audit` destination (§5.2) is this
cross-link, made concrete**, decided 2026-08-02: a plain external `<a>` to
TeamRitualAudit — no shared session, no cross-app API calls, no shared
personalization store. This is intentionally cheap now and cheap to upgrade
later specifically because both apps already key `users` by `google_sub`
(§7) — a future merge becomes a join across that column, not a data
migration. Do not build deeper integration (a shared learning/personalization
store, cross-app reads of audit scores, etc.) before the library-first merge
above actually happens — that would mean integrating against a data/session
model that's still planned to change.

---

## 2. Stack decision

### Vite + React, not Next.js — recommended

**Decision: React 19 + Vite + Hono, all served from a single Cloudflare Worker.**

- **Bindings are first-class.** `@cloudflare/vite-plugin` runs real workerd in
  `vite dev`, so D1, R2, Workers AI, and Vectorize behave locally as they do in
  production. Next.js on Workers goes through the OpenNext adapter — an extra
  build layer and a worse local story for D1 + Drizzle migrations.
- **Shape of the app.** An authenticated planning tool with a heavy interactive
  calendar. Nothing needs SSR except the public cadence gallery, which a Worker
  can prerender cheaply if we want it.
- **Consistency.** `design-resources` is exactly this stack and the closest
  sibling — its admin auth, approval queue, and semantic search are proven code
  shapes to reuse.

### Full stack

| Concern | Choice |
|---|---|
| Runtime | One Cloudflare Worker (API + SPA assets) |
| Frontend | React 19, Vite, React Router, TanStack Query |
| API | Hono |
| DB | D1 (SQLite) via Drizzle ORM |
| Files | R2 — cover images, attachments, PDF exports |
| Vectors | Vectorize — semantic search over rituals *and* cadences |
| AI | Workers AI — embeddings, cadence suggestion, spacing analysis |
| Video | Cloudflare Stream — *Phase 8, optional*: recorded talks/showcases |
| Cache/limits | KV — *optional*: ICS cache, rate limiting |
| Design system | **Keel** (`@ops-forward/keel`) |
| Icons | Lucide (stroke `1.75`, size `20`) |
| Deploy | `wrangler deploy` |

Deliberately **not** used: Durable Objects, Queues, Hyperdrive.

### Repo layout

```
worker/
  index.ts       route mounting + SPA fallback
  db.ts          drizzle client
  auth/          ← standalone, app-agnostic (§7); extractable to a shared package
  planner.ts     /api/plans, /api/slots, /api/occurrences, generation
  templates.ts   /api/cadences — publish, browse, clone
  library.ts     /api/rituals, /api/categories, /api/jobs
  ai.ts          embeddings, semantic search, suggest, balance analysis
  ics.ts         calendar feed
  admin.ts       /api/admin/*
src/
  onboarding/    JTBD picker → recommended cadences
  planner/       year / quarter / month views, cycle editor, occurrence drawer
  cadences/      gallery, preview, clone, publish
  library/       ritual browse + picker + detail
  admin/
  components/    shared UI on Keel
  hooks/
db/
  schema.ts, migrations/, seed/
scripts/         seed + embedding backfill
```

---

## 3. Design system & look/feel

**Target: Keel + the `design101` generation.** Ritual Builder sets the new visual
bar for the suite — it does *not* match TeamRitualAudit, whose look is a older
and slated for replacement. When the two eventually merge, Audit adopts this
language, not the reverse.

Keel supplies `Button`, `Badge`, `Card`, `Input`, `Select`, `Textarea`, `Switch`
plus the `of-*` token layer (`--of-bg-*`, `--of-fg-*`, `--of-border-*`,
`--of-gradient-brand`). Install with `npm i @ops-forward/keel` and
`import '@ops-forward/keel/styles.css'`.

Patterns to carry over:

- **`design101`** — the primary reference for page rhythm, hero treatment, and
  section structure. Newest and cleanest of the set.
- **`design-resources`** — the browse shell: collapsible category sidebar with
  rollup counts, filter chips, debounced search, **card ⇄ list toggle persisted
  to localStorage**. Reuse for the ritual picker and cadence gallery.
- **`ai-resources`** — content-card density and layout.
- **`TeamRitualAudit`** — *reference for behaviour, not appearance.* Take the
  Google auth flow's UX shape (and fix its security — §7); leave the styling.

Restrained brand gradient: one hero element per page, never chrome.

Components Keel lacks that this app needs — build on Keel tokens in
`src/components/`, **do not fork Keel**:

`YearGrid` (52-week lane chart, must render **span bars** as well as point
cells) · `MonthCalendar` · `CycleBoard` (drag ritual into a rotation position) ·
`OccurrenceDrawer` · `CadenceCard` · `JobPicker` · `Timeline` · `Chip` ·
`Modal` (lift from `design-resources`) · `EmptyState` · `StatTile`.

Category colours are the primary visual language across calendar views — one hue
per category from Keel's palette, contrast-checked in light and dark. Colour is
never the only signal; every category also carries an icon and a label.

---

## 4. Data model

Drizzle schema in `db/schema.ts`. The tables that matter: `slots`,
`rotation_items`, `occurrences`, `cadence_templates`, `jobs`.

### Identity & tenancy

```
users            id, email, name, avatar_url, google_sub UNIQUE,
                 role(user|admin), created_at
teams            id, name, slug, timezone, created_by, created_at
memberships      team_id, user_id, role(owner|editor|viewer)
```

`google_sub` is the merge key across the whole suite — see §7.

**Pre-auth testing:** every visitor gets an anonymous signed session cookie bound
to an auto-created "personal workspace" team. First Google sign-in **claims**
that team rather than discarding it. This is why teams exist from day one.

### Jobs to be done

```
jobs             id, slug, name, description, icon, sort_order,
                 typical_span(ongoing|bounded|one-off)
ritual_jobs      ritual_id, job_id, weight        -- how well this serves the job
cadence_jobs     cadence_template_id, job_id
```

### Rituals — tuned for scheduling

```
categories       id, name, slug, color, icon, description, sort_order

rituals          id, slug, title, summary, purpose,
                 category_id,
                 visibility(public|team|private),
                 status(draft|pending|published|rejected),
                 owner_team_id, created_by,

                 -- shape & span (§1.2)
                 engagement(session|recurring|series|campaign),
                 span_weeks,            -- series/campaign only; null otherwise
                 default_cadence(weekly|biweekly|monthly|quarterly|annual|adhoc|rotation),

                 -- scheduling metadata (priority fields)
                 duration_min,          -- length of one sitting
                 prep_lead_days,        -- how far ahead prep must start
                 load(light|medium|heavy),
                 participants(core-team|extended|cross-functional|guests|leadership),
                 size_min, size_max,
                 format(sync|async|hybrid),
                 timing_hint,           -- 'start-of-week' | 'end-of-week' | 'after-planning' | null
                 min_gap_weeks,         -- minimum spacing between instances
                 pairs_well_with json,  -- ritual slugs
                 avoid_near json,       -- ritual slugs — spacing conflicts
                 depends_on,            -- e.g. ship review needs a ship

                 -- runbook content (secondary, required for seeded entries)
                 facilitator_role, prep_notes,
                 agenda        json [{title, minutes, notes}]
                 outputs       json [string]
                 materials     json [string]
                 anti_patterns json [string]     -- how this ritual dies
                 variations    json [{name, description}]

                 tags json, source_name, source_url, attribution, source_verified,
                 cover_key, embedding_version, created_at, updated_at
```

The scheduling block is what enables placement intelligence and conflict
warnings — "two heavy rituals in one week," "this needs 5 days of prep but sits
the Monday after a holiday." `anti_patterns` and `outputs` keep entries feeling
like *rituals* rather than calendar invites.

### Cadence templates — the primary shareable unit

```
cadence_templates  id, slug, name, summary,
                   visibility(public|team|private),
                   status(draft|pending|published|rejected),
                   owner_team_id, origin_plan_id, created_by,
                   duration_weeks,          -- 1 / 6 / 12 / 26 / 52 — any length
                   discipline,              -- product design, UX research, design systems…
                   team_size_min, team_size_max,
                   work_mode(remote|hybrid|in-person),
                   goals json,
                   definition json,         -- portable, date-free spec
                   source_name, source_url,
                   clone_count, featured, created_at
```

Cadences are **any length** — a one-week research cadence is as valid as a
52-week team cadence, matching §1.2.

`definition` is self-contained and date-free: slots with relative anchors (week
1 of the plan, not `2026-03-05`), rotation items referencing **ritual slugs**
rather than ids so templates stay portable across databases and survive
re-seeding, and standalone rituals/campaigns with relative offsets and spans.

Two operations define the product loop:

- **Publish** — take a team's plan, strip dates/names/people/private rituals,
  emit a `definition`. Public publishes hit the admin queue; team publishes are
  instant.
- **Clone** — instantiate a `definition` against a chosen start date and
  timezone, generating slots, rotations, and occurrences.

"Start from a cadence" is the **primary onboarding path**, reached through the
JTBD picker.

### Planner

```
plans            id, team_id, name, start_date, end_date, timezone,
                 status(draft|active|archived), ics_token,
                 from_template_id NULL, primary_job_id NULL,
                 created_by, created_at

slots            id, plan_id, name, color,
                 freq(weekly|biweekly|monthly),
                 byweekday, nth,       -- monthly: 1st / 2nd / -1 Thursday
                 start_time NULL,      -- optional: plan at week granularity
                 duration_min,
                 cycle_length,         -- 1 = plain recurrence, 4 = the rotation
                 anchor_date,          -- cycle position 0 lands here
                 active_from, active_to

rotation_items   id, slot_id, position (0..cycle_length-1), ritual_id NULL, label

occurrences      id, plan_id, slot_id NULL, ritual_id NULL,
                 date,
                 end_date NULL,        -- ← spans: campaigns and multi-day sessions
                 start_time NULL, duration_min,
                 title_override,
                 status(planned|confirmed|done|skipped|cancelled),
                 owner_user_id, facilitator, guest_name,
                 notes, agenda_override json,
                 origin(rotation|manual|template|ai),
                 edited_at NULL,       -- non-null ⇒ protected from regeneration
                 created_at

reflections      id, occurrence_id, rating(1-5), what_worked, what_didnt,
                 author_user_id, created_at

assets           id, r2_key, kind(cover|attachment|export),
                 ritual_id NULL, occurrence_id NULL, cadence_template_id NULL,
                 mime, size, created_at

ai_runs          id, team_id, plan_id NULL,
                 kind(suggest|balance|remix|autofill),
                 input json, output json, accepted, created_at
```

### Occurrence generation

Occurrences are **materialized rows**, not computed on read — each carries an
owner, guest, notes, and a reflection.

```
generate(slot, from, to):
  for each date d matching (freq, byweekday, nth) in [from, to]:
    position = floor(weeksBetween(anchor_date, d)) % cycle_length
    item     = rotation_items[position]
    upsert occurrence(slot_id, date) with ritual_id = item.ritual_id
```

Campaigns and series are placed directly as occurrences with an `end_date`, not
through slots.

Regeneration obeys one rule:

> Delete and rebuild only occurrences where `origin IN ('rotation','template')`,
> `status='planned'`, `edited_at IS NULL`, and `date >= today`.
> Everything else is a human decision and survives.

Timezone: dates as `YYYY-MM-DD`, times as local `HH:MM` in `plans.timezone`. No
UTC conversion until ICS export, which emits `DTSTART;TZID=`. **Week-granularity
planning is first-class** — leave `start_time` null.

---

## 5. Feature areas

### 5.1 Planner — the product

Four views over one plan:

- **Year** — 52-week grid, one lane per slot plus lanes for standalone rituals
  and campaigns; cells coloured by category; **campaigns and series render as
  bars across their span**. The signature view: you see at a glance that Q3 has
  no learning in it.
- **Quarter** — 13 weeks, more detail, drag to move.
- **Month** — conventional calendar for the near term.
- **Cycle editor** — the rotation board. Each position 1..N is a free-text
  box (`RitualComboInput`, revised 2026-08-02): typing and submitting
  schedules exactly what you typed, no library entry required; a live
  suggestion dropdown underneath offers matching library rituals as
  one-click shortcuts, and a library icon still opens the full
  search/filter/create picker as an opt-in escape hatch. The library is a
  suggestion, never a gate — the inverse of the original "must pick from
  the library" flow.

Slots (the recurring rotation itself, not just its occurrences) are fully
CRUD-able via "Manage slots": rename, change cadence, edit the rotation, or
delete the whole series — not just create new ones. Cadence is a preset
picker (Weekly, Every 2/3/4 weeks, Monthly, Quarterly, Annual, or a raw
"every N weeks/months" Custom option) backed by a `slots.interval` column;
quarterly and annual are just monthly with `interval` 3 or 12, not separate
frequencies (`worker/schedule.ts`'s `generateSlotDates` steps by `interval`
weeks/months instead of a fixed 7/30-ish day gap).

Occurrence drawer: swap ritual, assign facilitator/owner, add a guest, extend a
span, skip an instance, reschedule its date/time/duration, attach notes, log a
reflection afterwards, or remove it from the plan entirely.

Scheduling intelligence (rules, not AI — cheap and instant): heavy-load
clustering, `min_gap_weeks` violations, `avoid_near` conflicts, prep-lead
warnings, overlapping campaigns, holiday/blackout weeks, per-person facilitation
load.

### 5.2 Onboarding — JTBD first

**The front door is its own page (`/`, HomePage.tsx), reached by clicking
"Ritual Builder" in the header.** It shows only the one-sentence app
description and a freeform intent box — no job chips. This went through
several same-day revisions on 2026-08-02: chip picker only → intent box
added *alongside* the chips as a permanent fixture of `/plan` → chips
dropped, front door moved to its own page (one-shot classify-and-route) →
**current form: a real conversational builder, not a classifier**. The
one-shot version just linked off to a filtered `/cadences` gallery when it
detected a "design a cadence" ask, which wasn't actually building anything
for you — it was still a hand-off.

`IntentBox.tsx` now holds a short back-and-forth against `POST
/api/intent/converse` (same tool-calling infra as cadence
suggestion/remix/autofill, §5.6), sending the whole transcript each turn.
The model calls a single `respond` tool with an `action`:
- **`ask`** — still missing a job and/or a team size (the two required
  inputs; work mode and plan length are optional, length defaults to 12
  weeks). The model asks for exactly one missing thing at a time and the
  reply renders as a follow-up question; the frontend just waits for the
  next message.
- **`propose`** — has enough to design one. The server runs the *same*
  `generateCadenceSuggestion` pipeline "Design my quarter" uses (factored
  out of `/api/suggest-cadence` so both share one implementation), and
  returns a `SuggestCadenceResult` embedded in the response. `IntentBox`
  renders a compact review (slots/rotation/standalone, real ritual titles)
  plus plan name/start date fields and a **"Build it on my calendar"**
  button, which calls the existing `useAcceptSuggestion` accept endpoint —
  the exact same generate → review → accept pipeline as the modal, just
  reached by talking instead of filling in a form.
- **`route`** — the ask isn't about building a cadence at all:
  `plan` (blank slate, `/plan?new=1`), `ritual` (`/library`), `calendar`
  (back to the active plan, or a fallback note if there's none), `audit`
  (external link to TeamRitualAudit, `src/config/suite.ts`, §1.5). There is
  no `gallery` destination anymore — that case now goes through
  ask/propose instead of linking to the gallery.

Two defensive server-side downgrades in `worker/ai.ts` (never trust the
model's adherence to its own schema, same discipline as everywhere else in
that file): `propose` without a real job+teamSize gets forced back to
`ask`, and `route` without a valid `destination` also gets forced back to
`ask` — the model does sometimes pick `route` without filling in
`destination`, which would otherwise reach the frontend's `switch` and
silently do nothing.

`/plan` itself is still just the planner: "Start a plan" is the default
body when there's no active plan (a single card — plan name/dates — plus a
second "Or let AI design one for you" card seeded with job chips/team
size/work mode that opens the same `SuggestCadenceModal`), and the calendar
otherwise. Neither embeds the intent box; that's Home's job alone.
`src/lib/cadenceFilters.ts` (the old classify→gallery param mapping) was
deleted along with the `gallery` destination — nothing else used it.

**Personalization (e.g. "this user always goes straight to the calendar" or
"always audits first") is still deferred until there's real usage data to
learn from.**

### 5.3 Cadences — browse, clone, publish

Gallery filtered by **job**, discipline, team size, work mode, and duration.
Publishing your own plan is a first-class planner action with a review step
showing exactly what gets stripped before it leaves your team.

### 5.4 Ritual library — supporting cast

Browse/filter/search and a runbook detail page, but the library's main surface is
the **picker** inside the cycle editor: search, filter by job/duration/load, drag
into position. Adding a missing ritual is a small inline form — it lands as a
team-visibility ritual immediately; publishing publicly is an optional second
step.

### 5.5 Admin

Queue for **public cadence templates** (primary) and **public rituals**
(secondary): approve, edit-then-approve, reject. Plus categories and jobs CRUD
(delete = reparent, no orphans), ritual CRUD, `featured` flag, and a
**source-verification view** for attribution (§6).

Spam controls from `design-resources`: off-screen honeypot (not `display:none`)
plus a `renderedAt` timing check, both returning generic success.

### 5.6 AI (Workers AI + Vectorize)

In build order:

1. **Semantic search** — embed rituals *and* cadences with
   `@cf/baai/bge-base-en-v1.5` (768-dim, cosine) into Vectorize. Powers the
   picker and gallery. `remote: true` so `wrangler dev` hits the real index.
2. **Cadence suggestion** — "Design my quarter." Inputs: **selected jobs**
   (primary), team size, work mode, seniority, current meeting load, horizon,
   existing slots, and **optionally** a Team Ritual Audit score. Output: strict
   JSON of slots + rotations + campaigns, drawn only from ritual slugs and
   template ids retrieved from Vectorize — retrieval-grounded, so the model
   *arranges* real entries and cannot invent rituals. Rendered as a reviewable
   diff. Every run logged to `ai_runs`.
3. **Balance & spacing analysis** — category mix, hours per person per week,
   clustering, gaps. Mostly arithmetic; the model writes only the narrative.
4. **Remix** — adapt a ritual to context ("6 people, remote, 30 minutes"), saved
   as a team-visibility ritual derived from the original.
5. **Autofill** — paste a title/URL/notes, get drafted summary, category, job
   tags, and scheduling metadata for the contributor to correct.

Guardrails: model IDs verified against Workers AI at implementation time;
generation rate-limited; nothing AI-generated reaches the public gallery without
human acceptance.

### 5.7 Export & integrations

- **ICS feed** per plan at `/ics/:token.ics` — subscribable in Google, Outlook,
  Apple Calendar; rotatable token. Campaigns export as all-day multi-day events.
- One-off `.ics` for a single occurrence.
- **Google Calendar push** — after Google auth (§7).
- Printable / PDF year plan via R2.
- **Team Ritual Audit** — cross-link both ways; optional score import.

---

## 6. Seed content

### 6a. Seed cadences (~6) — more important than the rituals

What new users clone, reached from the JTBD picker. Deliberately varied in
length to prove spans work:

1. **The Four-Week Design Cadence** (52 wk) — Learning · Innovation · Alignment ·
   Showcase + Spotlight. The flagship.
2. **Research Study Week** (1 wk) — a *bounded* cadence: recruit, sessions, watch
   parties, synthesis, readout. Proves short-span cadences are first-class.
3. **New Design Team, First Quarter** (12 wk) — light load, norms-setting.
4. **Design Systems Team** (26 wk) — office hours, contribution review, adoption
   check-ins, release rhythm.
5. **Small Team / Under 6 People** (52 wk) — one weekly slot, one monthly slot,
   nothing else. Proves usefulness at small scale.
6. **Craft-Focused Quarter** (12 wk) — crit, portfolio review, accessibility,
   polish passes. The natural landing place for a weak-craft audit result.

### 6b. Seed rituals (~70) — the ingredients

Drawn from many traditions, not one source. Each entry needs scheduling metadata
(including `engagement` and `span_weeks`) plus purpose, agenda, outputs, and
anti-patterns.

**Categories (9):** Learning & Craft · Research & Customer Exposure ·
Innovation & Exploration · Alignment & Operations · Showcase & Storytelling ·
Decision Making · People & Culture · Reflection & Renewal · Outside Voices

**A. Design & craft** — design crit; design review (distinct from crit);
portfolio/work review; design system office hours; pairing hour; craft workshop;
book/article club; sketch jam; prototype jam; design QA / polish pass;
accessibility review; content design review.

**B. UX research & customer exposure** — research readout; usability test watch
party; **user exposure hour** (Jared Spool's 2 hours every 6 weeks); customer
support rotation / "support week" *(campaign)*; field visit; research repository
grooming; assumption mapping; journey map review; dogfooding; insight of the
week (async); **research study week** *(campaign)*.

**C. IDEO & human-centred practice** — brainstorm with the seven rules; "How
Might We" framing; flare & focus; build-to-think / prototype-driven meeting;
analogous inspiration trip; **design sprint** *(campaign, 1 wk)*.

**D. Innovation & new tech** — AI & new-tech demo (your week 2); tech radar
review; hack day; tool bake-off; "what I learned" lightning talks; AI prompt
exchange.

**E. Alignment & operations** — staff meeting; roadmap review; quarterly
planning / OKR setting; OKR check-in; all-hands / **TGIF** (Google); **Dory**
Q&A and **Pulse** (Coda); **V2MOM** (Salesforce); standup / async check-in;
weekly written update ("snippets"); **no-meeting day / week** *(campaign)*.

**F. Showcase & storytelling** — product showcase, low-key (your week 4); demo
day / ship review; **team spotlight** (your week 4); launch story / release
notes; internal newsletter.

**G. Decision making** — **SPADE** (Gokul Rajaram); DACI; **six-pager silent
read** (Amazon); pre-mortem; disagree-and-commit checkpoint; decision log review;
**Rapids** (Coinbase).

**H. People & culture** — kudos round; **fail faire**; personal user manual /
"working with me"; random coffee pairing; new-hire intro + **onboarding
programme** *(series, 4–8 wk)*; work anniversaries & birthdays; career growth
check-in; **mentorship pairing** *(campaign, up to 52 wk)*; **Cupcake**
(DoorDash); **Spin the Wheel** (Stripe); **hiring call** (Gusto); weekly wins.

**I. Reflection & renewal** — retro with variants (starfish, sailboat, 4Ls);
post-launch retro; working agreement refresh; team offsite; **Reset** (Thrive);
**quarterly ritual audit** ← the TeamRitualAudit hook; calendar audit / meeting
cleanse.

**J. Outside voices** — guest speaker series *(series)*; cross-functional
exchange; external crit with another company's team; conference watch party;
customer advisory session.

### 6c. Attribution — accurate, linked, refined as we go

Best effort at seed time, always with a link, improved iteratively:

- Every company- or person-attributed entry carries `source_name` +
  `source_url`.
- A `source_verified` boolean starts `false`. The admin **source-verification
  view** (§5.5) lists unverified attributions so you can confirm URLs in batches.
- Unverified attributions still publish — they're marked, not blocked. Getting
  the ritual scheduled matters more than a perfect citation, and this is
  correctable.
- We describe and credit; we never reproduce anyone's copyrighted text.

Starting sources:
- <https://www.youtube.com/watch?v=veG6_hcrShE> — Config 2023, Shishir Mehrotra & Yuhki Yamashita
- <https://coda.io/@shishir/figmaconfig2023> — talk companion doc
- <https://coda.io/gallery/rituals-of-great-teams> — ritual gallery
- <https://docs.superhuman.com/d/Rituals-of-Great-Teams_dJfqgxV3UDv/Strategy-Outputs_suizoxaS>
  (JS-rendered; needs manual reading — not fetchable by tooling)
- IDEO's design-thinking practice; NN/g and Jared Spool on research exposure;
  Derby & Larsen for retrospective variants.

---

## 7. Auth — one login for the suite

### The decision

**Build the auth module once, here, early — and activate it late.**

Rationale: writing it early is cheap; retrofitting identity later is expensive,
and doing it twice (once per app) is the real waste. But you asked to test
freely, so it ships behind a flag with the anonymous path as default.

### Status: the module exists

**Built and tested 2026-08-01, in `TeamRitualAudit/src/auth/`** — written
app-agnostic specifically so Ritual Builder can port it. It has no imports from
the audit app; it depends only on WebCrypto and `fetch`.

- `google.js` — JWKS fetch/cache with rotation handling, RS256 verification,
  claim validation (`iss` / `aud` / `exp`, pinned algorithm).
- `session.js` — HMAC-SHA256 signed, HttpOnly, `SameSite=Lax` session cookies.
- `index.js` — `getUser()` + the `/api/auth/*` routes.
- `auth.test.mjs` — 18 cases: valid tokens, tampered payloads, `alg: none`,
  algorithm confusion, expiry, wrong audience, key rotation, forged and expired
  sessions. `npm run test:auth`.

**Porting task for Phase 2:** translate to TypeScript, swap the cookie name,
and back it with the D1 `users` table instead of a stateless payload. The
verification logic transfers unchanged.

### Why the canonical implementation lives here, not in TeamRitualAudit

TeamRitualAudit's Google sign-in *was* client-side only: its Worker read
`?userId=` straight from the query string and used it to get, overwrite, or
delete `user-data/${userId}.json` in R2 with no token verification anywhere, so
anyone knowing a Google `sub` could read or destroy another user's audits.
**Fixed 2026-08-01** — and the fix was written as the shared module above rather
than as a patch, so the correct implementation now exists once and gets adopted
rather than reinvented.

### Four moves, in order of value

1. **One Google Cloud OAuth client** for the whole suite, with both apps'
   origins registered as authorized JavaScript origins. One consent screen, one
   brand. Free, do it now.
2. **Key `users` by `google_sub`** in both apps (`UNIQUE`). This is the
   load-bearing decision: it makes the eventual merge a join rather than a
   migration, and nobody re-registers. Do this even while auth is off.
3. **Auth as a standalone, app-agnostic module** at `worker/auth/`:
   Google Identity Services on the client; the Worker verifies the ID token
   against Google's JWKS using **WebCrypto** — not `google-auth-library`, which
   drags in Node APIs — then issues its own signed httpOnly session cookie.
   Extract to a shared package alongside Keel once proven, and backport to
   Audit.
4. **True SSO needs a custom domain.** One session shared across both apps means
   a cookie scoped to a parent domain. On `*.workers.dev` that's unreliable: if
   `workers.dev` sits on the Public Suffix List, browsers reject a cookie scoped
   to `coscient.workers.dev` outright. Sources conflict, and it isn't worth
   building on an uncertainty. **A custom domain resolves it and also unlocks
   Cloudflare Access for admin (§9.4)** — two problems, one purchase.

### Staging

| Stage | Mechanism |
|---|---|
| Phase 0–5 | **No login.** Anonymous signed session → auto-created personal team. Admin gated by `ADMIN_PASSWORD` + signed httpOnly cookie (`design-resources` pattern). `users.google_sub` column exists but is unused. |
| Phase 2 | Auth module **written and tested**, shipped disabled behind `AUTH_ENABLED`. |
| Phase 6 | **Google Sign-In on.** First sign-in claims the anonymous team. `users.role='admin'` supersedes the password gate. |
| Later | Custom domain → shared session across the suite; team invites; roles enforced on every `/api/plans/*` route. |

Authorization rule from day one, even pre-auth: **every planner query is scoped
by `team_id` from the session.** Retro-fitting tenancy is exactly how the Audit
bug above happened.

---

## 8. Phases

Each phase ends deployed and usable.

**Phase 0 — Scaffold**
Vite + React 19 + TS, `@cloudflare/vite-plugin`, Hono, Keel, app shell (header,
nav, theme toggle), routing, D1, Drizzle + first migration, `wrangler deploy`
green.

**Phase 1 — Rituals & jobs as ingredients**
Categories, jobs, rituals schema with full scheduling metadata and the
`engagement`/`span` model. Seed ~70 rituals with job tagging. Minimal browse +
the picker. Not a polished library UX yet — just enough to schedule from.

**Phase 2 — Planner core** ← *the product*
Plans, slots, rotation items, occurrence generation, **campaigns and series with
spans**. Cycle editor. Month and quarter views. Occurrence drawer. Anonymous
team session. Rules-based spacing warnings. **Auth module written, disabled.**

**Phase 3 — Year view + ICS**
52-week grid with category colouring, span bars, drag-to-move. Subscribable ICS
feed. First phase genuinely useful to a real team.

**Phase 4 — Cadences: clone & publish**
`cadence_templates`, portable `definition`, clone-with-start-date,
publish-from-plan with strip review, gallery with job filters and mini-grid
preview. Ship the 6 seed cadences.

**Phase 5 — JTBD onboarding, contribution & admin**
"What are you trying to do?" as the front door. Public publish queue for
cadences and rituals, admin gate, CRUD, source-verification view, spam controls.

**Phase 6 — AI**
Vectorize + embedding backfill, semantic search, job-driven cadence suggestion
with accept/edit diff, balance & spacing analysis, remix, autofill. Optional
audit-score input. **Planned next:** intent-classification front door (§5.2)
routing freeform text to a plan/gallery/ritual/calendar/audit destination.

**Phase 7 — Auth on & teams**
Enable Google Sign-In, anonymous-team claim, memberships and roles, team
switcher, per-member facilitation load. Then Google Calendar push.

**Phase 8 — Extras & the audit bridge**
R2 covers/attachments; Stream for recorded talks; PDF export; reflections
rollup; TeamRitualAudit cross-links + optional score import.

**Phase 9 — Polish**
Calendar keyboard nav, a11y pass, empty states, mobile drawer, seed-copy edit,
performance on a 52-week × N-lane grid.

---

## 9. Open questions

1. **Plan granularity default** — week-level with optional times (current plan),
   or ask for times up front? Revisit after Phase 2.
2. **Stream cost/scope** — confirm before building in Phase 8.
3. **Custom domain — now or later?** Needed for suite-wide SSO (§7.4) *and* for
   Cloudflare Access on admin. Recommend acquiring before Phase 7.
4. **Where does the library-depth project live?** Its own repo/service, or a
   content pipeline that seeds this D1? Affects whether rituals need a separate
   schema.
*Resolved:*
- Primary shareable unit is a **whole cadence**, not an individual ritual (§4).
- **Library-depth project comes before the merge**; cross-link only for now (§1.5).
- Look and feel follows **Keel + design101**, not TeamRitualAudit (§3).
- **Rituals can be any span** — one week to a year — via `engagement` (§1.2).
- **JTBD is the entry point** (§1.1).
- **One shared auth module + `google_sub` as the merge key**, written here,
  backported to Audit (§7).
- **Front door becomes AI-native, additively, and always renders** — one
  freeform intent box above the existing JTBD chips, classified by a Workers
  AI call into a plan/gallery/ritual/calendar/audit destination; it stays on
  screen even once an active plan exists (revised 2026-08-02 — disappearing
  once there's data left a returning user with no orientation). The chip
  picker remains the deterministic fallback, and personalization is
  deferred until there's real usage data (§5.2).
- **Audit stays a plain external link** until the real merge — no cross-app
  API calls or shared personalization store before then (§1.5).
- **Multi-plan per team: several plans coexist, none of them exclusive**
  (decided 2026-08-02, ahead of the Phase 7 timeline above — a real user
  hit this managing more than one team's calendar). Creating a plan no
  longer archives whatever else exists (`archiveActivePlans` removed from
  both `POST /plans` and `instantiatePlanFromDefinition`); `PlanPage`
  remembers whichever plan you last picked and otherwise falls back to the
  most recently created one. `status` (`draft`/`active`/`archived`) is now
  a plain user-controlled label, not an exclusivity mechanism — "Manage
  plans" can rename, edit dates, restore an archived plan back to active
  (a `PATCH .../status` round trip; there's no archive action in the UI
  yet, only restore for plans archived before this change or via the API),
  and delete any plan, plus switch which one the calendar is showing
  (§5.1).

---

## 10. Setup commands (Phase 0)

```bash
npm create vite@latest . -- --template react-ts
npm i @ops-forward/keel hono drizzle-orm lucide-react react-router-dom @tanstack/react-query
npm i -D wrangler drizzle-kit @cloudflare/vite-plugin @cloudflare/workers-types
npm i -D tailwindcss @tailwindcss/vite   # Keel supplies tokens + components;
                                          # Tailwind covers layout/utilities.
                                          # Same pairing as design-resources.

npx wrangler d1 create ritual-builder
npx wrangler r2 bucket create ritual-builder-assets
npx wrangler vectorize create ritual-builder-embeddings --dimensions=768 --metric=cosine

npx drizzle-kit generate
npx wrangler d1 migrations apply ritual-builder --local
npm run dev
```

`wrangler.jsonc` bindings: `DB` (D1), `ASSETS` (SPA, `not_found_handling:
single-page-application`), `MEDIA` (R2), `AI`, `VECTORIZE` (`remote: true`).
Secrets: `SESSION_SECRET`, `ADMIN_PASSWORD`, later `GOOGLE_CLIENT_ID`.
