// Model-written coaching language, laid over a structure it cannot change.
//
// The composer decides WHAT happens (skills, weeks, drills, minutes,
// supervision). The model is asked for the words a coach would add: why this
// matters for THIS player, one simple cue per day, a note to the parent. Its
// output is parsed, sanitised and copied into a short list of text fields.
// It cannot add, remove or reorder anything, cannot change a drill, a date, a
// duration or a safety label, and anything that smells like a promise is
// dropped. If the model is unavailable the program is still complete.

import { COACH_VOICE } from '../coachVoice'
import type { ProgramDraft, SkillKey } from './types'
import type { PlayerEvidence } from './evidence'

export interface ModelRequest { system: string; user: string; maxTokens: number }
export interface ModelReply { text: string; inputTokens: number; outputTokens: number }
export type ModelCaller = (req: ModelRequest) => Promise<ModelReply>

// Outcome promises are never acceptable in a program for a child.
const PROMISE = /\b(guarantee[sd]?|will (?:definitely |certainly )?(?:gain|add|increase|improve|boost|make (?:the|your))\b[^.]{0,40}(?:mph|%|seconds?|team)|make the (?:travel )?team|ensure[sd]? (?:you|he|she|they) (?:make|get))/i

/** Strip links and markup, collapse whitespace, cap length; null if it is not usable. */
export function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/https?:\/\/\S+/g, '').replace(/[`*_#>]/g, '').replace(/\s+/g, ' ').trim()
  if (t.length < 3) return null
  if (PROMISE.test(t)) return null
  return t.slice(0, max)
}

function parseJson(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

const RULES = `You are enriching a youth baseball development program that has ALREADY been built. You may only write the text fields requested. Never invent player history, measurements, completed sessions, drills, videos or links. Never promise velocity, speed, exit-velocity, selection or tryout outcomes. Write for a volunteer parent-coach of a young child: short, concrete, one idea at a time. Return JSON only.`

export interface AuthorStats { calls: number; failed: number; inputTokens: number; outputTokens: number }

function evidenceDigest(ev: PlayerEvidence): string {
  const lines = ev.items.slice(0, 14).map(i => `- [${i.source}${i.on ? ' ' + i.on : ''}] ${i.text}`)
  return lines.join('\n') + (ev.loggedSessions60d === 0 ? '\n- No recent sessions are logged (unknown, not zero practice).' : '')
}

/** Mutates `draft` with sanitised text. Returns usage; throws nothing the caller cannot ignore. */
export async function enrichDraft(draft: ProgramDraft, ev: PlayerEvidence, call: ModelCaller): Promise<AuthorStats> {
  const stats: AuthorStats = { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0 }
  const b = draft.brief
  const run = async (req: ModelRequest) => {
    try {
      const r = await call(req); stats.calls++; stats.inputTokens += r.inputTokens; stats.outputTokens += r.outputTokens
      const j = parseJson(r.text); if (!j) stats.failed++
      return j
    } catch { stats.failed++; return null }
  }

  // 1 — the player-level read: summary, per-skill rationale, interpretations.
  const skillList = draft.skills.map(s => `${s.skill} (priority ${s.priority}): ${s.label}`).join('\n')
  const head = run({
    system: `${COACH_VOICE}\n\n${RULES}`, maxTokens: 2500,
    user: `Player: ${b.playerName || 'the player'}, age ${b.age ?? 'unknown'}, positions ${b.positions.join('/') || 'unknown'}.
Program: ${b.weeks} weeks from ${b.startDate}.
Skills (already prioritised):
${skillList}
Coach concerns (their own words): ${b.concerns.map(c => `${c.skill}: ${c.text}`).join(' | ') || 'none'}
What the records show (labelled by source):
${evidenceDigest(ev) || '- nothing recorded'}

Return {"summary": string (<= 500 chars, plain language, what the strategy is and why, referring only to the evidence above),
"skillNotes": { "<skill key>": string (<= 220 chars, why this skill matters for this player now; say if it is only a hypothesis) },
"interpretations": [ { "skill": "<skill key or null>", "text": string (<= 240 chars, a cautious reading of the evidence, worded as a hypothesis to check) } ] (at most 4) }`,
  })

  // 2 — per phase: a short note for each coached session. One call per phase.
  const phaseCalls = draft.phases.map(p => {
    const sess = draft.sessions.filter(s => s.week >= p.startWeek && s.week <= p.endWeek && (s.kind === 'coached' || s.kind === 'assessment'))
    const rows = sess.map(s => `${s.key} ${s.date} focus=${s.focus.join('+')} drills=${s.blocks.flatMap(bl => bl.drills.map(d => d.name)).slice(0, 6).join('; ')}${s.checkpoint ? ' CHECKPOINT=' + s.checkpoint : ''}`).join('\n')
    return run({
      system: `${COACH_VOICE}\n\n${RULES}`, maxTokens: 3500,
      user: `Phase "${p.name}" (weeks ${p.startWeek}-${p.endWeek}). Difficulty in this phase: ${p.difficulty}
Player age ${b.age ?? 'unknown'}. Give each session ONE focus cue a child can hold (not several mechanical corrections) and one sentence to the parent about what to watch for. Do not restate the drill list.
Sessions:
${rows}
Return {"sessions": { "<session key>": { "cue": string (<= 90 chars), "watchFor": string (<= 200 chars) } } }`,
    })
  })

  const [h, ...phases] = await Promise.all([head, ...phaseCalls])

  if (h) {
    const s = cleanText(h.summary, 600)
    if (s) draft.summary = `${s} ${draft.summary}`.slice(0, 1200)
    for (const sp of draft.skills) {
      const n = cleanText(h.skillNotes?.[sp.skill], 240)
      if (n) sp.rationale = `${sp.rationale} ${n}`.slice(0, 400)
    }
    for (const it of Array.isArray(h.interpretations) ? h.interpretations.slice(0, 4) : []) {
      const t = cleanText(it?.text, 240)
      const sk = typeof it?.skill === 'string' && draft.brief.skills.includes(it.skill as SkillKey) ? (it.skill as SkillKey) : null
      if (t) draft.assessment.needs.push({ source: 'ai_interpretation', text: `Hypothesis: ${t}`, skill: sk, on: null })
    }
  }
  for (const ph of phases) {
    if (!ph?.sessions || typeof ph.sessions !== 'object') continue
    for (const s of draft.sessions) {
      const note = ph.sessions[s.key]
      if (!note) continue
      const cue = cleanText(note.cue, 90), watch = cleanText(note.watchFor, 200)
      if (cue) {
        const first = s.blocks.find(bl => bl.kind === 'skill' || bl.kind === 'strength')?.drills[0]
        if (first && !first.cues.includes(cue)) first.cues = [cue, ...first.cues].slice(0, 4)
      }
      if (cue || watch) s.coachNote = [cue ? `Cue of the day: ${cue}.` : '', watch ? `Watch for: ${watch}` : '', s.coachNote || ''].filter(Boolean).join(' ').slice(0, 500)
    }
  }
  return stats
}
