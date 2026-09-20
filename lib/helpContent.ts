// The one place product instructions are written down.
//
// Both surfaces read this: the compact card that appears inside a module on
// first use, and the full article in the Help Center. They cannot drift,
// because there is nothing to drift from.
//
// THREE RULES THIS FILE IS UNDER
//
// 1. NOTHING HERE IS GENERATED. No model writes product instructions at
//    runtime or at build time. Every step below was read off the component
//    that renders the control it names.
//
// 2. EXACT LABELS, COPIED NOT REMEMBERED. The button that saves a generated
//    practice says "Use this plan", not "Save". A guide that says Save is
//    wrong on the step that matters most, and a coach standing on a field
//    looking for a button that does not exist has been failed by the help.
//    Every quoted label in this file was grepped out of the JSX.
//
// 3. NO CAPABILITY IS INVENTED. If the product cannot do it, it is not in
//    here — no promised videos, no support address, no workflow that reads
//    plausibly but does not exist.
//
// ROUTES ARE NOT PROSE. A guide never contains a URL. It names an action, and
// lib/helpRoutes.ts turns that into a link carrying the current team and
// player. That is what keeps "Open Practice Plans" working from a player page
// without the content knowing anything about routing.

export type HelpModule =
  | 'practice-plans'
  | 'skill-development'
  | 'roster'
  | 'player-development'
  | 'player-reports'
  | 'drill-library'
  | 'coachai'
  | 'game-day'
  | 'notes'
  | 'playbooks'
  | 'getting-started'

/** What a coach is trying to get done, as they would say it. */
export type HelpTask =
  | 'plan-practice'
  | 'help-a-player'
  | 'build-roster'
  | 'record-what-happened'
  | 'prepare-for-a-game'
  | 'player-report'

/**
 * A capability from lib/authz, or 'team' meaning "any team selected".
 *
 * Used to explain a missing prerequisite rather than to offer an action that
 * will fail. A contributor reading the practice guide is told the head coach
 * builds plans, not shown a button that 403s.
 */
export type HelpRequirement = 'team' | 'record' | 'decide'

export interface HelpStep {
  /** Imperative, one action. Contains the exact control name in quotes. */
  do: string
  /** Optional: why, or what to put in, when the step needs a decision. */
  note?: string
}

export interface HelpProblem {
  /** What the coach sees or believes has gone wrong. */
  symptom: string
  /** What to actually do about it. */
  fix: string
}

export interface HelpGuide {
  id: string
  module: HelpModule
  /** Which "I want to…" this belongs under in the Help Center. */
  tasks: HelpTask[]

  title: string
  /** One sentence. What this feature gets the coach. No feature nouns. */
  purpose: string
  /** The first-use card's sentence. Shorter than purpose, outcome-shaped. */
  summary: string

  /** Shown before the steps when they are not met. Never used to hide content. */
  requires: HelpRequirement[]
  /** Plain-language version of `requires`, for a coach who is missing one. */
  requiresNote?: string

  /** The card shows the first three. The article shows all of them. */
  steps: HelpStep[]

  /** One concrete case, with real numbers. */
  example?: string

  problems: HelpProblem[]

  /** What is true once they finish, including where it is saved. */
  result: string
  /** The single next thing worth doing. */
  nextAction: string

  /** Other guide ids. Rendered as links; unknown ids fail the content test. */
  related: string[]

  /**
   * Words a coach might search that do not appear in the prose.
   *
   * The Help Center searches title, summary, purpose, step text and these. A
   * coach looking for "photo" should find roster import, which says
   * "screenshot" everywhere and "photo" nowhere.
   */
  synonyms: string[]

  /**
   * Bumped when the INSTRUCTIONS change, not when a typo is fixed.
   *
   * Exists so a future change to a workflow can be found: grep the version,
   * re-read the component, confirm the steps still match.
   */
  version: number
}

// ───────────────────────────────────────────────────────────────────────────
// The guides
// ───────────────────────────────────────────────────────────────────────────

