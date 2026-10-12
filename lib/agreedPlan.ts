// Turning a chat answer the coach agreed to into a tracked priority.
//
// The chat's "Work this up into a plan" button used to send only the coach's
// last message to the analysis, which then diagnosed the problem from scratch,
// pulled its own drills from the library and wrote a new plan. The answer the
// coach had just read — and clicked the button because they liked — was never
// sent. So the plan regularly came back with a different priority and
// different drills, and a follow-up like "yes, let's do that" became the whole
// "question".
//
// These helpers carry the agreed answer across instead:
//
//   * planSourceFromChat — the answer the button sits on, and the conversation
//     that led to it, so a correction made two messages earlier still counts;
//   * citedLibraryDrills — the library drills that answer actually named, in
//     the order it named them.
//
// Pure: no database, no model. The route does the I/O.

import type { GroundingCandidate } from './drillGrounding'
import { splitMemorySuggestions } from './analysis'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
  /** Messages the chat page tags as already-saved priorities, errors, etc. */
  kind?: string | null
  id?: string
}

export interface PlanSource {
  /** The coach's most recent message before the answer — what they asked. */
  question: string
  /** The answer the coach agreed to, as they read it. */
  recommendation: string
  /** The exchange that led to it, oldest first, ending with the answer. */
  transcript: Array<{ role: 'user' | 'assistant'; content: string }>
}

// Large enough for a long, detailed answer; small enough that a thread pasted
// into the prompt cannot crowd out the coach's data.
export const MAX_RECOMMENDATION_CHARS = 12000
const MAX_TURN_CHARS = 3000
const MAX_TRANSCRIPT_CHARS = 12000
const MAX_TURNS = 8

// What the coach saw. Older saved replies can still carry the raw
// MEMORY_SUGGESTIONS block the chat page hides at render (ChatMessageContent),
// and it is not part of the recommendation.
function visible(s: string): string {
  const t = String(s || '')
  return /^[ \t]*MEMORY_SUGGESTIONS:/m.test(t) ? splitMemorySuggestions(t).message : t
}

