// Writing a priority.
//
// Split out of the analysis route because the analysis and the commit are now
// two separate acts. They used to be one: the prescription was inserted inside
// the response stream, so it was saved and tracked before the coach had read a
// word of it. There was no point at which they could say "no, that's not it" —
// or drop a drill they're already running — because by the time anything was on
// screen it was already the plan.
//
// Both callers land here so the supersede rule can't drift between them.

import { focusAreaLabel } from './focusAreas'
import type { AnalysisSection } from './analysis'

type AnySupabase = { from: (table: string) => any }

export interface CommitInput {
  coachId: string
  scope: 'player' | 'team'
  playerId?: string | null
  teamId?: string | null
  markdown: string
  sections: AnalysisSection[]
  focusArea: string | null
  problemSlug?: string | null
  // The drills the coach kept. Not necessarily the ones we suggested.
  drillIds: string[]
  // Ones they rejected — "already doing that", "not this one". Stored so a
  // later refresh never hands the same drill back.
  rejectedDrillIds?: string[]
  // 'instructor' when a lesson diagnosis is in play, which exempts the
  // priority from AI override during its hold window.
  origin?: 'ai' | 'instructor'
}

export interface CommitResult {
  prescriptionId: string
  supersededCount: number
}

export async function commitPrescription(
  supabase: AnySupabase,
  input: CommitInput
): Promise<CommitResult> {
  const {
    coachId, scope, playerId, teamId, markdown, sections,
    focusArea, problemSlug, drillIds, rejectedDrillIds = [], origin = 'ai',
  } = input

  const find = (prefix: string) => sections.find(x => x.key.startsWith(prefix))?.body || null

  const { data: saved, error } = await supabase
    .from('prescriptions')
    .insert({
      coach_id: coachId,
      scope,
      player_id: scope === 'player' ? playerId || null : null,
      team_id: teamId || null,
      problem_id: problemSlug || null,
      focus_area: focusArea,
      origin,
      summary: find('what_the_data'),
      priority: find('the_one_thing'),
      success_criteria: find('what_to_watch'),
      drill_ids: drillIds,
      // Rejected drills start the retired list, so "show me different drills"
      // later can't circle back to something already turned down.
      retired_drill_ids: rejectedDrillIds,
      sessions: { markdown, sections },
      status: 'active',
    })
    .select('id')
    .single()

  if (error) throw error
  const prescriptionId = (saved as any).id as string

  // A new priority replaces the one already running IN THE SAME AREA only.
  // Hitting and fielding run in parallel all week; two swing corrections at
  // once mean you can't tell which cue failed.
  let supersededCount = 0
  if (focusArea) {
    let sq = supabase
      .from('prescriptions')
      .update({
        status: 'abandoned',
        superseded_by: prescriptionId,
        outcome_note: `Replaced by a newer ${focusAreaLabel(focusArea).toLowerCase()} priority.`,
        resolved_at: new Date().toISOString(),
      })
      .eq('coach_id', coachId)
      .eq('status', 'active')
      .eq('focus_area', focusArea)
      .neq('id', prescriptionId)

    sq = scope === 'player'
      ? sq.eq('player_id', playerId)
      : sq.eq('team_id', teamId).eq('scope', 'team')

    const { data } = await sq.select('id')
    supersededCount = (data || []).length
  }

  return { prescriptionId, supersededCount }
}
