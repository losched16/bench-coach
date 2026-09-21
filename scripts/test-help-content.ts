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
import { execSync } from 'child_process'
import { FEATURE_UNAVAILABLE } from '../lib/migrationHints'

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

const read = (rel: string) => readFileSync(__dirname + '/../' + rel, 'utf8')

const practiceSrc = read('app/dashboard/practice/page.tsx')
const rosterSrc = read('app/dashboard/roster/page.tsx')
const chatSrc = read('app/dashboard/chat/page.tsx')

// Which files render the controls each guide is allowed to name. A guide that
// quotes a label not present in its own module's source is lying to a coach
// standing in front of that screen.
const SOURCES: Record<string, string> = {
  'practice-plans': practiceSrc,
  'roster': rosterSrc,
  'coachai': chatSrc,
  'pitch-counter': read('app/dashboard/count/page.tsx'),
  'lineups': read('app/dashboard/lineup/page.tsx'),
  'game-day': read('app/dashboard/game/page.tsx'),
  // The library page is a shell; every control a coach touches lives in the
  // finder components, so the guide is checked against all of them.
  'drill-library': read('app/dashboard/drills/page.tsx') +
    read('components/drillFinder/DrillFinder.tsx') +
    read('components/drillFinder/DrillDetail.tsx'),
}

