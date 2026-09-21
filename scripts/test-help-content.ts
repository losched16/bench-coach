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
import {
  PLAYBOOK_BLURB, PLAYBOOK_TAGLINE, DEVELOPMENT_BLURB, DEVELOPMENT_TAGLINE,
  PROGRAM_DISTINCTION, MASTERY_NOTE, decisionAidSentence,
  developmentPlanLink, playbooksLink,
} from '../lib/programChoice'

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
  // Reports are a two-part workflow: the entry point is a tab on the player
  // profile, the editing happens on its own route. Both are checked.
  'player-reports': read('components/PlayerReports.tsx') +
    read('app/dashboard/player-reports/[reportId]/page.tsx') +
    read('app/dashboard/roster/[playerId]/page.tsx'),
  'notes': read('app/dashboard/notes/page.tsx'),
  'log-entry': read('app/dashboard/log/page.tsx'),
  'stats': read('app/dashboard/stats/page.tsx'),
  'scouting': read('app/dashboard/scouting/page.tsx'),
  'staff': read('app/dashboard/team/page.tsx'),
  'ai-memory': read('app/dashboard/memory/page.tsx'),
  'account': read('app/dashboard/profile/page.tsx'),
  'team-settings': read('app/dashboard/settings/page.tsx'),
  'league-admin': read('app/league-admin/page.tsx') +
    read('components/league/LeagueAdminTables.tsx'),
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

// Playbooks WAS a real page with no sidebar entry, and these checks used to
// assert the guide said so. It is in the sidebar now, so they assert the
// opposite — the point was never the absence, it was that the article and the
// navigation agree.
const playbooks = guideById('playbooks')!
const playbookProse = [...playbooks.steps.flatMap(x => [x.do, x.note || '']),
  playbooks.requiresNote || '',
  ...playbooks.problems.flatMap(x => [x.symptom, x.fix])].join(' ')
check('the Playbooks guide no longer says it is missing from the menu',
  !/not in the sidebar|not currently in the sidebar|cannot find Playbooks/i
    .test(playbookProse), playbookProse.slice(0, 140))
check('it names the sidebar group the entry actually sits in',
  /under Planning/i.test(playbookProse) &&
  read('app/dashboard/layout.tsx').includes("label: 'Planning'"))
check('and the nav entry exists, with the href the guide implies',
  read('app/dashboard/layout.tsx').includes("href: '/dashboard/playbooks'"))
check('Playbooks now offers an action, because the decision was made',
  primaryActionFor('playbooks', { teamId: 't1' })!.href ===
    '/dashboard/playbooks?teamId=t1')
// ── THE PLAYBOOK / DEVELOPMENT-PLAN DISTINCTION ─────────────────────────────
//
// Both features are reachable, both serve one player or a whole team, and a
// coach could not tell them apart. These checks pin the answer to the shared
// constants in lib/programChoice.ts rather than to a literal sentence, so the
// copy can be edited in one place without rotting the suite — while the
// NEGATIVE checks below still fail if the old team-versus-individual framing
// comes back in any wording.

const devPlan = guideById('player-development')!

check('THE PLAYBOOKS GUIDE TAKES ITS DESCRIPTION FROM THE SHARED CONSTANT',
  playbooks.purpose === PLAYBOOK_BLURB && playbooks.summary === PLAYBOOK_TAGLINE)
check('AND THE DEVELOPMENT GUIDE TAKES ITS OWN FROM THE SAME FILE',
  devPlan.purpose === DEVELOPMENT_BLURB && devPlan.summary === DEVELOPMENT_TAGLINE)

// Asked from both sides, answered identically, because both read the same
// constant. A coach who lands on either guide gets the same line.
const pbWhich = playbooks.problems.find(p => /which should i use/i.test(p.symptom))
const dpWhich = devPlan.problems.find(p => /which should i use/i.test(p.symptom))
check('BOTH GUIDES ANSWER "WHICH SHOULD I USE?"', !!pbWhich && !!dpWhich)
check('and they give the same answer, word for word',
  !!pbWhich && !!dpWhich && pbWhich.fix === dpWhich.fix)
