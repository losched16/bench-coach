// A saved practice and the Development Plan stage it was built for.
//
// Migration 077 gives practice_plans a pathway_slug and pathway_stage_number.
// A practice that carries them can be recorded as a session on the plans of
// the players working that pathway — one press, from the practice page, never
// automatically. These are the pure rules that press is made of; the route
// (POST /api/player-pathways/[progressId]/events with practicePlanId) and the
// practice page both use them, so the two cannot disagree.

import { flattenBlocks, PlanBlock } from './practicePlan'

export interface PracticePathwayLink { slug: string; stageNumber: number | null }

/** The link a saved practice carries, or null when it was not built from a plan. */
export function practiceLink(plan: { pathway_slug?: string | null; pathway_stage_number?: number | null } | null | undefined): PracticePathwayLink | null {
  const slug = typeof plan?.pathway_slug === 'string' ? plan.pathway_slug.trim() : ''
  if (!slug) return null
  const n = Number(plan?.pathway_stage_number)
  return { slug, stageNumber: Number.isInteger(n) && n > 0 ? n : null }
}

/** The columns to save with a practice built from a plan. Empty when there is none. */
export function linkColumns(slug: string | null | undefined, stage: number | null | undefined): Record<string, any> {
  if (!slug) return {}
  return {
    pathway_slug: slug,
    pathway_stage_number: Number.isInteger(stage) && (stage as number) > 0 ? stage : null,
  }
}

/** A database that has not run migration 077 refuses the columns by name. */
export function isMissingLinkColumns(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const msg = String(error.message || '')
  return error.code === 'PGRST204' || error.code === '42703' || /pathway_(slug|stage_number)/.test(msg)
}

/** Drill ids in the practice, stations included, first appearance order, capped. */
export function practiceDrillIds(content: any, cap = 40): string[] {
  const blocks: PlanBlock[] = Array.isArray(content) ? content : Array.isArray(content?.blocks) ? content.blocks : []
  const out: string[] = []
  for (const b of flattenBlocks(blocks)) {
    const id = typeof b?.drill_id === 'string' ? b.drill_id.trim() : ''
    if (id && !out.includes(id)) out.push(id)
    if (out.length >= cap) break
  }
  return out
}

/**
 * The day the work happened: the practice's own date once it has passed or is
 * today, otherwise null (the event defaults to today). A practice scheduled
 * for next week is never recorded as having happened next week.
 */
export function practiceSessionDate(scheduledFor: string | null | undefined, today: string): string | null {
  const d = typeof scheduledFor === 'string' ? scheduledFor.slice(0, 10) : ''
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && d <= today ? d : null
}

/** Minutes worth recording: a real number the coach chose, or nothing. */
export function practiceMinutes(duration: unknown): number | null {
  const n = Number(duration)
  return Number.isFinite(n) && n > 0 && n <= 480 ? Math.round(n) : null
}

/** Has this practice already been recorded on this plan? */
export function recordedFor(events: Array<{ event_type?: string; detail?: any }>, practicePlanId: string): boolean {
  return events.some(e => e.event_type === 'session_logged' && e.detail?.practice_plan_id === practicePlanId)
}

/**
 * Who is ticked when the picker opens: active plans at the practice's stage
 * that have not already had this practice recorded. Players at another stage
 * are listed but left for the coach to choose — the practice was built for
 * this stage, and saying it served another is the coach's call, not ours.
 */
export function defaultSelection(
  rows: Array<{ id: string; status: string; current_stage_number: number | null; already_recorded?: boolean }>,
  stageNumber: number | null,
): Set<string> {
  return new Set(rows
    .filter(r => r.status === 'active' && !r.already_recorded)
    .filter(r => stageNumber == null || r.current_stage_number === stageNumber)
    .map(r => r.id))
}
