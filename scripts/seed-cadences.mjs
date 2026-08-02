#!/usr/bin/env node
/**
 * Generates db/seed/seed-cadences.sql — the 6 seed cadence templates
 * (PLAN.md §6a). Mirrors scripts/seed-rituals.mjs: edit this file and re-run
 * `node scripts/seed-cadences.mjs`, don't hand-edit the generated .sql.
 *
 * Every `ritualSlug` here must exist in db/seed/seed-rituals.sql — this
 * script doesn't validate that against a live database, so after changing
 * either seed, reseed both and check for foreign-key-shaped surprises
 * (a bad slug just silently resolves to no ritual at clone time — see
 * worker/cadences.ts's resolveRitualId — so a typo here fails quietly,
 * not loudly).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "db", "seed", "seed-cadences.sql");

/** @param {string} ritualSlug @param {number} position */
const rot = (position, ritualSlug, label = null) => ({ position, ritualSlug, label });

const CADENCES = [
  {
    slug: "four-week-design-cadence",
    name: "The Four-Week Design Cadence",
    summary: "One weekly meeting slot, four themes rotating through it: Learning, Innovation, Alignment, Showcase + Spotlight. The flagship — see PLAN.md §1.3.",
    durationWeeks: 52,
    discipline: "Product Design",
    teamSizeMin: 4,
    teamSizeMax: 14,
    workMode: "remote",
    goals: ["A predictable rhythm that still covers craft, exploration, alignment, and visibility"],
    jobs: ["raise-craft", "get-aligned", "explore-new-tech", "make-work-visible"],
    featured: true,
    definition: {
      slots: [
        {
          name: "Weekly Design Meeting",
          freq: "weekly",
          byweekday: 4, // Thursday
          durationMin: 60,
          rotation: [rot(0, "design-crit"), rot(1, "ai-new-tech-demo"), rot(2, "staff-meeting"), rot(3, "product-showcase")],
        },
      ],
      standalone: [
        { ritualSlug: "quarterly-ritual-audit", dayOffset: 7 * 12, spanWeeks: null },
        { ritualSlug: "quarterly-ritual-audit", dayOffset: 7 * 25, spanWeeks: null },
        { ritualSlug: "quarterly-ritual-audit", dayOffset: 7 * 38, spanWeeks: null },
        { ritualSlug: "team-offsite", dayOffset: 7 * 47, spanWeeks: null },
      ],
    },
  },
  {
    slug: "research-study-week",
    name: "Research Study Week",
    summary: "A focused, one-week push to get a real answer fast: assumptions mapped, sessions run, findings shared — not a month-long drift.",
    durationWeeks: 1,
    discipline: "UX Research",
    teamSizeMin: 2,
    teamSizeMax: 8,
    workMode: "remote",
    goals: ["Answer one specific question with real users, fast"],
    jobs: ["run-research-study", "closer-to-customers"],
    definition: {
      slots: [],
      standalone: [
        { ritualSlug: "assumption-mapping", dayOffset: 0, spanWeeks: null },
        { ritualSlug: "usability-watch-party", dayOffset: 2, spanWeeks: null },
        { ritualSlug: "research-readout", dayOffset: 4, spanWeeks: null },
      ],
    },
  },
  {
    slug: "new-design-team-first-quarter",
    name: "New Design Team, First Quarter",
    summary: "Deliberately light: one weekly meeting, working agreements set early, nothing else competing for attention while the team finds its footing.",
    durationWeeks: 12,
    discipline: "Product Design",
    teamSizeMin: 2,
    teamSizeMax: 6,
    workMode: "hybrid",
    goals: ["Set norms before adding ritual load", "Avoid over-scheduling a team that's still forming"],
    jobs: ["get-aligned", "onboard-well", "build-cohesion"],
    definition: {
      slots: [{ name: "Staff Meeting", freq: "weekly", byweekday: 1, durationMin: 45, rotation: [rot(0, "staff-meeting")] }],
      standalone: [
        { ritualSlug: "working-with-me", dayOffset: 3, spanWeeks: null },
        { ritualSlug: "working-agreement-refresh", dayOffset: 14, spanWeeks: null },
        { ritualSlug: "random-coffee", dayOffset: 28, spanWeeks: null },
      ],
    },
  },
  {
    slug: "design-systems-team",
    name: "Design Systems Team",
    summary: "Office hours every week, a contribution/adoption review every month, and a planning checkpoint — the rhythm a systems team runs on.",
    durationWeeks: 26,
    discipline: "Design Systems",
    teamSizeMin: 3,
    teamSizeMax: 10,
    workMode: "remote",
    goals: ["Keep the system easy to contribute to", "Catch adoption gaps before they calcify"],
    jobs: ["get-aligned", "raise-craft"],
    definition: {
      slots: [
        { name: "Design System Office Hours", freq: "weekly", byweekday: 2, durationMin: 30, rotation: [rot(0, "design-system-office-hours")] },
        { name: "Contribution & Adoption Review", freq: "monthly", byweekday: 1, nth: 2, durationMin: 45, rotation: [rot(0, "decision-log-review")] },
      ],
      standalone: [
        { ritualSlug: "quarterly-planning", dayOffset: 0, spanWeeks: null },
        { ritualSlug: "tech-radar-review", dayOffset: 7 * 12, spanWeeks: null },
        { ritualSlug: "quarterly-planning", dayOffset: 7 * 13, spanWeeks: null },
      ],
    },
  },
  {
    slug: "small-team-under-6",
    name: "Small Team / Under 6 People",
    summary: "One weekly slot, one monthly slot, nothing else. Proves the app is useful even when the team is too small for a heavier cadence.",
    durationWeeks: 52,
    discipline: "Product Design",
    teamSizeMin: 2,
    teamSizeMax: 6,
    workMode: "hybrid",
    goals: ["Stay aligned and reflective without over-scheduling a small team"],
    jobs: ["get-aligned"],
    definition: {
      slots: [
        { name: "Staff Meeting", freq: "weekly", byweekday: 1, durationMin: 30, rotation: [rot(0, "staff-meeting")] },
        { name: "Monthly Retro", freq: "monthly", byweekday: 5, nth: -1, durationMin: 45, rotation: [rot(0, "retro")] },
      ],
      standalone: [],
    },
  },
  {
    slug: "craft-focused-quarter",
    name: "Craft-Focused Quarter",
    summary: "Crit every week, plus a portfolio review, an accessibility pass, and a polish pass — the natural landing place after a ritual audit flags weak craft signals.",
    durationWeeks: 12,
    discipline: "Product Design",
    teamSizeMin: 3,
    teamSizeMax: 12,
    workMode: "hybrid",
    goals: ["Raise the craft bar for a quarter", "Follow up on a weak Team Ritual Audit craft score"],
    jobs: ["raise-craft"],
    definition: {
      slots: [{ name: "Design Crit", freq: "weekly", byweekday: 4, durationMin: 60, rotation: [rot(0, "design-crit")] }],
      standalone: [
        { ritualSlug: "portfolio-review", dayOffset: 7 * 6, spanWeeks: null },
        { ritualSlug: "accessibility-review", dayOffset: 7 * 3, spanWeeks: null },
        { ritualSlug: "design-qa-polish-pass", dayOffset: 7 * 9, spanWeeks: null },
      ],
    },
  },
];

