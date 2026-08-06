// Activity log shared logic: entry-type configuration, smart defaults, and
// roster name matching. Pure functions and data — no I/O — so the capture
// page and the API routes agree on what each entry type means.
//
// The note prompts live here rather than in the page because they are the
// product: a box labeled "Notes" returns "he did ok". Prompted questions
// return the observations the diagnosis engine actually needs.

import { nameSimilarity } from './scouting'

export type EntryType = 'game' | 'practice' | 'home_session' | 'lesson' | 'scrimmage'

export interface NotePrompt {
  key: string          // stored on observations.prompt_key for weighting
  label: string
  placeholder?: string
  rows?: number
}

export interface EntryTypeConfig {
  type: EntryType
  label: string
  hint: string                 // one line under the type picker once selected
  screenshots: 'expected' | 'optional' | 'none'
  screenshotHint?: string
  parses: boolean              // does a screenshot here get vision-parsed
  prompts: NotePrompt[]
  capturesInstructor?: boolean
  capturesDuration?: boolean
  linksToPrescription?: boolean // home sessions are the adherence signal
}

// The last prompt on game/scrimmage is load-bearing: it is what lets the
// output say "he jogged in the 8am game only" rather than converting a
// fatigue pattern into a character judgment.
const GAME_PROMPTS: NotePrompt[] = [
  {
    key: 'unseen',
    label: "What did you see that the box score wouldn't show?",
    placeholder: 'e.g. hit the ball hard twice and had nothing to show for it',
    rows: 2,
  },
  {
    key: 'outs',
    label: 'Anything about the at-bats that were outs?',
    placeholder: 'e.g. both strikeouts were called strikes on the outside corner',
    rows: 2,
  },
  {
    key: 'context',
    label: 'Anything off — tired, hurt, distracted, first game of the day?',
    placeholder: 'e.g. 8am game, second of a doubleheader',
    rows: 2,
  },
]

export const ENTRY_TYPES: Record<EntryType, EntryTypeConfig> = {
  game: {
    type: 'game',
    label: 'Game',
    hint: 'Upload the GameChanger box score — multiple games from a weekend is fine.',
    screenshots: 'expected',
    screenshotHint: 'Box score screenshots. Add all of the weekend\'s games at once.',
    parses: true,
    prompts: GAME_PROMPTS,
  },
  scrimmage: {
    type: 'scrimmage',
    label: 'Scrimmage',
    hint: 'Same as a game, weighted a little lighter.',
    screenshots: 'optional',
    screenshotHint: 'Optional — add a box score if you have one.',
    parses: true,
    prompts: GAME_PROMPTS,
  },
  practice: {
    type: 'practice',
    label: 'Practice',
    hint: 'What you worked on and what you saw.',
    screenshots: 'none',
    parses: false,
    capturesDuration: true,
    prompts: [
      {
        key: 'worked_on',
        label: 'What did you work on?',
        placeholder: 'e.g. ground ball footwork, tee work on outside pitches',
        rows: 2,
      },
      {
        key: 'unseen',
        label: 'What did you see?',
        placeholder: 'e.g. much better on the forehand side, still backhanding everything',
        rows: 3,
      },
    ],
  },
  home_session: {
    type: 'home_session',
    label: 'Home Session',
    hint: "Logging this is the check-in — it's how we know whether the plan is being run.",
    screenshots: 'none',
    parses: false,
    capturesDuration: true,
    linksToPrescription: true,
    prompts: [
      {
        key: 'worked_on',
        label: 'What did you run?',
        placeholder: 'e.g. 3 rounds of the high tee drill, about 40 swings',
        rows: 2,
      },
      {
        key: 'how_it_went',
        label: 'How did it go?',
        placeholder: 'e.g. first 10 were ugly, then it clicked',
        rows: 2,
      },
    ],
  },
  lesson: {
    type: 'lesson',
    label: 'Lesson',
    hint: 'A paid instructor watched in person — their read outranks everything else we have.',
    screenshots: 'none',
    parses: false,
    capturesInstructor: true,
    capturesDuration: true,
    prompts: [
      {
        key: 'instructor_diagnosis',
        label: 'What did the instructor say to work on?',
        placeholder: 'e.g. said his front shoulder is flying open before contact',
        rows: 3,
      },
      {
        key: 'home_drills',
        label: 'Any drills to do at home?',
        placeholder: 'e.g. wall drill, 5 minutes a day',
        rows: 2,
      },
    ],
  },
}

export const ENTRY_TYPE_ORDER: EntryType[] = [
  'game', 'practice', 'home_session', 'lesson', 'scrimmage',
]

// ── Smart defaults ─────────────────────────────────────
// Youth games happen on weekends. Defaulting the date to the most recent
// Saturday means the field is usually already correct on Sunday/Monday —
// the moment the user is most likely to be logging.

