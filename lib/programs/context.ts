// Gathering what we know about the player, labelled by source.
//
// I/O is split from mapping: `evidenceFromContext` is pure and tested;
// `loadPlayerEvidence` reads. The caller has ALREADY authorised the player on
// the team (lib/authz.authorizePlayer) — every read here is additionally
// scoped by that team and player, and only the already-assembled, capped
// coach context ever reaches a prompt.

import { assembleCoachContext, renderCoachContext, type CoachContext } from '../coachContext'
import { detectSkills } from './skills'
import type { EvidenceItem, PathwayRef, PlayerEvidence } from './evidence'
import type { SkillKey } from './types'

const POSITIVE = /\b(went well|great|strong|good|improv|nice|solid|8[- ]?for[- ]?8|clean)\b/i
const NEGATIVE = /\b(needs? work|drift|early|late|slow|struggl|pulling|bucket|rolls? over|collaps|weak|trouble|miss|drop|bobbl|inconsistent|flaw)\b/i
const ISO = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : null)
const ago = (d: string | null | undefined, today: string, days: number) => {
  const iso = ISO(d); if (!iso) return false
  return (Date.parse(today) - Date.parse(iso)) / 86400000 <= days
}

export function skillForPathway(name: string): SkillKey | null {
  const n = name.toLowerCase()
  if (/speed|agility|first[- ]step|quick/.test(n)) return 'first_step'
  if (/outfield|fly/.test(n)) return 'outfield_tracking'
  if (/infield|ground|fielding/.test(n)) return 'infield_fundamentals'
  if (/swing|hitting|launch|load|bat/.test(n)) return 'hitting'
  if (/pitch/.test(n)) return 'pitching_readiness'
  if (/throw/.test(n)) return 'throwing'
  if (/catch/.test(n)) return 'catching'
  if (/base ?run/.test(n)) return 'baserunning'
  return null
}

export interface EvidenceExtras {
  pitchOutings?: Array<{ date: string | null; pitches: number }>
}

