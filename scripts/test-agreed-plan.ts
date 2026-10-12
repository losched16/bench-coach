// "Work this up into a plan" builds the plan the coach agreed to.
//
// A coach reported that the chat's recommendations were good, but pressing
// the button to turn one into a priority produced a different plan — often a
// wrong one. The cause: the button sent only the coach's last message, and the
// analysis diagnosed from scratch and searched the library for its own drills.
// The answer the coach had read and liked was never sent. A follow-up such as
// "yes, let's do that" became the entire question.
//
// This pins the fix:
//   1. the button's request carries the answer and the conversation behind it;
//   2. the plan's drills are the library drills that answer named, in its
//      order — not a fresh search;
//   3. the analysis is told to write up that answer rather than re-diagnose.
//
//   npm run test:agreed-plan

import { readFileSync } from 'fs'
import { planSourceFromChat, citedLibraryDrills, renderTranscript, ChatTurn } from '@/lib/agreedPlan'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

// ── 1. What the button agrees to ────────────────────────────────────────────

const ANSWER = `For Sam the one thing is **keeping the back elbow tucked**.

Start with **Shoulder Swings** (https://www.youtube.com/watch?v=jGSbbHXX7NU) — 20 slow reps.
Then **Catch and Crush Drill** — 3 sets of 8.`

const thread: ChatTurn[] = [
  { id: 'm1', role: 'user', content: 'Sam keeps casting his hands and rolling over.' },
  { id: 'm2', role: 'assistant', content: 'Is it every swing, or mostly with two strikes?' },
  { id: 'm3', role: 'user', content: 'Every swing. Keep it to two drills please.' },
  { id: 'p1', role: 'assistant', content: '## The one thing\nAn old saved priority', kind: 'priority' },
  { id: 'error-1', role: 'assistant', content: 'Something went wrong' },
  { id: 'm4', role: 'assistant', content: ANSWER },
]

const src = planSourceFromChat(thread, 5)
check('a source is built for the answer the button sits on', !!src)
check('the recommendation is the answer, word for word', src?.recommendation === ANSWER.trim())
check('the question is the coach\'s latest message before it', src?.question === 'Every swing. Keep it to two drills please.')
check('the transcript keeps the earlier turns, so a correction still counts',
  !!src?.transcript.some(t => t.content.startsWith('Sam keeps casting')) &&
  !!src?.transcript.some(t => t.content.includes('two drills please')))
check('the transcript ends with the agreed answer',
  src?.transcript[src.transcript.length - 1]?.content === ANSWER.trim())
check('an old saved priority is not presented as part of this conversation',
  !src?.transcript.some(t => t.content.includes('An old saved priority')))
check('an error placeholder is not part of the conversation',
  !src?.transcript.some(t => t.content === 'Something went wrong'))

// A follow-up agreement: "yes" is the question, but the plan must still see
// what was being agreed to.
const followUp: ChatTurn[] = [
  { role: 'user', content: 'How do I stop my 9U team lunging at the ball?' },
  { role: 'assistant', content: 'Work **High Tee Drill** first, then ...' },
  { role: 'user', content: 'yes, let\'s do that' },
  { role: 'assistant', content: 'Great — here is the week: **High Tee Drill** 3x10, then **Bucket Drill**.' },
]
const fu = planSourceFromChat(followUp, 3)
check('a one-word follow-up does not lose the original problem',
  !!fu && renderTranscript(fu.transcript).includes('lunging at the ball'))

check('no source for a user message', planSourceFromChat(thread, 0) === null)
check('no source when there is no question before the answer',
  planSourceFromChat([{ role: 'assistant', content: 'Hello' }], 0) === null)

const withMemory: ChatTurn[] = [
  { role: 'user', content: 'q' },
  { role: 'assistant', content: 'Do **Frisbee Drill**.\n\nMEMORY_SUGGESTIONS:\n{"coach_preferences": []}' },
]
check('a hidden memory block in an old reply is not part of the recommendation',
  planSourceFromChat(withMemory, 1)?.recommendation === 'Do **Frisbee Drill**.')

