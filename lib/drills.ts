import { hasSegment, formatTimestamp } from './drillVideo'

// Who can see which drills.
//
// drill_resources holds two kinds of row. created_by_coach_id IS NULL is the
// curated library, shared by everyone. created_by_coach_id set means one coach
// wrote it — the station they invented, the version of a drill their old
// travel coach ran — and only they should ever see it.
//
// Every route reads this table through the service role, which bypasses RLS.
// So the policies in migration 041 are a backstop for the anon-key reads, and
// THIS FILE is what actually keeps one coach's drills out of another coach's
// library. Skipping the filter does not throw, does not warn, and does not
// show up in testing with one account. It just quietly pools people's work
// together — the same failure the scouting data is explicitly built to avoid.
//
// scripts/verify-drill-scope.mjs fails the build if a library read does not go
// through here, because "remember to add the filter" has never once been a
// control that holds.

/**
 * One drill, as production actually stores it.
 *
 * Written down because the shape was previously expressed three incompatible
 * ways — a runtime column string, a six-field scoring interface, and `any[]`
 * everywhere else — and the three disagreed about which columns exist. A
 * read-only export of production settled it; this is that answer.
 *
 * Everything is optional except id and drill_name, because it is: the audit
 * measured est_duration_minutes at 0/206 and safety_notes at 38/206. A
 * consumer that assumes a field is there is wrong about this table.
 */
export interface DrillRecord {
  id: string
  drill_name: string
  description?: string | null

  // Classification. skill_category is the coarse bucket the practice planner
  // filters on; primary_skill is a finer-grained label that exists on every
  // row and, until now, nothing read.
  skill_category?: string | null
  primary_skill?: string | null
  secondary_skill?: string | null
  tags?: string[] | null

  // What it trains and what it fixes. Both are free-text arrays and both are
  // the closest thing this library has to retrieval tags.
  mechanic_focus?: string[] | null
  common_flaws_fixed?: string[] | null

  // Fit
  difficulty_level?: string | null
  progression_level?: number | null
  min_age?: number | null
  max_age?: number | null
  age_range?: string | null
  competition_level?: string | null

  // Operational. All three are populated on every production row and were
  // invisible to every recommendation surface before this change.
  equipment_needed?: string[] | null
  indoor_outdoor?: string | null
  space_required?: string | null
  requires_partner?: boolean | null

  // Coaching
  ai_coaching_notes?: string | null
  safety_notes?: string | null
  success_markers?: string[] | null
  reps_guidance?: string | null
  frequency_guidance?: string | null
  est_duration_minutes?: number | null

  // Video
  youtube_video_id?: string | null
  youtube_url?: string | null
  youtube_start_seconds?: number | null
  thumbnail_url?: string | null
  channel?: string | null

  // Practice intelligence (migration 056). Every one of these is nullable and
  // unpopulated on the 206 curated rows until calibration lands, so every
  // reader must treat null as "unknown" rather than as a value. Absence is not
  // a constraint.
  activity_family_id?: string | null
  variation_type?: string | null
  activity_format?: string | null
  practice_roles?: string[] | null
  min_players?: number | null
  max_players?: number | null
  ideal_group_size?: number | null
  min_coaches?: number | null
  station_friendly?: boolean | null
  rep_density?: string | null
  idle_time_risk?: string | null
  engagement_level?: string | null
  competition_style?: string | null
  instruction_complexity?: string | null
  throwing_load?: string | null
  physical_intensity?: string | null
  mixed_skill_friendly?: boolean | null
  regression_notes?: string | null
  progression_notes?: string | null
  advanced_progression_notes?: string | null

  // The canonical row this one duplicates (migration 064). Set only for TRUE
  // duplicates — the same activity written twice — never for a variation or a
  // progression, which are different activities a coach might choose between.
  // Resolvable by id through visibleDrills; excluded from schedulableDrills.
  duplicate_of_drill_id?: string | null

  // What this row IS (migration 062). activity | practice_unit |
  // source_collection | teaching_content, or NULL for anything nobody has
  // classified — which includes every coach-authored drill and every curated
  // row outside the pilot. NULL is treated as runnable everywhere.
  resource_kind?: string | null

  // Provenance and scoping
  status?: string | null
  source?: string | null
  created_by_coach_id?: string | null

  // The table has more columns than any surface needs; this keeps a `select('*')`
  // caller assignable without widening the documented shape.
  [key: string]: any
}