check('which is the shared distinction plus the decision aid',
  !!pbWhich && pbWhich.fix === PROGRAM_DISTINCTION + ' ' + decisionAidSentence())

// The distinction itself: what decides the next step, not how many players.
check('THE DISTINCTION IS THE PROGRAM, NOT THE NUMBER OF PLAYERS',
  /same program whether you start it for the whole team or for one player/i
    .test(PROGRAM_DISTINCTION) &&
  /when you decide they are ready/i.test(PROGRAM_DISTINCTION))
check('IT DOES NOT PRESCRIBE A PLAYBOOK BY TEAM SIZE — the earlier wording did',
  !/(use|pick|choose) a Playbook (to|for|when)[^.]*(whole team|the team)/i
    .test(PROGRAM_DISTINCTION + ' ' + decisionAidSentence()) &&
  !/(use|pick|choose) a (development plan|Development Plan) (to|for|when)[^.]*(one kid|one player|single player|individual)/i
    .test(PROGRAM_DISTINCTION + ' ' + decisionAidSentence()))
check('and the playbook description names both targets',
  /your team or an individual player/i.test(PLAYBOOK_BLURB))

// Completing a session is not mastery, and the coach decides. Both are
// explicit requirements of this change.
check('THE PLAYBOOKS GUIDE SAYS FINISHING A SESSION IS NOT MASTERY',
  playbooks.problems.some(p => p.fix.indexOf(MASTERY_NOTE) !== -1))
check('and that advancing is the coach\'s call',
  /your call/i.test(MASTERY_NOTE))
check('the development guide still says ticking a signal unlocks nothing',
  devPlan.steps.some(s => /do not unlock anything|still your call/i.test(s.note || '')))

// No invented capability. A playbook does not adapt, learn or re-plan, and
// nothing in either description may suggest it does.
const distinctionProse = [
  PLAYBOOK_BLURB, DEVELOPMENT_BLURB, PROGRAM_DISTINCTION,
  MASTERY_NOTE, decisionAidSentence(),
].join(' ')
check('NEITHER DESCRIPTION CLAIMS THE PROGRAM ADAPTS ON ITS OWN',
  !/adapts?|adjusts? itself|learns from|automatically (adjusts|advances|updates)|personalis|personaliz|AI-(powered|driven)/i
    .test(distinctionProse), distinctionProse.slice(0, 120))

// A CoachAI priority is a third thing. Collapsing it into either of the other
// two is its own confusion, so the development guide keeps it separate.
check('AND THE DEVELOPMENT GUIDE KEEPS COACHAI PRIORITIES SEPARATE',
  devPlan.problems.some(p =>
    /priority/i.test(p.symptom) && /different things/i.test(p.fix)))

check('and says starting one is the head coach\'s',
  playbooks.requires.includes('decide'))

// The guides agreeing with each other proves nothing if the SCREENS still say
// something else — which is exactly how the team-only wording survived. These
// read the source of the two pages.
const playbooksPage = read('app/dashboard/playbooks/page.tsx')
const devComponent = read('components/PlayerDevelopment.tsx')

check('THE PLAYBOOKS PAGE RENDERS THE SHARED NOTE RATHER THAN ITS OWN COPY',
  playbooksPage.includes('<ProgramChoiceNote') &&
  playbooksPage.includes('variant="playbooks"'))
check('and the old subtitle that described both features is gone',
  !playbooksPage.includes('Step-by-step training programs to build specific skills'))
check('THE PLAYER PROFILE RENDERS THE SHARED BLURB WITH THE PLAYER IN IT',
  devComponent.includes('developmentBlurb(playerName)'))
check('and offers the cross-link from its empty state',
  devComponent.includes('<ProgramChoiceNote') &&
  devComponent.includes('variant="development"'))
