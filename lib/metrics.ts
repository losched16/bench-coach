// Reading a measurement honestly.
//
// This is the only objective evidence in the product. Box scores are scored by
// a volunteer with a phone and coach notes are subjective by design; a number
// off a tee is neither. That makes it the cleanest way to answer the question
// the whole loop exists to answer — did the work move it?
//
// Which also makes it the easiest thing to lie with. Two readings is a line
// through noise. A single good day at nine years old is a single good day. The
// rules that keep this honest live here rather than in a prompt, so the chart
// and the AI can't disagree about what the data supports.

export type MetricShape = 'measurement' | 'challenge'
export type MetricDirection = 'higher' | 'lower'

export interface MetricType {
  id: string
  coach_id: string | null
  slug: string
  label: string
  unit: string | null
  shape: MetricShape
  direction: MetricDirection
  default_attempts: number | null
  hint: string | null
  sort_order: number
  archived?: boolean
}

export interface MetricReading {
  id: string
  metric_type_id: string | null
  metric: string
  value: number
  unit: string | null
  attempts: number | null
  successes: number | null
  measured_on: string      // YYYY-MM-DD
  note: string | null
}

// Below this, a chart is a rorschach test. Three sessions is the minimum at
// which "it's moving" is a claim rather than a hope.
export const MIN_SESSIONS_FOR_TREND = 3

// ── Sessions ───────────────────────────────────────────
// A session is a date. Ten swings on Tuesday is one session with ten readings,
// and both numbers matter: coaches quote the best, but the average is the one
// that actually tracks whether something changed.

export interface MetricSession {
  date: string
  best: number
  average: number
  count: number
  attempts: number | null
  successes: number | null
}