// Everything a surface needs to render or choose a drill. One list, so adding
// a column does not mean hunting six select strings.
//
// primary_skill, secondary_skill, tags, indoor_outdoor, space_required and
// requires_partner were added after a production export showed they exist and
// are populated — four of them on every single row — while being absent from
// this string, which is the only reason chat, prescribe and the practice
// planner could not see them. age_range was in the same position: used by
// drillMenuLine and by the chat prompt, and fetched only because those two
// callers happened to name it themselves.
export const DRILL_FIELDS =
  'id, drill_name, description, youtube_video_id, youtube_url, thumbnail_url, ' +
  'channel, youtube_start_seconds, skill_category, primary_skill, secondary_skill, ' +
  'tags, difficulty_level, progression_level, equipment_needed, ai_coaching_notes, ' +
  'safety_notes, min_age, max_age, age_range, competition_level, mechanic_focus, ' +
  'common_flaws_fixed, indoor_outdoor, space_required, requires_partner, ' +
  'reps_guidance, frequency_guidance, success_markers, est_duration_minutes, ' +
  'status, source, created_by_coach_id, resource_kind, duplicate_of_drill_id, ' +
  // Practice intelligence (056). Selected in the same round trip rather than a
  // second query: retrieval already pulls the whole library once and ranks it
  // in memory, and a per-drill lookup for these would be the N+1 the brief
  // warns against.
  'activity_family_id, variation_type, activity_format, practice_roles, ' +
  'min_players, max_players, ideal_group_size, min_coaches, station_friendly, ' +
  'rep_density, idle_time_risk, engagement_level, competition_style, ' +
  'instruction_complexity, throwing_load, physical_intensity, ' +
  'mixed_skill_friendly, regression_notes, progression_notes, ' +
  'advanced_progression_notes'

/**
 * A drill_resources query scoped to what this coach may see: the curated
 * library plus their own drills, and nothing anyone else wrote.
 *
 * Pass the fields you need, or leave it to take DRILL_FIELDS.
 *
 * A null coachId returns the curated library only. That is the right answer
 * for an unauthenticated or system read — it is never the right answer for a
 * coach, so callers that have an id must pass it.
 */
// `any` rather than the inferred builder type: selecting a runtime string of
// columns gives supabase-js nothing to infer from, so it types every row as
// GenericStringError and every caller has to cast anyway. One cast here beats
// ten at the call sites.
export function visibleDrills(
  // `any` rather than SupabaseClient: the browser client is generated against
  // the typed Database and the server one is not, so a single concrete type
  // rejects one caller or the other. The query is untyped below regardless.
  supabase: any,
  coachId: string | null | undefined,
  fields: string = DRILL_FIELDS
): any {
  let q: any = supabase.from('drill_resources').select(fields)

  // PostgREST `or` with a nested filter. `.is.null` rather than `.eq.null`:
  // in Postgres `= NULL` is never true, so an eq here would return only the
  // coach's own drills and silently hide the entire curated library.
  q = coachId
    ? q.or(`created_by_coach_id.is.null,created_by_coach_id.eq.${coachId}`)
    : q.is('created_by_coach_id', null)

  // Drills retired by curation never reach a coach. Coach-written drills have
  // no status, which `status.is.null` covers.
  return q.or('status.eq.approved,status.is.null')
}

/**
 * visibleDrills, but survives a database that has not run migration 041.
 *
 * Before 041 there is no created_by_coach_id column, so both the select and
 * the filter above fail — and a failed drill query does not throw, it returns
 * an error object that the caller usually destructures past. The result is a
 * practice plan generated with an EMPTY drill library, which is not an error
 * anyone sees; it is just a much worse plan, and it took a coach reporting
 * "it failed to generate" to find it.
 *
 * So: try the scoped query, and if the column is missing fall back to the
 * pre-041 shape. There are no coach-written drills in that world, so nothing
 * can leak — the whole feature simply is not on yet.
 *
 * Returns { data, error, degraded } so a caller can say WHICH of the two
 * happened rather than guessing.
 */
export async function visibleDrillsSafe(
  supabase: any,
  coachId: string | null | undefined,
  fields: string = DRILL_FIELDS,
  apply: (q: any) => any = (q) => q
): Promise<{ data: any[] | null; error: any; degraded: boolean }> {
  const first = await apply(visibleDrills(supabase, coachId, fields))
  if (!first.error) return { data: first.data, error: null, degraded: false }

  // Strip the column from both the projection and the filter.
  const legacyFields = fields
    .split(',')
    .map(f => f.trim())
    .filter(f => f !== 'created_by_coach_id')
    .join(', ')

  const second = await apply(
    supabase.from('drill_resources')
      .select(legacyFields)
      .or('status.eq.approved,status.is.null')
  )

  return { data: second.data, error: second.error, degraded: !second.error }
}

