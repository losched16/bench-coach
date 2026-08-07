// The check-in — the half of the loop that makes the first half worth paying for.
//
// Three weeks ago we told a coach one thing to work on and stated, in advance,
// what "it worked" would look like. This module goes and finds out.
//
// Two jobs live here:
//
//   1. Gather the evidence that accumulated since the prescription was issued,
//      split before/after so a change is visible rather than asserted.
//   2. Read adherence honestly. This is the part everything else depends on.
//      "It didn't move" means two completely different things depending on
//      whether the work was actually done, and a system that cannot tell the
//      difference gives the wrong advice half the time — it changes a drill
//      that was never run, or nags about sessions when the drill was wrong.
//
// Everything above `gatherCheckinEvidence` is pure so it can be reasoned about
// and tested without a database.

import { SupabaseClient } from '@supabase/supabase-js'
import { focusAreaLabel } from './focusAreas'
import { MIN_SESSIONS_FOR_TREND } from './metrics'

// ── Timing ─────────────────────────────────────────────

export function daysBetween(from: string | Date, to: string | Date = new Date()): number {
  const a = new Date(from).getTime()
  const b = new Date(to).getTime()
  if (isNaN(a) || isNaN(b)) return 0
  return Math.floor((b - a) / 86_400_000)
}

export type DueState = 'holding' | 'due' | 'overdue'

// A prescription holds its priority for a minimum window (min_hold_until)
// because youth data oscillates week to week. Before that date there is
// nothing useful to say; after review_due_at there is.
export function dueState(
  p: { review_due_at?: string | null; min_hold_until?: string | null; issued_at?: string | null },
  now: Date = new Date()
): DueState {
  const due = p.review_due_at
    ? new Date(p.review_due_at)
    : p.issued_at ? new Date(new Date(p.issued_at).getTime() + 21 * 86_400_000) : null
  if (!due) return 'holding'
  const overdueAt = new Date(due.getTime() + 7 * 86_400_000)
  if (now >= overdueAt) return 'overdue'
  if (now >= due) return 'due'
  return 'holding'
}

// ── Adherence ──────────────────────────────────────────
// The prescription's "This week" block asks a parent for two home sessions a
// week, or a coach for one practice block. That is the denominator — not a
// target to hit, a scale to read the result against.

export const SESSIONS_PER_WEEK: Record<'player' | 'team', number> = { player: 2, team: 1 }

export function expectedSessions(scope: 'player' | 'team', daysElapsed: number): number {
  const weeks = Math.max(1, Math.round(daysElapsed / 7))
  return weeks * SESSIONS_PER_WEEK[scope]
}

export type AdherenceBand = 'ran_it' | 'partial' | 'not_run'

export interface AdherenceRead {
  logged: number
  expected: number
  band: AdherenceBand
  // What this means for the diagnosis — the single most important line in the
  // whole check-in, because it decides whether we change the drill or the plan.
  interpretation: string
}

export function readAdherence(
  logged: number,
  expected: number,
  moved: 'yes' | 'no' | 'unclear' = 'unclear'
): AdherenceRead {
  const ratio = expected > 0 ? logged / expected : 0
  const band: AdherenceBand = logged === 0 ? 'not_run' : ratio >= 0.6 ? 'ran_it' : 'partial'

  let interpretation: string
  if (band === 'not_run') {
    // Never a scolding. If nothing was logged, the plan asked for something
    // that did not fit into this family's week — that is a plan problem.
    interpretation = moved === 'yes'
      ? 'Nothing was logged against this, and it moved anyway. Either it was worked without being logged, or it was going to resolve on its own. Do not claim credit for the plan.'
      : 'Nothing was logged against this, so we have no evidence the work happened — which means we cannot conclude the drill failed. Treat this as a plan-size problem, not a player problem: the ask was too long, too complicated, or needed equipment they do not have. Shrink it to something that fits into ten minutes in a driveway, and say so without any suggestion they let anyone down.'
  } else if (band === 'partial') {
    interpretation = `Some of the work happened (${logged} of about ${expected}). That is enough to be worth something and not enough to be conclusive. If it moved, keep the same plan and let it run longer. If it did not, the honest read is "not enough reps yet" before "wrong drill".`
  } else {
    interpretation = moved === 'no'
      ? `The work was done (${logged} of about ${expected}) and it did not move. That is real information: the dose was not the problem, so the drill or the diagnosis was. Change one of those — do not prescribe more of the same.`
      : `The work was done (${logged} of about ${expected}). Whatever the result is, it is trustworthy — it reflects the plan, not a gap in effort.`
  }

  return { logged, expected, band, interpretation }
}

