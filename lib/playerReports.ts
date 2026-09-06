// Player development reports — the shared shape of one.
//
// A report is a document a coach hands to a family. Everything about how it is
// built follows from that one fact:
//
//   * It says only what the coach approved. There are no model-authored
//     claims in it, because a sentence about somebody's child is not a place
//     to be approximately right.
//   * Once sent, it does not change. A finalized report is frozen and edits
//     start a revision, so the PDF in a parent's inbox and the report in the
//     app can never quietly disagree.
//   * Empty means absent. A coach with strengths, one development area and no
//     closing comment has written a real report; the document must not print
//     "Coach's Comments" above nothing.
//
// This module holds the parts both the API and the PDF need, so the two cannot
// come to different conclusions about what a report says.

import { FOCUS_AREAS, isFocusArea, resolveFocusArea, type FocusArea } from './focusAreas'
import { watchUrl } from './drillVideo'

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------
// Three, deliberately. A coach choosing between "Midseason" and "End of
// Season" is answering a question they already know the answer to; a coach
// choosing between eleven report types is doing admin.

export type ReportType = 'midseason' | 'end_of_season' | 'general'
export type ReportStatus = 'draft' | 'final'

export const REPORT_TYPES: Array<{ key: ReportType; label: string; hint: string }> = [
  { key: 'midseason', label: 'Midseason Development Report',
    hint: 'Where they are partway through, and what to work on for the rest of it' },
  { key: 'end_of_season', label: 'End-of-Season Development Report',
    hint: 'How the season went, and what to take into the off-season' },
  { key: 'general', label: 'General Player Development Report',
    hint: 'Any time — after a stretch of practices, or before a break' },
]

export function reportTypeLabel(type: string | null | undefined): string {
  return REPORT_TYPES.find(t => t.key === type)?.label || 'Player Development Report'
}

export function isReportType(v: unknown): v is ReportType {
  return REPORT_TYPES.some(t => t.key === v)
}

// ---------------------------------------------------------------------------
// The stored shapes
// ---------------------------------------------------------------------------

/** Team/season/coach names as at finalization. See migration 054. */
export interface ReportContext {
  player_name: string
  team_name: string | null
  age_group: string | null
  season_name: string | null
  coach_name: string | null
}

/**
 * What the report prints about a drill, copied from drill_resources when the
 * coach adds it.
 *
 * Only the printed fields. Copying all 38 columns would mean every column
 * added in future arrives silently empty in old snapshots, which is a worse
 * kind of wrong than not having it.
 */
export interface DrillSnapshot {
  drill_name: string
  description: string | null
  /** What it trains, one line, from the drill's own metadata. */
  focus: string | null
  channel: string | null
  video_url: string | null
  /** Seconds into the video — only when the library recorded one AND said where it came from. */
  video_start_seconds: number | null
  /** How that start was determined (chapter, description, manual-review, imported). See migration 049. */
  video_start_source: string | null
  reps_guidance: string | null
  frequency_guidance: string | null
}

export interface ReportFocusArea {
  id: string
  problem_slug: string | null
  focus_area: string | null
  label: string
  coach_notes: string | null
  approved_content: string | null
  sort_order: number
}

export interface ReportDrill {
  id: string
  focus_area_id: string | null
  drill_id: string | null
  snapshot: DrillSnapshot
  recommendation_reason: string | null
  source: 'recommended' | 'manual'
  include_video: boolean
  sort_order: number
}

export interface PlayerReport {
  id: string
  team_id: string
  player_id: string
  coach_id: string
  report_type: ReportType
  status: ReportStatus
  report_date: string
  context: ReportContext | null
  strengths_content: string | null
  development_intro: string | null
  closing_content: string | null
  strength_areas: string[]
  revision: number
  revision_of: string | null
  created_at: string
  updated_at: string
  finalized_at: string | null
}