// ── visible vs schedulable ───────────────────────────────────────────────────
//
// These are two different questions and conflating them breaks one of them.
//
//   VISIBLE      this coach is authorized to see and resolve this row.
//   SCHEDULABLE  this visible row may be OFFERED as something to run.
//
// visibleDrills answers the first and must keep answering only the first. It is
// what resolves a drill id stored on a 2026 player report, a prescription, or a
// saved practice plan. A row demoted to source_collection in 2027 still has to
// come back through it, or a finalized report silently loses the drill it
// recommended and a coach sees a blank where their plan used to be.
//
// Demotion stops FUTURE recommendations. It does not edit the past.
//
// So: discovery — "what should I run?" — goes through schedulableDrills.
// History — "what did this id refer to?" — stays on visibleDrills.
//
// Migration 064 adds a second reason a visible row may not be schedulable:
// duplicate_of_drill_id. A row that is the same activity as another, written
// twice, is excluded from discovery and still resolves by id — the same split,
// applied to duplication rather than to kind.

/**
 * Every value resource_kind is allowed to hold, matching the CHECK constraint
 * in migration 062.
 *
 * Written here as well as in SQL so the two can be asserted equal. Adding a
 * kind is a migration, and a migration that does not also land here would drop
 * every row of the new kind out of the schedulable pool without a word.
 * scripts/test-schedulable.ts fails if these drift apart.
 */
export const RESOURCE_KINDS = [
  'activity', 'practice_unit', 'source_collection', 'teaching_content',
] as const

/** Kinds that may never be offered as something to run. */
export const NOT_SCHEDULABLE = ['source_collection', 'teaching_content'] as const

export interface SchedulableOptions {
  /**
   * Whether a practice_unit — a warm-up routine, a three-phase progression, a
   * sequence run as one block — belongs in this pool.
   *
   * True by default because most "what should I run" surfaces are building a
   * practice, and a warm-up routine is a perfectly good block of one. Pass
   * false from a surface that must hand back a single drill for a single
   * problem, where a routine is the wrong shape of answer.
   */
  practiceUnits?: boolean
}

/**
 * The classified kinds a given surface will accept, derived from the full enum
 * rather than listed by hand — so a kind added to RESOURCE_KINDS is included by
 * default and has to be excluded deliberately.
 */
export function schedulableKinds(options: SchedulableOptions = {}): string[] {
  const excluded: string[] = [...NOT_SCHEDULABLE]
  if (options.practiceUnits === false) excluded.push('practice_unit')
  return RESOURCE_KINDS.filter(k => !excluded.includes(k))
}

/**
 * visibleDrills, narrowed to rows that may be offered as runnable activities.
 *
 * Built ON TOP of visibleDrills rather than beside it. That is the whole point:
 * the ownership and privacy boundary is defined in exactly one place, and this
 * can only ever narrow it. A second query spelling out its own
 * created_by_coach_id filter would be a second boundary to keep in step, and
 * the failure when the two drift is one coach seeing another's drills.
 *
 * NULL resource_kind is INCLUDED. Coach-authored drills are NULL forever, and
 * curated rows nobody has classified are NULL until somebody does. Treating
 * unknown as unrunnable would empty the library on the day this shipped.
 */
export function schedulableDrills(
  supabase: any,
  coachId: string | null | undefined,
  fields: string = DRILL_FIELDS,
  options: SchedulableOptions = {}
): any {
  const allowed = schedulableKinds(options)

  // Stated as the kinds that ARE allowed rather than as `not.in` of the ones
  // that are not. Two reasons, and the second is the load-bearing one:
  //
  //   * `is.null` has to be spelled out either way. In SQL, `kind NOT IN (...)`
  //     is NULL for a NULL kind — not true — so an exclusion list drops every
  //     unclassified row unless the null branch is explicit. It is, below.
  //   * an `in` list of literals is the idiom every PostgREST deployment
  //     parses. A `not.in` nested inside an `or` is rarer, and a filter the
  //     server rejects does not throw here — it returns an error object the
  //     caller destructures past, and the surface renders an empty library.
  //     schedulableDrillsSafe catches that; this avoids needing it to.
  return visibleDrills(supabase, coachId, fields)
    .or(`resource_kind.is.null,resource_kind.in.(${allowed.join(',')})`)
    // A true duplicate is the same activity as another row, so offering it is
    // offering the same drill twice. Plain `.is(...)` rather than an `or`:
    // there is no "unknown" case here — a row either points at a canonical or
    // it does not, and every row that does has a better row to show instead.
    .is('duplicate_of_drill_id', null)
}

/**
 * schedulableDrills, but survives a database that has not run migration 062.
 *
 * Same reasoning as visibleDrillsSafe, and the same failure it exists to
 * prevent: before 062 there is no resource_kind column, so both the projection
 * and the filter fail — and a failed drill query does not throw, it returns an
 * error object callers destructure past. The result is a practice plan built
 * from an EMPTY library, which nobody sees as an error. It just quietly becomes
 * a much worse plan.
 *
 * Falling back to visibleDrillsSafe is correct rather than merely convenient:
 * in a pre-062 world no row is classified, so nothing is demoted, and
 * "everything visible is schedulable" is the true answer, not a lenient one.
 */
