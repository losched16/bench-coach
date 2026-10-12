// Is the newest question in a chat thread still waiting for its answer?
//
// The chat route saves the coach's question as soon as it arrives and the
// answer when it is written, 20-90 seconds later. The function keeps running
// if the browser goes away, so a coach who switches apps, locks the phone or
// opens another page still gets the answer saved. What the page needs to know
// on return is which of three states the thread is in:
//
//   'waiting'    — the last message is a question asked recently enough that
//                  its answer may still be on the way. Show that, and check
//                  back until it lands.
//   'unanswered' — the last message is a question old enough that no answer
//                  is coming (the generation failed or timed out). Say so and
//                  offer to ask again, rather than leaving a question hanging.
//   null         — nothing outstanding.
//
// Pure, so it can be tested without a browser or a server.

export interface PendingMessage {
  id?: string
  role: 'user' | 'assistant'
  content?: string
  created_at?: string | null
}

// The route's maxDuration is 120 seconds; past that the platform has stopped
// the function, so the answer is not coming. A little slack for clocks and
// for the save after generation.
export const ANSWER_WINDOW_MS = 150_000

export type PendingState = 'waiting' | 'unanswered' | null

export function pendingState(messages: PendingMessage[], now: number = Date.now()): PendingState {
  const last = messages[messages.length - 1]
  if (!last || last.role !== 'user') return null
  // A message the page added itself (no server timestamp) is the page's own
  // business — it knows whether its request is still in flight.
  if (!last.created_at) return null
  const asked = Date.parse(last.created_at)
  if (!Number.isFinite(asked)) return null
  return now - asked < ANSWER_WINDOW_MS ? 'waiting' : 'unanswered'
}

/**
 * After a request failed without a response (the phone suspended the page,
 * the network dropped), did the question reach the server anyway?
 *
 * Matched on the text and on being saved no earlier than shortly before the
 * page sent it, so an identical question from yesterday is not mistaken for
 * this one.
 */
export function questionArrived(
  messages: PendingMessage[],
  question: string,
  sentAt: number,
): boolean {
  const q = question.trim()
  return messages.some(m =>
    m.role === 'user' &&
    String(m.content || '').trim() === q &&
    !!m.created_at &&
    Date.parse(m.created_at) >= sentAt - 60_000
  )
}
