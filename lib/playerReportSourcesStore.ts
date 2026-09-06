// Gathering what the coach recorded about a player. Server only.
//
// The pure half — types, windowing, the item builders — is in
// playerReportSources.ts and is safe to import into the browser. This file
// does the reads and must stay out of client bundles: it reaches
// drillDiagnosis, which reaches the Anthropic client, which reaches node:fs.
//
// Assumes the caller has already authorized the report (report → team → the
// caller's role). Reads through the service role, scoped by the ids the
// report carries — the same scoping the report itself lives under.

import { loadTaxonomy } from './drillDiagnosis'
import {
  seasonWindow, inWindow, measurementItems, priorityItem, noteItem,
  observationItem, entryItem, traitItem, sortItems,
  type SourceBundle, type SourceItem, type SourceKind, type MetricType,
} from './playerReportSources'

// ---------------------------------------------------------------------------

async function safe<T>(label: string, q: PromiseLike<{ data: T | null; error: any }>): Promise<T | null> {
  // A table this database does not have yet (a skipped migration) must cost
  // the coach one source, not the whole picker.
  try {
    const { data, error } = await q
    if (error) { console.warn(`[report sources] ${label}: ${error.message}`); return null }
    return data
  } catch (e: any) {
    console.warn(`[report sources] ${label}: ${e?.message || e}`)
    return null
  }
}

/**
 * Everything recorded about this player, for this coach, in this season.
 *
 * Assumes the caller has already authorized the report (report → team → the
 * caller's role). Reads through the service role, scoped by the ids the
 * report carries — the same scoping the report itself lives under.
 */
export async function gatherSources(
  supabase: any,
  opts: { teamId: string; playerId: string; coachId: string; allSeasons?: boolean }
): Promise<SourceBundle> {
  const { teamId, playerId, coachId, allSeasons = false } = opts

  const team = await safe<any>('team',
    supabase.from('teams').select('season_id, created_at').eq('id', teamId).maybeSingle())
  const season = team?.season_id
    ? await safe<any>('season',
        supabase.from('seasons').select('start_date, end_date').eq('id', team.season_id).maybeSingle())
    : null
  const window = { ...seasonWindow(season, team?.created_at, { allSeasons }), allSeasons }

  const [prescriptions, notes, observations, entries, metrics, metricTypes, traits, teamPlayer, taxonomy] =
    await Promise.all([
      safe<any[]>('prescriptions', supabase.from('prescriptions')
        .select('id, priority, summary, success_criteria, problem_id, focus_area, status, outcome_note, issued_at, created_at, resolved_at')
        .eq('coach_id', coachId).eq('scope', 'player').eq('player_id', playerId)
        .order('issued_at', { ascending: false }).limit(50)),
      safe<any[]>('player_notes', supabase.from('player_notes')
        .select('id, note, created_at').eq('team_id', teamId).eq('player_id', playerId)
        .order('created_at', { ascending: false }).limit(100)),
      safe<any[]>('observations', supabase.from('observations')
        .select('id, body, observed_on, created_at, prompt_key').eq('coach_id', coachId).eq('player_id', playerId)
        .order('created_at', { ascending: false }).limit(100)),
      safe<any[]>('entries', supabase.from('entries')
        .select('id, entry_type, occurred_on, title, instructor_name, duration_min').eq('coach_id', coachId).eq('player_id', playerId)
        .order('occurred_on', { ascending: false }).limit(100)),
      safe<any[]>('player_metrics', supabase.from('player_metrics')
        .select('metric, metric_type_id, value, unit, measured_on').eq('coach_id', coachId).eq('player_id', playerId)
        .order('measured_on', { ascending: true }).limit(300)),
      safe<any[]>('metric_types', supabase.from('metric_types')
        .select('id, label, unit, direction').eq('coach_id', coachId)),
      safe<any[]>('player_traits', supabase.from('player_traits')
        .select('id, note, created_at').eq('player_id', playerId).order('created_at', { ascending: false }).limit(50)),
      safe<any>('team_players', supabase.from('team_players')
        .select('hitting_level, throwing_level, fielding_level, pitching_level, baserunning_level, coachability_level')
        .eq('team_id', teamId).eq('player_id', playerId).maybeSingle()),
      loadTaxonomy(supabase).catch(() => []),
    ])

  // Check-in outcomes belong under their priority, not beside it.
  const checkinsByPrescription = new Map<string, string[]>()
  const presIds = (prescriptions || []).map(p => p.id)
  if (presIds.length) {
    const checkins = await safe<any[]>('checkins', supabase.from('checkins')
      .select('prescription_id, outcome_note, accepted_at').in('prescription_id', presIds).not('accepted_at', 'is', null))
    for (const c of checkins || []) {
      if (!c.outcome_note) continue
      if (!checkinsByPrescription.has(c.prescription_id)) checkinsByPrescription.set(c.prescription_id, [])
      checkinsByPrescription.get(c.prescription_id)!.push(String(c.outcome_note).trim())
    }
  }

  const labelBySlug = new Map((taxonomy as any[]).map(t => [t.slug, t.label as string]))
  const taxonomyLabel = (slug: string) => labelBySlug.get(slug) || null

  const items: SourceItem[] = [
    ...(prescriptions || []).map(p => priorityItem(p, taxonomyLabel, checkinsByPrescription.get(p.id) || [])),
    ...(notes || []).map(noteItem),
    ...(observations || []).map(observationItem),
    ...(entries || []).map(entryItem).filter((x): x is SourceItem => x !== null),
    ...measurementItems(
      (metrics || []).filter(m => inWindow(m.measured_on, window)),
      (metricTypes || []) as MetricType[]
    ),
    ...(traits || []).map(traitItem),
  ].filter(it => it.text && (it.kind === 'measurement' || inWindow(it.date, window)))

  const counts: Partial<Record<SourceKind, number>> = {}
  for (const it of items) counts[it.kind] = (counts[it.kind] || 0) + 1

  return {
    window,
    items: sortItems(items),
    skillLevels: teamPlayer ? {
      Hitting: teamPlayer.hitting_level, Throwing: teamPlayer.throwing_level,
      Fielding: teamPlayer.fielding_level, Pitching: teamPlayer.pitching_level,
      Baserunning: teamPlayer.baserunning_level, Coachability: teamPlayer.coachability_level,
    } : null,
    counts,
  }
}