export const HELP_GUIDES: HelpGuide[] = [
  // ── Practice Plans ──────────────────────────────────────────────────────
  {
    id: 'practice-plans',
    module: 'practice-plans',
    tasks: ['plan-practice'],
    title: 'Plan a practice',
    purpose:
      'Turn "we have the field at 5:30" into a printed sheet that tells you and your assistants what to run, in what order, for how long.',
    summary: 'Build a practice you can hand to an assistant and run without thinking about it.',
    requires: ['team', 'decide'],
    requiresNote:
      'Building plans is the head coach\'s. If you help run the team but cannot see the button, ask whoever set the team up to give you Admin — or they can build the plan and you can run it.',
    steps: [
      {
        do: 'Open Practice Plans and choose "New Plan".',
      },
      {
        do: 'Pick how you want to start: "Generate with AI", "Start from a template", or "Create Custom".',
        note: 'AI is the usual choice. A template repeats a structure you liked. Custom is a blank sheet you fill in yourself.',
      },
      {
        do: 'Set the practice length and tap the focus areas you want to work on.',
        note: 'Everything else is optional. Coaches, players, equipment and space only change the plan if you fill them in — with two coaches it will avoid drills that need three.',
      },
      {
        do: 'If a player is on a development plan you want the team to work on, choose that pathway and stage in the picker above the focus chips.',
        note: 'Optional. It biases the drills toward that stage; it does not turn the practice into one player\'s session.',
      },
      { do: 'Press "Generate Practice Plan" and read what comes back.' },
      {
        do: 'Swap anything you do not like with "Swap Drill" on that block.',
        note: 'You can also change the length of a block, or regenerate with different constraints.',
      },
      {
        do: 'Press "Use this plan" to save it.',
        note: 'Nothing is saved until you do. Leaving the page on a generated plan loses it.',
      },
      {
        do: 'From the saved plan, use "Print" for the full sheet or "One page" for a single sheet to share.',
        note: 'Printing only exists once the plan is saved, because the sheet is built from the saved copy.',
      },
      {
        do: 'After practice, use "Log Recap" on that plan to record how it went.',
        note: 'This is what makes the next plan better — it is the only way the app learns what actually happened.',
      },
    ],
    example:
      'Ninety minutes, two coaches, focus on hitting and fielding: you get a warmup, two hitting stations you can run in parallel, ground balls, and a game to finish — with minutes on each block and the cues to say out loud.',
    problems: [
      {
        symptom: 'The plan has drills you cannot run — no room, not enough coaches.',
        fix: 'Fill in coaches, space and equipment before generating. Those fields are optional, so if you leave them blank the plan assumes you have what the drill needs.',
      },
      {
        symptom: 'You generated a plan and it is gone.',
        fix: 'A generated plan is not saved until you press "Use this plan". Generate it again and save it this time.',
      },
      {
        symptom: 'There is no Print button.',
        fix: 'Print appears on saved plans in the list, not on a plan you are still reviewing. Save it first.',
      },
      {
        symptom: 'The same drills keep coming back.',
        fix: 'Log a recap after practice. Without one the app has no idea what you have already run.',
      },
    ],
    result:
      'The plan is saved to your team and stays in the Practice Plans list. You can print it, edit it, or log a recap against it later.',
    nextAction: 'Print it, or come back after practice and log a recap.',
    related: ['skill-development', 'player-development', 'drill-library'],
    synonyms: [
      'session', 'training', 'schedule', 'agenda', 'drills for tonight', 'what to do at practice',
      'print', 'sheet', 'clipboard', 'stations', 'rotation', 'warmup', 'ai plan', 'generate',
    ],
    version: 1,
  },

  // ── Skill Development ───────────────────────────────────────────────────
  {
    id: 'skill-development',
    module: 'skill-development',
    tasks: ['help-a-player', 'record-what-happened'],
    title: 'Work on what is going wrong',
    purpose:
      'Take something you noticed at practice and turn it into a short, specific plan for fixing it — then see whether it worked.',
    summary: 'Turn something you noticed into a plan you can actually run.',
    requires: ['team'],
    steps: [
      {
        do: 'Describe what you saw in CoachAI — plainly, the way you would tell another coach.',
        note: 'For example: "half my kids are stepping in the bucket". You do not need to know the technical name for it.',
      },
      {
        do: 'Read the answer, and if it matches what you are seeing, press "Make this the priority".',
        note: 'That is the step that creates anything. Reading a good answer and closing the tab leaves nothing behind.',
      },
      {
        do: 'The priority appears on Skill Development under "Pinned Issues" with drills attached.',
      },
      { do: 'Run the drills, at practice or in a few minutes before it.' },
      {
        do: 'Come back and record how it went, so the priority can be resolved or kept going.',
      },
    ],
    example:
      'You say "my third baseman is scared of the ball". CoachAI comes back with what that usually is and three drills for it. You make it the priority, run them for two weeks, and close it out when he stops turning his head.',
    problems: [
      {
        symptom: 'You asked CoachAI something useful but nothing appeared on Skill Development.',
        fix: 'Answers are just answers until you press "Make this the priority" on one. Ask again, or scroll back and press it on the answer you liked.',
      },
      {
        symptom: 'You cannot tell this apart from a development plan on a player profile.',
        fix: 'A priority is a reaction to something going wrong now, and it ends when it is fixed. A development plan is a long sequence a player works through over a season. Use a priority for "he is doing X wrong"; use a development plan for "I want to build his swing properly".',
      },
    ],
    result:
      'The priority is saved to your team and shows on Skill Development until you resolve it. Practice plans can draw on it.',
    nextAction: 'Build a practice that works on it, or record what happened after you ran the drills.',
    related: ['practice-plans', 'player-development', 'coachai'],
    synonyms: [
      'priority', 'problem', 'fix', 'struggling', 'weakness', 'issue', 'prescription',
      'coachai', 'chat', 'ask', 'what should i work on', 'pinned',
    ],
    version: 1,
  },

  // ── Roster ──────────────────────────────────────────────────────────────
  {
    id: 'roster',
    module: 'roster',
    tasks: ['build-roster'],
    title: 'Get your roster in',
    purpose:
      'Get your players into BenchCoach so plans, lineups and reports know who is on the team.',
    summary: 'Add your players once, and everything else knows who they are.',
    requires: ['team', 'decide'],
    steps: [
      {
        do: 'Open Roster and choose "Add Player" to type one in.',
        note: 'Name is all you need. Jersey number and positions can wait.',
      },
      {
        do: 'For a whole team at once, choose "Import from Screenshot".',
        note: 'A photo of your league roster page, a team text, or a printed list all work.',
      },
      {
        do: 'Check the names it pulled out before you import them.',
        note: 'Read them — a screenshot of a phone screen can drop a letter, and a wrong name follows the kid all season.',
      },
      {
        do: 'Tap a player to open their profile.',
        note: 'Their notes, measurements, development plans and reports all live there.',
      },
    ],
    example:
      'You screenshot the league site roster page, upload it, correct one misspelled name, and import twelve players in about a minute.',
    problems: [
      {
        symptom: 'The screenshot import missed players or got names wrong.',
        fix: 'Fix them on the review screen before importing. If it is badly off, import what is right and add the rest with "Add Player".',
      },
      {
        symptom: 'A player has left the team.',
        fix: 'Use "Archive" rather than deleting. Everything recorded about them is kept, and they stop appearing in lineups and plans. You can restore them later.',
      },
    ],
    result:
      'Players are saved to this team. Lineups, practice plans, reports and development plans can all use them now.',
    nextAction: 'Open a player and rate their skill levels, or build your first practice.',
    related: ['player-development', 'player-reports', 'practice-plans'],
    synonyms: [
      'players', 'team list', 'add kids', 'import', 'screenshot', 'photo', 'upload',
      'jersey', 'numbers', 'archive', 'remove player', 'delete player',
    ],
    version: 1,
  },

  // ── Player development plans ────────────────────────────────────────────
  {
    id: 'player-development',
    module: 'player-development',
    tasks: ['help-a-player'],
    title: 'Put a player on a development plan',
    purpose:
      'Follow a curated teaching sequence with one player, so you always know what to work on next and can see how far they have come.',
    summary: 'A stage-by-stage plan for one player, so you always know what is next.',
    requires: ['team', 'decide'],
    requiresNote:
      'Starting a plan and moving a player between stages is the head coach\'s. Anyone on the staff can read the plan and record what they saw.',
    steps: [
      {
        do: 'Open a player, go to the "Development" tab, and choose "Start Development Plan".',
      },
      {
        do: 'Pick the pathway that matches what you want to build.',
        note: 'Each one is a sequence somebody wrote down on purpose — stage 2 assumes stage 1 landed.',
      },
      {
        do: 'Read the stage: what you are working on, what good looks like, and the drills for it.',
        note: 'Every stage is readable from day one. You can look ahead as far as you like without moving the player.',
      },
      {
        do: 'Run the drills, then use "Record today\'s work" to note that you did.',
      },
      {
        do: 'Tick the signals under "What good looks like" as you actually see them.',
        note: 'These record what you observed. They do not unlock anything — moving him on is still your call.',
      },
      {
        do: 'When he is ready, use the advance button, which names the stage he is moving to before you confirm.',
        note: 'Going back a stage is a normal coaching decision and is recorded the same way.',
      },
    ],
    example:
      'You start Speed & Agility for a nine-year-old. Stage 1 asks for four baseline measurements. Six weeks and eight sessions later he is on stage 3, and you can see both numbers side by side.',
    problems: [
      {
        symptom: 'You cannot tell a development plan from a CoachAI priority.',
        fix: 'A development plan is a long sequence for one player, over a season. A priority is a reaction to a specific problem and ends when it is fixed. Both can be running at once.',
      },
      {
        symptom: 'Some drills have no video.',
        fix: 'Most do not, and that is expected — every drill carries written setup, cues, reps and what to look for, and is meant to be run from those. Where a video exists it is shown, labelled honestly about what it covers.',
      },
      {
        symptom: 'You want the whole team working on one player\'s stage.',
        fix: 'Use "Add to practice" on the stage. It opens the practice builder with that pathway and stage chosen — you still press Generate, and you can clear it.',
      },
    ],
    result:
      'The plan is saved against the player on this team. Their stage, sessions, notes, observations and measurements are all kept, including if you move them backwards.',
    nextAction: 'Record a baseline measurement, or add the stage to your next practice.',
    related: ['roster', 'practice-plans', 'skill-development', 'playbooks'],
    synonyms: [
      'pathway', 'stages', 'progression', 'curriculum', 'long term', 'speed', 'agility',
      'individual', 'one player', 'advance', 'mastery', 'baseline', 'measurements', 'lms',
    ],
    version: 1,
  },

  // ── Player reports ──────────────────────────────────────────────────────
  {
    id: 'player-reports',
    module: 'player-reports',
    tasks: ['player-report'],
    title: 'Write a report for a family',
    purpose:
      'Produce an end-of-season or mid-season write-up about a player that you would be comfortable handing to their parents.',
    summary: 'A write-up about one player, ready to hand to their family.',
    requires: ['team', 'decide'],
    requiresNote:
      'Writing the document that goes to a family is the head coach\'s. Anyone on the staff can read reports that already exist.',
    steps: [
      { do: 'Open the player, go to the "Reports" tab, and start a new report.' },
      {
        do: 'Check what it has pulled in from the season before you edit anything.',
      },
      { do: 'Edit the wording until it sounds like you.' },
      {
        do: 'Finalize it, then export the PDF and send that to the family.',
        note: 'Parents get the exported file. They do not need a BenchCoach account and never see your team.',
      },
    ],
    problems: [
      {
        symptom: 'The report says things you would not say to a parent.',
        fix: 'Edit it before finalizing. It is a draft built from what is recorded, not a finished document.',
      },
      {
        symptom: 'You want the parents to log in and read it.',
        fix: 'They do not need to. Export the PDF and send it however you already talk to them.',
      },
    ],
    result: 'The report is saved against the player. Finalized reports keep their own copy of what they said.',
    nextAction: 'Export the PDF and send it to the family.',
    related: ['roster', 'player-development'],
    synonyms: [
      'parents', 'families', 'end of season', 'evaluation', 'assessment', 'pdf', 'export',
      'write up', 'feedback', 'season summary',
    ],
    version: 1,
  },

  // ── Overview articles for the rest ──────────────────────────────────────
  // Short, code-verified, and honest about being overviews. Full contextual
  // integration for these modules is the next phase.
  {
    id: 'coachai',
    module: 'coachai',
    tasks: ['help-a-player'],
    title: 'Ask CoachAI',
    purpose:
      'Ask a coaching question in your own words and get an answer that knows your team, your players and what you have already worked on.',
    summary: 'Ask in plain language. It knows your roster and your season.',
    requires: ['team'],
    steps: [
      { do: 'Open CoachAI and describe what you are seeing or what you want to do.' },
      {
        do: 'If the answer is worth acting on, press "Make this the priority".',
        note: 'That is what turns an answer into something on Skill Development.',
      },
    ],
    problems: [
      {
        symptom: 'The answer is generic.',
        fix: 'Say more about the specific kid or situation. It reads your roster and your recorded notes, so naming who you mean helps.',
      },
    ],
    result: 'The conversation is kept. Nothing changes on your team unless you make something the priority.',
    nextAction: 'Make an answer the priority, or build a practice around it.',
    related: ['skill-development', 'practice-plans'],
    synonyms: ['chat', 'ask', 'question', 'advice', 'assistant', 'ai'],
    version: 1,
  },
  {
    id: 'drill-library',
    module: 'drill-library',
    tasks: ['plan-practice'],
    title: 'Find a drill',
    purpose: 'Search the drill library by what you want to fix, what age you coach, and what you have with you.',
    summary: 'Find a drill for the problem in front of you.',
    requires: [],
    steps: [
      { do: 'Open Drill Library and search, or filter by skill, age and equipment.' },
      { do: 'Open a drill to read its setup, cues and what good looks like.' },
      {
        do: 'Use the option to send it into a practice plan if you want to build around it.',
      },
    ],
    problems: [
      {
        symptom: 'A drill has no video.',
        fix: 'Many do not. Every drill carries written instructions and is meant to be run from those. Where a video exists it is shown and labelled with what it actually covers — some are compilations that include the drill somewhere inside them.',
      },
    ],
    result: 'Nothing is saved by browsing. Sending a drill to a practice plan starts a plan you still have to save.',
    nextAction: 'Build a practice around the drill you found.',
    related: ['practice-plans'],
    synonyms: ['drills', 'search', 'find', 'activities', 'exercises', 'video', 'how to'],
    version: 1,
  },
  {
    id: 'game-day',
    module: 'game-day',
    tasks: ['prepare-for-a-game', 'record-what-happened'],
    title: 'Run a game',
    purpose: 'Keep the book, track pitch counts and manage who is playing where during a game.',
    summary: 'Keep the book and the pitch counts during the game.',
    requires: ['team', 'record'],
    steps: [
      { do: 'Build a lineup before the game in Lineup Builder.' },
      { do: 'Open Game Day to score the game as it happens.' },
      { do: 'Use Pitch Counter to track pitches and rest days.' },
    ],
    problems: [
      {
        symptom: 'You are not the head coach and cannot build the lineup.',
        fix: 'Lineups are the head coach\'s. You can still keep the book and the pitch count.',
      },
    ],
    result: 'What you record during the game is saved to the team and feeds stats and player reports.',
    nextAction: 'Log the recap afterwards.',
    related: ['roster', 'player-reports'],
    synonyms: ['scorebook', 'scoring', 'pitch count', 'lineup', 'batting order', 'positions', 'innings'],
    version: 1,
  },
  {
    id: 'notes',
    module: 'notes',
    tasks: ['record-what-happened'],
    title: 'Write things down',
    purpose: 'Keep notes about the team or about one player, so you are not relying on remembering.',
    summary: 'Notes about the team or one player, kept where you will find them.',
    requires: ['team', 'record'],
    steps: [
      { do: 'Use Notes for anything about the team.' },
      { do: 'Use the notes on a player profile for anything about that player.' },
      {
        do: 'Notes inside a development plan stay with the stage you wrote them on.',
      },
    ],
    problems: [
      {
        symptom: 'You cannot find a note you wrote.',
        fix: 'Notes live where you wrote them — team notes in Notes, player notes on that player, plan notes on that stage of that plan.',
      },
    ],
    result: 'Notes are saved to your team and visible to your coaching staff. They are not shared with families.',
    nextAction: 'Ask CoachAI about something you noted — it reads them.',
    related: ['roster', 'coachai', 'player-development'],
    synonyms: ['note', 'journal', 'log', 'observations', 'write down', 'remember'],
    version: 1,
  },
  {
    id: 'playbooks',
    module: 'playbooks',
    tasks: ['help-a-player'],
    title: 'Playbooks',
    purpose:
      'Follow a fixed multi-week template with a player, session by session.',
    summary: 'A fixed multi-week template, session by session.',
    requires: ['team'],
    requiresNote:
      'Playbooks are not currently in the sidebar. If you have players enrolled in one, their progress is still kept and still shows on their profile.',
    steps: [
      { do: 'Open a player and look for "Active Playbooks" on their Overview tab.' },
      { do: 'Work through the sessions in order and mark them complete as you go.' },
    ],
    problems: [
      {
        symptom: 'You cannot find Playbooks in the menu.',
        fix: 'It is not in the sidebar at the moment. Existing playbooks still work and still show on a player\'s profile. For starting something new, a development plan on the player\'s Development tab is the current way.',
      },
      {
        symptom: 'You are not sure whether to use a Playbook or a development plan.',
        fix: 'Development plans are the current system and the one being built on. A Playbook is a fixed template; a development plan is a stage sequence you advance a player through deliberately, with measurements and history.',
      },
    ],
    result: 'Session completion is saved against the player.',
    nextAction: 'For new work, start a development plan on the player\'s Development tab.',
    related: ['player-development'],
    synonyms: ['playbook', 'program', 'multi week', 'template', 'progression'],
    version: 1,
  },
  {
    id: 'getting-started',
    module: 'getting-started',
    tasks: ['plan-practice', 'build-roster'],
    title: 'Getting started',
    purpose: 'Get from a new account to something you can use at your next practice.',
    summary: 'From a new account to a practice you can print.',
    requires: [],
    steps: [
      { do: 'Make sure the right team is selected at the top of the sidebar.' },
      { do: 'Add your players, by hand or from a screenshot.' },
      { do: 'Build a practice plan and save it with "Use this plan".' },
      { do: 'Print it and take it to the field.' },
    ],
    problems: [
      {
        symptom: 'You were invited to somebody else\'s team and are being asked to make your own.',
        fix: 'You should not be. Open the invite link again — accepting it puts you straight on their team.',
      },
    ],
    result: 'A saved practice plan on your team, which you can print.',
    nextAction: 'Print the plan, or add your roster if you have not yet.',
    related: ['roster', 'practice-plans'],
    synonyms: ['new', 'first time', 'setup', 'begin', 'start', 'onboarding', 'tutorial'],
    version: 1,
  },
]