check('the start dialog says both targets run the same program',
  /Same program either way/i.test(playbooksPage))
check('PLAYBOOKS HAS A HELP ENTRY POINT AT ALL — it had none before',
  playbooksPage.includes('module="playbooks"'))

// The cross-links have to carry context and land somewhere real.
check('THE CROSS-LINK TO A DEVELOPMENT PLAN CARRIES THE TEAM',
  developmentPlanLink('t1', 'p1').href ===
    '/dashboard/roster/p1?teamId=t1&tab=development')
check('and lands on the Development tab, which the player page now reads',
  read('app/dashboard/roster/[playerId]/page.tsx').includes("searchParams.get('tab')"))
check('WITH NO PLAYER IT ASKS FOR ONE INSTEAD OF PRETENDING',
  developmentPlanLink('t1', null).needsPlayerChoice &&
  developmentPlanLink('t1', null).href === '/dashboard/roster?teamId=t1' &&
  /pick a player/i.test(developmentPlanLink('t1', null).label))
check('the link back to Playbooks carries the team too',
  playbooksLink('t1').href === '/dashboard/playbooks?teamId=t1')
check('AND A JUNK ID IN THE ADDRESS BAR IS DROPPED, NOT ESCAPED',
  developmentPlanLink('t1', '../../admin').href === '/dashboard/roster?teamId=t1' &&
  playbooksLink('a/b?c').href === '/dashboard/playbooks')

// Mounting the Playbooks guide on the Playbooks page surfaced this: the card's
// primary action is written for the Help Center, so in-page it offered "Open
// Playbooks" to a coach already standing there. The fix is in ModuleHelp and
// applies to every module's card.
const moduleHelpSrc = read('components/help/ModuleHelp.tsx')
check('A CARD DOES NOT OFFER TO OPEN THE PAGE IT IS ALREADY ON',
  moduleHelpSrc.includes('function usefulAction') &&
  moduleHelpSrc.includes('usefulAction(primaryActionFor(guide.id, ctx), here)'))
check('and it compares paths, so a teamId on one side does not defeat it',
  /action\.href\.split\('\?'\)\[0\]/.test(moduleHelpSrc))

// One screen, one spelling. The shared copy uses "program" (which is what the
// app says everywhere else); the guide had "programme" beside it.
const playbookAllProse = [
  playbooks.purpose, playbooks.summary, playbooks.result, playbooks.nextAction,
  playbooks.example || '', playbooks.requiresNote || '',
  ...playbooks.steps.flatMap(s => [s.do, s.note || '']),
  ...playbooks.problems.flatMap(p => [p.symptom, p.fix]),
].join(' ')
check('THE PLAYBOOKS GUIDE SPELLS IT "PROGRAM" THROUGHOUT, LIKE THE SCREEN DOES',
  !/programme/i.test(playbookAllProse), playbookAllProse.slice(0, 120))
check('and its example is not team-only either',
  /one player/i.test(playbooks.example || ''))

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

// ── the administrative-adjacent four ────────────────────────────────────────
//
// Reports, Notes/Log, Stats and Scouting. Two of these guides exist mostly to
// draw a distinction, and the tests below are about the distinction rather
// than the prose around it.

// Notes versus Log an Entry: a coach who puts a dated game into Notes loses it
// to the report builder and the stats, and nothing tells them why.
const notesProse = guideById('notes')!.problems.map(p => p.symptom + ' ' + p.fix).join(' ')
const logProse = guideById('log-entry')!.problems.map(p => p.symptom + ' ' + p.fix).join(' ')
check('the notes guide explains how it differs from logging an entry',
  /Log an Entry/i.test(notesProse) && /what you think|standing context|how things are/i.test(notesProse))
check('and the log guide draws the same line from its own side',
  /Notes are what is true in general|what happened on a day/i.test(logProse))
check('both give the coach a rule they can apply without thinking',
  /if it has a date|would start the sentence with a date/i.test(notesProse + logProse))