// ── The verdict tail ───────────────────────────────────
// The check-in streams prose, then a small JSON tail with the disposition it
// recommends. The coach still clicks the button — we suggest, they decide.

export const VERDICT_SENTINEL = '\n<<<BENCHCOACH_VERDICT>>>'

export type VerdictStatus = 'resolved' | 'stalled' | 'abandoned' | 'active'

export interface Verdict {
  status: VerdictStatus
  outcome_note: string
  // set when the recommendation is to work something different next
  next_focus?: string | null
}

const VALID_STATUSES: VerdictStatus[] = ['resolved', 'stalled', 'abandoned', 'active']

const VERDICT_TOKEN = VERDICT_SENTINEL.trim()

export function splitVerdict(raw: string): { markdown: string; verdict: Verdict | null } {
  // Match on the bare token rather than the newline-prefixed form: the model
  // reliably puts it on its own line, but not reliably with exactly one \n.
  const idx = raw.indexOf(VERDICT_TOKEN)
  if (idx === -1) return { markdown: raw.trim(), verdict: null }
  const markdown = raw.slice(0, idx).trim()
  const tail = raw.slice(idx + VERDICT_TOKEN.length)
  try {
    const m = tail.match(/\{[\s\S]*\}/)
    if (!m) return { markdown, verdict: null }
    const parsed = JSON.parse(m[0]) as Partial<Verdict>
    const status = VALID_STATUSES.includes(parsed.status as VerdictStatus)
      ? (parsed.status as VerdictStatus)
      : 'active'
    return {
      markdown,
      verdict: {
        status,
        outcome_note: String(parsed.outcome_note || '').trim(),
        next_focus: parsed.next_focus ? String(parsed.next_focus) : null,
      },
    }
  } catch {
    return { markdown, verdict: null }
  }
}

// Mid-stream, the buffer can hold a half-arrived sentinel ("\n<<<BENCH"). That
// is not prose and must not flash into the last section — hide anything from
// the last unterminated "<<<" onward while the tail is still landing.
export function visibleMarkdown(buffer: string): string {
  const at = buffer.indexOf(VERDICT_TOKEN)
  if (at !== -1) return buffer.slice(0, at)
  const partial = buffer.lastIndexOf('<<<')
  if (partial !== -1 && VERDICT_TOKEN.startsWith(buffer.slice(partial))) {
    return buffer.slice(0, partial)
  }
  return buffer
}

export const CHECKIN_HEADINGS = [
  'Where this started',
  "What's happened since",
  'The read',
  'Next three weeks',
] as const

// ── Evidence ───────────────────────────────────────────

export interface GameLine {
  date: string
  opponent: string | null
  at_bats: number
  hits: number
  walks: number
  strikeouts: number
  pitches_thrown: number | null
}

export interface CheckinEvidence {
  prescription: {
    id: string
    scope: 'player' | 'team'
    focus_area: string | null
    priority: string | null
    summary: string | null
    success_criteria: string | null
    problem_id: string | null
    origin: string
    issued_at: string
    review_due_at: string | null
    drill_names: string[]
  }
  subjectName: string
  playerAge: number | null
  daysElapsed: number
  due: DueState
  adherence: AdherenceRead
  sessions: Array<{ date: string; title: string | null; notes: Array<{ prompt_key: string | null; body: string }> }>
  gamesBefore: GameLine[]
  gamesSince: GameLine[]
  observationsSince: Array<{ date: string | null; prompt_key: string | null; entry_type: string | null; instructor: string | null; body: string }>
  otherEntriesSince: Array<{ date: string; type: string; title: string | null }>
  metricsSince: Array<{ date: string; metric: string; value: number; unit: string | null }>
}