// ───────────────────────────────────────────────────────────────────────────
// Lookups
// ───────────────────────────────────────────────────────────────────────────

const BY_ID = new Map(HELP_GUIDES.map(g => [g.id, g]))
const BY_MODULE = new Map<HelpModule, HelpGuide>()
for (const g of HELP_GUIDES) if (!BY_MODULE.has(g.module)) BY_MODULE.set(g.module, g)

export function guideById(id: string | null | undefined): HelpGuide | null {
  return (id && BY_ID.get(id)) || null
}

export function guideForModule(m: HelpModule | null | undefined): HelpGuide | null {
  return (m && BY_MODULE.get(m)) || null
}

export const HELP_TASKS: Array<{ id: HelpTask; label: string; blurb: string }> = [
  { id: 'plan-practice', label: 'Plan my next practice', blurb: 'Build a sheet you can run from.' },
  { id: 'help-a-player', label: 'Help a player improve', blurb: 'Fix a problem, or follow a longer plan.' },
  { id: 'build-roster', label: 'Add or import my roster', blurb: 'Get your players in.' },
  { id: 'record-what-happened', label: 'Record what happened', blurb: 'Recaps, notes and observations.' },
  { id: 'prepare-for-a-game', label: 'Prepare for a game', blurb: 'Lineups, the book and pitch counts.' },
  { id: 'player-report', label: 'Create a player report', blurb: 'A write-up for a family.' },
]

