// Shared context assembly for the coaching surfaces.
//
// The single biggest reason an API answer reads worse than a conversation on
// claude.ai is that it was handed less to work with. This module gathers
// everything we know about a player or team into one structure, so any
// surface that answers a coaching question starts from the same evidence.
//
// Evidence weighting, in descending order (Platform Scope v2):
//   1. Lesson diagnosis  — a paid instructor watched the player in person
//   2. Direct observation — the human saw it; outranks the box score
//   3. Game stats         — outcome data, but noisy at this age
//   4. Practice observation
//   5. Home session logs  — primarily an adherence signal

import { SupabaseClient } from '@supabase/supabase-js'
import { focusAreaLabel, focusAreaRank } from './focusAreas'

export interface CoachContext {
  player?: {
    name: string
    age?: number | null
    jersey_number?: string | null
    positions?: string[]
    skill_levels?: Record<string, number | null>
    traits?: string[]
    notes?: string[]
  }
  team?: {
    name: string
    age_group?: string | null
    skill_level?: string | null
    league_type?: string | null
    player_count?: number
  }
  seasonStats?: {
    games_played: number
    at_bats: number
    hits: number
    doubles: number
    triples: number
    home_runs: number
    walks: number
    strikeouts: number
    stolen_bases: number
    errors: number
    batting_avg: number
    obp: number
    slg: number
  } | null
  recentGames?: Array<{
    date: string
    opponent: string | null
    result: string | null
    hits: number
    at_bats: number
    walks: number
    strikeouts: number
    pitches_thrown: number | null
  }>
  // Highest-weight evidence: what the human actually said they saw
  observations?: Array<{
    date: string | null
    prompt_key: string | null
    entry_type: string | null
    instructor_name?: string | null
    body: string
  }>
  lessonDiagnoses?: Array<{
    date: string | null
    instructor: string | null
    body: string
  }>
  journal?: Array<{
    date: string
    type: string
    instructor?: string | null
    focus?: string | null
    went_well?: string | null
    needs_work?: string | null
  }>
  pastPrescriptions?: Array<{
    priority: string | null
    problem_id: string | null
    status: string
    issued_at: string
    outcome_note: string | null
    adherence_sessions: number
  }>
  // Several at a time — one per focus area. A player works pitching, hitting
  // and fielding in the same week; the surfaces need to see all of it so they
  // don't contradict a plan that's already running in another area.
  activePrescriptions?: Array<{
    id: string
    focus_area: string | null
    priority: string | null
    success_criteria: string | null
    issued_at: string
    review_due_at: string | null
    min_hold_until: string | null
    adherence_sessions: number
  }>
}

// Number of plate appearances below which a batting line is an observation,
// not a tendency. 30 at-bats across a season is noise.
export const MIN_PA_FOR_TENDENCY = 15

function ageFromBirthYear(birthYear: number | null | undefined): number | null {
  if (!birthYear) return null
  return new Date().getFullYear() - birthYear
}