export async function gatherCheckinEvidence(
  supabase: SupabaseClient,
  prescriptionId: string,
  coachId: string
): Promise<CheckinEvidence | null> {
  const { data: pres } = await supabase
    .from('prescriptions')
    .select('*')
    .eq('id', prescriptionId)
    .eq('coach_id', coachId)
    .maybeSingle()

  if (!pres) return null
  const p = pres as any
  const scope: 'player' | 'team' = p.scope === 'team' ? 'team' : 'player'
  const issuedAt: string = p.issued_at || p.created_at
  const issuedDate = issuedAt.slice(0, 10)
  const daysElapsed = daysBetween(issuedAt)

  // ── Who this is about ──
  let subjectName = 'this team'
  let playerAge: number | null = null
  let teamPlayerId: string | null = null

  if (scope === 'player' && p.player_id) {
    const { data: player } = await supabase
      .from('players').select('name, birth_year').eq('id', p.player_id).maybeSingle()
    if (player) {
      subjectName = (player as any).name
      const by = (player as any).birth_year
      playerAge = by ? new Date().getFullYear() - by : null
    }
    if (p.team_id) {
      const { data: tp } = await supabase
        .from('team_players').select('id')
        .eq('team_id', p.team_id).eq('player_id', p.player_id).maybeSingle()
      teamPlayerId = (tp as any)?.id || null
    }
  } else if (p.team_id) {
    const { data: team } = await supabase.from('teams').select('name').eq('id', p.team_id).maybeSingle()
    if (team) subjectName = (team as any).name
  }

  // ── The drills we actually prescribed, by name ──
  let drillNames: string[] = []
  if (Array.isArray(p.drill_ids) && p.drill_ids.length > 0) {
    const { data: drills } = await supabase
      .from('drill_resources').select('drill_name').in('id', p.drill_ids)
    drillNames = (drills || []).map((d: any) => d.drill_name).filter(Boolean)
  }

  // ── Adherence: home_session entries carrying this prescription_id ──
  const { data: sessionRows } = await supabase
    .from('entries')
    .select('id, occurred_on, title, observations(prompt_key, body)')
    .eq('prescription_id', prescriptionId)
    .eq('entry_type', 'home_session')
    .order('occurred_on', { ascending: true })

  const sessions = (sessionRows || []).map((e: any) => ({
    date: e.occurred_on,
    title: e.title || null,
    notes: (e.observations || []).map((o: any) => ({ prompt_key: o.prompt_key, body: o.body })),
  }))

  // ── Games, split before and after the prescription ──
  let gamesBefore: GameLine[] = []
  let gamesSince: GameLine[] = []

  if (teamPlayerId) {
    const { data: lines } = await supabase
      .from('player_game_stats')
      .select('hits, at_bats, walks, strikeouts, pitches_thrown, game:games(game_date, opponent)')
      .eq('team_player_id', teamPlayerId)

    const mapped = (lines || [])
      .map((g: any) => ({
        date: g.game?.game_date as string,
        opponent: g.game?.opponent ?? null,
        at_bats: g.at_bats || 0,
        hits: g.hits || 0,
        walks: g.walks || 0,
        strikeouts: g.strikeouts || 0,
        pitches_thrown: g.pitches_thrown ?? null,
      }))
      .filter((g: GameLine) => !!g.date)
      .sort((a: GameLine, b: GameLine) => a.date.localeCompare(b.date))

    gamesSince = mapped.filter((g: GameLine) => g.date >= issuedDate)
    // Baseline: the games immediately before, so "before vs after" compares
    // like with like rather than against a whole season of a different player.
    gamesBefore = mapped.filter((g: GameLine) => g.date < issuedDate).slice(-12)
  }

  // ── What the human saw since ──
  let obsQuery = supabase
    .from('observations')
    .select('body, prompt_key, observed_on, entry:entries(entry_type, instructor_name)')
    .eq('coach_id', coachId)
    .gte('observed_on', issuedDate)
    .order('observed_on', { ascending: true })
    .limit(30)

  if (scope === 'player' && p.player_id) obsQuery = obsQuery.eq('player_id', p.player_id)
  else if (p.team_id) obsQuery = obsQuery.eq('team_id', p.team_id)

  const { data: obs } = await obsQuery
  const observationsSince = (obs || []).map((o: any) => ({
    date: o.observed_on,
    prompt_key: o.prompt_key,
    entry_type: o.entry?.entry_type ?? null,
    instructor: o.entry?.instructor_name ?? null,
    body: o.body,
  }))

  // ── Everything else logged in the window (practices, lessons, games) ──
  let entryQuery = supabase
    .from('entries')
    .select('occurred_on, entry_type, title')
    .eq('coach_id', coachId)
    .gte('occurred_on', issuedDate)
    .order('occurred_on', { ascending: true })
    .limit(40)

  if (scope === 'player' && p.player_id) entryQuery = entryQuery.eq('player_id', p.player_id)
  else if (p.team_id) entryQuery = entryQuery.eq('team_id', p.team_id)

  const { data: otherEntries } = await entryQuery
  const otherEntriesSince = (otherEntries || [])
    .filter((e: any) => e.entry_type !== 'home_session')
    .map((e: any) => ({ date: e.occurred_on, type: e.entry_type, title: e.title || null }))

  // ── Metrics, if any were logged. Trend only, never a single reading. ──
  let metricsSince: CheckinEvidence['metricsSince'] = []
  if (scope === 'player' && p.player_id) {
    const { data: metrics } = await supabase
      .from('player_metrics')
      .select('metric, value, unit, measured_on')
      .eq('player_id', p.player_id)
      .order('measured_on', { ascending: true })
      .limit(20)
    metricsSince = (metrics || []).map((m: any) => ({
      date: m.measured_on, metric: m.metric, value: Number(m.value), unit: m.unit,
    }))
  }

  const adherence = readAdherence(sessions.length, expectedSessions(scope, daysElapsed))

  return {
    prescription: {
      id: p.id,
      scope,
      focus_area: p.focus_area ?? null,
      priority: p.priority,
      summary: p.summary,
      success_criteria: p.success_criteria,
      problem_id: p.problem_id,
      origin: p.origin || 'ai',
      issued_at: issuedAt,
      review_due_at: p.review_due_at,
      drill_names: drillNames,
    },
    subjectName,
    playerAge,
    daysElapsed,
    due: dueState(p),
    adherence,
    sessions,
    gamesBefore,
    gamesSince,
    observationsSince,
    otherEntriesSince,
    metricsSince,
  }
}