export function guidesForTask(task: HelpTask): HelpGuide[] {
  return HELP_GUIDES.filter(g => g.tasks.includes(task))
}

// ───────────────────────────────────────────────────────────────────────────
// Search
// ───────────────────────────────────────────────────────────────────────────

/**
 * Everything a guide can be found by.
 *
 * Titles alone was the old behaviour and it meant a coach searching
 * "screenshot" found nothing, though roster import is documented in detail.
 */
function haystack(g: HelpGuide): string {
  return [
    g.title, g.summary, g.purpose,
    ...g.steps.flatMap(s => [s.do, s.note || '']),
    g.example || '',
    ...g.problems.flatMap(p => [p.symptom, p.fix]),
    g.result, g.nextAction,
    ...g.synonyms,
  ].join(' ').toLowerCase()
}

const HAYSTACKS = new Map(HELP_GUIDES.map(g => [g.id, haystack(g)]))

export function searchGuides(query: string): HelpGuide[] {
  const q = query.trim().toLowerCase()
  if (!q) return HELP_GUIDES

  // Every word has to appear somewhere. "import roster" should not match a
  // guide that merely says "import", and an OR search on two common words
  // returns the whole library.
  const words = q.split(/\s+/).filter(Boolean)

  const scored = HELP_GUIDES
    .map(g => {
      const hay = HAYSTACKS.get(g.id) || ''
      if (!words.every(w => hay.includes(w))) return null
      // A title match is what the coach most likely meant.
      const inTitle = words.filter(w => g.title.toLowerCase().includes(w)).length
      const inSummary = words.filter(w => g.summary.toLowerCase().includes(w)).length
      return { g, score: inTitle * 10 + inSummary * 3 }
    })
    .filter((x): x is { g: HelpGuide; score: number } => x !== null)

  return scored.sort((a, b) => b.score - a.score || a.g.title.localeCompare(b.g.title)).map(x => x.g)
}

