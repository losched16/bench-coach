// Reading and writing a report, in one place.
//
// Five routes need "the whole report" and three need "freeze what it says".
// Those are the two operations everything else is built on, and they are the
// two that must not have a second implementation — a PDF assembled from a
// slightly different query than the preview is a document the coach did not
// approve.
//
// Everything here takes a service-role client and assumes the caller has
// ALREADY passed authorization. That is the codebase's existing contract
// (see lib/authz.ts): the routes decide who may act, these functions do the
// work. Nothing in this file checks a permission, so nothing in this file may
// be called before something else has.

import {
  cleanText, drillSnapshot, recommendationReason,
  type FullReport, type ReportContext, type DrillSnapshot,
} from './playerReports'
import { visibleDrills, DRILL_FIELDS } from './drills'

// Everything a snapshot reads, plus the one column DRILL_FIELDS does not carry:
// where a timestamp came from. Without it the provenance gate in
// drillSnapshot() would see null for every row and print no timestamps at all,
// which would look exactly like "none are curated yet" and never be noticed.
const SNAPSHOT_FIELDS = `${DRILL_FIELDS}, youtube_start_source`

const REPORT_COLUMNS =
  'id, team_id, player_id, coach_id, author_user_id, report_type, status, report_date, ' +
  'context, strengths_content, development_intro, closing_content, strength_areas, ' +
  'revision, revision_of, created_at, updated_at, finalized_at'

/**
 * A report and everything under it, ordered the way it prints.
 *
 * Returns null when the id names nothing — the routes turn that into a 404,
 * and authorization has already established the caller may see this team.
 */
export async function loadFullReport(
  supabase: any,
  reportId: string
): Promise<FullReport | null> {
  const { data: report, error } = await supabase
    .from('player_reports')
    .select(REPORT_COLUMNS)
    .eq('id', reportId)
    .maybeSingle()

  if (error || !report) return null

  const [{ data: focusAreas }, { data: drills }] = await Promise.all([
    supabase.from('player_report_focus_areas')
      .select('id, problem_slug, focus_area, label, coach_notes, approved_content, sort_order')
      .eq('report_id', reportId)
      .order('sort_order', { ascending: true }),
    supabase.from('player_report_drills')
      .select('id, focus_area_id, drill_id, snapshot, recommendation_reason, source, include_video, sort_order')
      .eq('report_id', reportId)
      .order('sort_order', { ascending: true }),
  ])

  return {
    ...(report as any),
    strength_areas: (report as any).strength_areas || [],
    focusAreas: (focusAreas || []) as any[],
    drills: (drills || []) as any[],
  } as FullReport
}

/**
 * Team, season, age group, coach and player names as they are RIGHT NOW.
 *
 * A draft reads these live, because a coach editing a report expects the
 * header to reflect the team they are actually on. Finalizing copies the
 * answer into player_reports.context and the report stops asking — which is
 * why a report from 2026 still says "8U · Fall 2026" after the age group has
 * rolled over twice.
 */
export async function buildContext(
  supabase: any,
  opts: { teamId: string; playerId: string; authorUserId?: string | null; coachId: string }
): Promise<ReportContext> {
  const [{ data: player }, { data: team }, { data: coach }] = await Promise.all([
    supabase.from('players').select('name').eq('id', opts.playerId).maybeSingle(),
    supabase.from('teams').select('name, age_group, season_id').eq('id', opts.teamId).maybeSingle(),
    supabase.from('coaches').select('display_name').eq('id', opts.coachId).maybeSingle(),
  ])

  let seasonName: string | null = null
  if ((team as any)?.season_id) {
    const { data: season } = await supabase
      .from('seasons').select('name').eq('id', (team as any).season_id).maybeSingle()
    seasonName = (season as any)?.name || null
  }

  return {
    player_name: (player as any)?.name || 'Player',
    team_name: (team as any)?.name || null,
    age_group: (team as any)?.age_group || null,
    // "Personal" is the label for a one-player workspace, not a season anyone
    // would print on a report to themselves.
    season_name: seasonName && seasonName !== 'Personal' ? seasonName : null,
    coach_name: (coach as any)?.display_name || null,
  }
}

/** The player's age in years, or undefined. Used to filter drill suggestions. */
export async function playerAge(supabase: any, playerId: string): Promise<number | undefined> {
  const { data } = await supabase
    .from('players').select('birth_year').eq('id', playerId).maybeSingle()
  const year = (data as any)?.birth_year
  if (!year) return undefined
  const age = new Date().getFullYear() - Number(year)
  return age > 2 && age < 25 ? age : undefined
}

