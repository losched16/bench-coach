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
 * Names a bolded phrase can match: the full drill name, and its head — the
 * part before " — " that the chat uses ("High Tee" for "High Tee Drill —
 * Hitting Up in the Zone"), each with and without a trailing "drill".
 */
function namesFor(drillName: string): string[] {
  const full = norm(drillName)
  const head = norm(String(drillName).split(/\s[—–-]\s|\s\/\s/)[0])
  return Array.from(new Set([full, head, dropDrill(full), dropDrill(head)].filter(Boolean)))
}

/**
 * The library drills the answer named, first mention first, each once.
 *
 * Not lib/drillGrounding's matcher. That one decides whether an answer
 * INVENTED a drill, so it only treats a bolded phrase as a drill claim when it
 * ends in "drill", "toss" and the like — which skips real names such as
 * "Shoulder Swings", "High Tee" or "Wall Ball". Here the question is the
 * opposite one — which library drills did the coach just agree to — so:
 *
 *   * a bolded phrase counts when it IS a drill's name or head (exactly, give
 *     or take a trailing "drill") — "**catch**" is coaching emphasis, not
 *     "Partner Catch";
 *   * a video link counts when exactly one drill uses that video, or when it
 *     belongs to the drill named just before it. A compilation video shared
 *     by several drills cannot say which one was meant, so on its own it
 *     names none.
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
  const byVideo = new Map<string, T[]>()
  for (const d of library) {
    const v = d.youtube_video_id
    if (!v) continue
    byVideo.set(v, [...(byVideo.get(v) || []), d])
  }

  const out: T[] = []
  const seen = new Set<string>()
  const add = (d: T | undefined) => {
    if (!d || seen.has(d.id)) return
    seen.add(d.id)
    out.push(d)
  }

  let lastNamed: T | null = null
  for (const m of Array.from(String(text || '').matchAll(CITATION))) {
    if (m[1] !== undefined) {
      const key = norm(m[1])
      const hits = byName.get(key) || byName.get(dropDrill(key)) || []
      // Two drills with the same head ("Rocker Drill", "The Rocker Drill for
      // Pitching") — prefer the one whose full name is exactly what was said.
      const exact = hits.find(d => norm(d.drill_name) === key) || (hits.length === 1 ? hits[0] : undefined)
      lastNamed = exact || null
      add(exact)
    } else if (m[2]) {
      const users = byVideo.get(m[2]) || []
      if (lastNamed && lastNamed.youtube_video_id === m[2]) continue
      if (users.length === 1) add(users[0])
    }
  }
  return out
}

/** The transcript as the analysis prompt shows it. */
export function renderTranscript(transcript: PlanSource['transcript']): string {
  return transcript
    .map(t => `${t.role === 'user' ? 'COACH' : 'YOU (in chat)'}:\n${t.content}`)
    .join('\n\n')
}