// ───────────────────────────────────────────────────────────────────────────
// Requirements
// ───────────────────────────────────────────────────────────────────────────

export interface HelpContext {
  hasTeam: boolean
  can: (c: 'record' | 'decide') => boolean
}

/**
 * Which requirements this coach does not meet.
 *
 * Used to EXPLAIN, never to hide. A contributor reading the practice guide sees
 * every step and a line saying who can do it — which is more useful than a
 * missing article, and far more useful than a button that fails.
 */
export function unmetRequirements(g: HelpGuide, ctx: HelpContext): HelpRequirement[] {
  return g.requires.filter(r =>
    r === 'team' ? !ctx.hasTeam : !ctx.can(r))
}

export function requirementMessage(g: HelpGuide, unmet: HelpRequirement[]): string | null {
  if (unmet.length === 0) return null
  if (g.requiresNote) return g.requiresNote
  if (unmet.includes('team')) return 'Select a team first.'
  return 'Your role on this team does not include this. The head coach can do it.'
}

// ───────────────────────────────────────────────────────────────────────────
// Content integrity
// ───────────────────────────────────────────────────────────────────────────

/**
 * Problems a human should fix, found by walking the registry.
 *
 * Run by scripts/test-help-content.ts. Here rather than in the test so the
 * rules travel with the content they describe.
 */
