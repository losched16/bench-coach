// Phase 2I — the help content, and whether it can be trusted.
//
//   npm run test:help-content
//
// Help is the one surface where being wrong is worse than being absent. A coach
// standing on a field at 5:20 looking for a button called "Save" — because the
// help said so, and the button says "Use this plan" — has been actively
// misled, and will not trust the next article either.
//
// So most of what follows asserts things ABOUT THE PROSE rather than about
// code paths: that it names controls that exist, that it makes no claim the
// product cannot back, that it does not leak implementation language, and that
// search finds what a coach would actually type.

import {
  HELP_GUIDES, HELP_TASKS, guideById, guideForModule, guidesForTask,
  searchGuides, unmetRequirements, requirementMessage, contentProblems,
} from '../lib/helpContent'
import { primaryActionFor, articleHref } from '../lib/helpRoutes'
import { readFileSync } from 'fs'

let passed = 0
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
}
const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

// ── integrity ───────────────────────────────────────────────────────────────

const problems = contentProblems()
check('the registry has no structural problems', problems.length === 0,
  problems.join('\n    '))

check('every guide has a unique id',
  new Set(HELP_GUIDES.map(g => g.id)).size === HELP_GUIDES.length)
check('every guide is reachable from a task or is the getting-started one',
  HELP_GUIDES.every(g => g.tasks.length > 0 || g.id === 'getting-started'))
check('every task lists at least one guide',
  HELP_TASKS.every(t => guidesForTask(t.id).length > 0),
  HELP_TASKS.filter(t => guidesForTask(t.id).length === 0).map(t => t.id).join(', '))

// ── THE LABELS ARE REAL ─────────────────────────────────────────────────────
//
// The point of the whole exercise. Each of these was read off the component
// that renders it; if somebody renames a control, this fails and the guide gets
// corrected instead of quietly lying.

const practiceSrc = readFileSync(__dirname + '/../app/dashboard/practice/page.tsx', 'utf8')
const rosterSrc = readFileSync(__dirname + '/../app/dashboard/roster/page.tsx', 'utf8')
const chatSrc = readFileSync(__dirname + '/../app/dashboard/chat/page.tsx', 'utf8')