export async function assembleCoachContext(
  supabase: SupabaseClient,
  opts: { coachId: string; teamId?: string | null; playerId?: string | null }
): Promise<CoachContext> {
  const { coachId, teamId, playerId } = opts
  const ctx: CoachContext = {}

  // ── Team ──
  if (teamId) {
    const { data: team } = await supabase
      .from('teams')
      .select('name, age_group, skill_level, season:seasons(league_type)')
      .eq('id', teamId)
      .single()

    if (team) {
      const { count } = await supabase
        .from('team_players')
        .select('*', { count: 'exact', head: true })
        .eq('team_id', teamId)

      ctx.team = {
        name: (team as any).name,
        age_group: (team as any).age_group,
        skill_level: (team as any).skill_level,
        league_type: (team as any).season?.league_type ?? null,
        player_count: count || 0,
      }
    }
  }

  // ── Player identity, ratings, traits ──
  let teamPlayerId: string | null = null
  if (playerId) {
    const { data: player } = await supabase
      .from('players')
      .select('name, jersey_number, birth_year')
      .eq('id', playerId)
      .single()

    if (player) {
      ctx.player = {
        name: (player as any).name,
        jersey_number: (player as any).jersey_number,
        age: ageFromBirthYear((player as any).birth_year),
      }
    }

    if (teamId) {
      const { data: tp } = await supabase
        .from('team_players')
        .select('id, positions, hitting_level, throwing_level, fielding_level, pitching_level, baserunning_level, coachability_level, focus_notes')
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .maybeSingle()

      if (tp && ctx.player) {
        teamPlayerId = (tp as any).id
        ctx.player.positions = (tp as any).positions || []
        ctx.player.skill_levels = {
          hitting: (tp as any).hitting_level,
          throwing: (tp as any).throwing_level,
          fielding: (tp as any).fielding_level,
          pitching: (tp as any).pitching_level,
          baserunning: (tp as any).baserunning_level,
          coachability: (tp as any).coachability_level,
        }
      }
    }

    const [traitsRes, notesRes] = await Promise.all([
      supabase.from('player_traits').select('note').eq('player_id', playerId).limit(10),
      teamId
        ? supabase.from('player_notes').select('note').eq('player_id', playerId).eq('team_id', teamId)
            .order('created_at', { ascending: false }).limit(10)
        : Promise.resolve({ data: [] as any[] }),
    ])
    if (ctx.player) {
      ctx.player.traits = (traitsRes.data || []).map((t: any) => t.note)
      ctx.player.notes = ((notesRes as any).data || []).map((n: any) => n.note)
    }
  }

  // ── Season stats + recent game log ──
  if (teamPlayerId) {
    const { data: season } = await supabase
      .from('player_season_batting')
      .select('*')
      .eq('team_player_id', teamPlayerId)
      .maybeSingle()

    if (season) {
      const s = season as any
      ctx.seasonStats = {
        games_played: s.games_played || 0,
        at_bats: s.total_ab || 0,
        hits: s.total_hits || 0,
        doubles: s.total_doubles || 0,
        triples: s.total_triples || 0,
        home_runs: s.total_hr || 0,
        walks: s.total_walks || 0,
        strikeouts: s.total_strikeouts || 0,
        stolen_bases: s.total_sb || 0,
        errors: s.total_errors || 0,
        batting_avg: Number(s.batting_avg) || 0,
        obp: Number(s.obp) || 0,
        slg: Number(s.slg) || 0,
      }
    }

    const { data: gameLog } = await supabase
      .from('player_game_stats')
      .select('hits, at_bats, walks, strikeouts, pitches_thrown, game:games(game_date, opponent, result)')
      .eq('team_player_id', teamPlayerId)
      .order('created_at', { ascending: false })
      .limit(8)

    ctx.recentGames = (gameLog || []).map((g: any) => ({
      date: g.game?.game_date,
      opponent: g.game?.opponent ?? null,
      result: g.game?.result ?? null,
      hits: g.hits || 0,
      at_bats: g.at_bats || 0,
      walks: g.walks || 0,
      strikeouts: g.strikeouts || 0,
      pitches_thrown: g.pitches_thrown ?? null,
    })).filter((g: any) => g.date)
  }

  // ── Observations — the highest-weight evidence we have ──
  try {
    let obsQuery = supabase
      .from('observations')
      .select('body, prompt_key, observed_on, entry:entries(entry_type, instructor_name)')
      .eq('coach_id', coachId)
      .order('observed_on', { ascending: false })
      .limit(25)

    if (playerId) obsQuery = obsQuery.eq('player_id', playerId)
    else if (teamId) obsQuery = obsQuery.eq('team_id', teamId)

    const { data: obs } = await obsQuery

    ctx.observations = (obs || []).map((o: any) => ({
      date: o.observed_on,
      prompt_key: o.prompt_key,
      entry_type: o.entry?.entry_type ?? null,
      instructor_name: o.entry?.instructor_name ?? null,
      body: o.body,
    }))

    // A lesson diagnosis is adopted, not argued with — pull it out separately
    ctx.lessonDiagnoses = ctx.observations
      .filter(o => o.entry_type === 'lesson' && o.prompt_key === 'instructor_diagnosis')
      .map(o => ({ date: o.date, instructor: o.instructor_name ?? null, body: o.body }))
  } catch {
    // entries/observations may not exist yet — the surface still works without them
    ctx.observations = []
    ctx.lessonDiagnoses = []
  }

  // ── Development journal (pre-dates the activity log; still valuable) ──
  if (playerId && teamId) {
    try {
      const { data: journal } = await supabase
        .from('player_journal_entries')
        .select('session_date, session_type, instructor_name, focus_areas, went_well, needs_work')
        .eq('player_id', playerId)
        .eq('team_id', teamId)
        .order('session_date', { ascending: false })
        .limit(6)

      ctx.journal = (journal || []).map((j: any) => ({
        date: j.session_date,
        type: j.session_type,
        instructor: j.instructor_name,
        focus: j.focus_areas,
        went_well: j.went_well,
        needs_work: j.needs_work,
      }))
    } catch {
      ctx.journal = []
    }
  }

  // ── Prescription history — what we already told them, and whether it moved ──
  try {
    let pq = supabase
      .from('prescriptions')
      .select('id, priority, problem_id, focus_area, status, issued_at, review_due_at, min_hold_until, success_criteria, outcome_note')
      .eq('coach_id', coachId)
      .order('issued_at', { ascending: false })
      .limit(12)

    if (playerId) pq = pq.eq('player_id', playerId)
    else if (teamId) pq = pq.eq('team_id', teamId)

    const { data: pres } = await pq

    if (pres && pres.length > 0) {
      // Adherence comes from home_session entries carrying the prescription_id
      const ids = pres.map((p: any) => p.id)
      const { data: sessions } = await supabase
        .from('entries')
        .select('prescription_id')
        .in('prescription_id', ids)
        .eq('entry_type', 'home_session')

      const countByPrescription: Record<string, number> = {}
      for (const s of sessions || []) {
        const pid = (s as any).prescription_id
        countByPrescription[pid] = (countByPrescription[pid] || 0) + 1
      }

      ctx.activePrescriptions = pres
        .filter((p: any) => p.status === 'active')
        .sort((a: any, b: any) => focusAreaRank(a.focus_area) - focusAreaRank(b.focus_area))
        .map((a: any) => ({
          id: a.id,
          focus_area: a.focus_area ?? null,
          priority: a.priority,
          success_criteria: a.success_criteria,
          issued_at: a.issued_at,
          review_due_at: a.review_due_at,
          min_hold_until: a.min_hold_until,
          adherence_sessions: countByPrescription[a.id] || 0,
        }))

      ctx.pastPrescriptions = pres
        .filter((p: any) => p.status !== 'active')
        .map((p: any) => ({
          priority: p.priority,
          problem_id: p.problem_id,
          status: p.status,
          issued_at: p.issued_at,
          outcome_note: p.outcome_note,
          adherence_sessions: countByPrescription[p.id] || 0,
        }))
    }
  } catch {
    ctx.pastPrescriptions = []
    ctx.activePrescriptions = []
  }

  return ctx
}

