// What we know about the player, labelled by how we know it.
//
// The loader (context.ts) fills this from authorised reads; compose.ts and the
// authoring prompt consume it. Keeping it a plain data shape is what lets the
// generator be tested with no database.

import type { Evidence, SkillKey } from './types'

export type Bucket = 'strengths' | 'needs' | 'concerns' | 'history' | 'unknowns'

export interface EvidenceItem extends Evidence { bucket: Bucket }

export interface PathwayRef {
  progressId: string
  skill: SkillKey | null
  pathwayName: string
  stageName: string | null
  status: 'active' | 'paused' | 'completed'
}

export interface PlayerEvidence {
  items: EvidenceItem[]
  pathways: PathwayRef[]
  /** Latest recorded readings by metric slug, so baselines are real or absent. */
  metrics: Array<{ slug: string; label: string; value: number; unit: string | null; on: string; attempts: number | null; successes: number | null }>
  /** Count of logged sessions in the last 60 days. 0 means NOTHING LOGGED, not "did nothing". */
  loggedSessions60d: number
  /** Rendered, capped text of the existing coach context, for the authoring prompt only. */
  contextText: string
}

export const EMPTY_EVIDENCE: PlayerEvidence = {
  items: [], pathways: [], metrics: [], loggedSessions60d: 0, contextText: '',
}