const quoted = (guideId: string): string[] => {
  const g = guideById(guideId)!
  const text = [...g.steps.flatMap(s => [s.do, s.note || '']), ...g.problems.map(p => p.fix)].join(' ')
  // Curly quotes are what the prose actually uses.
  return Array.from(text.matchAll(/[“"]([^”"]{2,40})[”"]/g)).map(m => m[1])
}

for (const label of quoted('practice-plans')) {
  check(`practice guide names a real control: "${label}"`,
    practiceSrc.includes(label), `not found in the practice page`)
}
for (const label of quoted('roster')) {
  check(`roster guide names a real control: "${label}"`,
    rosterSrc.includes(label), `not found in the roster page`)
}
check('the practice guide says "Use this plan", which is what the button says',
  quoted('practice-plans').includes('Use this plan'))
check('and never tells a coach to press Save, which does not exist',
  !/press "Save"|click "Save"|tap "Save"/i.test(
    guideById('practice-plans')!.steps.map(s => s.do).join(' ')))
check('the skill-development guide names the real CoachAI button',
  chatSrc.includes('Make this the priority') &&
  quoted('skill-development').includes('Make this the priority'))

// ── claims the product cannot back ──────────────────────────────────────────

const allProse = HELP_GUIDES.map(g => [
  g.purpose, g.summary, ...g.steps.flatMap(s => [s.do, s.note || '']),
  g.example || '', ...g.problems.flatMap(p => [p.symptom, p.fix]), g.result, g.nextAction,
].join(' ')).join(' ')

check('NOTHING claims every drill has a video',
  !/every drill.{0,30}video|all drills.{0,20}video/i.test(allProse))
check('the drill guide says the opposite, because most do not',
  /many do not|most do not/i.test(
    guideById('drill-library')!.problems.map(p => p.fix).join(' ')))
check('no support email is invented',
  !/[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(allProse))
check('no URLs in the prose — routing belongs to lib/helpRoutes',
  !/https?:\/\//.test(allProse))
check('no implementation language reaches a coach',
  !/\bmigration\b|\bRLS\b|\bschema\b|supabase|\bjsonb\b/i.test(allProse))
check('no promise that parents need an account',
  /do not need a BenchCoach account|They do not need to/i.test(
    guideById('player-reports')!.steps.map(s => s.note || '').join(' ') +
    guideById('player-reports')!.problems.map(p => p.fix).join(' ')))

// Playbooks is a real page that is not in the sidebar. Saying "go to
// Playbooks in the menu" was the old article's mistake.
check('the Playbooks guide does not send anyone to a sidebar entry',
  !/sidebar|in the menu(?! at the moment| at present)/i.test(
    guideById('playbooks')!.steps.map(s => s.do).join(' ')))
check('and says plainly that it is not in the menu',
  /not in the sidebar/i.test(
    (guideById('playbooks')!.requiresNote || '') +
    guideById('playbooks')!.problems.map(p => p.fix).join(' ')))
eq('Playbooks offers no action, because that would be a product decision',
  primaryActionFor('playbooks', { teamId: 't1' }), null)

// ── the distinctions the brief asked for ────────────────────────────────────

check('the skill-development guide distinguishes a priority from a pathway',
  guideById('skill-development')!.problems.some(p =>
    /development plan/i.test(p.symptom) && /ends when it is fixed|long sequence/i.test(p.fix)))
check('and the player-development guide draws the same line from the other side',
  guideById('player-development')!.problems.some(p =>
    /priority/i.test(p.symptom + p.fix)))

// ── search ──────────────────────────────────────────────────────────────────
//
// The old Help Center matched titles only. Each of these is a word a coach
// would plausibly type that appears in NO title.

const findsIt = (q: string, id: string) =>
  searchGuides(q).some(g => g.id === id)

check('“screenshot” finds roster import', findsIt('screenshot', 'roster'))
check('“photo” finds it too, via synonyms', findsIt('photo', 'roster'))
check('“print” finds practice plans', findsIt('print', 'practice-plans'))
check('“clipboard” finds practice plans', findsIt('clipboard', 'practice-plans'))
check('“stages” finds player development', findsIt('stages', 'player-development'))
check('“parents” finds player reports', findsIt('parents', 'player-reports'))
check('“pitch count” finds game day', findsIt('pitch count', 'game-day'))
check('“batting order” finds game day via synonyms', findsIt('batting order', 'game-day'))
check('a title search still works', findsIt('roster', 'roster'))

eq('an empty search returns everything', searchGuides('   ').length, HELP_GUIDES.length)
eq('nonsense returns nothing rather than everything',
  searchGuides('qwertyuiop').length, 0)
check('ALL words must match, so two words do not widen the result',
  searchGuides('screenshot pitch').length === 0)
check('search is case-insensitive', findsIt('SCREENSHOT', 'roster'))
check('a title match outranks a body match',
  searchGuides('roster')[0].id === 'roster')

// ── requirements explain rather than hide ───────────────────────────────────

const contributor = { hasTeam: true, can: (c: 'record' | 'decide') => c === 'record' }
const viewer = { hasTeam: true, can: () => false }
const noTeam = { hasTeam: false, can: () => true }

eq('a contributor cannot build practice plans',
  unmetRequirements(guideById('practice-plans')!, contributor), ['decide'])
check('and is told who can, in words',
  /head coach/i.test(requirementMessage(guideById('practice-plans')!, ['decide']) || ''))
check('the guide is still fully readable to them — nothing is hidden',
  guideById('practice-plans')!.steps.length > 0)
eq('with no team selected, that is the thing that is missing',
  unmetRequirements(guideById('practice-plans')!, noTeam).includes('team'), true)
eq('the drill library needs nothing at all',
  unmetRequirements(guideById('drill-library')!, viewer), [])
eq('a coach who meets everything gets no message',
  requirementMessage(guideById('practice-plans')!, []), null)

// ── routing preserves context ───────────────────────────────────────────────

check('an action carries the selected team',
  primaryActionFor('practice-plans', { teamId: 'team-7' })!.href.includes('teamId=team-7'))
check('a player-scoped guide carries the player when it has one',
  primaryActionFor('player-development', { teamId: 't', playerId: 'p9' })!.href.includes('p9'))
check('and falls back to the roster when it does not, rather than guessing',
  primaryActionFor('player-development', { teamId: 't' })!.href.includes('/roster') &&
  !primaryActionFor('player-development', { teamId: 't' })!.href.match(/roster\/[a-z0-9]/i))
check('an action with no team is marked unusable rather than offered',
  primaryActionFor('practice-plans', {})!.enabled === false)
check('article links are stable and carry the team',
  articleHref('roster', { teamId: 'team-7' }) === '/dashboard/help?teamId=team-7&article=roster')
check('and work with no team selected',
  articleHref('roster', {}) === '/dashboard/help?article=roster')

// ── lookups ─────────────────────────────────────────────────────────────────

eq('a module resolves to its guide', guideForModule('practice-plans')?.id, 'practice-plans')
eq('an unknown id resolves to nothing', guideById('nope'), null)
eq('null resolves to nothing', guideById(null), null)
check('every related link resolves to a real guide',
  HELP_GUIDES.every(g => g.related.every(r => guideById(r) !== null)))

// ── report ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  console.log('\nFailures:')
  for (const f of failures) console.log(`  ✗ ${f}`)
  process.exit(1)
}
console.log(`
Not checked here, and not claimed:
  that the panel traps focus in a real browser
  that any of this has been read by a coach
`)
