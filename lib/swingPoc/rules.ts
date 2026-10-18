// Swing mechanics POC — pure rules shared by the routes, the UI and the tests.

export function swingPocEnabled(): boolean {
  return process.env.SWING_MECHANICS_POC === '1'
}

// ── timeline ────────────────────────────────────────────────────────────────

export interface ResultFrame {
  i: number
  t_ms: number
  flags: string[]
  lm?: number[][]
  world?: number[][]
}

/**
 * The analysed frame to draw for a video time, or null.
 *
 * A video frame is on screen from its own presentation time until the next
 * frame's, so the pose to draw is the latest analysed frame at or before the
 * playhead — matched by the file's timestamps (variable-frame-rate safe),
 * never by index × fps.
 *
 * `holdMs` caps how long one pose may stay up: pass the source's longest
 * frame interval. When the analysis sampled every Nth frame, a frame that was
 * not analysed then shows NO skeleton rather than the previous frame's.
 */
export function frameAt(frames: ResultFrame[], tMs: number, holdMs?: number): ResultFrame | null {
  if (!frames.length || !Number.isFinite(tMs)) return null
  const eps = 0.5
  let lo = 0
  let hi = frames.length - 1
  if (tMs < frames[0].t_ms - eps) return null
  // Last frame with t_ms <= tMs (+eps).
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (frames[mid].t_ms <= tMs + eps) lo = mid
    else hi = mid - 1
  }
  const best = frames[lo]
  const next = frames[lo + 1]
  const until = next ? next.t_ms - best.t_ms : Infinity
  const hold = Math.min(until, holdMs ?? (Number.isFinite(until) ? until : 1000 / 30))
  return tMs - best.t_ms < hold + eps ? best : null
}

/**
 * Where the video picture actually sits inside its element (object-fit:
 * contain), so landmarks normalised to the picture land on the picture and
 * not on the letterbox. videoWidth/Height are the DISPLAYED dimensions — the
 * browser has already applied the file's rotation, as the analyzer does.
 */
export function contentRect(boxW: number, boxH: number, videoW: number, videoH: number) {
  if (!boxW || !boxH || !videoW || !videoH) return { x: 0, y: 0, w: 0, h: 0 }
  const scale = Math.min(boxW / videoW, boxH / videoH)
  const w = videoW * scale
  const h = videoH * scale
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h }
}

/** A time inside frame `k` of `times`, for seeking: halfway to the next frame, so rounding cannot land on a neighbour. */
export function seekTimeForFrame(timesMs: number[], k: number): number {
  const t = timesMs[k]
  const next = timesMs[k + 1]
  const prev = timesMs[k - 1]
  const half = Number.isFinite(next) ? (next - t) / 2 : Number.isFinite(prev) ? (t - prev) / 2 : 1
  return (t + Math.min(half, 2)) / 1000
}

// ── review ──────────────────────────────────────────────────────────────────

export type ReviewState = 'pending' | 'accepted' | 'edited' | 'rejected' | 'not_assessable'
export const REVIEW_STATES: ReviewState[] = ['pending', 'accepted', 'edited', 'rejected', 'not_assessable']

export interface FindingReview {
  state: ReviewState
  note?: string | null
  reviewed_by?: string
  reviewed_at?: string
}

export interface Review {
  // The analysis these decisions were made about. A re-analysis (new contact
  // mark, new analyzer version) produces a different hash, and the old
  // decisions no longer apply to it.
  input_hash: string | null
  findings: Record<string, FindingReview>
  // What this review may write. Always false in the POC: nothing reaches
  // player_metrics, prescriptions or development plans.
  writes_player_record: false
}

export function emptyReview(inputHash: string | null): Review {
  return { input_hash: inputHash, findings: {}, writes_player_record: false }
}

/**
 * Apply one coach decision. Throws with a message a coach can read.
 *
 *  - only findings the analysis actually produced can be reviewed;
 *  - a finding the analyzer could not assess cannot be "accepted" — there is
 *    no value to accept;
 *  - "edited" needs the coach's wording;
 *  - decisions about an older analysis are discarded, not carried over.
 */
export function applyReview(
  current: Review | null,
  result: { input_hash?: string | null; observations?: Array<{ id: string; status: string }> } | null,
  update: { findingId: string; state: string; note?: string | null },
  userId: string,
  now = new Date().toISOString()
): Review {
  if (!result || !Array.isArray(result.observations)) throw new Error('There is no analysis to review yet.')
  const hash = result.input_hash ?? null
  const base = current && current.input_hash === hash ? current : emptyReview(hash)
  const obs = result.observations.find(o => o.id === update.findingId)
  if (!obs) throw new Error('That finding is not part of this analysis.')
  if (!REVIEW_STATES.includes(update.state as ReviewState)) throw new Error('Unknown review state.')
  const state = update.state as ReviewState
  if ((state === 'accepted' || state === 'edited') && obs.status !== 'observed') {
    throw new Error('This finding could not be assessed, so there is nothing to accept.')
  }
  const note = typeof update.note === 'string' ? update.note.trim().slice(0, 600) : null
  if (state === 'edited' && !note) throw new Error('Add your wording when editing a finding.')
  return {
    input_hash: hash,
    writes_player_record: false,
    findings: { ...base.findings, [update.findingId]: { state, note, reviewed_by: userId, reviewed_at: now } },
  }
}

/** Findings a coach has agreed with — the only ones that may lead to drills. */
export function acceptedFindings(review: Review | null, result: any): Array<{ id: string; note: string | null; drill_taxonomy: string[]; label: string }> {
  if (!review || !result || review.input_hash !== (result.input_hash ?? null)) return []
  return (result.observations || [])
    .filter((o: any) => {
      const r = review.findings[o.id]
      return o.status === 'observed' && r && (r.state === 'accepted' || r.state === 'edited')
    })
    .map((o: any) => ({ id: o.id, note: review.findings[o.id].note ?? null, drill_taxonomy: o.drill_taxonomy || [], label: o.label }))
}

/**
 * The diagnosis handed to retrieveDrills: taxonomy slugs from the registry of
 * the findings the coach accepted. Passing it explicitly means retrieval makes
 * no model call and can only return library drills mapped to those problems.
 */
export function drillDiagnosis(accepted: ReturnType<typeof acceptedFindings>) {
  const slugs = Array.from(new Set(accepted.flatMap(a => a.drill_taxonomy)))
  // `via: 'aliases'` is retrieval's label for "no model call made" — the slugs
  // come from the registry, not from a classifier.
  return { slugs, categories: slugs.length ? ['Hitting'] : [], via: 'aliases' as const }
}
