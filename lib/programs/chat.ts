// CoachAI's program turns: recognise the request, build or edit the draft, and
// answer with the strategy plus a pointer to the real, editable draft.
//
// Returns null for every other intent — the existing conversational path
// handles those, with intent guidance added to its prompt (see coachVoice).

import { weekdayName } from './calendar'
import { loadPlayerEvidence } from './context'
import { applyReplaceDrill, applyRestDay, briefForEdit, parseEdit, refreshDerived, weekSummary } from './edits'
import { generateProgram } from './generate'
import { classifyIntent, type Intent } from './intent'
import { anthropicCaller } from './model'
import { createProgramDraft, loadPool } from './service'
import { openDraftForThread, updateDraft } from './store'
import { validateDraft } from './validate'
import type { ProgramDraft } from './types'

export interface ProgramTurnInput {
  db: any
  teamId: string
  coachId: string
  userId: string | null
  threadId: string
  message: string
  history: Array<{ role: string; content: string }>
  /** The player this conversation is scoped to, already authorised. */
  playerId: string | null
  roster: Array<{ playerId: string; name: string }>
  today?: string
}

export interface ProgramTurnResult {
  message: string
  meta: { kind: 'program_draft' | 'program_needs_info'; draftId?: string; playerId?: string; playerName?: string | null; weeks?: number } | null
  intent: Intent
}

/** Pick the player the coach means. Never guesses between two. */
export function resolvePlayer(
  text: string, scoped: string | null, roster: Array<{ playerId: string; name: string }>,
): { playerId: string; name: string } | { ambiguous: string[] } | null {
  if (scoped) { const r = roster.find(p => p.playerId === scoped); return r ? { playerId: r.playerId, name: r.name } : null }
  const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // A full name is decisive; a first name only counts when no full name matched.
  const full = roster.filter(p => new RegExp(`\\b${esc(p.name)}\\b`, 'i').test(text))
  const hits = full.length ? full : roster.filter(p => {
    const first = p.name.split(/\s+/).filter(w => w.length >= 3)[0]
    return !!first && new RegExp(`\\b${esc(first)}\\b`, 'i').test(text)
  })
  if (hits.length === 1) return { playerId: hits[0].playerId, name: hits[0].name }
  if (hits.length > 1) return { ambiguous: hits.map(h => h.name) }
  return null
}

export async function handleProgramTurn(i: ProgramTurnInput): Promise<ProgramTurnResult | null> {
  const open = await openDraftForThread(i.db, i.threadId, i.teamId)
  const userHistory = i.history.filter(h => h.role === 'user').map(h => h.content).slice(-4)
  const intent = classifyIntent(i.message, { hasOpenDraft: !!open, recentUserMessages: userHistory, hasPlayer: !!i.playerId })

  if (intent.intent === 'program_edit' && open) return await editTurn(i, open)
  if (intent.intent !== 'program') return null

  const who = resolvePlayer([i.message, ...userHistory].join('\n'), i.playerId, i.roster)
  if (!who) return { intent: 'program', meta: { kind: 'program_needs_info' }, message: 'I can build that program. Which player is it for? Pick them from the roster (or open this chat from their page) and I’ll use everything recorded about them.' }
  if ('ambiguous' in who) return { intent: 'program', meta: { kind: 'program_needs_info' }, message: `That could be ${who.ambiguous.join(' or ')}. Which one should I build the program for?` }

  const res = await createProgramDraft({
    db: i.db, teamId: i.teamId, coachId: i.coachId, userId: i.userId, playerId: who.playerId, threadId: i.threadId,
    message: i.message, priorUserMessages: userHistory, today: i.today,
  })
  if (res.status === 'needs_info') {
    return { intent: 'program', meta: { kind: 'program_needs_info' }, message: `I want to get this right before I build it:\n\n${res.questions.map(q => `- ${q}`).join('\n')}` }
  }
  return {
    intent: 'program',
    message: renderProgramMessage(res.draft, who.name),
    meta: { kind: 'program_draft', draftId: res.draftId, playerId: who.playerId, playerName: who.name, weeks: res.draft.brief.weeks },
  }
}