// Stats: entered versus calculated is the whole question a coach has here.
const statsProse = guideById('stats')!.problems.map(p => p.symptom + ' ' + p.fix).join(' ')
check('the stats guide separates what you entered from what was worked out',
  /raw counts/i.test(statsProse) && /calculated from those/i.test(statsProse))
check('and says correcting the entry corrects everything derived from it',
  /correcting the entry corrects/i.test(statsProse))
check('it does not claim stats appear without logging',
  /nothing to show until something is logged|Nothing arrives on its own/i
    .test(guideById('stats')!.summary + guideById('stats')!.steps.map(x => x.do + (x.note || '')).join(' ')))

// Scouting: the limitation is the point, and it comes first.
const scouting = guideById('scouting')!
const scoutProse = scouting.problems.map(p => p.symptom + ' ' + p.fix).join(' ')
check('THE SCOUTING GUIDE LEADS WITH HOW FAR THE EVIDENCE GOES',
  /How much can you trust/i.test(scouting.problems[0].symptom))
check('it says a rest-day figure is an estimate from your own counts',
  /estimate|arithmetic/i.test(scoutProse) && /by hand|your own/i.test(scoutProse))
check('it says the product does not know what it did not see',
  /no idea what that pitcher threw|did not watch/i.test(scoutProse))
check('it explains correcting a wrong name or count',
  scouting.problems.some(p => /wrong name/i.test(p.symptom)))
check('and it states that scouting is never pooled between coaches',
  /never pooled|stays in the account/i.test(scoutProse))
check('scouting makes no claim about the opposing team as fact',
  !/\b(their roster says|official|confirmed by|guarantee)\b/i.test(scoutProse))

// Reports: the entry point, and what a finalized one can and cannot do.
const reports = guideById('player-reports')!
const reportProse = [...reports.steps.map(x => x.do + ' ' + (x.note || '')),
  ...reports.problems.map(p => p.symptom + ' ' + p.fix)].join(' ')
check('the report guide names the tab that is the only way in',
  /"Reports" tab/.test(reportProse))
check('and the real button on it',
  /Create Player Report/.test(reportProse))
check('it explains the pre-fill question rather than leaving it a surprise',
  /Start from what you have already recorded/.test(reportProse))
check('it says a draft is not sent anywhere',
  /Nothing is sent anywhere while it says "Draft"/.test(reportProse))
check('and that a finalized report is revised rather than edited',
  reports.problems.some(p => /finalized/i.test(p.symptom) && /revision/i.test(p.fix)))
check('parents still need no account',
  /do not need a BenchCoach account/.test(reportProse))

// ── THE ADMINISTRATION MODULES ──────────────────────────────────────────────
//
// These are the guides a coach reads once and then acts on for a season. Two
// of them touch access to children's records, so the tests below are about
// what they may not promise rather than about how they read.

// Staff: the role vocabulary has to be the one the app enforces, and the one
// the role selector prints. A second vocabulary in the help is how a coach
// ends up expecting a permission that does not exist.
const staff = guideById('staff')!
const staffProse = [...staff.steps.flatMap(x => [x.do, x.note || '']),
  ...staff.problems.flatMap(x => [x.symptom, x.fix])].join(' ')
const teamSrc = read('app/dashboard/team/page.tsx')
for (const role of ['Admin', 'Contributor', 'Viewer', 'Team Owner']) {
  check(`the staff guide uses the role name the page prints: ${role}`,
    staffProse.includes(role) && teamSrc.includes(role))
}
check('and describes each role by what it can DO, in the capability words',
  /read and ask|record what happens|decide things|manages staff/i.test(staffProse))
check('it says a missing button is a role, not a fault',
  staff.problems.some(p => /button is missing/i.test(p.symptom)))
eq('managing staff is the owner\'s', staff.requires.includes('own'), true)
check('the staff guide promises no email is sent',
  /no email sent from here|send it however you normally/i.test(staffProse))

