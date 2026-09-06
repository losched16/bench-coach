// What the coach has already written down about a player.
//
// A report used to start blank, which meant a coach re-typing in September
// the things they had been recording since April — a note after practice, a
// priority they set and resolved, a sixty-yard time in the spring and again in
// August. BenchCoach had all of it and offered none of it.
//
// This gathers it into one dated list the coach can pick from. Three rules:
//
//   EVERYTHING HERE IS THE COACH'S OWN RECORD. Notes, observations, priorities,
//   measurements — each was written or entered by the coaching staff. That is
//   what makes it legitimate raw material for a document to a family, and
//   what keeps the model on the right side of "AI assists, the coach
//   approves": it can only ever be handed things the coach already said.
//
//   NOTHING IS INCLUDED BY SILENCE. Items arrive with a suggested destination
//   and, for a coach's own explicit priorities, pre-ticked — but nothing
//   reaches the report until the coach presses a button that says so.
//
//   PRIVATE STAYS PRIVATE. Traits are persistent notes about a child's
//   behaviour, and some of them are the kind a coach writes precisely because
//   nobody else will read them. They are shown, marked, and never pre-ticked.
//   Roster skill ratings are shown for context and cannot be included at all —
//   the report does not rank children.
//
// This module is the PURE half — types, windowing, measurement lines, note
// formatting, the pre-selection rules — with no I/O and no server-only
// imports, because the wizard and the picker import it into the browser.
// The gathering lives in playerReportSourcesStore.ts, the same split as
// playerReports.ts / playerReportStore.ts, and for the same reason: one
// import of a server module from a client component takes the build down.

import { formatReportDate } from './playerReports'
import { focusAreaLabel, resolveFocusArea } from './focusAreas'

export type SourceKind = 'priority' | 'note' | 'observation' | 'entry' | 'measurement' | 'trait'
export type SourceTarget = 'strengths' | 'development' | 'closing'

export interface SourceItem {
  /** `${kind}:${row id}` — stable across reloads, unique across kinds. */
  id: string
  kind: SourceKind
  /** YYYY-MM-DD, or null when the row carries no date. */
  date: string | null
  /** The short line the picker shows. */
  title: string
  /** What goes into the report or the draft — the coach's words, or a factual line. */
  text: string
  /** Shown with a warning and never pre-selected. */
  sensitive: boolean
  suggestedTarget: SourceTarget | null
  preselected: boolean
  /** Only on priorities: enough to become a development area with its drills ready. */
  priority?: {
    problemSlug: string | null
    focusArea: string | null
    status: string
    label: string
  }
}

export interface SourceBundle {
  window: { from: string | null; to: string; allSeasons: boolean }
  items: SourceItem[]
  /** Roster ratings, for the coach's eyes only. Never printed. */
  skillLevels: Record<string, number | null> | null
  counts: Partial<Record<SourceKind, number>>
}

