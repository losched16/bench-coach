// Phase 2I closeout — the onboarding checklist's rules, and help's context.
//
//   npm run test:onboarding
//
// Two things are being defended here.
//
// FIRST: an unanswered question is not an answer of no. Supabase returns a
// failed count as `{ count: null, error }` rather than throwing, so the
// original code — which destructured `count` and wrapped the call in
// try/catch — read a broken roster query as "this coach has no players" and a
// broken plan query as "this coach has never made a plan". The visible
// consequence is an established coach being shown a first-run checklist. The
// invisible one is worse: onboarding_started fired at somebody who onboarded
// months ago, quietly poisoning the only number that says whether any of this
// works.
//
// SECOND: reopening is not completing. The Help Center can now put the
// checklist back, and the one thing it must never do is invent progress or
// report a second completion for the same first practice.

import {
  checklistDecision, reopenPatch, ChecklistFacts, ChecklistPref,
} from '../lib/onboarding'
import { primaryActionFor, articleHref, safeId } from '../lib/helpRoutes'

let passed = 0
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
}
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

const TEAM = 'team-1'

const facts = (over: Partial<ChecklistFacts> = {}): ChecklistFacts => ({
  status: 'answered', teamId: TEAM, hasRoster: false, hasPlan: false, ...over,
})

const decide = (f: Partial<ChecklistFacts>, pref: ChecklistPref | null = null, over: {
  teamId?: string | null; canCreatePlans?: boolean; prefReady?: boolean
} = {}) => checklistDecision({
  facts: facts(f),
  teamId: over.teamId === undefined ? TEAM : over.teamId,
  canCreatePlans: over.canCreatePlans ?? true,
  pref,
  prefReady: over.prefReady ?? true,
})

// ── a failed read is not an empty roster ────────────────────────────────────

const unavailable = decide({ status: 'unavailable' })
eq('a failed count hides the checklist', unavailable.visible, false)
eq('and says so', unavailable.hiddenBecause, 'data-unavailable')
check('a failed count reports NOTHING — this is the analytics poisoning case',
  !unavailable.trackStarted && !unavailable.trackCompleted)

const loading = decide({ status: 'loading' })
eq('a read still in flight shows nothing', loading.visible, false)
check('and reports nothing yet', !loading.trackStarted && !loading.trackCompleted)

const prefPending = decide({}, null, { prefReady: false })
eq('nothing renders before the preference has loaded', prefPending.visible, false)
check('and nothing is reported either — a dismissal we have not read yet is ' +
  'still a dismissal', !prefPending.trackStarted)

// ── the stale response, which is the team-switching bug ─────────────────────

const stale = decide({ teamId: 'team-OTHER', hasPlan: true })
eq('counts for another team never answer for this one', stale.visible, false)
eq('and are named as stale rather than merged', stale.hiddenBecause, 'stale-team')
check('a stale answer reports nothing', !stale.trackStarted && !stale.trackCompleted)

// The specific failure: team A has a plan, team B does not. If A's slow
// response lands after the coach switches to B, B must not inherit "complete".
const switched = decide({ teamId: 'team-A', hasPlan: true }, { startedAt: 'x' },
  { teamId: 'team-B' })
check('a slow team-A response cannot mark team B complete',
  !switched.complete && !switched.trackCompleted)

eq('no team selected shows nothing', decide({}, null, { teamId: null }).hiddenBecause, 'no-team')

// ── a genuinely new coach ───────────────────────────────────────────────────

const brandNew = decide({})
eq('a new coach sees it', brandNew.visible, true)
eq('and it is reported once', brandNew.trackStarted, true)
eq('but not as complete', brandNew.complete, false)

const noRoster = decide({ hasRoster: false })
check('no roster does not block the checklist — the builder works without one',
  noRoster.visible && !noRoster.complete)

const rosterOnly = decide({ hasRoster: true })
check('a roster alone is not completion', rosterOnly.visible && !rosterOnly.complete)

// ── permissions ─────────────────────────────────────────────────────────────

const assistant = decide({}, null, { canCreatePlans: false })
eq('a coach who cannot create plans is not offered the checklist',
  assistant.visible, false)
eq('for that reason', assistant.hiddenBecause, 'cannot-create-plans')
check('and is NOT counted as having started onboarding they cannot perform',
  !assistant.trackStarted)

// ── the established coach ───────────────────────────────────────────────────

const established = decide({ hasRoster: true, hasPlan: true })
eq('a coach who already has a plan is not shown a get-started checklist',
  established.visible, false)
eq('for that reason', established.hiddenBecause, 'established-coach')
check('and no completion is reported for a first practice they made before ' +
  'this feature existed', !established.trackCompleted)

// ── finishing it, once ──────────────────────────────────────────────────────

