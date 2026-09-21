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
  | 'pitch-counter'
  | 'lineups'
  | 'notes'
  | 'log-entry'
  | 'stats'
  | 'scouting'
  | 'staff'
  | 'ai-memory'
  | 'account'
  | 'team-settings'
  | 'league-admin'
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
  | 'set-things-up'

/**
 * A capability from lib/authz, or 'team' meaning "any team selected".
 *
 * Used to explain a missing prerequisite rather than to offer an action that
 * will fail. A contributor reading the practice guide is told the head coach
 * builds plans, not shown a button that 403s.
 */
// 'own' is the team owner — staff and billing. It is a real rung in
// lib/authz.ts and Staff genuinely requires it, so the registry carries it
// rather than pretending 'decide' is close enough.
export type HelpRequirement = 'team' | 'record' | 'decide' | 'own'

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
      {
        do: 'Open the player from the roster and pick the "Reports" tab.',
        note: 'That tab is the only way in. Reports belong to a player, so there is no separate reports page to start one from.',
      },
      {
        do: 'Press "Create Player Report" — or "Continue draft" if you already started one.',
        note: 'Only one draft is open at a time, so you can close the laptop and come back.',
      },
      {
        do: 'Answer "Start from what you have already recorded?" to decide whether it pulls the season in.',
        note: 'Saying yes fills the sections from your notes, measurements and priorities. Saying no gives you a blank one.',
      },
      {
        do: 'Work down "Report setup", "Strengths", "Development" and "Closing", editing until it sounds like you.',
        note: 'It saves as you go. Nothing is sent anywhere while it says "Draft".',
      },
      {
        do: 'Use "Preview the PDF" to see exactly what a parent will get.',
      },
      {
        do: 'Press "Finalize report", then "Open PDF" and send that file to the family.',
        note: 'Parents get the file. They do not need a BenchCoach account and never see your team.',
      },
    ],
    example:
      'Mid-season for Charlie: you say yes to starting from what is recorded, it fills in two strengths and a development area from your notes, you rewrite the closing in your own words, preview it, finalize, and email the PDF that evening.',
    problems: [
      {
        symptom: 'The report says things you would not say to a parent.',
        fix: 'Edit it before finalizing. What it starts with is assembled from what you recorded, not a finished document — every word is yours to change.',
      },
      {
        symptom: 'You want the parents to log in and read it.',
        fix: 'They do not need to. Send the PDF however you already talk to them.',
      },
      {
        symptom: 'You finalized it and something is wrong.',
        fix: 'A finalized report opens on its preview and cannot be edited in place. Start a revision from it — the original stays as it was, which is the point if it has already gone out.',
      },
      {
        symptom: 'You are not the head coach and there is no button.',
        fix: 'Writing the document that goes to a family is the head coach\'s. You can read reports that already exist on that tab.',
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
      {
        // The distinction the brief asks for, from the CoachAI side.
        symptom: 'You want to know whether to make this a priority or start a development plan.',
        fix: 'A priority is CoachAI\'s answer to something happening now, and it ends when the thing is fixed. A development plan is a curated sequence somebody wrote in advance, with stages, and it runs for weeks whatever else is going on. Priorities come from here; development plans are started on a player\'s profile.',
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
        // No proportion is claimed here any more. The library changes as drills
        // are added, and "many do not" was a number nothing keeps true.
        symptom: 'A drill has no video.',
        fix: 'Not every drill has one. The written instructions are the drill and it is meant to be run from those. Where a video exists it appears under "Supporting video" and is labelled with what it actually covers — some are compilations with the drill somewhere inside them.',
      },
      {
        symptom: 'You cannot find a drill for the thing you are seeing.',
        fix: 'Search the problem rather than the drill — the box takes "a drill, or the problem you are trying to fix". If nothing fits, ask CoachAI in your own words.',
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
    // DELIBERATELY SHORT. This is read standing on a field with a game
    // starting. Three steps, and the detail lives in the pitch-counter and
    // lineups guides where there is time to read it.
    steps: [
      { do: 'Build a lineup before the game in Lineup Builder.' },
      { do: 'Press "Start Game", then score it as it happens.' },
      {
        do: 'Keep pitch counts from Pitch Counter.',
        note: 'Pick a rule set there if you want the daily max and rest days shown.',
      },
    ],
    problems: [
      {
        symptom: 'You are not the head coach and cannot build the lineup.',
        fix: 'Lineups are the head coach\'s. You can still keep the book and the pitch count.',
      },
      {
        symptom: 'The game is already going and you have not read any of this.',
        fix: 'You do not need to. Tap "Start Game" and score — everything saves as you go, and nothing has to be set up first.',
      },
    ],
    result: 'What you record during the game is saved to the team and feeds stats and player reports.',
    nextAction: 'Log the recap afterwards.',
    related: ['lineups', 'pitch-counter', 'player-reports'],
    synonyms: ['scorebook', 'scoring', 'pitch count', 'lineup', 'batting order', 'positions', 'innings'],
    version: 1,
  },
  {
    id: 'pitch-counter',
    module: 'pitch-counter',
    tasks: ['prepare-for-a-game', 'record-what-happened'],
    title: 'Count pitches',
    purpose:
      'Keep a running pitch count for one pitcher at a time, on a screen you can hit without looking at it.',
    summary: 'Tap to count. Pick a rule set and it shows you where they stand.',
    requires: ['team', 'record'],
    requiresNote:
      'Anyone who can record for the team can keep a pitch count — it is not the head coach\'s job alone.',
    steps: [
      {
        do: 'Choose a rule set under "Rules", or leave it on "Just count, no rules".',
        // THE MOST IMPORTANT SENTENCE IN THIS FILE. See the note below.
        note: 'With no rule set you get a plain tally and no limit is shown, because BenchCoach does not know which rules your league plays under. Picking one is what makes the daily max and rest days appear.',
      },
      {
        do: 'Pick the pitcher and tap the big number to count. Every tap saves on its own.',
        note: 'Nothing has to be pressed at the end for the count to be kept.',
      },
      {
        do: 'Tap "Undo" if you double-tapped or counted a warm-up pitch.',
        note: 'It takes one off the same count. There is no separate correction screen.',
      },
      {
        do: 'On a pitching change, press "Switch pitcher".',
        note: 'That leaves the first count open, so you can come back to it later the same day and keep adding.',
      },
      {
        do: 'When a pitcher is finished for the day, press "Finish" on their count.',
        note: 'You can reopen it if they go back out. The day stays as one total per pitcher rather than several.',
      },
    ],
    example:
      'You pick your league\'s 10U rule set and start a count on Charlie. At 36 the screen says how many are left to the daily max. He comes out, you switch to the next pitcher, and later Charlie goes back in — you tap his name again and the count carries on from 36 rather than starting over.',
    problems: [
      {
        symptom: 'No limit or warning is shown.',
        fix: 'No rule set was chosen for that count, so there is no limit to compare against. Start a new count and pick one under "Rules".',
      },
      {
        symptom: 'You went past the daily max and it still let you count.',
        // The line the whole guide exists for.
        fix: 'It will. The warning is there to tell you where the pitcher stands against the rule set you picked — it does not stop the count, and it cannot stop a pitch. Whether a pitcher keeps throwing is your decision and your league\'s rules, not the app\'s.',
      },
      {
        symptom: 'The rule sets do not match how your league actually plays.',
        fix: 'Then the numbers shown will not match either. Check the count against your league\'s own rules and use whichever your league enforces.',
      },
      {
        symptom: 'You counted on the wrong pitcher.',
        fix: 'Tap "Undo" to take the pitches off, then switch to the right one and add them there. Counts stay open all day, so nothing is lost.',
      },
    ],
    result:
      'One running total per pitcher per day, saved as you go. With a rule set chosen, the screen also shows the daily max and the rest days that rule set calls for.',
    nextAction: 'Switch to the next pitcher, or finish the day out.',
    related: ['game-day', 'lineups'],
    synonyms: [
      'pitch count', 'pitches', 'pitcher', 'arm', 'rest days', 'daily max',
      'limit', 'tally', 'counter', 'innings pitched',
    ],
    version: 1,
  },
  {
    id: 'lineups',
    module: 'lineups',
    tasks: ['prepare-for-a-game'],
    title: 'Build a lineup',
    purpose:
      'Put together a batting order and a fielding plan for a game, either by generating one or by setting it yourself.',
    summary: 'Generate a lineup, then change whatever you want before you use it.',
    requires: ['team', 'decide'],
    requiresNote:
      'The head coach and admins build lineups. Everyone else can read one and keep the book.',
    steps: [
      { do: 'Open Lineup Builder and set the date, innings and how many players are on the field.' },
      {
        do: 'Choose a batting order style and pick "How should we build it?"',
        note: 'These set what the generator optimises for. Nothing is locked in by choosing them.',
      },
      {
        do: 'Mark anyone unavailable before you generate.',
        note: 'Position eligibility and any innings limits you have set are read from the roster.',
      },
      {
        do: 'Press "Generate Lineup", or "Set it myself" to build it by hand.',
      },
      {
        do: 'Read the grid, change what you want, and use "Regenerate" or "Start over" if it is not close.',
        note: 'Every generated lineup is a draft for you to edit. Nothing is sent anywhere until you save it.',
      },
    ],
    example:
      'Nine players, six innings, one of them cannot pitch this week. You generate, see that two kids sit two innings in a row, swap them by hand, and keep the rest.',
    problems: [
      {
        symptom: 'Somebody is in a position you would never put them in.',
        fix: 'Set their position eligibility on the roster, then regenerate. The generator only uses what it has been told.',
      },
      {
        symptom: 'The innings are not as even as you want.',
        fix: 'Change them by hand in the grid. The generator balances what it can, and it is a starting point rather than an answer.',
      },
      {
        symptom: 'You cannot build one.',
        fix: 'Building a lineup is the head coach\'s. If you keep the book you can still open the lineup and score from it.',
      },
    ],
    result:
      'A saved lineup you can open on game day. It does not start a game or move anything on its own.',
    nextAction: 'Open Game Day when the game starts.',
    related: ['game-day', 'roster', 'pitch-counter'],
    synonyms: [
      'lineup', 'batting order', 'positions', 'fielding', 'who plays where',
      'bench', 'innings', 'rotation', 'card',
    ],
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
      {
        do: 'Open Notes and press "Add Team Note" for anything about the team.',
        note: 'Give it a short title — "Throwing Issues" — and write as much or as little as you want.',
      },
      {
        do: 'Press "Add Player Note", or use the notes on a player profile, for one kid.',
      },
      {
        do: 'Use "Edit Note" to change one later, or "Delete Note" to remove it.',
      },
    ],
    problems: [
      {
        // The distinction the brief asks for, from the Notes side.
        symptom: 'You are not sure whether this belongs in Notes or in Log an Entry.',
        fix: 'Notes are what you think. Log an Entry is what happened. A note is standing context that stays true: he is scared of the ball, or you have no catcher until June. An entry is one dated event — this game, this practice, this lesson. If it has a date attached, log it; if it describes how things are, note it.',
      },
      {
        symptom: 'You cannot find a note you wrote.',
        fix: 'Notes live where you wrote them — team notes in Notes, player notes on that player, plan notes on that stage of that plan.',
      },
    ],
    result: 'Notes are saved to your team and visible to your coaching staff. They are not shared with families.',
    nextAction: 'Ask CoachAI about something you noted — it reads them.',
    related: ['log-entry', 'roster', 'coachai'],
    synonyms: ['note', 'journal', 'observations', 'write down', 'remember', 'context'],
    version: 1,
  },
  {
    id: 'log-entry',
    module: 'log-entry',
    tasks: ['record-what-happened'],
    title: 'Log what happened',
    purpose:
      'Record one dated thing — a game, a practice, a lesson — so the rest of the product has something real to work from.',
    summary: 'One dated event. This is what stats and reports are built out of.',
    requires: ['team', 'record'],
    requiresNote:
      'Anyone who can record for the team can log an entry. It is not the head coach\'s alone.',
    steps: [
      {
        do: 'Open Log an Entry and pick what kind of thing it was.',
        note: 'A game, a practice, a lesson, or "Something else" if none of them fit.',
      },
      {
        do: 'Set the date. It defaults to the most recent weekend, which is usually right.',
      },
      {
        do: 'Choose "Whole team" or one player.',
        note: 'Picking a player is what makes it show up on their profile and in their report.',
      },
      {
        do: 'Write what you saw under "What did you see?"',
        note: 'Plain sentences. This is the text CoachAI and the report builder read back.',
      },
      {
        do: 'Add a box-score screenshot if you have one, and check what it pulled out before saving.',
        note: 'A screenshot of a phone screen can drop a letter, and a wrong name follows the kid all season.',
      },
    ],
    example:
      'Saturday\'s game: you pick Game, leave the date on Saturday, choose Charlie, write that he was late on anything with speed but his glove work was the best it has been, and attach the box score.',
    problems: [
      {
        // The distinction the brief asks for, from the Log side.
        symptom: 'You are not sure whether this belongs here or in Notes.',
        fix: 'Log an Entry is what happened on a day. Notes are what is true in general. If you would start the sentence with a date, log it. If you would start it with "he" or "we", it is probably a note.',
      },
      {
        symptom: 'The stats did not change after you logged a game.',
        fix: 'Stats are built from the numbers in a box score, not from what you wrote. An entry with only a written description adds context, not batting averages.',
      },
      {
        symptom: 'The screenshot pulled out the wrong name.',
        fix: 'Correct it on the review step before you save. Names are matched against your roster and a close miss is easy to accept by accident.',
      },
    ],
    result:
      'One dated entry saved to the team, and to the player if you picked one. It feeds their profile, their report and anything you ask CoachAI afterwards.',
    nextAction: 'Ask CoachAI about what you just logged, or log the next one.',
    related: ['notes', 'stats', 'player-reports'],
    synonyms: [
      'log', 'entry', 'record', 'game', 'practice', 'lesson', 'box score',
      'screenshot', 'what happened', 'session',
    ],
    version: 1,
  },
  {
    id: 'stats',
    module: 'stats',
    tasks: ['record-what-happened'],
    title: 'Read your stats',
    purpose:
      'See batting, pitching and fielding numbers for your team and each player, built from the games you have logged.',
    summary: 'Numbers from the games you logged. Nothing arrives on its own.',
    requires: ['team'],
    steps: [
      {
        do: 'Log your games first, with the box score.',
        note: 'This page has nothing to show until something is logged — it is a view of your entries, not a separate record.',
      },
      { do: 'Open Stats and pick a player, or stay on the team view.' },
      {
        do: 'Use the game type filter — "Regular", "Playoff", "Scrimmage" — if you only want some of them.',
      },
    ],
    example:
      'You log six games with box scores. Team AVG and the leaderboard fill in; a seventh game you logged as a written note only does not move them, because there were no numbers in it.',
    problems: [
      {
        // The distinction the brief asks for.
        symptom: 'You are not sure which of these numbers you typed and which the app worked out.',
        fix: 'You provide the raw counts — at-bats, hits, innings, pitches — from each game\'s box score. Everything with a rate in it, like Team AVG or extra-base hits, is calculated from those. Change a game and the calculated numbers change with it; there is nothing stored separately that could disagree.',
      },
      {
        symptom: 'A number looks wrong.',
        fix: 'Find the game it came from and check what was entered. A miskeyed box score is the usual cause, and correcting the entry corrects everything derived from it.',
      },
      {
        symptom: 'There is nothing here.',
        fix: 'No games with box scores have been logged yet. Written entries about a game add context but no numbers.',
      },
    ],
    result:
      'A read-only view. Nothing on this page changes your data — it is arithmetic over what you logged.',
    nextAction: 'Log the game you have not got round to yet.',
    related: ['log-entry', 'player-reports'],
    synonyms: [
      'stats', 'statistics', 'average', 'batting average', 'numbers',
      'leaderboard', 'era', 'totals', 'season',
    ],
    version: 1,
  },
  {
    id: 'scouting',
    module: 'scouting',
    tasks: ['prepare-for-a-game'],
    title: 'Keep notes on other teams',
    purpose:
      'Record what you saw of an opposing team and their pitchers, so you are not starting from nothing the next time you meet them.',
    summary: 'What you saw of the other team, kept for next time.',
    requires: ['team', 'record'],
    steps: [
      {
        do: 'Add the opposing team, then add what you saw as an entry against it.',
        note: 'Pick an entry type — batting, pitching, or a general note — and set the game date.',
      },
      {
        do: 'Name their pitchers as you see them and record pitch counts.',
        note: 'Pitch Counter can do this at the fence, and an opponent count files itself here.',
      },
      {
        do: 'Pick a rule set, or add your own under "Custom Pitch Count Rules", if you want rest-day estimates.',
      },
      {
        do: 'Read back what you have before you play them again, and correct anything that was a guess.',
      },
    ],
    example:
      'You count 68 pitches for their number 12 on Saturday. Next Wednesday the availability view shows he is likely still resting under the rule set you picked — which is a estimate from your own count, not a fact about their roster.',
    problems: [
      {
        // The limitation that matters most, stated first.
        symptom: 'How much can you trust the rest-day estimate?',
        fix: 'Only as much as the count it came from. It is worked out from pitches you recorded by hand, against a rule set you chose, and it has no idea what that pitcher threw in a game you did not watch. Treat it as your own notes doing arithmetic, not as information about their team.',
      },
      {
        symptom: 'You recorded the wrong name or the wrong count.',
        fix: 'Open the entry and correct it. Names are what you typed at a fence, so a wrong one stays wrong until somebody fixes it, and everything downstream is built on it.',
      },
      {
        symptom: 'You logged the same game twice.',
        fix: 'Re-reading a game you already logged is fine — find the existing entry and edit it rather than adding a second, or the counts add up to more than were thrown.',
      },
      {
        symptom: 'You want to see another coach\'s scouting of this team.',
        fix: 'You cannot. Scouting stays in the account that recorded it and is never pooled between coaches or leagues.',
      },
    ],
    result:
      'Your own record of an opposing team, visible to your staff and nobody else.',
    nextAction: 'Count their pitcher next time you play them.',
    related: ['pitch-counter', 'game-day', 'notes'],
    synonyms: [
      'scouting', 'opponent', 'other team', 'opposing', 'advance',
      'rest days', 'availability', 'their pitcher',
    ],
    version: 1,
  },
  {
    id: 'staff',
    module: 'staff',
    tasks: ['set-things-up'],
    title: 'Add another coach',
    purpose:
      'Invite the other coaches on your team and decide what each of them can do.',
    summary: 'Invite a coach, pick their role, and know what that role means.',
    requires: ['team', 'own'],
    requiresNote:
      'Only the team owner manages staff. Everyone else can see who is on the team.',
    steps: [
      { do: 'Open Staff and press "Invite Coach".' },
      {
        do: 'Pick the role you want them to have before you send it.',
        note: 'Admin, Contributor or Viewer. The page describes each one next to the choice, and those descriptions are what the app actually enforces.',
      },
      {
        do: 'Set how long the link should last, then copy it and send it however you normally talk to them.',
        note: 'The link is the invitation — there is no email sent from here.',
      },
      {
        do: 'Check "Active Invite Links" later to see what is still outstanding.',
      },
      {
        do: 'Use "Remove Member" if somebody leaves the team.',
      },
    ],
    example:
      'Your assistant needs to keep the book on Saturday but should not be rewriting lineups. You invite him as a Contributor, send him the link, and he can log entries and keep pitch counts without being able to change the plan.',
    problems: [
      {
        // The vocabulary the whole product leans on, in the page's own words.
        symptom: 'You are not sure which role to give somebody.',
        fix: 'Viewer can read and ask CoachAI. Contributor can also record what happens — log entries, keep the book, count pitches. Admin can decide things: build practice plans and lineups, start development plans, write reports. Only the Team Owner manages staff and billing.',
      },
      {
        symptom: 'Somebody says a button is missing.',
        fix: 'That is their role, not a bug. Change it here and it takes effect for them straight away.',
      },
      {
        symptom: 'The invite link stopped working.',
        fix: 'Links expire on the date you set. Send a new one from "Invite Coach" — nothing is lost by making another.',
      },
      {
        symptom: 'There is no Invite Coach button.',
        fix: 'You are not the team owner. The owner is named at the top of this page; ask them.',
      },
    ],
    result:
      'The coach joins your team with the role you picked, and can be changed or removed here later.',
    nextAction: 'Show them where the roster and practice plans are.',
    related: ['roster', 'account'],
    synonyms: [
      'staff', 'coaches', 'invite', 'permissions', 'roles', 'access',
      'assistant', 'admin', 'who can', 'add a coach', 'remove',
    ],
    version: 1,
  },
  {
    id: 'ai-memory',
    module: 'ai-memory',
    tasks: ['set-things-up'],
    title: 'See what the AI remembers',
    purpose:
      'Look at everything CoachAI reads about your team before it answers, and delete anything that should not be there.',
    summary: 'Everything CoachAI reads before it answers, in one place.',
    requires: ['team'],
    steps: [
      {
        do: 'Open AI Memory to see three lists: "Team Notes", "Player Notes" and "Coach Preferences".',
        note: 'The notes are the ones you wrote elsewhere in the app. This page is a view of them, not a second copy.',
      },
      {
        do: 'Read "Coach Preferences" — these are things CoachAI offered to remember and somebody accepted.',
        note: 'They are saved against the team owner, so everyone on the staff sees the same list here.',
      },
      {
        do: 'Delete anything that is out of date using the bin icon next to it.',
        note: 'That deletes the note or preference itself, for everyone on the team. It is not hidden from this page only.',
      },
      { do: 'Press "Refresh" if you have just written something and want to see it here.' },
    ],
    example:
      'CoachAI keeps suggesting a drill you stopped using in April. You open AI Memory, find the preference that says you like it, and delete it. The next answer does not mention it.',
    problems: [
      {
        symptom: 'You want to know why CoachAI said something.',
        fix: 'Everything on this page is what it had to work from. If an answer looks odd, the reason is usually a note here that is no longer true.',
      },
      {
        symptom: 'Deleting a note here — does that delete it everywhere?',
        fix: 'Yes. A team note deleted here is gone from Notes as well, for the whole staff. This is the same record shown from a different angle, not a copy.',
      },
      {
        symptom: 'Nothing is listed under Coach Preferences.',
        fix: 'Nothing has been saved yet. CoachAI only remembers something when it offers to and somebody accepts — it does not store your conversations on its own.',
      },
      {
        symptom: 'You expected to see your own preferences and these are somebody else\'s.',
        fix: 'Preferences are kept for the team owner, so the whole staff sees one shared list rather than a separate one each.',
      },
    ],
    result:
      'What you delete is gone for the team, and CoachAI stops using it from the next answer.',
    nextAction: 'Ask CoachAI something and see whether the answer improved.',
    related: ['coachai', 'notes', 'staff'],
    synonyms: [
      'memory', 'remembers', 'ai', 'preferences', 'forget', 'delete',
      'privacy', 'what it knows', 'stored', 'context',
    ],
    version: 1,
  },
  {
    id: 'account',
    module: 'account',
    tasks: ['set-things-up'],
    title: 'Your account and billing',
    purpose:
      'Change your own name and password, see which teams you are on, and manage what you pay.',
    summary: 'Your name, your password, your subscription. Not your team.',
    requires: [],
    steps: [
      { do: 'Open Profile Settings from your account menu.' },
      {
        do: 'Change the name other coaches see under "Profile Information".',
        note: 'Your email cannot be changed here — the page says so next to it.',
      },
      { do: 'Use "Change Password" to set a new one.' },
      {
        do: 'Check "Teams Owned" and "Team Memberships" to see where you have access.',
      },
      {
        do: 'Use "Manage Billing" for anything to do with your subscription.',
      },
    ],
    problems: [
      {
        // Two routes, two different scopes. Confusing them is the likely error.
        symptom: 'You are looking for the season, focus areas or report branding.',
        fix: 'Those are Team Settings, not your account. This page is about you and follows you between teams; Team Settings is about one team and changes what everyone on it sees.',
      },
      {
        symptom: 'There is no billing to manage.',
        fix: 'Billing appears once there is a subscription on your account. If your league bought BenchCoach for you, there may be nothing here to manage and that is correct.',
      },
      {
        symptom: 'You want to change your email.',
        fix: 'You cannot from here. Everything else on the page is editable.',
      },
    ],
    result: 'Changes to your name and password apply to you everywhere, on every team.',
    nextAction: 'Set up the team itself in Team Settings.',
    related: ['team-settings', 'staff'],
    synonyms: [
      'account', 'profile', 'password', 'billing', 'subscription', 'payment',
      'my name', 'sign in', 'plan', 'upgrade',
    ],
    version: 1,
  },
  {
    id: 'team-settings',
    module: 'team-settings',
    tasks: ['set-things-up'],
    title: 'Set up the team',
    purpose:
      'Name the season, set what you are working on, and choose how player reports are branded.',
    summary: 'The season, the focus areas, and what reports look like.',
    requires: ['team', 'decide'],
    steps: [
      { do: 'Open Team Settings and check "Team Info" is right.' },
      {
        do: 'Set the season under "Season" — a name, a start and an end.',
        note: 'Season Progress on the dashboard is worked out from those dates.',
      },
      {
        do: 'Pick your "Focus Areas" — what the team is currently working on.',
        note: 'Practice plans and CoachAI lean on these, so keeping them current changes what you get suggested.',
      },
      {
        do: 'Set "Player Report Branding" if you want reports to carry your own name rather than BenchCoach\'s.',
      },
    ],
    problems: [
      {
        symptom: 'You are looking for your password or your subscription.',
        fix: 'Those are your account, not this team. This page changes things for everyone on the team; your account follows you between teams.',
      },
      {
        symptom: 'Season Progress looks wrong on the dashboard.',
        fix: 'Check the season start and end dates here. That bar is calculated from them and nothing else.',
      },
      {
        symptom: 'You cannot change anything.',
        fix: 'Team settings are the head coach\'s. You can see what they are set to.',
      },
    ],
    result: 'Settings apply to the whole team, and everyone on the staff sees them.',
    nextAction: 'Invite the rest of your coaches from Staff.',
    related: ['account', 'staff', 'player-reports'],
    synonyms: [
      'settings', 'season', 'focus areas', 'branding', 'team name',
      'logo', 'report header', 'configure',
    ],
    version: 1,
  },
  {
    id: 'league-admin',
    module: 'league-admin',
    tasks: ['set-things-up'],
    title: 'Run a league',
    purpose:
      'Set up a league\'s seasons, divisions and teams, invite its coaches, and see how many of them are actually using BenchCoach.',
    summary: 'Seasons, divisions, teams and coaches — and adoption, not coaching.',
    requires: [],
    requiresNote:
      'League administration is separate from coaching a team. Being a league admin does not put you on any team.',
    steps: [
      {
        do: 'Open the league dashboard and create a season with "New season".',
        note: 'Everything else hangs off a season, so this comes first.',
      },
      { do: 'Add your divisions with "New division", then teams with "New team".' },
      {
        do: 'Invite each team\'s coach and copy the link you are given.',
        note: 'You send the link yourself. The coach signs up through it and lands on their own team.',
      },
      {
        do: 'Use "Add administrator" to give somebody else league access.',
        note: 'Commissioner, Admin, Coaching director or Owner. Only the owner or a commissioner can change who administers a league.',
      },
      { do: 'Watch the adoption numbers to see who has actually opened the app.' },
    ],
    example:
      'Before the spring season you create Spring 2027, add three divisions, create twelve teams and send twelve invite links. Two weeks in, the dashboard shows nine coaches activated and four making practice plans — so you know who to ring.',
    problems: [
      {
        // The boundary that matters, stated as plainly as it can be.
        symptom: 'You want to see a team\'s practice plans, notes or scouting.',
        fix: 'You cannot, and that is deliberate. This dashboard shows adoption only — who was invited, who accepted, who has opened the app, how many plans exist. There is no route from here into a plan\'s contents, a player note, a scouting report or a CoachAI conversation. Sponsoring a league does not give you access to what its coaches record about children.',
      },
      {
        symptom: 'You also coach a team in this league.',
        fix: 'That is a separate thing. You reach your own team the normal way, and the access you have there comes from being on that team — not from administering the league.',
      },
      {
        symptom: 'A coach never accepted their invitation.',
        fix: 'The coaches list shows who was invited and who activated. Send a fresh link; the old one may have expired.',
      },
      {
        symptom: 'You cannot change seasons, divisions or teams.',
        fix: 'Only a league admin can. If you are a coaching director you can see everything and change less — ask your commissioner.',
      },
    ],
    result:
      'The league structure and its invitations, plus a count of how many coaches are using it.',
    nextAction: 'Chase the coaches who have not activated yet.',
    related: ['staff'],
    synonyms: [
      'league', 'commissioner', 'division', 'season', 'adoption',
      'organization', 'club', 'invite coaches', 'admin',
    ],
    version: 1,
  },
  {
    id: 'playbooks',
    module: 'playbooks',
    tasks: ['help-a-player'],
    title: 'Playbooks',
    purpose:
      'Follow a fixed multi-week template, session by session, with a team or one player.',
    summary: 'A fixed multi-week template, session by session.',
    requires: ['team', 'decide'],
    requiresNote:
      'Starting a playbook assigns a multi-week programme, so it is the head coach\'s. Anyone on the staff can see the progress of one already running, on the player\'s profile.',
    steps: [
      {
        do: 'Open Playbooks under Planning and pick a programme from "Progression Playbooks".',
        note: 'Each one says what it is for and how many sessions it runs to.',
      },
      {
        do: 'Press "Start Playbook" and choose "Whole Team" or "Specific Player".',
      },
      {
        do: 'Work through the sessions in order, pressing "Mark Complete" as you finish each one.',
      },
      {
        do: 'Check progress later from Playbooks, or from "Active Playbooks" on a player\'s Overview tab.',
      },
    ],
    example:
      'You pick a six-week throwing accuracy programme and start it for the whole team. Every session you run, you mark the day complete, and the progress bar on each player carries across to their profile.',
    problems: [
      {
        // The distinction is the real question now that both are reachable.
        //
        // It is NOT team versus individual. A playbook can be started for one
        // player — "Specific Player" is a real option on the start dialog, two
        // steps above this — and an earlier version of this answer said to use
        // a playbook for the team and a development plan for one kid, which
        // contradicted the step and sent a coach to the wrong tool whenever
        // they wanted a set programme for a single player. The line is fixed
        // sessions versus progression you assess.
        symptom: 'You are not sure whether to use a Playbook or a development plan.',
        fix: 'A Playbook is a fixed programme: a set list of sessions in a set order that you work through and tick off. It does not change on what you see, and it is the same programme whether you start it for the whole team or for one player. A development plan is the other way round: stages a player only moves up when you judge they are ready, with measurements and a record of what you decided. Pick a Playbook when you want a set programme followed; pick a development plan when the next step should depend on how the player is actually doing.',
      },
      {
        symptom: 'You cannot start one.',
        fix: 'Starting a playbook is the head coach\'s. You can still see how a running one is going on the player\'s profile.',
      },
      {
        symptom: 'You started the wrong one, or for the wrong player.',
        fix: 'Start the right one and work from that. The sessions you have already marked complete stay recorded against whoever they were marked for.',
      },
    ],
    result: 'The playbook is saved against the team or the player, and session completion is kept as you mark it.',
    nextAction: 'Run the first session at your next practice.',
    related: ['player-development', 'practice-plans'],
    synonyms: ['playbook', 'programme', 'program', 'multi week', 'template',
      'progression', 'curriculum', 'sessions'],
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
  { id: 'set-things-up', label: 'Set up my team and account', blurb: 'Staff, seasons, billing, what the AI remembers.' },
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
  can: (c: 'record' | 'decide' | 'own') => boolean
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