async function editTurn(i: ProgramTurnInput, open: { id: string; player_id: string; version: number; payload: ProgramDraft }): Promise<ProgramTurnResult> {
  const op = parseEdit(i.message)
  const meta = { kind: 'program_draft' as const, draftId: open.id, playerId: open.player_id, weeks: open.payload.brief.weeks }
  if (!op) return { intent: 'program_edit', meta, message: 'I couldn’t tell what to change. Try “make Thursday a rest day”, “add more outfield work”, “change this to three days a week”, “show me week 4”, or “replace "Tee Work" with one I can do indoors”.' }

  if (op.kind === 'show_week') return { intent: 'program_edit', meta, message: weekSummary(open.payload, op.week) }

  let draft = open.payload
  let say = ''
  if (op.kind === 'rest_day') {
    const r = applyRestDay(draft, op.weekday)
    if (!r.ok) return { intent: 'program_edit', meta, message: r.message }
    draft = r.draft; say = r.message
  } else if (op.kind === 'replace_drill') {
    const pool = await loadPool(i.db, i.coachId)
    const r = applyReplaceDrill(draft, op, pool)
    if (!r.ok) return { intent: 'program_edit', meta, message: r.message }
    draft = r.draft; say = r.message
  } else {
    const brief = briefForEdit(draft.brief, op)
    if (!brief) return { intent: 'program_edit', meta, message: 'I couldn’t apply that.' }
    const { evidence } = await loadPlayerEvidence(i.db, { coachId: i.coachId, teamId: i.teamId, playerId: open.player_id, today: i.today ?? new Date().toISOString().slice(0, 10) })
    const pool = await loadPool(i.db, i.coachId)
    draft = await generateProgram({ brief, evidence, pool, model: anthropicCaller() })
    say = op.kind === 'days_per_week'
      ? `I rebuilt the whole schedule for ${op.days} supervised days a week. Every skill, week and checkpoint is still covered.`
      : `I moved that skill to the top priority and re-planned. Nothing else you asked for was dropped.`
  }
  refreshDerived(draft)
  const pool = await loadPool(i.db, i.coachId)
  draft.qualityReport = { checks: validateDraft(draft, { drillIds: new Set(pool.map(p => p.id)) }), repairs: [], warnings: draft.qualityReport?.warnings ?? [] }
  await updateDraft(i.db, open.id, i.teamId, open.version, draft)
  return { intent: 'program_edit', meta, message: `${say} It's still a draft — open it to review every session. Nothing is saved until you approve it.` }
}

// ── the message the coach reads ──────────────────────────────────────────────

const DAY = (d: string) => weekdayName(d).slice(0, 3)

export function renderProgramMessage(d: ProgramDraft, name: string): string {
  const b = d.brief
  const last = d.sessions.reduce((a, s) => (s.date > a ? s.date : a), b.startDate)
  const lines: string[] = []
  lines.push(`Here is the full ${b.weeks}-week program for ${name} (${b.startDate} to ${last}). I built it around ${name}'s own records, and every goal you listed is in it. It's a draft: nothing is saved until you review and approve it.`)

  lines.push('**What this is based on**')
  const labelled = (src: string, label: string) => d.assessment.needs.concat(d.assessment.strengths, d.assessment.history, d.assessment.concerns)
    .filter(e => e.source === src).slice(0, 3).map(e => `- ${label}${e.on ? ' (' + e.on + ')' : ''}: ${e.text}`)
  lines.push(...labelled('recorded', 'Recorded'), ...labelled('coach_observation', 'Coach observation'), ...labelled('user_reported', 'You told me'))
  const unknowns = d.assessment.unknowns.slice(0, 3).map(e => `- ${e.text}`)
  if (unknowns.length) lines.push('', '**Not known yet**', ...unknowns)

  lines.push('', '**Priorities** (these shape how much time each gets; none was dropped)')
  d.skills.forEach(s => lines.push(`${s.priority}. ${s.label}${s.pathwayName ? ` — continues "${s.pathwayName}"${s.currentStage ? ` (${s.currentStage})` : ''}` : ''}`))

  lines.push('', '**Phases**')
  d.phases.forEach(p => lines.push(`- Weeks ${p.startWeek}–${p.endWeek}, ${p.name}: ${p.difficulty}`))

  const wk = d.sessions.filter(s => s.week === 1 && s.kind !== 'independent').sort((a, c) => a.date.localeCompare(c.date))
  lines.push('', '**Week 1**')
  wk.forEach(s => lines.push(`- ${DAY(s.date)}: ${s.kind === 'rest' ? 'rest' : `${s.title} (${s.minutes} min)`}`))
  if (b.independentMinutes) lines.push(`- Plus a ${b.independentMinutes}-minute independent routine on each training day (easy effort, no throwing, no max lifting).`)

  const cps = Array.from(new Set(d.sessions.filter(s => s.checkpoint).map(s => s.checkpoint)))
  lines.push('', `**Measuring progress**: ${cps.join(', ')} checkpoints with the same protocol each time, recorded in the player's metrics.`)
  if (d.throwingGate) lines.push('', `**Throwing**: the throwing gate starts closed because the arm is resting and the rest length and pain history aren't recorded. Pitching work is arm care and legs-and-balance until you clear it. ${d.throwingGate.note.split('. ')[0]}.`)
  if (d.assumptions.length) lines.push('', '**Assumptions I made (change any of them)**', ...d.assumptions.map(a => `- ${a}`))
  const warn = (d.qualityReport?.warnings || []).filter(w => w.startsWith('Check failed')).slice(0, 3)
  if (warn.length) lines.push('', '**Needs your attention**', ...warn.map(w => `- ${w}`))
  lines.push('', 'Open it to see every session, edit anything, and save when you are happy. You can also tell me things like “make Thursday a rest day” or “add more outfield work”.')
  return lines.join('\n')
}