export interface FullReport extends PlayerReport {
  focusAreas: ReportFocusArea[]
  drills: ReportDrill[]
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
// A report is a page or two. These are not editorial opinions about how much a
// coach may say — they stop a paste of somebody's entire season notes turning
// into a 40-page PDF and a very slow request.

export const MAX_SECTION_CHARS = 4000
export const MAX_FOCUS_AREAS = 3
export const MAX_DRILLS = 12

/** Trim and cap a free-text field, or null if there is nothing in it. */
export function cleanText(value: unknown, max = MAX_SECTION_CHARS): string | null {
  if (typeof value !== 'string') return null
  const t = value.trim()
  if (!t) return null
  return t.length > max ? t.slice(0, max) : t
}

/** Keep only real focus-area keys, deduplicated, in the canonical order. */
export function cleanStrengthAreas(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const v of value) if (isFocusArea(v)) seen.add(v)
  return (Object.keys(FOCUS_AREAS) as FocusArea[]).filter(k => seen.has(k))
}

// ---------------------------------------------------------------------------
// Video links
// ---------------------------------------------------------------------------

/**
 * Is this a link we are willing to put in a document going to a family?
 *
 * The URL comes out of our own drill library, so this is not defence against
 * an attacker so much as against a bad row: a `javascript:` or `data:` href in
 * a PDF is a live hazard, and a relative path is a broken link with our name
 * on it. http and https only.
 */