const finishing = decide({ hasRoster: true, hasPlan: true }, { startedAt: 't0' })
eq('a coach who started and now has a plan is complete', finishing.complete, true)
eq('and completion is reported', finishing.trackCompleted, true)

const finished = decide({ hasRoster: true, hasPlan: true },
  { startedAt: 't0', completedAt: 't1' })
eq('once recorded it is not reported again', finished.trackCompleted, false)
eq('and the checklist goes away', finished.hiddenBecause, 'already-finished')

// ── skipping ────────────────────────────────────────────────────────────────

const skipped = decide({}, { skipped: true })
eq('a skipped checklist stays gone', skipped.hiddenBecause, 'skipped')
check('and skipping stops the started event from firing later',
  !decide({}, { skipped: true }).trackStarted)

// ── reopening from the Help Center ──────────────────────────────────────────

const patch = reopenPatch('2026-09-20T00:00:00Z')
eq('reopening clears the skip', patch.skipped, false)
check('reopening records when', typeof patch.reopenedAt === 'string')
check('REOPENING INVENTS NO PROGRESS: no startedAt, no completedAt',
  !('startedAt' in patch) && !('completedAt' in patch))

const reopenedUnfinished = decide({ hasRoster: true },
  { skipped: false, startedAt: 't0', reopenedAt: 't2' })
check('a coach who reopens an unfinished checklist gets it back, still unfinished',
  reopenedUnfinished.visible && !reopenedUnfinished.complete)

const reopenedFinished = decide({ hasRoster: true, hasPlan: true },
  { startedAt: 't0', completedAt: 't1', reopenedAt: 't2' })
eq('a coach who reopens a finished one sees it again', reopenedFinished.visible, true)
eq('showing the true state of their data, which is done', reopenedFinished.complete, true)
check('AND NO SECOND COMPLETION IS REPORTED', !reopenedFinished.trackCompleted)

const reopenedEstablished = decide({ hasRoster: true, hasPlan: true }, { reopenedAt: 't2' })
eq('an established coach who asks to see it gets it', reopenedEstablished.visible, true)
check('ticked from their real rows, with no invented completion event',
  reopenedEstablished.complete && !reopenedEstablished.trackCompleted)
check('and no started event either — they did not just start',
  !reopenedEstablished.trackStarted)

// Hiding it again after reopening has to win.
const hiddenAgain = decide({}, { reopenedAt: 't2', skipped: true })
eq('hiding it after reopening puts it away', hiddenAgain.hiddenBecause, 'skipped')

// ── help keeps the player it was opened from ────────────────────────────────

eq('an article link carries the team',
  articleHref('roster', { teamId: 'team-7' }),
  '/dashboard/help?teamId=team-7&article=roster')
eq('AND THE PLAYER — the thing that was being dropped',
  articleHref('player-development', { teamId: 't1', playerId: 'p9' }),
  '/dashboard/help?teamId=t1&playerId=p9&article=player-development')
eq('with no context it is still a clean link',
  articleHref('roster', {}), '/dashboard/help?article=roster')

check('a player carried through help still opens that player',
  primaryActionFor('player-development', { teamId: 't1', playerId: 'p9' })!
    .href === '/dashboard/roster/p9?teamId=t1')
check('player reports behaves identically',
  primaryActionFor('player-reports', { teamId: 't1', playerId: 'p9' })!
    .href === '/dashboard/roster/p9?teamId=t1')
check('and with no player it offers a choice rather than guessing one',
  primaryActionFor('player-development', { teamId: 't1' })!.label === 'Choose a player')

// A destination about the whole team does not carry a player, because
// /dashboard/practice?playerId=... means nothing and invites somebody to
// implement it as if it did.
check('a team-level action does not carry a player id',
  !primaryActionFor('practice-plans', { teamId: 't1', playerId: 'p9' })!
    .href.includes('playerId'))

// ── a URL parameter is not a grant, and not a path ──────────────────────────

eq('an id with a path separator is dropped, not escaped',
  safeId('../../league-admin'), null)
eq('an id with a query separator is dropped', safeId('p9?teamId=other'), null)
eq('an empty id is nothing', safeId(''), null)
eq('a null id is nothing', safeId(null), null)
eq('a uuid survives', safeId('3f2504e0-4f89-11d3-9a0c-0305e82c3301'),
  '3f2504e0-4f89-11d3-9a0c-0305e82c3301')
check('a hostile player id cannot redirect the action link',
  primaryActionFor('player-development', { teamId: 't1', playerId: '../../admin' })!
    .href === '/dashboard/roster?teamId=t1')
check('nor a hostile team id',
  !articleHref('roster', { teamId: 'x&article=evil' }).includes('evil'))

// ── report ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`
Checked here: the rules. Not checked here: that React calls them in the right
order, or that any of it renders. That is scripts/browser/help.spec.ts.
`)
