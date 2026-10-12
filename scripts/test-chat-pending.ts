// A chat answer no longer depends on the coach watching the screen.
//
// Reported: on a phone, leaving the chat page — another page, another app,
// the screen locking — meant no answer. The route saved the question and the
// answer together only after the answer was written, so a coach who came back
// mid-answer found no trace of their question and nothing to say an answer was
// coming, and the page never looked again. A request the phone cut off was
// shown as "That didn't go through" even when the server was still writing.
//
// Pinned here:
//   1. the route saves the question BEFORE it generates the answer;
//   2. the page can tell "answer on its way" from "no answer is coming";
//   3. the page waits and checks back instead of declaring failure.
//
//   npm run test:chat-pending

import { readFileSync } from 'fs'
import { pendingState, questionArrived, ANSWER_WINDOW_MS } from '@/lib/chatPending'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

const NOW = Date.parse('2026-10-12T12:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()

// ── 1. The three states ─────────────────────────────────────────────────────

check('an answered question is not pending',
  pendingState([
    { role: 'user', content: 'q', created_at: ago(60_000) },
    { role: 'assistant', content: 'a', created_at: ago(30_000) },
  ], NOW) === null)
check('a question asked moments ago with no answer yet is waiting',
  pendingState([{ role: 'user', content: 'q', created_at: ago(20_000) }], NOW) === 'waiting')
check('one asked just inside the window is still waiting',
  pendingState([{ role: 'user', content: 'q', created_at: ago(ANSWER_WINDOW_MS - 1000) }], NOW) === 'waiting')
check('one past the window is unanswered — no answer is coming',
  pendingState([{ role: 'user', content: 'q', created_at: ago(ANSWER_WINDOW_MS + 1000) }], NOW) === 'unanswered')
check('the window outlasts the route\'s time limit',
  ANSWER_WINDOW_MS >= 120_000 &&
  /export const maxDuration = (\d+)/.test(readFileSync('app/api/chat/route.ts', 'utf8')) &&
  Number(/export const maxDuration = (\d+)/.exec(readFileSync('app/api/chat/route.ts', 'utf8'))![1]) * 1000 <= ANSWER_WINDOW_MS)
check('an empty thread is not pending', pendingState([], NOW) === null)
check('a message the page added itself (no server time) is the page\'s own business',
  pendingState([{ role: 'user', content: 'q' }], NOW) === null)

// ── 2. Did a cut-off request reach the server? ──────────────────────────────

const sentAt = NOW - 10_000
check('the question is found when the server saved it',
  questionArrived([{ role: 'user', content: '  How do I fix his stride? ', created_at: ago(9_000) }], 'How do I fix his stride?', sentAt))
check('the same words asked yesterday do not count',
  !questionArrived([{ role: 'user', content: 'How do I fix his stride?', created_at: ago(86_400_000) }], 'How do I fix his stride?', sentAt))
check('an answer with the same words does not count',
  !questionArrived([{ role: 'assistant', content: 'How do I fix his stride?', created_at: ago(5_000) }], 'How do I fix his stride?', sentAt))

// ── 3. The wiring ───────────────────────────────────────────────────────────

const route = readFileSync('app/api/chat/route.ts', 'utf8')
const post = route.slice(route.indexOf('export async function POST'), route.indexOf('export async function GET'))
const userSave = post.search(/\.insert\(\{\s*thread_id: thread\.id,\s*role: 'user'/)
const generate = post.indexOf('await generateChatResponse(')
const answerSave = post.search(/\.insert\(\{\s*thread_id: thread\.id,\s*role: 'assistant'/)
check('the route saves the question before writing the answer',
  userSave > -1 && generate > -1 && userSave < generate, `user save @${userSave}, generate @${generate}`)
check('...and the answer after', answerSave > generate)
check('the route does not stop when the browser goes away',
  !/request\.signal/.test(post) && !/signal:\s*request/.test(post))

const page = readFileSync('app/dashboard/chat/page.tsx', 'utf8')
check('opening a thread notices an answer still on its way',
  /setWaiting\(pendingState\(data\.messages \|\| \[\]\) === 'waiting'\)/.test(page))
check('while waiting, the page checks the thread again',
  /if \(!waiting \|\| !teamId \|\| !threadId\) return[\s\S]{0,200}fetch\(`\/api\/chat\?teamId=\$\{teamId\}&threadId=\$\{threadId\}`\)/.test(page))
check('...and as soon as the page is visible again',
  page.includes("document.addEventListener('visibilitychange', onVisible)"))
check('a request cut off with no response waits instead of failing',
  /if \(!gotResponse && threadId\) \{[\s\S]{0,120}setWaiting\(true\)/.test(page))
check('the coach is told they can leave',
  page.includes('You can leave this page or lock your phone'))
check('a question with no answer coming is said plainly',
  page.includes('No answer came back for your last question.'))

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