// ── Rendering the context into prompt text ─────────────
// Written as prose-ish blocks rather than JSON: the model reads it as
// evidence to reason about, not a schema to echo.

export function renderCoachContext(ctx: CoachContext): string {
  const parts: string[] = []

  if (ctx.player) {
    const p = ctx.player
    const bits = [`Player: ${p.name}`]
    if (p.age) bits.push(`age ${p.age}`)
    if (p.positions?.length) bits.push(p.positions.join('/'))
    parts.push(bits.join(' · '))

    if (p.skill_levels) {
      const labels = ['', 'Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert']
      const rated = Object.entries(p.skill_levels)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${labels[v as number] || v}`)
      if (rated.length) parts.push(`Coach's skill ratings — ${rated.join(', ')}`)
    }
    if (p.traits?.length) parts.push(`Persistent traits: ${p.traits.join(' | ')}`)
    if (p.notes?.length) parts.push(`Coach's notes on this player: ${p.notes.join(' | ')}`)
  }

  if (ctx.team) {
    const t = ctx.team
    parts.push(
      `Team: ${t.name}${t.age_group ? ` (${t.age_group})` : ''}` +
      `${t.skill_level ? `, ${t.skill_level}` : ''}` +
      `${t.league_type ? `, ${t.league_type}` : ''}` +
      `${t.player_count ? `, ${t.player_count} players` : ''}`
    )
  }

  // Lesson diagnoses lead — they are the strongest evidence available
  if (ctx.lessonDiagnoses?.length) {
    parts.push(
      `INSTRUCTOR DIAGNOSES (highest weight — a paid instructor watched in person):\n` +
      ctx.lessonDiagnoses.map(l =>
        `  ${l.date || 'undated'}${l.instructor ? ` (${l.instructor})` : ''}: ${l.body}`
      ).join('\n')
    )
  }

  const nonLessonObs = (ctx.observations || []).filter(
    o => !(o.entry_type === 'lesson' && o.prompt_key === 'instructor_diagnosis')
  )
  if (nonLessonObs.length) {
    parts.push(
      `WHAT THE COACH SAW (outranks the box score — if these conflict with stats, trust these):\n` +
      nonLessonObs.slice(0, 15).map(o => {
        // Notes tapped out during the game carry their own weight: seen live
        // and written at the time, not reconstructed on Sunday night.
        const inGame = o.prompt_key?.startsWith('in_game_')
        const tag = inGame ? `[live, during the game — ${o.prompt_key!.slice('in_game_'.length)}]`
          : o.prompt_key === 'context' ? '[context/fatigue]'
          : o.prompt_key === 'outs' ? '[on the outs]'
          : o.prompt_key === 'unseen' ? '[not in the box score]'
          : o.prompt_key ? `[${o.prompt_key}]` : ''
        return `  ${o.date || 'undated'} ${o.entry_type || ''} ${tag}: ${o.body}`
      }).join('\n')
    )
  }

  if (ctx.seasonStats) {
    const s = ctx.seasonStats
    const pa = s.at_bats + s.walks
    parts.push(
      `SEASON STATS: ${s.games_played} games, ${s.hits}-for-${s.at_bats}` +
      ` (AVG ${s.batting_avg.toFixed(3)}, OBP ${s.obp.toFixed(3)}, SLG ${s.slg.toFixed(3)})` +
      `, ${s.walks}BB ${s.strikeouts}K, ${s.doubles + s.triples + s.home_runs} XBH` +
      `, ${s.stolen_bases}SB, ${s.errors}E` +
      (pa < MIN_PA_FOR_TENDENCY
        ? `\n  ⚠ Only ~${pa} plate appearances. This is an OBSERVATION, not a tendency — say so.`
        : '')
    )
  }

  if (ctx.recentGames?.length) {
    parts.push(
      `RECENT GAMES (most recent first):\n` +
      ctx.recentGames.map(g =>
        `  ${g.date}${g.opponent ? ` vs ${g.opponent}` : ''}: ${g.hits}-for-${g.at_bats}` +
        `${g.walks ? `, ${g.walks}BB` : ''}${g.strikeouts ? `, ${g.strikeouts}K` : ''}` +
        `${g.pitches_thrown ? `, ${g.pitches_thrown} pitches thrown` : ''}`
      ).join('\n')
    )
  }

  if (ctx.journal?.length) {
    parts.push(
      `DEVELOPMENT JOURNAL:\n` +
      ctx.journal.map(j =>
        `  ${j.date} ${j.type}${j.instructor ? ` with ${j.instructor}` : ''}` +
        `${j.focus ? ` — worked on: ${j.focus}` : ''}` +
        `${j.went_well ? ` — went well: ${j.went_well}` : ''}` +
        `${j.needs_work ? ` — needs work: ${j.needs_work}` : ''}`
      ).join('\n')
    )
  }

  if (ctx.activePrescriptions?.length) {
    parts.push(
      `CURRENTLY WORKING ON — ${ctx.activePrescriptions.length} ` +
      `${ctx.activePrescriptions.length === 1 ? 'priority' : 'priorities'} running in parallel, ` +
      `one per area. These do not compete with each other: different skills, different practice slots. ` +
      `Do not tell the coach to drop one to work another.\n\n` +
      ctx.activePrescriptions.map(a =>
        `  [${focusAreaLabel(a.focus_area)}] issued ${a.issued_at?.slice(0, 10)}, ` +
        `review due ${a.review_due_at?.slice(0, 10)}\n` +
        `    Priority: ${a.priority}\n` +
        `    Success criteria set at the time: ${a.success_criteria}\n` +
        `    Home sessions logged against it: ${a.adherence_sessions}` +
        (a.adherence_sessions === 0
          ? ' — nothing logged yet, so we cannot tell whether the plan failed or was never run.'
          : '')
      ).join('\n\n')
    )
  }

  if (ctx.pastPrescriptions?.length) {
    parts.push(
      `WHAT WE'VE ALREADY TRIED:\n` +
      ctx.pastPrescriptions.map(p =>
        `  ${p.issued_at?.slice(0, 10)}: "${p.priority}" — ${p.status}` +
        `${p.outcome_note ? ` (${p.outcome_note})` : ''}` +
        `, ${p.adherence_sessions} home sessions logged`
      ).join('\n')
    )
  }

  return parts.length > 0 ? parts.join('\n\n') : 'No history logged for this player yet.'
}