// AI Memory: the surprising parts are that deleting is global and that the
// preferences are the owner's. Both were read out of the page, not assumed —
// an earlier note of mine guessed an assistant would see nothing here, and
// the code says otherwise.
const memory = guideById('ai-memory')!
const memProse = [...memory.steps.flatMap(x => [x.do, x.note || '']),
  ...memory.problems.flatMap(x => [x.symptom, x.fix])].join(' ')
check('THE MEMORY GUIDE SAYS DELETING HERE DELETES EVERYWHERE',
  /deletes the note or preference itself, for everyone|gone from Notes as well/i
    .test(memProse), memProse.slice(0, 160))
check('and that this page is a view rather than a second copy',
  /not a second copy|same record shown from a different angle/i.test(memProse))
check('it says preferences belong to the team owner, not the viewer',
  /saved against the team owner|kept for the team owner/i.test(memProse))
check('it says nothing is remembered without somebody accepting it',
  /offers to and somebody accepts|does not store your conversations/i.test(memProse))
check('AI MEMORY CLAIMS NO LEARNING THE PRODUCT DOES NOT DO',
  !/\b(learns|training|trains on|improves itself|gets smarter)\b/i.test(memProse))

// Account versus Team Settings: two routes, two scopes, and the likely error
// is looking for one on the other.
const account = guideById('account')!
const teamSettings = guideById('team-settings')!
check('the account guide sends season and branding to Team Settings',
  account.problems.some(p => /season, focus areas or report branding/i.test(p.symptom)))
check('and the team-settings guide sends password and billing to the account',
  teamSettings.problems.some(p => /password or your subscription/i.test(p.symptom)))
check('the account guide says it follows you between teams',
  /follows you between teams|on every team/i.test(
    [account.result, ...account.problems.map(p => p.fix)].join(' ')))
check('the team-settings guide says it applies to the whole staff',
  /everyone on the staff|everyone on the team|whole team/i.test(teamSettings.result),
  teamSettings.result)
eq('the account action carries no team id, because it is not a team thing',
  primaryActionFor('account', { teamId: 't1' })!.href, '/dashboard/profile')
check('and it works with no team selected at all',
  primaryActionFor('account', {})!.enabled === true)

// League Admin: the one guide where getting it wrong means a commissioner
// believes they can read what coaches record about children.
const league = guideById('league-admin')!
const leagueProse = [league.purpose, league.summary,
  ...league.steps.flatMap(x => [x.do, x.note || '']),
  ...league.problems.flatMap(x => [x.symptom, x.fix]), league.result].join(' ')
check('THE LEAGUE GUIDE SAYS THE DASHBOARD SHOWS ADOPTION ONLY',
  /adoption only|shows adoption/i.test(leagueProse), leagueProse.slice(0, 160))
check('AND THAT THERE IS NO ROUTE INTO WHAT COACHES RECORD',
  /no route from here into|cannot, and that is deliberate/i.test(leagueProse))
check('IT NAMES THE THINGS A LEAGUE ADMIN CANNOT SEE',
  /player note/i.test(leagueProse) && /scouting/i.test(leagueProse) &&
  /practice plan/i.test(leagueProse))
check('IT SAYS SPONSORSHIP GRANTS NO PLAYER-LEVEL ACCESS',
  /Sponsoring a league does not give you access/i.test(leagueProse))
check('and that coaching a team in the league is a separate thing',
  league.problems.some(p => /also coach a team/i.test(p.symptom)))
check('the league guide points at /league-admin, not /league',
  primaryActionFor('league-admin', {})!.href === '/league-admin')
check('it uses the league role names the page prints',
  ['Commissioner', 'Admin', 'Coaching director', 'Owner']
    .every(r => leagueProse.includes(r)))

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

type Cap = 'record' | 'decide' | 'own'
const contributor = { hasTeam: true, can: (c: Cap) => c === 'record' }
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