/**
 * The drills this coach may see, by id, in the order asked for.
 *
 * Goes through visibleDrills so a drill id belonging to ANOTHER coach's
 * private drill simply does not come back — which is what makes "the client
 * sends drill ids" safe. A caller that posts a guessed id gets nothing, not
 * somebody else's drill.
 */
export async function loadSelectableDrills(
  supabase: any,
  coachId: string | null,
  ids: string[]
): Promise<Map<string, any>> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  if (unique.length === 0) return new Map()
  const { data } = await visibleDrills(supabase, coachId, SNAPSHOT_FIELDS).in('id', unique)
  return new Map(((data || []) as any[]).map(d => [d.id, d]))
}

/**
 * Re-copy the printable fields from the live library onto a DRAFT's drills.
 *
 * Called on every draft save and once more at finalization. While a report is
 * a draft the coach should see the library as it is today; the moment they
 * finalize, the copy stops moving. That single call at finalize is the entire
 * historical-integrity mechanism, and it is why a re-curation in 2027 cannot
 * rewrite a document a family received in 2026.
 *
 * A drill that has since been retired keeps the snapshot it had. It is not
 * removed from the report and it does not become an error — the coach
 * recommended it, so it stays.
 */
export async function refreshDrillSnapshots(
  supabase: any,
  reportId: string,
  coachId: string | null
): Promise<void> {
  const { data: rows } = await supabase
    .from('player_report_drills')
    .select('id, drill_id, focus_area_id, snapshot, source')
    .eq('report_id', reportId)

  const list = (rows || []) as any[]
  const ids = list.map(r => r.drill_id).filter(Boolean)
  if (ids.length === 0) return

  const live = await loadSelectableDrills(supabase, coachId, ids)

  const { data: areas } = await supabase
    .from('player_report_focus_areas')
    .select('id, label')
    .eq('report_id', reportId)
  const areaLabel = new Map(((areas || []) as any[]).map(a => [a.id, a.label]))

  for (const row of list) {
    const drill = row.drill_id ? live.get(row.drill_id) : null
    if (!drill) continue
    const snapshot = drillSnapshot(drill)
    await supabase
      .from('player_report_drills')
      .update({
        snapshot,
        recommendation_reason: recommendationReason(
          row.focus_area_id ? areaLabel.get(row.focus_area_id) || null : null,
          snapshot
        ),
      })
      .eq('id', row.id)
  }
}

/**
 * Replace a draft's drill selection with exactly what the coach has on screen.
 *
 * Replace-set rather than add/remove endpoints: the wizard lets a coach add,
 * drop and reorder freely, and "send me the list you ended up with" is both
 * simpler and impossible to get out of step with. Array position IS sort_order.
 *
 * Rows already present keep their id, so a drill that was in the report before
 * this save is updated rather than deleted and re-inserted — which matters
 * because focus_area_id and the coach's include_video choice live on that row.
 */
export interface DrillSelection {
  drillId: string
  focusAreaId?: string | null
  includeVideo?: boolean
  source?: 'recommended' | 'manual'
}

export async function saveDrillSelection(
  supabase: any,
  opts: {
    reportId: string
    coachId: string | null
    selection: DrillSelection[]
    /** Focus-area ids that belong to THIS report. Anything else is dropped. */
    validAreaIds: Map<string, string>
  }
): Promise<void> {
  const { reportId, coachId, selection, validAreaIds } = opts

  const { data: existingRows } = await supabase
    .from('player_report_drills')
    .select('id, drill_id, include_video')
    .eq('report_id', reportId)
  const existing = new Map(((existingRows || []) as any[]).map(r => [r.drill_id, r]))

  const live = await loadSelectableDrills(supabase, coachId, selection.map(s => s.drillId))

  const keptRowIds: string[] = []
  let order = 0

  for (const item of selection) {
    // A drill id the coach may not see never becomes a row. This is the check
    // that makes the whole selection endpoint safe against a posted id.
    const drill = live.get(item.drillId)
    if (!drill) continue

    const areaId = item.focusAreaId && validAreaIds.has(item.focusAreaId)
      ? item.focusAreaId
      : null
    const snapshot: DrillSnapshot = drillSnapshot(drill)
    const reason = recommendationReason(areaId ? validAreaIds.get(areaId) || null : null, snapshot)
    const includeVideo = item.includeVideo !== false

    const prior = existing.get(item.drillId)
    if (prior) {
      await supabase.from('player_report_drills').update({
        focus_area_id: areaId,
        snapshot,
        recommendation_reason: reason,
        include_video: includeVideo,
        sort_order: order,
      }).eq('id', prior.id)
      keptRowIds.push(prior.id)
    } else {
      const { data: inserted } = await supabase.from('player_report_drills').insert({
        report_id: reportId,
        focus_area_id: areaId,
        drill_id: item.drillId,
        snapshot,
        recommendation_reason: reason,
        source: item.source === 'manual' ? 'manual' : 'recommended',
        include_video: includeVideo,
        sort_order: order,
      }).select('id').maybeSingle()
      if ((inserted as any)?.id) keptRowIds.push((inserted as any).id)
    }
    order++
  }

  // Whatever the coach took out.
  let del = supabase.from('player_report_drills').delete().eq('report_id', reportId)
  if (keptRowIds.length) del = del.not('id', 'in', `(${keptRowIds.join(',')})`)
  await del
}

