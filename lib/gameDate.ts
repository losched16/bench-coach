// When was this game, actually?
//
// A coach typed July 14 2026 into the date field, uploaded a box score, and the
// entry saved as 2024 — so every downstream surface called the data "over a
// year old" and discounted it.
//
// THE RULE NOW: the date the coach selects is the date. The capture form does
// not read a date out of an image at all, ever. They pick one deliberately,
// and a year guessed off a screenshot that printed "Jul 14" with no year is
// not a reason to overrule them.
//
// What is left here guards the OTHER copy of the date — the parsed value kept
// in the raw parse record. GameChanger prints days without years constantly, a
// model with no clock has to invent one, and it lands near its training data.
// So the prompt is given today's date and told never to guess, and anything
// impossible that comes back anyway is stripped rather than stored.

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