function esc(v) {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "1" : "0";
  return `'${String(v).replace(/'/g, "''")}'`;
}
const json = (v) => esc(JSON.stringify(v));

let sql = `-- Generated by scripts/seed-cadences.mjs — do not hand-edit.\n-- Run: node scripts/seed-cadences.mjs\n\n`;

for (const cad of CADENCES) {
  const columns = [
    "slug", "name", "summary", "visibility", "status",
    "duration_weeks", "discipline", "team_size_min", "team_size_max", "work_mode",
    "goals", "definition", "clone_count", "featured",
  ];
  const values = [
    esc(cad.slug), esc(cad.name), esc(cad.summary), esc("public"), esc("published"),
    esc(cad.durationWeeks), esc(cad.discipline), esc(cad.teamSizeMin), esc(cad.teamSizeMax), esc(cad.workMode),
    json(cad.goals ?? []), json(cad.definition), "0", esc(!!cad.featured),
  ];
  sql += `INSERT INTO cadence_templates (${columns.join(", ")}) VALUES (${values.join(", ")});\n`;
}

sql += `\n-- Job tags\n`;
for (const cad of CADENCES) {
  for (const jobSlug of cad.jobs ?? []) {
    sql += `INSERT INTO cadence_jobs (cadence_template_id, job_id) SELECT (SELECT id FROM cadence_templates WHERE slug = ${esc(cad.slug)}), (SELECT id FROM jobs WHERE slug = ${esc(jobSlug)});\n`;
  }
}

writeFileSync(OUT, sql);
console.log(`Wrote ${CADENCES.length} cadences -> ${OUT}`);
