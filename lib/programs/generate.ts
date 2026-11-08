// The generation pipeline: brief + evidence + drill pool → a validated draft.

import type { DrillRecord } from '../drills'
import { enrichDraft, type ModelCaller } from './author'
import { composeDraft } from './compose'
import { EMPTY_EVIDENCE, type PlayerEvidence } from './evidence'
import { repairDraft, validateDraft } from './validate'
import type { ProgramBrief, ProgramDraft } from './types'

export interface GenerateInput {
  brief: ProgramBrief
  evidence?: PlayerEvidence
  pool: DrillRecord[]
  /** Omit for a deterministic (no-model) program. */
  model?: ModelCaller | null
  /** Budget for the optional model layer. The structure never waits on it past this. */
  modelTimeoutMs?: number
  now?: () => number
}

export async function generateProgram(input: GenerateInput): Promise<ProgramDraft> {
  const now = input.now ?? Date.now
  const t0 = now()
  const ev = input.evidence ?? EMPTY_EVIDENCE
  const draft = composeDraft({ brief: input.brief, evidence: ev, pool: input.pool })
  const warnings = draft.qualityReport?.warnings ?? []
  let method: 'deterministic' | 'hybrid' = 'deterministic'
  let calls = 0, inTok = 0, outTok = 0

  if (input.model) {
    // Enrich a COPY so a half-finished model pass can never leave the real
    // draft in a mixed state.
    const copy: ProgramDraft = JSON.parse(JSON.stringify(draft))
    try {
      const stats = await withTimeout(enrichDraft(copy, ev, input.model), input.modelTimeoutMs ?? 90_000)
      calls = stats.calls; inTok = stats.inputTokens; outTok = stats.outputTokens
      if (stats.failed > 0) warnings.push(`Some coaching language from the model was unavailable (${stats.failed} of ${stats.calls + stats.failed} requests); those notes use the library’s own text.`)
      if (stats.calls - stats.failed > 0) {
        Object.assign(draft, { summary: copy.summary, skills: copy.skills, assessment: copy.assessment, sessions: copy.sessions })
        method = 'hybrid'
      }
    } catch (e: any) {
      warnings.push('Coaching language from the model was unavailable; the program is complete without it.')
    }
  } else {
    warnings.push('Generated without the model layer; coaching notes are the library’s own.')
  }

  const repairs = repairDraft(draft)
  const checks = validateDraft(draft, {
    drillIds: new Set(input.pool.map(d => d.id)),
  })
  const failed = checks.filter(c => !c.ok)
  draft.qualityReport = {
    checks, repairs,
    warnings: [...warnings, ...failed.map(c => `Check failed: ${c.id} — ${c.detail}`)].slice(0, 20),
  }
  draft.generation = { method, modelCalls: calls, inputTokens: inTok, outputTokens: outTok, ms: now() - t0 }
  return draft
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: any
  return Promise.race([p, new Promise<T>((_, rej) => { t = setTimeout(() => rej(new Error('timeout')), ms) })]).finally(() => clearTimeout(t)) as Promise<T>
}
