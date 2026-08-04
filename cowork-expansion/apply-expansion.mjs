#!/usr/bin/env node
/**
 * BenchCoach drill-library expansion — apply script (idempotent).
 *
 * Inserts new_problems.json, new_drills.json, new_mappings.json into Supabase
 * via PostgREST. Additive only: no updates to existing content, no deletes, no DDL.
 *
 * Reusable for ANY expansion batch:
 *  - Expected counts are DERIVED from the payload files (nothing hardcoded).
 *  - Safe to re-run: drills already present (by youtube_video_id) are SKIPPED,
 *    problems/mappings upsert on their keys. A full re-run is a clean no-op.
 *
 * Run from the repo root (Node 18+):   node cowork-expansion/apply-expansion.mjs
 * Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");

// ---- creds ----
const env = {};
for (const line of readFileSync(join(repoRoot, ".env.local"), "utf8").split("\n")) {
  const t = line.trim();
  if (t && !t.startsWith("#") && t.includes("=")) {
    const i = t.indexOf("=");
    env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  }
}
const URL_ = (env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || "";
if (!URL_.startsWith("https://") || KEY.length < 30) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const problems = JSON.parse(readFileSync(join(here, "new_problems.json"), "utf8"));
const drills = JSON.parse(readFileSync(join(here, "new_drills.json"), "utf8"));
const mappings = JSON.parse(readFileSync(join(here, "new_mappings.json"), "utf8"));

async function req(method, path, { body, prefer } = {}) {
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(URL_ + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) {
    console.error(`ABORT — HTTP ${res.status} on ${method} ${path}\n${text.slice(0, 800)}`);
    process.exit(1);
  }
  return { headers: res.headers, data: text ? JSON.parse(text) : null };
}
async function count(path) {
  const res = await fetch(URL_ + path, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Prefer: "count=exact", Range: "0-0" } });
  return parseInt((res.headers.get("content-range") || "/0").split("/")[1], 10);
}

// ---- 0. column check: every payload key must exist as a live column ----
const { data: spec } = await req("GET", "/rest/v1/");
for (const [table, rows] of [["problem_taxonomy", problems], ["drill_resources", drills]]) {
  const cols = new Set(Object.keys(spec?.definitions?.[table]?.properties ?? {}));
  if (!cols.size) { console.error(`ABORT — could not read column list for ${table}`); process.exit(1); }
  const extra = Object.keys(rows[0]).filter((k) => !cols.has(k));
  if (extra.length) { console.error(`ABORT — ${table} has no columns for payload keys: ${extra.join(", ")}`); process.exit(1); }
}
console.log("Column check OK");

// ---- 1. live snapshot ----
const { data: liveProbs } = await req("GET", "/rest/v1/problem_taxonomy?select=slug&limit=2000");
const liveSlugs = new Set(liveProbs.map((p) => p.slug));
const { data: liveDrills } = await req("GET", "/rest/v1/drill_resources?select=id,youtube_video_id&limit=5000");
const liveVids = new Map(liveDrills.filter((d) => d.youtube_video_id).map((d) => [d.youtube_video_id, d.id]));
const preMapCount = await count("/rest/v1/drill_problem_map?select=drill_id");
console.log(`Live DB before: ${liveSlugs.size} problems, ${liveDrills.length} drills, ${preMapCount} mappings`);

// ---- 2. partition new vs already-present (idempotent) ----
const problemsNew = problems.filter((p) => !liveSlugs.has(p.slug));
const drillsToInsert = drills.filter((d) => !liveVids.has(d.youtube_video_id));
const drillsSkipped = drills.length - drillsToInsert.length;
if (problems.length - problemsNew.length) console.log(`(${problems.length - problemsNew.length} problem slug(s) already present — skipping)`);
if (drillsSkipped) console.log(`(${drillsSkipped} drill video id(s) already present — skipping, idempotent)`);

// every mapping ref (new + existing) must be resolvable
const refMissing = mappings.filter((m) => !liveVids.has(m.drill_ref) && !drillsToInsert.some((d) => d.youtube_video_id === m.drill_ref));
if (refMissing.length) { console.error(`ABORT — ${refMissing.length} mapping(s) reference a drill not present and not in this batch (e.g. ${refMissing[0].drill_ref})`); process.exit(1); }

// ---- 3. problems (only genuinely new; upsert on slug) ----
if (problemsNew.length) await req("POST", "/rest/v1/problem_taxonomy", { body: problemsNew, prefer: "resolution=merge-duplicates" });
console.log(`Inserted ${problemsNew.length} new problems`);

// ---- 4. drills (only new video ids; capture generated ids) ----
let inserted = [];
if (drillsToInsert.length) {
  ({ data: inserted } = await req("POST", "/rest/v1/drill_resources?select=id,youtube_video_id", { body: drillsToInsert, prefer: "return=representation" }));
  if (inserted.length !== drillsToInsert.length) { console.error(`ABORT — expected ${drillsToInsert.length} inserted drills, got ${inserted.length}. Mappings NOT applied.`); process.exit(1); }
}
console.log(`Inserted ${inserted.length} new drills (${drillsSkipped} already present)`);

// resolve EVERY mapping ref -> drill id (new inserts + live snapshot)
const vidToId = new Map(liveVids);
for (const d of inserted) vidToId.set(d.youtube_video_id, d.id);
const unresolved = mappings.filter((m) => !vidToId.has(m.drill_ref));
if (unresolved.length) { console.error(`ABORT — ${unresolved.length} mapping refs unresolved. Mappings NOT applied.`); process.exit(1); }

// ---- 5. mappings (upsert on drill_id+problem_slug) ----
const mapRows = mappings.map((m) => ({ drill_id: vidToId.get(m.drill_ref), problem_slug: m.problem_slug, sort_order: m.sort_order, curated: m.curated }));
await req("POST", "/rest/v1/drill_problem_map", { body: mapRows, prefer: "resolution=merge-duplicates" });
console.log(`Upserted ${mapRows.length} mappings`);

// ---- 6. verify (all expectations DERIVED from the payload; idempotent-safe) ----
const newSlugSet = new Set(problems.map((p) => p.slug));
const expProbTotal = new Set([...liveSlugs, ...newSlugSet]).size;
const expDrillTotal = liveDrills.length + drillsToInsert.length;
const expNewProbMaps = mappings.filter((m) => newSlugSet.has(m.problem_slug)).length;

const appended = mappings.filter((m) => !newSlugSet.has(m.problem_slug)).map((m) => ({ slug: m.problem_slug, id: vidToId.get(m.drill_ref) }));
const appSlugs = [...new Set(appended.map((a) => a.slug))];
const appIds = [...new Set(appended.map((a) => a.id))];

const nProb = await count("/rest/v1/problem_taxonomy?select=slug");
const nDrill = await count("/rest/v1/drill_resources?select=id");
const nMapNew = await count(`/rest/v1/drill_problem_map?select=drill_id&problem_slug=in.(${[...newSlugSet].join(",")})`);
const nAppended = appended.length ? await count(`/rest/v1/drill_problem_map?select=drill_id&problem_slug=in.(${appSlugs.join(",")})&drill_id=in.(${appIds.join(",")})`) : 0;

console.log("--- VERIFICATION (expected values derived from payload) ---");
console.log(`problem_taxonomy total:   ${nProb}  (expected ${expProbTotal})`);
console.log(`drill_resources total:    ${nDrill}  (expected ${expDrillTotal})`);
console.log(`mappings on new problems: ${nMapNew}  (expected ${expNewProbMaps})`);
console.log(`appended mappings present:${nAppended}  (expected ${appended.length})`);
const ok = nProb === expProbTotal && nDrill === expDrillTotal && nMapNew === expNewProbMaps && nAppended === appended.length;
console.log(ok ? "✅ All counts match — expansion applied (or already present)." : "⚠️ Counts differ — review before re-running.");
process.exit(ok ? 0 : 1);
