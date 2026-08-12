// When was this game, actually?
//
// A coach typed July 14 2026 into the date field, uploaded a box score, and the
// entry saved as 2024 — so every downstream surface called the data "over a
// year old" and discounted it. Two independent faults, both worth naming.
//
// THE PARSED DATE OVERWROTE THE TYPED ONE. The capture screen did
// `if (parsed.game_date) setOccurredOn(parsed.game_date)`, unconditionally.
// A human who has told you the date is the best source in the room, and a
// guess from a screenshot is the worst; that assignment had it backwards.
//
// THE MODEL WAS NEVER TOLD WHAT TODAY IS. GameChanger prints "Jul 14" with no
// year all over its box scores. Asked to produce YYYY-MM-DD from that, a model
// with no clock has to invent a year, and it lands near its training data
// rather than near the coach's season.
//
// So: never guess a year, and never accept one that cannot be true.

/** Today in the local timezone, as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** Parse YYYY-MM-DD strictly. Returns null for anything else. */
export function parseISODate(value: unknown): { y: number; m: number; d: number } | null {
  const m = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  // Reject 31 February and friends — a date that does not exist is a parse
  // error wearing a valid-looking mask.
  const probe = new Date(Date.UTC(y, mo - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null
  }
  return { y, m: mo, d }
}

/** Whole days from `a` to `b`. Negative when b is before a. */
export function daysBetween(a: string, b: string): number | null {
  const pa = parseISODate(a), pb = parseISODate(b)
  if (!pa || !pb) return null
  const ms = Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)
  return Math.round(ms / 86_400_000)
}

export type DateVerdict = 'ok' | 'future' | 'ancient' | 'unreadable'

export interface DateCheck {
  verdict: DateVerdict
  /** Null unless the verdict is 'ok'. A date we do not trust is not a date. */
  date: string | null
  /** Coach-facing, and only set when something is wrong. */
  note: string | null
}

// A screenshot from tomorrow is a misread, not a fixture list. Two days of
// slack covers timezone skew between the phone that took it and the server.
const FUTURE_SLACK_DAYS = 2
// Youth scouting has a shelf life. Three seasons back is generous for
// something a coach is uploading today, and it still catches the failure that
// matters: a model inventing a year from its own training data.
const MAX_AGE_DAYS = 365 * 3

/**
 * Is this parsed date usable?
 *
 * Deliberately strict. A wrong date is worse than no date: it silently ages
 * the record, and every surface that reasons about staleness then discounts
 * good scouting as historical. Returning null makes the coach's own entry win,
 * which is the right outcome anyway.
 */
export function checkGameDate(value: unknown, today: string = todayISO()): DateCheck {
  const parsed = parseISODate(value)
  if (!parsed) return { verdict: 'unreadable', date: null, note: null }

  const iso = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  const delta = daysBetween(today, iso)
  if (delta === null) return { verdict: 'unreadable', date: null, note: null }

  if (delta > FUTURE_SLACK_DAYS) {
    return {
      verdict: 'future',
      date: null,
      note: `The date read from the image (${iso}) is in the future, so it was ignored.`,
    }
  }
  if (-delta > MAX_AGE_DAYS) {
    return {
      verdict: 'ancient',
      date: null,
      note: `The date read from the image (${iso}) is years old — box scores often print the day without a year, so this was ignored. Set the date yourself if the entry needs one.`,
    }
  }
  return { verdict: 'ok', date: iso, note: null }
}

/**
 * What to do with a parsed date when the coach has already set one.
 *
 * The coach always wins. This only decides whether to mention that the image
 * disagreed — worth saying when they might have picked the wrong day, and pure
 * noise when the two agree.
 */
export function reconcileDate(
  parsedDate: unknown,
  coachDate: string | null,
  coachTouched: boolean,
  today: string = todayISO()
): { use: string | null; suggestion: string | null; note: string | null } {
  const check = checkGameDate(parsedDate, today)

  // Nothing usable came out of the image.
  if (!check.date) return { use: null, suggestion: null, note: check.note }

  // They have not touched the field, so the parsed date is an improvement on a
  // default of "today".
  if (!coachTouched) return { use: check.date, suggestion: null, note: null }

  // They set it themselves. Keep theirs, and only speak up on a real conflict.
  if (coachDate && check.date !== coachDate) {
    return {
      use: null,
      suggestion: check.date,
      note: `You entered ${coachDate}, but the image reads as ${check.date}.`,
    }
  }
  return { use: null, suggestion: null, note: null }
}