export function contentProblems(): string[] {
  const out: string[] = []
  const ids = new Set(HELP_GUIDES.map(g => g.id))

  for (const g of HELP_GUIDES) {
    if (HELP_GUIDES.filter(x => x.id === g.id).length > 1) out.push(`${g.id}: duplicate id`)
    for (const r of g.related) {
      if (!ids.has(r)) out.push(`${g.id}: related guide '${r}' does not exist`)
      if (r === g.id) out.push(`${g.id}: related to itself`)
    }
    if (g.steps.length === 0) out.push(`${g.id}: no steps`)
    if (g.problems.length === 0) out.push(`${g.id}: no problems section`)
    if (!g.result.trim()) out.push(`${g.id}: no result`)
    if (!g.nextAction.trim()) out.push(`${g.id}: no next action`)
    if (g.tasks.length === 0 && g.module !== 'getting-started') {
      out.push(`${g.id}: belongs to no task, so nothing in the Help Center lists it`)
    }

    // A URL in the prose means the content knows about routing, which is how
    // links end up dropping the selected team.
    const prose = haystack(g)
    if (/https?:\/\//.test(prose)) out.push(`${g.id}: contains a URL — use an action, not a link`)
    if (/\/dashboard\//.test(prose)) out.push(`${g.id}: contains a route path — use an action`)

    // Claims the product cannot back.
    if (/every drill has a video|all drills have videos/i.test(prose)) {
      out.push(`${g.id}: claims every drill has a video, which is not true`)
    }
    if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(prose)) {
      out.push(`${g.id}: contains an email address — there is no support inbox to point at`)
    }
    // Implementation language in coach-facing prose.
    if (/\bmigration\b|\bRLS\b|\bschema\b|\bdatabase\b|supabase/i.test(prose)) {
      out.push(`${g.id}: exposes implementation terminology`)
    }
  }
  return out
}
