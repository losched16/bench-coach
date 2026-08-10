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

// Everything a surface needs to render or choose a drill. One list, so adding
// a column does not mean hunting six select strings.
export const DRILL_FIELDS =
  'id, drill_name, description, youtube_video_id, youtube_url, thumbnail_url, ' +
  'channel, youtube_start_seconds, skill_category, difficulty_level, ' +
  'progression_level, equipment_needed, ai_coaching_notes, safety_notes, ' +
  'min_age, max_age, competition_level, mechanic_focus, common_flaws_fixed, ' +
  'reps_guidance, frequency_guidance, success_markers, status, created_by_coach_id'

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
 * The drill ids this coach has favourited.
 *
 * Returns an empty set rather than throwing when migration 041 has not been
 * applied — a missing favourites table should cost a coach their stars, not
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
 * Favourites first, then everything else, each group keeping the order it
 * arrived in.
 *
 * Used where a coach is choosing — the swap picker, the library. NOT used when
 * the prescription engine has already sorted by progression_level: a
 * favourite is a preference, and it does not get to reorder a progression so
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
 * ★ makes a favourite pickable-by-preference, and "the coach's own drill" is
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
    (d.youtube_video_id ? ` [video: ${d.youtube_video_id}]` : '') +
    (d.description ? ` — ${String(d.description).slice(0, 130)}` : '') +
    (d.mechanic_focus?.length ? ` | trains: ${d.mechanic_focus.slice(0, 4).join(', ')}` : '') +
    (d.equipment_needed?.length ? ` | needs: ${d.equipment_needed.join(', ')}` : '')
  )
}

// Said once, here, so every surface that sends a drill menu says the same
// thing about what the marks mean.
export const DRILL_PREFERENCE_NOTE =
  'Drills marked ★ are ones this coach has favourited — they know them, their ' +
  'players know them, and setup is faster. Prefer a ★ drill when it genuinely ' +
  'fits, and pick a different one when it does not: a favourite that is wrong ' +
  'for the problem is still wrong.\n' +
  "Drills marked [the coach's own drill] were written by this coach. Use their " +
  'name and their description as written — do not rewrite or improve them.'