/**
 * Replace a draft's development priorities.
 *
 * Rows carrying an id that belongs to this report are updated in place, which
 * is what keeps a drill's focus_area_id pointing at the right priority when a
 * coach edits the wording of one.
 */
export interface FocusAreaInput {
  id?: string | null
  problemSlug?: string | null
  focusArea?: string | null
  label: string
  coachNotes?: string | null
  approvedContent?: string | null
}

export async function saveFocusAreas(
  supabase: any,
  reportId: string,
  input: FocusAreaInput[]
): Promise<void> {
  const { data: existingRows } = await supabase
    .from('player_report_focus_areas')
    .select('id')
    .eq('report_id', reportId)
  const existingIds = new Set(((existingRows || []) as any[]).map(r => r.id))

  const keptIds: string[] = []
  let order = 0

  for (const item of input) {
    const label = cleanText(item.label, 120)
    if (!label) continue

    const row = {
      problem_slug: item.problemSlug || null,
      focus_area: item.focusArea || null,
      label,
      coach_notes: cleanText(item.coachNotes),
      approved_content: cleanText(item.approvedContent),
      sort_order: order,
    }

    if (item.id && existingIds.has(item.id)) {
      await supabase.from('player_report_focus_areas').update(row).eq('id', item.id)
      keptIds.push(item.id)
    } else {
      const { data: inserted } = await supabase
        .from('player_report_focus_areas')
        .insert({ report_id: reportId, ...row })
        .select('id')
        .maybeSingle()
      if ((inserted as any)?.id) keptIds.push((inserted as any).id)
    }
    order++
  }

  let del = supabase.from('player_report_focus_areas').delete().eq('report_id', reportId)
  if (keptIds.length) del = del.not('id', 'in', `(${keptIds.join(',')})`)
  await del
}

/**
 * Is this player actually on this team?
 *
 * The team is what authorization is granted against, so without this a coach
 * who legitimately owns team A could name any player id in the database and
 * write a report about a child they have never met. team_players is the join
 * that says a player belongs to a team in a season.
 */
export async function playerIsOnTeam(
  supabase: any,
  teamId: string,
  playerId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('team_players')
    .select('id')
    .eq('team_id', teamId)
    .eq('player_id', playerId)
    .maybeSingle()
  return Boolean((data as any)?.id)
}

/**
 * Find a drill by name.
 *
 * For the moment in a report where the coach has decided our suggestions are
 * wrong and wants the drill they had in mind. Deliberately a server-side
 * lookup rather than shipping the library to the browser: 206 drills with
 * coaching notes is not a payload a phone in a car park should download to
 * filter locally. Goes through visibleDrills, so it finds the curated library
 * and this coach's own drills, and nobody else's.
 */
export async function searchLibraryByName(
  supabase: any,
  coachId: string | null,
  query: string,
  limit = 20
): Promise<any[]> {
  const q = String(query || '').trim()
  if (!q) return []
  // ilike patterns are built from typed text, so the wildcards and the escape
  // character are neutralised — a stray % would return the whole library.
  const safe = q.replace(/[\%_]/g, ch => `\${ch}`)
  const { data } = await visibleDrills(supabase, coachId, SNAPSHOT_FIELDS)
    .or(`drill_name.ilike.%${safe}%,description.ilike.%${safe}%,skill_category.ilike.%${safe}%`)
    .limit(limit)
  return (data || []) as any[]
}
