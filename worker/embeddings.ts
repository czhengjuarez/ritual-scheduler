import type { Ritual, CadenceTemplate } from "../db/schema";
import type { Env } from "./index";

/**
 * Rituals and cadences share ONE Vectorize index (PLAN.md §5.6: "embed
 * rituals *and* cadences... into Vectorize"), distinguished by a `type`
 * metadata field and an id prefix (`ritual:123` / `cadence:45`) so the two
 * id spaces — both plain autoincrement integers — can't collide.
 *
 * 768 dimensions, cosine metric: matches the index created with
 * `wrangler vectorize create ritual-builder-embeddings --dimensions=768
 * --metric=cosine`. Pattern ported from design-resources/worker/embeddings.ts.
 */
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";

export function ritualEmbeddingText(r: Pick<Ritual, "title" | "summary" | "purpose" | "tags">): string {
  return [r.title, r.summary, r.purpose, ...(r.tags ?? [])].filter(Boolean).join(" — ");
}

export function cadenceEmbeddingText(c: Pick<CadenceTemplate, "name" | "summary" | "discipline" | "goals">): string {
  return [c.name, c.summary, c.discipline, ...(c.goals ?? [])].filter(Boolean).join(" — ");
}

async function embedBatch(env: Env, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const result = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  return (result as { data: number[][] }).data;
}

export async function embedText(env: Env, text: string): Promise<number[]> {
  const [vector] = await embedBatch(env, [text]);
  return vector;
}

const ritualVectorId = (id: number) => `ritual:${id}`;
const cadenceVectorId = (id: number) => `cadence:${id}`;

/** Only published+public content is indexed — team/private/pending rows shouldn't surface in a search anyone can run. */
function isSearchable(status: string, visibility: string): boolean {
  return status === "published" && visibility === "public";
}

export async function upsertRitualEmbedding(env: Env, ritual: Ritual): Promise<void> {
  if (!isSearchable(ritual.status, ritual.visibility)) {
    await env.VECTORIZE.deleteByIds([ritualVectorId(ritual.id)]).catch(() => {});
    return;
  }
  const vector = await embedText(env, ritualEmbeddingText(ritual));
  await env.VECTORIZE.upsert([{ id: ritualVectorId(ritual.id), values: vector, metadata: { type: "ritual", refId: ritual.id } }]);
}

export async function upsertCadenceEmbedding(env: Env, cadence: CadenceTemplate): Promise<void> {
  if (!isSearchable(cadence.status, cadence.visibility)) {
    await env.VECTORIZE.deleteByIds([cadenceVectorId(cadence.id)]).catch(() => {});
    return;
  }
  const vector = await embedText(env, cadenceEmbeddingText(cadence));
  await env.VECTORIZE.upsert([{ id: cadenceVectorId(cadence.id), values: vector, metadata: { type: "cadence", refId: cadence.id } }]);
}

export interface SemanticMatch {
  type: "ritual" | "cadence";
  refId: number;
  score: number;
}

/** Embeds a query and returns nearest matches, optionally restricted to one content type. */
export async function semanticSearch(env: Env, query: string, opts: { type?: "ritual" | "cadence"; topK?: number } = {}): Promise<SemanticMatch[]> {
  const vector = await embedText(env, query);
  const result = await env.VECTORIZE.query(vector, {
    topK: opts.topK ?? 24,
    // "indexed" only returns metadata properties that have a metadata index
    // (just `type` — see wrangler vectorize create-metadata-index). `refId`
    // is never filtered on, only read back, so it needs "all" here.
    returnMetadata: "all",
    filter: opts.type ? { type: opts.type } : undefined,
  });
  return result.matches
    .filter((m) => m.metadata && typeof m.metadata.refId === "number")
    .map((m) => ({ type: m.metadata!.type as "ritual" | "cadence", refId: m.metadata!.refId as number, score: m.score }));
}

/** Batch-embed and upsert many rituals — used by the admin backfill job. Vectorize caps a Worker upsert at 1,000 vectors; batch defensively at 100 to stay well clear of it and of Workers AI's own per-request batch limits. */
export async function backfillRitualEmbeddings(env: Env, rituals: Ritual[]): Promise<number> {
  const searchable = rituals.filter((r) => isSearchable(r.status, r.visibility));
  let count = 0;
  for (let i = 0; i < searchable.length; i += 100) {
    const batch = searchable.slice(i, i + 100);
    const vectors = await embedBatch(env, batch.map(ritualEmbeddingText));
    await env.VECTORIZE.upsert(batch.map((r, j) => ({ id: ritualVectorId(r.id), values: vectors[j], metadata: { type: "ritual" as const, refId: r.id } })));
    count += batch.length;
  }
  return count;
}

export async function backfillCadenceEmbeddings(env: Env, cadences: CadenceTemplate[]): Promise<number> {
  const searchable = cadences.filter((c) => isSearchable(c.status, c.visibility));
  let count = 0;
  for (let i = 0; i < searchable.length; i += 100) {
    const batch = searchable.slice(i, i + 100);
    const vectors = await embedBatch(env, batch.map(cadenceEmbeddingText));
    await env.VECTORIZE.upsert(batch.map((c, j) => ({ id: cadenceVectorId(c.id), values: vectors[j], metadata: { type: "cadence" as const, refId: c.id } })));
    count += batch.length;
  }
  return count;
}