export function mostRecentWeekend(today = new Date()): string {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const day = d.getDay() // 0 Sun .. 6 Sat
  // On Sun/Mon/Tue, the relevant weekend is the Saturday just past.
  // Later in the week, default to today — they're logging a practice.
  if (day === 0) d.setDate(d.getDate() - 1)        // Sunday  -> Saturday
  else if (day === 1) d.setDate(d.getDate() - 2)   // Monday  -> Saturday
  else if (day === 2) d.setDate(d.getDate() - 3)   // Tuesday -> Saturday
  return toDateStr(d)
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function todayStr(): string {
  return toDateStr(new Date())
}

// Practice-first teams (a coach logs practices far more often than games)
// vs a Home account tracking one player's games.
export function defaultEntryType(playerCount: number): EntryType {
  return playerCount > 2 ? 'practice' : 'game'
}

// ── Roster matching ────────────────────────────────────
// Box scores print "C. Smith" where the roster says "Charlie Smith". Reuses
// the scouting matcher so both surfaces behave the same way.

export interface RosterCandidate {
  team_player_id: string
  name: string
  jersey_number?: string | null
}

export interface RosterMatch {
  team_player_id: string | null
  confidence: 'exact' | 'strong' | 'possible' | 'none'
}

export function matchRosterPlayer(
  sourceName: string,
  jerseyNumber: string | null | undefined,
  roster: RosterCandidate[],
  savedMappings: Record<string, string> = {}
): RosterMatch {
  // A confirmed mapping from a previous import always wins — the coach
  // already told us the answer once.
  const saved = savedMappings[sourceName.trim().toLowerCase()]
  if (saved && roster.some(r => r.team_player_id === saved)) {
    return { team_player_id: saved, confidence: 'exact' }
  }

  const jersey = jerseyNumber ? String(jerseyNumber).trim() : null
  let best: RosterCandidate | null = null
  let bestSim = 0
  let bestJersey = false

  for (const candidate of roster) {
    const sim = nameSimilarity(sourceName, candidate.name)
    const jerseyMatch =
      !!jersey && !!candidate.jersey_number &&
      String(candidate.jersey_number).trim() === jersey
    if (sim > bestSim || (sim === bestSim && jerseyMatch && !bestJersey)) {
      best = candidate
      bestSim = sim
      bestJersey = jerseyMatch
    }
  }

  if (!best) return { team_player_id: null, confidence: 'none' }
  if (bestSim >= 0.999) return { team_player_id: best.team_player_id, confidence: 'exact' }
  if (bestJersey && bestSim >= 0.7) return { team_player_id: best.team_player_id, confidence: 'strong' }
  if (bestSim >= 0.9) return { team_player_id: best.team_player_id, confidence: 'strong' }
  // Plausible but not certain — surface it pre-selected but flagged, so the
  // coach can correct it rather than having it silently attached.
  if (bestSim >= 0.6) return { team_player_id: best.team_player_id, confidence: 'possible' }
  return { team_player_id: null, confidence: 'none' }
}

// ── Batting line normalization ─────────────────────────
// Vision output keys vary; map them onto player_game_stats columns.

export interface NormalizedStatLine {
  at_bats: number | null
  hits: number | null
  doubles: number | null
  triples: number | null
  home_runs: number | null
  rbi: number | null
  runs: number | null
  walks: number | null
  strikeouts: number | null
  stolen_bases: number | null
  errors: number | null
  innings_pitched: number | null
  pitches_thrown: number | null
  pitching_strikeouts: number | null
  pitching_walks: number | null
}

function num(line: any, ...keys: string[]): number | null {
  if (!line) return null
  for (const k of keys) {
    const v = line[k] ?? line[k.toUpperCase()] ?? line[k.toLowerCase()]
    if (v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) return Number(v)
  }
  return null
}

export function normalizeStatLine(line: any): NormalizedStatLine {
  return {
    at_bats: num(line, 'ab', 'at_bats'),
    hits: num(line, 'h', 'hits'),
    doubles: num(line, '2b', 'doubles'),
    triples: num(line, '3b', 'triples'),
    home_runs: num(line, 'hr', 'home_runs'),
    rbi: num(line, 'rbi'),
    runs: num(line, 'r', 'runs'),
    walks: num(line, 'bb', 'walks'),
    strikeouts: num(line, 'k', 'so', 'strikeouts'),
    stolen_bases: num(line, 'sb', 'stolen_bases'),
    errors: num(line, 'e', 'errors'),
    innings_pitched: num(line, 'ip', 'innings_pitched'),
    pitches_thrown: num(line, 'pitches', 'pitches_thrown'),
    pitching_strikeouts: num(line, 'pitching_k', 'pitching_strikeouts'),
    pitching_walks: num(line, 'pitching_bb', 'pitching_walks'),
  }
}
