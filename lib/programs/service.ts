// Create a program draft for an already-authorised player. Used by BOTH entry
// points — the CoachAI chat and the "Create Development Program" form — so the
// two can never disagree about how a program is made.

import { DRILL_FIELDS, schedulableDrills, type DrillRecord } from '../drills'
import { buildBrief } from './brief'
import { loadPlayerEvidence } from './context'
import { generateProgram } from './generate'
import { anthropicCaller } from './model'
import { createDraft } from './store'
import type { ProgramBrief, ProgramDraft } from './types'

export type CreateResult =
  | { status: 'needs_info'; questions: string[] }
  | { status: 'ok'; draftId: string; draft: ProgramDraft }

export interface CreateInput {
  db: any
  teamId: string
  /** The team owner's coach id — whose private drills are visible. */
  coachId: string
  userId: string | null
  playerId: string
  threadId?: string | null
  message: string
  priorUserMessages?: string[]
  overrides?: Partial<ProgramBrief>
  today?: string
  /** Tests pass a stub. Default: the real model when a key is configured. */
  model?: ReturnType<typeof anthropicCaller>
}

export async function loadPool(db: any, coachId: string): Promise<DrillRecord[]> {
  const { data } = await schedulableDrills(db, coachId, DRILL_FIELDS).limit(500)
  return (data || []) as DrillRecord[]
}

export async function createProgramDraft(i: CreateInput): Promise<CreateResult> {
  const today = i.today ?? new Date().toISOString().slice(0, 10)
  const { evidence, player } = await loadPlayerEvidence(i.db, { coachId: i.coachId, teamId: i.teamId, playerId: i.playerId, today })
  const { brief, questions } = buildBrief({
    message: i.message, priorUserMessages: i.priorUserMessages, playerId: i.playerId,
    playerName: player.name, age: player.age, positions: player.positions, today, overrides: i.overrides,
  })
  if (!brief) return { status: 'needs_info', questions }

  const pool = await loadPool(i.db, i.coachId)
  const draft = await generateProgram({ brief, evidence, pool, model: i.model === undefined ? anthropicCaller() : i.model })
  console.log(`[programs] generated ${draft.generation?.method} weeks=${brief.weeks} sessions=${draft.sessions.length} ` +
    `calls=${draft.generation?.modelCalls} tokens=${draft.generation?.inputTokens}/${draft.generation?.outputTokens} ms=${draft.generation?.ms}`)

  // One open draft per conversation and player: a regenerated request replaces
  // the earlier draft instead of leaving two to pick between.
  if (i.threadId) {
    await i.db.from('development_program_drafts').update({ status: 'discarded' })
      .eq('thread_id', i.threadId).eq('team_id', i.teamId).eq('player_id', i.playerId).eq('status', 'draft')
  }
  const row = await createDraft(i.db, { teamId: i.teamId, playerId: i.playerId, threadId: i.threadId, userId: i.userId, draft })
  return { status: 'ok', draftId: row.id, draft }
}