const long: ChatTurn[] = [
  ...Array.from({ length: 20 }, (_, i) => ({ role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant', content: `turn ${i} ` + 'x'.repeat(5000) })),
  { role: 'assistant', content: ANSWER },
]
const ls = planSourceFromChat(long, 20)
check('a long thread is bounded', !!ls && renderTranscript(ls.transcript).length < 20000,
  String(ls && renderTranscript(ls.transcript).length))
check('...and still ends with the full answer', ls?.recommendation === ANSWER.trim())

// ── 2. The drills are the ones it named ─────────────────────────────────────

const LIBRARY = [
  { id: 'd-catch', drill_name: 'Catch and Crush Drill — Stay Closed', youtube_video_id: 'XZZ80KnHuOU' },
  { id: 'd-shoulder', drill_name: 'Shoulder Swings — Stay Short to the Ball', youtube_video_id: 'jGSbbHXX7NU' },
  { id: 'd-tee', drill_name: 'High Tee Drill — Hitting Up in the Zone', youtube_video_id: 'iKX-qxQ1X5g' },
  { id: 'd-frisbee', drill_name: 'Frisbee Drill — Hip Rotation & Finish', youtube_video_id: 'g72wLGj2kq4' },
]
const cited = citedLibraryDrills(ANSWER, LIBRARY).map(d => d.id)
check('the named drills are found, in the order the answer gave them',
  JSON.stringify(cited) === JSON.stringify(['d-shoulder', 'd-catch']), JSON.stringify(cited))
check('a drill the answer did not name is not added', !cited.includes('d-tee') && !cited.includes('d-frisbee'))
check('bolded coaching phrases that are not drills are ignored',
  citedLibraryDrills('Focus on **keeping the back elbow tucked**.', LIBRARY).length === 0)
check('a drill named twice appears once',
  citedLibraryDrills('**Frisbee Drill** now, and **Frisbee Drill** again next week.', LIBRARY).length === 1)
check('a video link alone is enough to identify the drill',
  citedLibraryDrills('Watch this: https://youtu.be/iKX-qxQ1X5g', LIBRARY)[0]?.id === 'd-tee')
check('a drill outside the library is not invented into the plan',
  citedLibraryDrills('Try the **Broomstick Drill**.', LIBRARY).length === 0)

// Real library names that do not end in "drill". The chat's own fabrication
// check skips these, which is why this matcher is separate from it.
const REAL = [
  { id: 'r-hightee', drill_name: 'High Tee', youtube_video_id: 'iKX-qxQ1X5g' },
  { id: 'r-hightee-zone', drill_name: 'High Tee Drill — Hitting Up in the Zone', youtube_video_id: 'iKX-qxQ1X5g' },
  { id: 'r-shoulder', drill_name: 'Shoulder Swings — Stay Short to the Ball', youtube_video_id: 'jGSbbHXX7NU' },
  { id: 'r-wall', drill_name: 'Wall Ball', youtube_video_id: '4NOo7JSK6eA' },
  { id: 'r-funnel', drill_name: 'Funnel Drill', youtube_video_id: '4NOo7JSK6eA' },
  { id: 'r-kneel', drill_name: 'Kneel-Down Throw — Isolating Upper Body and Wrist Snap', youtube_video_id: '77r6mWAUecA' },
  { id: 'r-partner', drill_name: 'Partner Catch', youtube_video_id: '77r6mWAUecA' },
]
const ids = (t: string) => citedLibraryDrills(t, REAL).map(d => d.id).join(',')
check('names that do not end in "drill" are still found',
  ids('Do **Shoulder Swings**, then **Wall Ball**, then **Kneel-Down Throw**.') === 'r-shoulder,r-wall,r-kneel',
  ids('Do **Shoulder Swings**, then **Wall Ball**, then **Kneel-Down Throw**.'))
check('the short name picks the drill with exactly that name, not its longer sibling',
  ids('**High Tee** — 3x10') === 'r-hightee')
check('"High Tee Drill" picks the drill whose name starts that way',
  ids('**High Tee Drill**') === 'r-hightee-zone')
check('coaching emphasis is not mistaken for a drill ("**catch**" is not Partner Catch)',
  ids('Make sure he can **catch** it first.') === '')
check('a compilation video on its own names no drill (several drills share it)',
  ids('https://www.youtube.com/watch?v=4NOo7JSK6eA') === '')
check('a compilation video right after its drill\'s name does not add a second drill',
  ids('**Funnel Drill** (https://www.youtube.com/watch?v=4NOo7JSK6eA)') === 'r-funnel')

// ── 3. The wiring ───────────────────────────────────────────────────────────

const page = readFileSync('app/dashboard/chat/page.tsx', 'utf8')
const route = readFileSync('app/api/prescribe/route.ts', 'utf8')

check('the chat button sends the answer it sits on',
  /recommendation:\s*source\.recommendation/.test(page) && /transcript:\s*source\.transcript/.test(page))
check('the button builds from its own message, not just the last question',
  /onClick=\{\(\) => runAnalysis\(index\)\}/.test(page))
check('with an agreed answer the route takes its drills from that answer',
  /if \(agreed\) \{[\s\S]{0,400}citedLibraryDrills\(agreed\.recommendation/.test(route))
check('...and does not search the library for different ones',
  /!agreed && slugs\.length > 0/.test(route) && /!agreed && selected\.length < 2/.test(route))
check('the analysis is told to write up the agreed answer, not re-diagnose',
  route.includes('YOUR JOB NOW: write up THAT recommendation') && route.includes('Add nothing it did not recommend'))
check('a draft is not blocked by the replace-priority check (the commit asks)',
  /!body\.confirmSupersede && body\.persist !== false/.test(route))
check('a request without an answer still gets the original fresh read',
  route.includes('A coach came to you with this, in their words:'))

console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