export async function schedulableDrillsSafe(
  supabase: any,
  coachId: string | null | undefined,
  fields: string = DRILL_FIELDS,
  apply: (q: any) => any = (q) => q,
  options: SchedulableOptions = {}
): Promise<{ data: any[] | null; error: any; degraded: boolean }> {
  const first = await apply(schedulableDrills(supabase, coachId, fields, options))
  if (!first.error) return { data: first.data, error: null, degraded: false }

  const legacyFields = fields
    .split(',')
    .map(f => f.trim())
    .filter(f => f !== 'resource_kind' && f !== 'duplicate_of_drill_id')
    .join(', ')

  const second = await visibleDrillsSafe(supabase, coachId, legacyFields, apply)
  return { data: second.data, error: second.error, degraded: true }
}

/**
 * The in-memory twin of the schedulableDrills filter.
 *
 * For callers that already hold rows — a fixture, a cached pool, a list that
 * came back from somewhere else — so the rule lives in one place whether it is
 * applied by PostgREST or by JavaScript.
 */
export function isSchedulable(d: any, options: SchedulableOptions = {}): boolean {
  // Checked before the kind: a duplicate of a perfectly good activity is still
  // not something to offer, and its own resource_kind says 'activity'.
  if (d?.duplicate_of_drill_id) return false

  const kind = d?.resource_kind
  if (kind === null || kind === undefined || kind === '') return true
  if ((NOT_SCHEDULABLE as readonly string[]).includes(kind)) return false
  if (kind === 'practice_unit') return options.practiceUnits !== false
  return true
}

/**
 * The drill ids this coach has favorited.
 *
 * Returns an empty set rather than throwing when migration 041 has not been
 * applied — a missing favorites table should cost a coach their stars, not
 * their practice plan.
 */
export async function favoriteDrillIds(
  supabase: any,
  coachId: string | null | undefined
): Promise<Set<string>> {
  if (!coachId) return new Set()
  try {
    const { data, error } = await supabase
      .from('drill_favorites')
      .select('drill_id')
      .eq('coach_id', coachId)
    if (error) throw error
    return new Set((data || []).map((r: any) => r.drill_id))
  } catch {
    return new Set()
  }
}

/**
 * Favorites first, then everything else, each group keeping the order it
 * arrived in.
 *
 * Used where a coach is choosing — the swap picker, the library. NOT used when
 * the prescription engine has already sorted by progression_level: a
 * favorite is a preference, and it does not get to reorder a progression so
 * that step three comes first.
 */
export function favoritesFirst<T extends { id: string }>(
  drills: T[],
  favorites: Set<string>
): T[] {
  if (favorites.size === 0) return drills
  const fav: T[] = []
  const rest: T[] = []
  for (const d of drills) (favorites.has(d.id) ? fav : rest).push(d)
  return [...fav, ...rest]
}

/**
 * How a drill is described to the model when it is picking from a menu.
 *
 * One line each, deliberately: the full prose for every drill used to be sent
 * and it dominated the request. The two markers earn their characters —
 * ★ makes a favorite pickable-by-preference, and "the coach's own drill" is
 * the difference between a drill Claude may reason about and one it must not
 * paraphrase, because the coach wrote those words.
 */
export function drillMenuLine(d: any, isFavorite: boolean): string {
  const marks =
    (isFavorite ? '★ ' : '') +
    (d.created_by_coach_id ? "[the coach's own drill] " : '')

  return (
    `- ${marks}"${d.drill_name}" (${d.skill_category}` +
    `${d.difficulty_level ? `, ${d.difficulty_level}` : ''}` +
    `${d.age_range ? `, ages ${d.age_range}` : ''})` +
    (d.youtube_video_id ? ` [video: ${d.youtube_video_id}${hasSegment(d) ? ` @${formatTimestamp(d.youtube_start_seconds)}` : ''}]` : '') +
    (d.description ? ` — ${String(d.description).slice(0, 130)}` : '') +
    (d.mechanic_focus?.length ? ` | trains: ${d.mechanic_focus.slice(0, 4).join(', ')}` : '') +
    (d.equipment_needed?.length ? ` | needs: ${d.equipment_needed.join(', ')}` : '')
  )
}

// Said once, here, so every surface that sends a drill menu says the same
// thing about what the marks mean.
export const DRILL_PREFERENCE_NOTE =
  'Drills marked ★ are ones this coach has favorited — they know them, their ' +
  'players know them, and setup is faster. Prefer a ★ drill when it genuinely ' +
  'fits, and pick a different one when it does not: a favorite that is wrong ' +
  'for the problem is still wrong.\n' +
  "Drills marked [the coach's own drill] were written by this coach. Use their " +
  'name and their description as written — do not rewrite or improve them.'