const quoted = (guideId: string): string[] => {
  const g = guideById(guideId)!
  const text = [...g.steps.flatMap(s => [s.do, s.note || '']), ...g.problems.map(p => p.fix)].join(' ')
  // Curly quotes are what the prose actually uses.
  return Array.from(text.matchAll(/[“"]([^”"]{2,40})[”"]/g)).map(m => m[1])
}

for (const [guideId, src] of Object.entries(SOURCES)) {
  for (const label of quoted(guideId)) {
    check(`${guideId} names a real control: "${label}"`,
      src.includes(label), `not rendered by that module`)
  }
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
// The drill guide used to say "many do not", which is a claim about a
// proportion that nothing keeps true as the library grows. It now says only
// what is always true: some have one, some do not, and the written
// instructions are the drill.
const drillFix = guideById('drill-library')!.problems.map(p => p.fix).join(' ')
check('the drill guide claims no proportion of drills with video',
  !/\b(many|most|some|few|all|every|half)\b[^.]{0,30}\b(have|has|do not|don't|lack)\b[^.]{0,20}video/i
    .test(drillFix), drillFix.slice(0, 120))
check('and says a video appears where one exists',
  /where a video exists|Not every drill has one/i.test(drillFix))
check('while pointing the coach at the written instructions',
  /written instructions/i.test(drillFix))
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

// ── THE PITCH COUNTER GUIDE ─────────────────────────────────────────────────
//
// The highest-consequence prose in the product, and the only guide whose
// failure mode is a child's arm rather than a wasted afternoon.
//
// The app shows a daily max from a rule set the coach optionally picks, warns
// within ten pitches of it, and turns the count button red past it. IT NEVER
// BLOCKS — there is no disabled state, no confirmation, no stop. A coach who
// believes BenchCoach is keeping their pitcher legal, or safe, has been told
// something false about something that matters.

const pitch = guideById('pitch-counter')!
const pitchProse = [
  pitch.purpose, pitch.summary, pitch.requiresNote || '',
  ...pitch.steps.flatMap(s => [s.do, s.note || '']),
  pitch.example || '', ...pitch.problems.flatMap(p => [p.symptom, p.fix]),
  pitch.result, pitch.nextAction,
].join(' ')

check('THE PITCH GUIDE SAYS THE WARNING DOES NOT STOP THE COUNT',
  /does not stop the count|it does not stop|will let you|It will\./i.test(pitchProse),
  pitchProse.slice(0, 200))
check('and puts the decision back on the coach and the league',
  /your decision|your league/i.test(pitchProse))
// Enforcement language is only wrong when THE APP is the one doing it. "use
// whichever your league enforces" is the correct sentence and an earlier,
// blunter version of this check failed it — so the rule is per sentence, and
// a sentence that attributes the enforcing to the league or the coach passes.
const ENFORCING = /\b(enforce[sd]?|enforcement|prevents?|blocks?|will not let|stops? (you|them|him|her))\b/i
const ATTRIBUTED_ELSEWHERE = /\b(your league|the league|your decision|league'?s? own|you)\b/i
// No lookbehind — this repo compiles to ES5.
const badEnforcement = pitchProse
  .split(/[.!?]+\s+/)
  .filter(sentence => ENFORCING.test(sentence) && !ATTRIBUTED_ELSEWHERE.test(sentence))
check('IT CLAIMS NO ENFORCEMENT OF ITS OWN',
  badEnforcement.length === 0, badEnforcement.join(' | ').slice(0, 200))
check('IT CLAIMS NO COMPLIANCE',
  !/\b(compliant|compliance|keeps? (them|him|her|you) legal|guarantee|ensures?)\b/i
    .test(pitchProse))
check('AND MAKES NO MEDICAL OR SAFETY CLAIM',
  !/\b(safe|safely|safety|injur(y|ies|ed)|arm health|protects?|prevent(s|ing)? (injury|damage))\b/i
    .test(pitchProse), pitchProse.slice(0, 200))
check('it explains what happens with NO rule set chosen',
  /no rule set|Just count, no rules/i.test(pitchProse) &&
  /no limit is shown|there is no limit/i.test(pitchProse))
check('it says the app does not know your league',
  /does not know which rules|do not match/i.test(pitchProse))
check('it explains the per-day, per-pitcher total rather than per-session',
  /same day|carries on|one total per pitcher|the day stays as one total/i.test(pitchProse))
check('it explains correcting a miscount',
  pitch.problems.some(p => /wrong pitcher|double-tapped/i.test(p.symptom + p.fix)))
check('and the rule sets may not match a league',
  pitch.problems.some(p => /do not match how your league/i.test(p.symptom)))
eq('keeping a pitch count is "record", not "decide" — an assistant can do it',
  pitch.requires.includes('decide'), false)

// ── the lineup guide ────────────────────────────────────────────────────────

const lineups = guideById('lineups')!
const lineupProse = [
  ...lineups.steps.flatMap(s => [s.do, s.note || '']),
  ...lineups.problems.flatMap(p => [p.symptom, p.fix]), lineups.result,
].join(' ')
check('the lineup guide says a generated lineup is a draft the coach edits',
  /draft for you to edit|change what you want|starting point/i.test(lineupProse))
check('it explains where the constraints come from',
  /position eligibility|innings limits/i.test(lineupProse))
check('and that nothing is saved or sent until the coach saves it',
  /until you save|does not start a game/i.test(lineupProse))
check('building a lineup is the head coach\'s', lineups.requires.includes('decide'))

// ── game day stays out of the way ───────────────────────────────────────────

const gameDay = guideById('game-day')!
check('the game-day guide is short enough to read at first pitch',
  gameDay.steps.length <= 3, `${gameDay.steps.length} steps`)
check('and tells a coach mid-game they can just start',
  gameDay.problems.some(p => /already going/i.test(p.symptom)))

// ── priorities versus pathways, from both sides ─────────────────────────────

check('CoachAI draws the line between a priority and a development plan',
  guideById('coachai')!.problems.some(p =>
    /priority/i.test(p.symptom + p.fix) && /development plan/i.test(p.fix)))
check('and says where each one is started',
  /player’s profile|player's profile/i.test(
    guideById('coachai')!.problems.map(p => p.fix).join(' ')))

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

// ── no repair instructions anywhere a coach can see ─────────────────────────
//
// The registry was already checked for this above. The rest of the product was
// not, and it was worse: eleven coach-facing banners said things like "Run
// migrations/019_metrics.sql in your Supabase SQL editor, then refresh."
// A volunteer coach cannot do that, should never be asked to, and reads it as
// the app being broken. They all go through FEATURE_UNAVAILABLE now.
//
// /app/admin is exempt. Those pages are for whoever runs the thing, and naming
// the file there is the point.

const uiFiles = execSync(
  `find app components -name '*.tsx' -not -path 'app/admin/*'`,
  { cwd: __dirname + '/..', encoding: 'utf8' }
).trim().split('\n').filter(Boolean)

const offenders: string[] = []
for (const rel of uiFiles) {
  // An index loop, not .entries(): this repo compiles to ES5.
  const lines = readFileSync(__dirname + '/../' + rel, 'utf8').split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Only JSX text and string literals — a comment explaining the rule is fine.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue
    if (/migrations\/\d|Supabase SQL editor|Run migration/i.test(line)) {
      offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 70)}`)
    }
  }
}
check('no coach-facing screen tells anyone to run a migration',
  offenders.length === 0, offenders.join('\n    '))

check('and there is one shared sentence for a feature that is not switched on',
  /not switched on/.test(FEATURE_UNAVAILABLE) &&
  !/migration|supabase|SQL|database/i.test(FEATURE_UNAVAILABLE),
  FEATURE_UNAVAILABLE)
check('which tells the coach their work is safe, because that is their first question',
  /Nothing you have saved is affected/.test(FEATURE_UNAVAILABLE))

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