// ── Rendering evidence for the prompt ──────────────────

function battingSummary(games: GameLine[]): string {
  const ab = games.reduce((s, g) => s + g.at_bats, 0)
  const h = games.reduce((s, g) => s + g.hits, 0)
  const bb = games.reduce((s, g) => s + g.walks, 0)
  const k = games.reduce((s, g) => s + g.strikeouts, 0)
  const avg = ab > 0 ? (h / ab).toFixed(3) : '—'
  return `${games.length} games, ${h}-for-${ab} (${avg}), ${bb}BB ${k}K`
}

export function renderCheckinEvidence(ev: CheckinEvidence): string {
  const parts: string[] = []
  const p = ev.prescription

  parts.push(
    `THE ${focusAreaLabel(p.focus_area).toUpperCase()} PRIORITY WE ISSUED ${p.issued_at.slice(0, 10)} ` +
    `(${ev.daysElapsed} days ago) for ${ev.subjectName}` +
    (ev.playerAge ? `, age ${ev.playerAge}` : '') + ':\n' +
    `  The one thing: ${p.priority || '(not recorded)'}\n` +
    `  What we said to watch for: ${p.success_criteria || '(no criteria recorded — say so, and set some this time)'}\n` +
    (p.summary ? `  Our read at the time: ${p.summary}\n` : '') +
    (p.drill_names.length ? `  Drills we sent: ${p.drill_names.join(', ')}\n` : '') +
    (p.origin === 'instructor'
      ? `  This came from an in-person instructor diagnosis, not from us. Do not overturn it on box-score evidence alone.\n`
      : '')
  )

  parts.push(
    `WORK LOGGED AGAINST IT: ${ev.adherence.logged} sessions` +
    ` (the plan asked for roughly ${ev.adherence.expected} over this period)\n` +
    (ev.sessions.length
      ? ev.sessions.map(s =>
          `  ${s.date}${s.title ? ` — ${s.title}` : ''}` +
          (s.notes.length ? `\n${s.notes.map(n => `      ${n.prompt_key === 'how_it_went' ? 'how it went' : n.prompt_key === 'worked_on' ? 'ran' : n.prompt_key || 'note'}: ${n.body}`).join('\n')}` : '')
        ).join('\n')
      : '  (nothing logged)') +
    `\n\n  HOW TO READ THAT: ${ev.adherence.interpretation}`
  )

  if (ev.gamesSince.length || ev.gamesBefore.length) {
    parts.push(
      `GAMES SINCE: ${ev.gamesSince.length ? battingSummary(ev.gamesSince) : 'none played'}\n` +
      ev.gamesSince.map(g =>
        `  ${g.date}${g.opponent ? ` vs ${g.opponent}` : ''}: ${g.hits}-for-${g.at_bats}` +
        `${g.walks ? `, ${g.walks}BB` : ''}${g.strikeouts ? `, ${g.strikeouts}K` : ''}` +
        `${g.pitches_thrown ? `, ${g.pitches_thrown} pitches` : ''}`
      ).join('\n') +
      (ev.gamesBefore.length
        ? `\n\nBASELINE — the ${ev.gamesBefore.length} games immediately before we issued this: ${battingSummary(ev.gamesBefore)}`
        : '\n\nNo games on file before this was issued, so there is no statistical baseline to compare against. Say that rather than implying a trend.')
    )
  } else {
    parts.push('GAMES SINCE: none logged. The box score cannot answer this one — lean entirely on what the coach saw and what the sessions say.')
  }

  if (ev.observationsSince.length) {
    const lessons = ev.observationsSince.filter(o => o.entry_type === 'lesson' && o.prompt_key === 'instructor_diagnosis')
    const rest = ev.observationsSince.filter(o => !(o.entry_type === 'lesson' && o.prompt_key === 'instructor_diagnosis'))
    if (lessons.length) {
      parts.push(
        `INSTRUCTOR SAW THE PLAYER SINCE (highest weight — this outranks everything below):\n` +
        lessons.map(o => `  ${o.date}${o.instructor ? ` (${o.instructor})` : ''}: ${o.body}`).join('\n')
      )
    }
    if (rest.length) {
      parts.push(
        `WHAT THE COACH SAW SINCE (outranks the box score):\n` +
        rest.map(o => `  ${o.date} ${o.entry_type || ''}${o.prompt_key ? ` [${o.prompt_key}]` : ''}: ${o.body}`).join('\n')
      )
    }
  } else {
    parts.push('WHAT THE COACH SAW SINCE: nothing written down. That is a real limit on what you can conclude — say so plainly instead of inferring.')
  }

  if (ev.otherEntriesSince.length) {
    parts.push(
      `ALSO LOGGED IN THE WINDOW:\n` +
      ev.otherEntriesSince.map(e => `  ${e.date} ${e.type}${e.title ? ` — ${e.title}` : ''}`).join('\n')
    )
  }

  // Measurements are the only objective evidence available to a check-in.
  // If a priority moved a number, that is the strongest possible answer to
  // "did it work" — and if it didn't, that's just as decisive.
  if (ev.metricsSince.length > 0) {
    const byMetric: Record<string, typeof ev.metricsSince> = {}
    for (const m of ev.metricsSince) (byMetric[m.metric] ||= []).push(m)

    parts.push(
      `MEASUREMENTS — objective, unlike everything above:\n` +
      Object.entries(byMetric).map(([metric, rows]) => {
        const dates = Array.from(new Set(rows.map(r => r.date)))
        const line = rows.map(r => `${r.date}: ${r.value}${r.unit || ''}`).join(', ')
        return `  ${metric} — ${line}` +
          (dates.length < MIN_SESSIONS_FOR_TREND
            ? `\n      ⚠ only ${dates.length} session${dates.length === 1 ? '' : 's'}. Not a trend yet — do NOT ` +
              `call a direction off this, say what another session or two would tell you.`
            : '')
      }).join('\n') +
      `\n\n  Where a number moved and the priority was about that quality, say so — it is the cleanest ` +
      `evidence in this whole check-in. Where it did not move, that is equally decisive and you should ` +
      `say that too. Never celebrate a single good session.`
    )
  }

  return parts.join('\n\n')
}