export function groupIntoSessions(
  readings: MetricReading[],
  direction: MetricDirection
): MetricSession[] {
  const byDate = new Map<string, MetricReading[]>()
  for (const r of readings) {
    if (!r.measured_on || r.value == null || isNaN(Number(r.value))) continue
    const list = byDate.get(r.measured_on) || []
    list.push(r)
    byDate.set(r.measured_on, list)
  }

  return Array.from(byDate.entries())
    .map(([date, list]) => {
      const values = list.map(r => Number(r.value))
      const sum = values.reduce((a, b) => a + b, 0)
      // "Best" depends on which way is good — a 4.2 home-to-first beats a 4.6.
      const best = direction === 'lower' ? Math.min(...values) : Math.max(...values)
      const attempts = list.reduce((a, r) => a + (r.attempts || 0), 0) || null
      const successes = list.reduce((a, r) => a + (r.successes || 0), 0) || null
      return {
        date,
        best,
        average: sum / values.length,
        count: values.length,
        attempts,
        successes,
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ── Trend ──────────────────────────────────────────────

export type TrendVerdict = 'improving' | 'declining' | 'flat' | 'not_enough_data'

export interface MetricTrend {
  verdict: TrendVerdict
  sessions: number
  first: MetricSession | null
  latest: MetricSession | null
  // Signed change in raw units, positive meaning "the number went up" —
  // NOT "it got better". Direction decides what that means.
  change: number
  // Change expressed as improvement, so positive is always good news.
  improvement: number
  percentChange: number
  // Plain-English, safe to show or hand to a model verbatim.
  summary: string
}

export function computeTrend(
  sessions: MetricSession[],
  type: Pick<MetricType, 'label' | 'unit' | 'direction' | 'shape'>,
  use: 'best' | 'average' = 'average'
): MetricTrend {
  const pick = (s: MetricSession) => (use === 'best' ? s.best : s.average)
  const first = sessions[0] || null
  const latest = sessions[sessions.length - 1] || null

  if (sessions.length < MIN_SESSIONS_FOR_TREND) {
    return {
      verdict: 'not_enough_data',
      sessions: sessions.length,
      first, latest, change: 0, improvement: 0, percentChange: 0,
      summary: sessions.length === 0
        ? `No ${type.label.toLowerCase()} logged yet.`
        : `Only ${sessions.length} session${sessions.length === 1 ? '' : 's'} of ${type.label.toLowerCase()} — ` +
          `not enough to call a direction yet. ${MIN_SESSIONS_FOR_TREND - sessions.length} more and it means something.`,
    }
  }

  const start = pick(first!)
  const end = pick(latest!)
  const change = end - start
  const improvement = type.direction === 'lower' ? -change : change
  const percentChange = start !== 0 ? (change / Math.abs(start)) * 100 : 0

  // Youth numbers wobble. A 2% move over a handful of sessions is measurement
  // noise — the tee was a bit higher, the gun was a bit closer — and calling
  // that "improving" is how a coach stops believing the trend line.
  const meaningful = Math.abs(percentChange) >= 3
  const verdict: TrendVerdict = !meaningful ? 'flat' : improvement > 0 ? 'improving' : 'declining'

  const unit = type.shape === 'challenge' ? '%' : (type.unit ? ` ${type.unit}` : '')
  const fmt = (n: number) => (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)).replace(/\.00$/, '')

  const span = `${sessions.length} sessions between ${first!.date} and ${latest!.date}`
  const summary =
    verdict === 'flat'
      ? `${type.label} is flat across ${span} — ${fmt(start)}${unit} to ${fmt(end)}${unit}, which is inside the noise.`
      : verdict === 'improving'
        ? `${type.label} improved across ${span}: ${fmt(start)}${unit} to ${fmt(end)}${unit}.`
        : `${type.label} moved the wrong way across ${span}: ${fmt(start)}${unit} to ${fmt(end)}${unit}.`

  return { verdict, sessions: sessions.length, first, latest, change, improvement, percentChange, summary }
}

// ── Formatting ─────────────────────────────────────────

export function formatValue(
  value: number,
  type: Pick<MetricType, 'unit' | 'shape'>
): string {
  if (type.shape === 'challenge') return `${Math.round(value)}%`
  const rounded = Math.abs(value) >= 10 ? value.toFixed(1) : value.toFixed(2)
  return `${rounded.replace(/\.?0+$/, '')}${type.unit ? ` ${type.unit}` : ''}`
}

// A challenge stores its percentage in `value` so one chart serves both
// shapes; this is where that conversion is defined.
export function challengeValue(successes: number, attempts: number): number {
  if (!attempts || attempts <= 0) return 0
  return Math.max(0, Math.min(100, (successes / attempts) * 100))
}

// ── For the prompt ─────────────────────────────────────
// Rendered rather than dumped: the model gets the trend verdict and the
// sample-size caveat as words, so it can't quietly build a story out of two
// readings taken a day apart.

export function renderMetricsForPrompt(
  groups: Array<{ type: MetricType; sessions: MetricSession[] }>
): string {
  if (groups.length === 0) return ''

  const blocks = groups.map(({ type, sessions }) => {
    const trend = computeTrend(sessions, type)
    const unit = type.shape === 'challenge' ? '%' : (type.unit ? ` ${type.unit}` : '')
    const recent = sessions.slice(-6).map(s =>
      `      ${s.date}: ${formatValue(s.average, type)}` +
      (s.count > 1 ? ` avg of ${s.count} (best ${formatValue(s.best, type)})` : '') +
      (s.attempts ? ` — ${s.successes}/${s.attempts}` : '')
    ).join('\n')

    return `  ${type.label}${type.direction === 'lower' ? ' (lower is better)' : ''}\n` +
      `      ${trend.summary}\n${recent}`
  })

  return `MEASUREMENTS (objective — the one thing here that isn't a judgment call):\n` +
    blocks.join('\n\n') +
    `\n\n  Read these as trends, never single sessions. A jump on one day at this age is a good day, ` +
    `not progress. Anything with fewer than ${MIN_SESSIONS_FOR_TREND} sessions is not yet a direction — say so ` +
    `rather than implying one.`
}