/** What a selected priority becomes on the Development step. */
export interface FocusAreaSeed {
  problemSlug: string | null
  focusArea: string | null
  label: string
  coachNotes: string
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The season's dates, or the best available stand-in.
 *
 * A report is about a season, so by default only that season's record is
 * offered. seasons.start_date/end_date are optional in this schema; a season
 * with neither falls back to "since the team was created", which is when the
 * coach could first have recorded anything.
 */
export function seasonWindow(
  season: { start_date?: string | null; end_date?: string | null } | null | undefined,
  teamCreatedAt: string | null | undefined,
  opts: { allSeasons?: boolean; today?: Date } = {}
): { from: string | null; to: string } {
  const today = ymd(opts.today || new Date())
  if (opts.allSeasons) return { from: null, to: today }
  const from = season?.start_date?.slice(0, 10)
    || (teamCreatedAt ? String(teamCreatedAt).slice(0, 10) : null)
  const to = season?.end_date?.slice(0, 10) || today
  return { from, to: to < today ? today : to }
}

/** Undated rows are kept: we cannot exclude what we cannot date. */
export function inWindow(date: string | null | undefined, w: { from: string | null; to: string }): boolean {
  if (!date) return true
  const d = date.slice(0, 10)
  if (w.from && d < w.from) return false
  return d <= w.to
}

const LEGACY_METRICS: Record<string, { label: string; direction: 'higher' | 'lower' }> = {
  exit_velo: { label: 'Exit velocity', direction: 'higher' },
  throw_velo: { label: 'Throwing velocity', direction: 'higher' },
  home_to_first: { label: 'Home to first', direction: 'lower' },
  sixty: { label: '60-yard dash', direction: 'lower' },
}

export function humanizeMetric(slug: string | null | undefined): string {
  const s = String(slug || '').trim()
  if (!s) return 'Measurement'
  if (LEGACY_METRICS[s]) return LEGACY_METRICS[s].label
  return s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
}

export interface MetricReading {
  metric: string | null
  metric_type_id?: string | null
  value: number | string
  unit?: string | null
  measured_on: string
}

export interface MetricType {
  id: string
  label: string
  unit?: string | null
  direction?: 'higher' | 'lower' | null
}

function fmtValue(v: number | string, unit: string | null | undefined): string {
  const n = Number(v)
  const shown = Number.isFinite(n) ? String(Math.round(n * 100) / 100) : String(v)
  return unit ? `${shown} ${unit}` : shown
}

/**
 * One item per measurement, as a factual line: first reading → latest.
 *
 * "60-yard dash: 9.8 s (April 3) → 9.1 s (August 20) — lower is better."
 * The direction is stated so a draft that says "faster" is grounded in the
 * item rather than in the model's guess about what the number means. No
 * "improved" is written here; the coach and the draft can say it, the app
 * only says what was measured.
 */
export function measurementItems(readings: MetricReading[], types: MetricType[] = []): SourceItem[] {
  const typeById = new Map(types.map(t => [t.id, t]))
  const groups = new Map<string, MetricReading[]>()
  for (const r of readings) {
    const key = r.metric_type_id || r.metric || 'unknown'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(r)
  }

  const out: SourceItem[] = []
  for (const [key, rows] of Array.from(groups.entries())) {
    const sorted = [...rows].sort((a, b) => String(a.measured_on).localeCompare(String(b.measured_on)))
    const first = sorted[0], last = sorted[sorted.length - 1]
    const type = first.metric_type_id ? typeById.get(first.metric_type_id) : undefined
    const label = type?.label || humanizeMetric(first.metric)
    const unit = type?.unit ?? first.unit ?? null
    const direction = type?.direction || (first.metric ? LEGACY_METRICS[first.metric]?.direction : undefined)
    const better = direction ? ` — ${direction} is better` : ''

    const text = sorted.length > 1
      ? `${label}: ${fmtValue(first.value, unit)} (${formatReportDate(first.measured_on)}) → ${fmtValue(last.value, unit)} (${formatReportDate(last.measured_on)})${better}`
      : `${label}: ${fmtValue(first.value, unit)} (${formatReportDate(first.measured_on)})${better}`

    out.push({
      id: `measurement:${key}`,
      kind: 'measurement',
      date: String(last.measured_on).slice(0, 10),
      title: `${label} · ${sorted.length} reading${sorted.length === 1 ? '' : 's'}`,
      text,
      sensitive: false,
      suggestedTarget: null,
      preselected: false,
    })
  }
  return out
}

/**
 * A priority the coach set, with how it turned out.
 *
 * The one source that is already report-shaped: it names a catalogued problem
 * (so a development area built from it has its drills ready), it says what the
 * coach wanted to see, and its status says whether they saw it. Active ones
 * are pre-ticked into Development and resolved ones into Strengths — these are
 * the coach's own explicit decisions about this player, not inferences.
 */
export function priorityItem(
  p: {
    id: string
    priority?: string | null
    summary?: string | null
    success_criteria?: string | null
    problem_id?: string | null
    focus_area?: string | null
    status: string
    outcome_note?: string | null
    issued_at?: string | null
    created_at?: string | null
    resolved_at?: string | null
  },
  taxonomyLabel: (slug: string) => string | null,
  checkinNotes: string[] = []
): SourceItem {
  const catalogued = p.problem_id ? taxonomyLabel(p.problem_id) : null
  const label = catalogued
    || (p.focus_area ? `${focusAreaLabel(p.focus_area)} priority` : 'Priority')
  const status = String(p.status || 'active')

  const parts = [
    p.priority ? String(p.priority).trim() : null,
    p.success_criteria ? `What we wanted to see: ${String(p.success_criteria).trim()}` : null,
    ...checkinNotes.map(n => `Check-in: ${n}`),
    p.outcome_note ? `Outcome: ${String(p.outcome_note).trim()}` : null,
    status === 'resolved' ? 'Marked resolved.' : status === 'stalled' ? 'Marked stalled.' : null,
  ].filter(Boolean)

  const suggestedTarget: SourceTarget | null =
    status === 'resolved' ? 'strengths'
      : status === 'active' || status === 'stalled' ? 'development'
      : null

  return {
    id: `priority:${p.id}`,
    kind: 'priority',
    date: (p.resolved_at || p.issued_at || p.created_at || '').slice(0, 10) || null,
    title: `${label} · ${status}`,
    text: parts.join(' '),
    sensitive: false,
    suggestedTarget,
    preselected: status === 'active' || status === 'resolved',
    priority: {
      problemSlug: p.problem_id || null,
      focusArea: p.focus_area || resolveFocusArea(null, p.priority || label),
      status,
      label,
    },
  }
}

export function noteItem(n: { id: string; note: string; created_at?: string | null }): SourceItem {
  return {
    id: `note:${n.id}`, kind: 'note',
    date: (n.created_at || '').slice(0, 10) || null,
    title: 'Player note',
    text: String(n.note || '').trim(),
    sensitive: false, suggestedTarget: null, preselected: false,
  }
}

export function observationItem(o: {
  id: string; body: string; observed_on?: string | null; created_at?: string | null; prompt_key?: string | null
}): SourceItem {
  return {
    id: `observation:${o.id}`, kind: 'observation',
    date: (o.observed_on || o.created_at || '').slice(0, 10) || null,
    title: o.prompt_key ? `Observation · ${String(o.prompt_key).replace(/_/g, ' ')}` : 'Observation',
    text: String(o.body || '').trim(),
    sensitive: false, suggestedTarget: null, preselected: false,
  }
}

const ENTRY_LABEL: Record<string, string> = {
  game: 'Game', practice: 'Practice', home_session: 'Home session', lesson: 'Lesson', scrimmage: 'Scrimmage',
}

/** Only entries that carry words. A bare "game on the 14th" is not a source. */
export function entryItem(e: {
  id: string; entry_type: string; occurred_on: string; title?: string | null
  instructor_name?: string | null; duration_min?: number | null
}): SourceItem | null {
  const title = String(e.title || '').trim()
  const instructor = e.instructor_name ? ` with ${String(e.instructor_name).trim()}` : ''
  if (!title && !instructor) return null
  const kind = ENTRY_LABEL[e.entry_type] || 'Entry'
  return {
    id: `entry:${e.id}`, kind: 'entry',
    date: String(e.occurred_on).slice(0, 10),
    title: `${kind}${instructor}`,
    text: title || `${kind}${instructor}`,
    sensitive: false, suggestedTarget: null, preselected: false,
  }
}

/** Never pre-selected, always marked. See the header. */
export function traitItem(t: { id: string; note: string; created_at?: string | null }): SourceItem {
  return {
    id: `trait:${t.id}`, kind: 'trait',
    date: (t.created_at || '').slice(0, 10) || null,
    title: 'Trait · private note',
    text: String(t.note || '').trim(),
    sensitive: true, suggestedTarget: null, preselected: false,
  }
}

/**
 * Selected items as the coach's own dated notes, ready for a textarea.
 *
 * The "add as notes" path: no model, no rewriting, just the record in one
 * place with its dates, for the coach to shape or hand to Improve wording.
 */
export function itemsToNotes(items: SourceItem[]): string {
  const lines = items
    .filter(it => it.text.trim())
    .map(it => `• ${it.date ? formatReportDate(it.date) + ' — ' : ''}${it.text.trim()}`)
  return lines.join(String.fromCharCode(10))
}

/**
 * A selected priority, as a development area the coach can edit.
 *
 * Carries the taxonomy slug so the Drills step can suggest immediately; seeds
 * the wording with the coach's own priority sentence so the box is not empty
 * — that sentence is theirs, and Improve wording is one tap away.
 */
export function priorityToFocusArea(item: SourceItem): FocusAreaSeed | null {
  if (item.kind !== 'priority' || !item.priority) return null
  return {
    problemSlug: item.priority.problemSlug,
    focusArea: item.priority.focusArea,
    label: item.priority.label,
    coachNotes: item.text,
  }
}

/** Newest first; undated last. */
export function sortItems(items: SourceItem[]): SourceItem[] {
  return [...items].sort((a, b) => {
    if (!a.date && !b.date) return 0
    if (!a.date) return 1
    if (!b.date) return -1
    return b.date.localeCompare(a.date)
  })
}