export function isSafeUrl(url: string | null | undefined): boolean {
  if (!url) return false
  try {
    const p = new URL(url)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * The link the report prints for a drill's video.
 *
 * The URL was built by lib/drillVideo's watchUrl() when the drill was
 * snapshotted, so any timestamp is already in it. All that is left to decide
 * here is whether it is safe to put in a document — nothing is rebuilt, and
 * nothing is guessed.
 */
export function drillVideoLink(snapshot: DrillSnapshot | null | undefined): string | null {
  const url = snapshot?.video_url
  return isSafeUrl(url) ? (url as string) : null
}

/** "Watch Drill", never a 90-character URL printed across a page. */
export function videoLinkLabel(snapshot: DrillSnapshot): string {
  return snapshot.channel ? `Watch drill (${snapshot.channel})` : 'Watch drill'
}

// ---------------------------------------------------------------------------
// Building a snapshot
// ---------------------------------------------------------------------------

/**
 * Copy the printable fields off a live drill_resources row.
 *
 * Called when the coach adds the drill and refreshed while the report is still
 * a draft. After finalization it is never written again, which is what makes a
 * report from September 2026 still the report the coach sent.
 */
export function drillSnapshot(drill: any): DrillSnapshot {
  // A timestamp counts only when the library also says where it came from.
  // Migration 049 added youtube_start_source precisely because a wrong
  // segment start is worse than none — at 0:00 a parent knows where they are;
  // forty seconds into the wrong drill they decide the report is broken. An
  // unsourced value is "unknown provenance" and does not reach a family.
  const source = drill?.youtube_start_source ? String(drill.youtube_start_source) : null
  const rawStart = Number(drill?.youtube_start_seconds)
  const start = source && Number.isFinite(rawStart) && rawStart > 0 ? Math.floor(rawStart) : null

  // Built by the one helper every surface uses, so the report's link is the
  // same link the app would open — timestamp and all. Never assembled here.
  const url = watchUrl({
    youtube_video_id: drill?.youtube_video_id || null,
    youtube_url: drill?.youtube_url || null,
    youtube_start_seconds: start,
  })

  const focus = Array.isArray(drill?.mechanic_focus) && drill.mechanic_focus.length
    ? drill.mechanic_focus.slice(0, 3).join(', ')
    : (Array.isArray(drill?.common_flaws_fixed) && drill.common_flaws_fixed.length
        ? drill.common_flaws_fixed.slice(0, 2).join(', ')
        : null)

  return {
    drill_name: String(drill?.drill_name || 'Drill'),
    description: cleanText(drill?.description, 600),
    focus: focus ? String(focus).slice(0, 200) : null,
    channel: drill?.channel ? String(drill.channel).slice(0, 120) : null,
    video_url: isSafeUrl(url) ? url : null,
    video_start_seconds: start,
    video_start_source: start ? source : null,
    reps_guidance: cleanText(drill?.reps_guidance, 200),
    frequency_guidance: cleanText(drill?.frequency_guidance, 200),
  }
}

/**
 * "Recommended because: Ground-ball fundamentals."
 *
 * Built from the priority the coach named and the drill's own curated
 * metadata. Deliberately NOT written by a model: a plausible sentence about
 * why a drill fixes a problem is exactly the kind of thing that reads well and
 * is wrong, and the coach has no way to check it. What the drill trains is
 * already recorded in the library by someone who looked.
 */
export function recommendationReason(
  focusLabel: string | null | undefined,
  snapshot: DrillSnapshot
): string {
  if (focusLabel && snapshot.focus) return `${focusLabel} — trains ${snapshot.focus}`
  if (focusLabel) return focusLabel
  if (snapshot.focus) return `Trains ${snapshot.focus}`
  return 'Selected by the coach'
}

// ---------------------------------------------------------------------------
// Focus areas
// ---------------------------------------------------------------------------

/**
 * Work out which of the seven areas a chosen problem belongs to.
 *
 * Uses the taxonomy's own skill_category first — the reliable signal — and
 * falls back to reading the label, which is what a priority the coach typed
 * themselves has instead.
 */
export function focusAreaForProblem(
  skillCategory: string | null | undefined,
  label: string | null | undefined
): string | null {
  return resolveFocusArea(skillCategory ? [skillCategory] : null, label || null)
}

// ---------------------------------------------------------------------------
// What the document actually contains
// ---------------------------------------------------------------------------

export interface RenderSection {
  heading: string
  /** Plain paragraphs. */
  body?: string
  /** Numbered development priorities. */
  priorities?: Array<{ label: string; body: string | null }>
  /** Drills, grouped under their priority where they have one. */
  drills?: Array<{
    name: string
    focus: string | null
    reason: string | null
    description: string | null
    dosage: string | null
    link: { url: string; label: string } | null
  }>
}

/**
 * The report, reduced to the sections that actually have something in them.
 *
 * One function, used by both the on-screen preview and the PDF, so a coach
 * cannot approve one document and send another. Sections with no content are
 * dropped here rather than in either renderer — that is the only way "hide
 * empty sections" stays true in both places.
 */
export function renderSections(report: FullReport): RenderSection[] {
  const out: RenderSection[] = []

  const strengthChips = report.strength_areas
    .filter(isFocusArea)
    .map(a => FOCUS_AREAS[a].label)

  if (report.strengths_content || strengthChips.length) {
    out.push({
      heading: 'Strengths',
      body: [
        strengthChips.length ? `Doing well in: ${strengthChips.join(' · ')}` : null,
        report.strengths_content,
      ].filter(Boolean).join('\n\n'),
    })
  }

  const priorities = [...report.focusAreas]
    .sort((a, b) => a.sort_order - b.sort_order)
    .filter(f => f.label)

  if (priorities.length) {
    out.push({
      heading: 'Development Priorities',
      body: report.development_intro || undefined,
      priorities: priorities.map(f => ({ label: f.label, body: f.approved_content })),
    })
  }

  const drills = [...report.drills].sort((a, b) => a.sort_order - b.sort_order)
  if (drills.length) {
    out.push({
      heading: 'Recommended Drills',
      drills: drills.map(d => {
        const url = d.include_video ? drillVideoLink(d.snapshot) : null
        const dosage = [d.snapshot.reps_guidance, d.snapshot.frequency_guidance]
          .filter(Boolean).join(' · ') || null
        return {
          name: d.snapshot.drill_name,
          focus: d.snapshot.focus,
          reason: d.recommendation_reason,
          description: d.snapshot.description,
          dosage,
          link: url ? { url, label: videoLinkLabel(d.snapshot) } : null,
        }
      }),
    })
  }

  if (report.closing_content) {
    out.push({ heading: "Coach's Comments", body: report.closing_content })
  }

  return out
}

/** Is there enough here to be worth sending to a family? */
export function isReportSendable(report: FullReport): boolean {
  return renderSections(report).length > 0
}

/** The line under the player's name: "8U · Fall 2026 · Rockets". */
export function contextLine(context: ReportContext | null): string {
  if (!context) return ''
  return [context.age_group, context.season_name, context.team_name]
    .filter(Boolean).join(' · ')
}

/** "September 5, 2026" — a document date, not a timestamp. */
export function formatReportDate(value: string | null | undefined): string {
  if (!value) return ''
  // Date-only strings are parsed as UTC, and rendering them in a negative
  // offset shifts them a day back — a report dated the 5th printing as the
  // 4th. Pin the parts rather than trusting the Date constructor.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const d = m
    ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    : new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}