export function evidenceFromContext(ctx: CoachContext, today: string, extras: EvidenceExtras = {}): PlayerEvidence {
  const items: EvidenceItem[] = []
  const push = (e: EvidenceItem) => { if (items.length < 40) items.push(e) }

  for (const o of (ctx.observations || []).slice(0, 10)) {
    const body = String(o.body || '').slice(0, 260)
    if (!body) continue
    const bucket = NEGATIVE.test(body) && !(POSITIVE.test(body) && !NEGATIVE.test(body)) ? 'needs' : POSITIVE.test(body) ? 'strengths' : 'history'
    push({ bucket, source: 'coach_observation', on: ISO(o.date), skill: detectSkills(body)[0] ?? null, text: body })
  }
  for (const l of (ctx.lessonDiagnoses || []).slice(0, 4)) {
    const body = String(l.body || '').slice(0, 260)
    if (body) push({ bucket: 'needs', source: 'coach_observation', on: ISO(l.date), skill: detectSkills(body)[0] ?? null,
      text: `${l.instructor ? l.instructor + ': ' : ''}${body}` })
  }
  for (const j of (ctx.journal || []).slice(0, 5)) {
    if (j.needs_work) push({ bucket: 'needs', source: 'coach_observation', on: ISO(j.date), skill: detectSkills(j.needs_work)[0] ?? null, text: String(j.needs_work).slice(0, 220) })
    if (j.went_well) push({ bucket: 'strengths', source: 'coach_observation', on: ISO(j.date), skill: detectSkills(j.went_well)[0] ?? null, text: String(j.went_well).slice(0, 220) })
  }
  const st = ctx.seasonStats
  if (st && st.at_bats > 0) {
    push({ bucket: 'history', source: 'recorded', on: null, skill: 'hitting',
      text: `Season so far: ${st.hits} hits in ${st.at_bats} at-bats over ${st.games_played} games${st.at_bats < 15 ? ' (small sample — an observation, not a tendency)' : ''}.` })
  }
  const outings = extras.pitchOutings || []
  if (outings.length) {
    const last = outings[0]
    push({ bucket: 'history', source: 'recorded', on: ISO(last.date), skill: 'pitching_readiness',
      text: `${outings.length} pitching outing${outings.length === 1 ? '' : 's'} logged; the most recent was ${last.pitches} pitches.` })
  } else {
    push({ bucket: 'unknowns', source: 'missing', skill: 'pitching_readiness', text: 'No pitch counts are logged for this player. Throwing history outside the app is unknown.' })
  }

  const metrics: PlayerEvidence['metrics'] = []
  for (const m of ctx.metrics || []) {
    const last = m.sessions[m.sessions.length - 1]
    if (!last) continue
    metrics.push({ slug: m.type.slug, label: m.type.label, value: m.type.direction === 'lower' ? last.best : last.best, unit: m.type.unit, on: last.date, attempts: last.attempts, successes: last.successes })
    push({ bucket: 'history', source: 'recorded', on: ISO(last.date), skill: null,
      text: `${m.type.label}: ${m.sessions.length} session${m.sessions.length === 1 ? '' : 's'} on file${m.sessions.length < 3 ? ' (too few to call a trend)' : ''}.` })
  }

  const pathways: PathwayRef[] = []
  for (const e of ctx.pathways?.entries || []) {
    pathways.push({ progressId: e.progressId, skill: skillForPathway(e.pathwayName), pathwayName: e.pathwayName, stageName: e.stage?.name ?? null, status: e.status })
    push({ bucket: 'history', source: 'recorded', on: e.stageStartedOn, skill: skillForPathway(e.pathwayName),
      text: `Development plan "${e.pathwayName}"${e.stage ? `, stage ${e.stage.number} of ${e.stage.total} (${e.stage.name})` : ''}; ${e.sessionsTotal === 0 ? 'no sessions recorded against it yet (not the same as none done)' : `${e.sessionsTotal} session${e.sessionsTotal === 1 ? '' : 's'} recorded`}.` })
  }

  const recent =
    (ctx.observations || []).filter(o => ago(o.date, today, 60)).length +
    (ctx.journal || []).filter(j => ago(j.date, today, 60)).length +
    (ctx.pathways?.entries || []).reduce((a, e) => a + e.recentEvents.filter(ev => ago(ev.on, today, 60)).length, 0)

  return {
    items, pathways, metrics, loggedSessions60d: recent,
    contextText: renderCoachContext(ctx, { today: new Date(today) }).slice(0, 3500),
  }
}

/** Authorised reads only: the route has already checked player-on-team. */
export async function loadPlayerEvidence(db: any, opts: { coachId: string; teamId: string; playerId: string; today: string }): Promise<{
  evidence: PlayerEvidence
  player: { name: string | null; age: number | null; positions: string[] }
}> {
  const ctx = await assembleCoachContext(db, { coachId: opts.coachId, teamId: opts.teamId, playerId: opts.playerId })
  let outings: EvidenceExtras['pitchOutings'] = []
  try {
    const { data } = await db.from('game_pitch_counts')
      .select('pitch_count, game:games(game_date, team_id)').eq('player_id', opts.playerId).limit(40)
    outings = (data || [])
      .filter((r: any) => (Array.isArray(r.game) ? r.game[0] : r.game)?.team_id === opts.teamId)
      .map((r: any) => ({ date: (Array.isArray(r.game) ? r.game[0] : r.game)?.game_date ?? null, pitches: Number(r.pitch_count) || 0 }))
      .sort((a: any, b: any) => String(b.date).localeCompare(String(a.date)))
  } catch { /* no pitch table or none logged: handled as unknown */ }
  const { data: tp } = await db.from('team_players').select('positions').eq('team_id', opts.teamId).eq('player_id', opts.playerId).maybeSingle()
  return {
    evidence: evidenceFromContext(ctx, opts.today, { pitchOutings: outings }),
    player: { name: ctx.player?.name ?? null, age: ctx.player?.age ?? null, positions: (tp as any)?.positions || ctx.player?.positions || [] },
  }
}