function clip(s: string, n: number): string {
  const t = visible(s).trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

/**
 * What the button at `answerIndex` is agreeing to.
 *
 * Saved priorities and error placeholders are left out of the transcript:
 * they are not part of the conversation the coach had, and an old priority's
 * text would read to the model as something it had recommended this time.
 */
export function planSourceFromChat(turns: ChatTurn[], answerIndex: number): PlanSource | null {
  const answer = turns[answerIndex]
  if (!answer || answer.role !== 'assistant' || !String(answer.content || '').trim()) return null

  const usable = (t: ChatTurn) =>
    !!String(t.content || '').trim() &&
    t.kind !== 'priority' &&
    !String(t.id || '').startsWith('error-')

  let question = ''
  for (let i = answerIndex - 1; i >= 0; i--) {
    if (turns[i].role === 'user' && usable(turns[i])) { question = turns[i].content.trim(); break }
  }
  if (!question) return null

  const before = turns.slice(0, answerIndex).filter(usable).slice(-(MAX_TURNS - 1))
  const transcript: PlanSource['transcript'] = []
  let budget = MAX_TRANSCRIPT_CHARS
  // Newest first, so when the budget runs out it is the oldest turns that go.
  for (let i = before.length - 1; i >= 0 && budget > 0; i--) {
    const content = clip(before[i].content, Math.min(MAX_TURN_CHARS, budget))
    budget -= content.length
    transcript.unshift({ role: before[i].role, content })
  }

  const recommendation = clip(answer.content, MAX_RECOMMENDATION_CHARS)
  transcript.push({ role: 'assistant', content: recommendation })
  return { question, recommendation, transcript }
}

// The two ways an answer cites a library drill: a **Bolded Name** or a
// YouTube link. Read together, in the order they appear.
const CITATION = /\*\*([^*\n]{2,120})\*\*|(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/g

function norm(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}
const dropDrill = (s: string) => s.replace(/\s+drill$/, '').trim()

/**
 * Names a drill can be mentioned by: the full name, and its head — the part
 * before " — " that the chat uses ("High Tee" for "High Tee Drill — Hitting
 * Up in the Zone") — each with and without a leading "the" and a trailing
 * "drill" ("Hands Routine" for "The Hands Routine — Infield Fielding Drill").
 */
function namesFor(drillName: string): string[] {
  const full = norm(drillName)
  const head = norm(String(drillName).split(/\s[—–-]\s|\s\/\s/)[0])
  const out = new Set<string>()
  for (const n of [full, head]) {
    for (const a of [n, n.replace(/^the\s+/, '')]) {
      out.add(a)
      out.add(dropDrill(a))
    }
  }
  out.delete('')
  return Array.from(out)
}

const words = (s: string) => s.split(' ').filter(Boolean).length

/**
 * The library drills the answer named, first mention first, each once.
 *
 * Not lib/drillGrounding's matcher. That one decides whether an answer
 * INVENTED a drill, so it only treats a bolded phrase as a drill claim when it
 * ends in "drill", "toss" and the like — which skips real names such as
 * "Shoulder Swings", "High Tee" or "Wall Ball". Here the question is the
 * opposite one — which library drills did the coach just agree to — so a drill
 * counts when the answer mentions it by name, however it is formatted:
 *
 *   * written out in the text — "- Hands Routine against a wall, ten
 *     minutes" — when the name is at least two words. Answers often list
 *     their drills as plain bullets with no bold and no link, and a plan built
 *     from one of those used to come back with no drills at all;
 *   * bolded, which also lets a one-word name count — "**catch**" on its own
 *     is still coaching emphasis, not "Partner Catch", because it is not a
 *     drill's name;
 *   * a video link, when exactly one drill uses that video. A compilation
 *     video shared by several drills cannot say which one was meant, so on its
 *     own it names none.
 *
 * Where names overlap, the longest wins at that spot: "Protect the Castle +
 * Throw" is that drill, not "Protect the Castle". A name two drills share,
 * with neither called exactly that, names neither.
 *
 * Order matters: "start with X, then Y" is a sequence, and the plan keeps it.
 */
export function citedLibraryDrills<T extends GroundingCandidate>(text: string, library: T[]): T[] {
  const byName = new Map<string, T[]>()
  for (const d of library) {
    for (const n of namesFor(d.drill_name)) {
      const list = byName.get(n) || []
      if (!list.includes(d)) list.push(d)
      byName.set(n, list)
    }
  }
  const pick = (name: string): T | undefined => {
    const hits = byName.get(name) || []
    return hits.find(d => norm(d.drill_name) === name) || (hits.length === 1 ? hits[0] : undefined)
  }
  const byVideo = new Map<string, T[]>()
  for (const d of library) {
    const v = d.youtube_video_id
    if (!v) continue
    byVideo.set(v, [...(byVideo.get(v) || []), d])
  }

  const raw = String(text || '')
  // Everything is placed in the normalised text, so plain, bolded and linked
  // mentions can be put in one order.
  const flat = ` ${norm(raw)} `
  const at = (rawIndex: number) => norm(raw.slice(0, rawIndex)).length
  const hits: Array<{ pos: number; drill: T }> = []

  // Written out (and bolded — bold is just punctuation once normalised).
  // Longest names first, so a longer name claims its words before a shorter
  // name inside it can.
  const taken: Array<[number, number]> = []
  const names = Array.from(byName.keys()).filter(n => words(n) >= 2).sort((a, b) => b.length - a.length)
  for (const name of names) {
    const drill = pick(name)
    if (!drill) continue
    const needle = ` ${name} `
    for (let i = flat.indexOf(needle); i !== -1; i = flat.indexOf(needle, i + 1)) {
      const span: [number, number] = [i + 1, i + needle.length - 1]
      if (taken.some(([a, b]) => span[0] < b && a < span[1])) continue
      taken.push(span)
      hits.push({ pos: span[0], drill })
    }
  }

  // Bolded one-word names, and video links.
  for (const m of Array.from(raw.matchAll(CITATION))) {
    const pos = at(m.index ?? 0)
    if (m[1] !== undefined) {
      const key = norm(m[1])
      if (words(key) >= 2) continue  // already found above
      const drill = pick(key)
      if (drill) hits.push({ pos, drill })
    } else if (m[2]) {
      const users = byVideo.get(m[2]) || []
      if (users.length === 1) hits.push({ pos, drill: users[0] })
    }
  }

  const out: T[] = []
  const seen = new Set<string>()
  for (const h of hits.sort((a, b) => a.pos - b.pos)) {
    if (seen.has(h.drill.id)) continue
    seen.add(h.drill.id)
    out.push(h.drill)
  }
  return out
}

/** The transcript as the analysis prompt shows it. */
export function renderTranscript(transcript: PlanSource['transcript']): string {
  return transcript
    .map(t => `${t.role === 'user' ? 'COACH' : 'YOU (in chat)'}:\n${t.content}`)
    .join('\n\n')
}
