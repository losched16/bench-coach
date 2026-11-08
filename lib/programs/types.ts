// Development Program — the shapes.
//
// A program is generated as a DRAFT (one JSON document validated by these
// schemas), reviewed and edited by the coach, and only then materialised into
// rows by bc_save_development_program (migration 085). Nothing the model
// writes becomes a coaching record until a coach approves it.
//
// The draft is deliberately a plain JSON tree: weeks → sessions → blocks →
// drills. Dates are YYYY-MM-DD strings (the program lives in the player's
// local calendar, never in UTC instants).

import { z } from 'zod'

export const SKILL_KEYS = [
  'first_step', 'acceleration', 'outfield_tracking', 'infield_fundamentals',
  'hitting', 'strength_athleticism', 'pitching_readiness', 'throwing',
  'catching', 'baserunning',
] as const
export type SkillKey = (typeof SKILL_KEYS)[number]

export const SESSION_KINDS = [
  'coached', 'independent', 'strength', 'throwing', 'assessment', 'team', 'recovery', 'rest',
] as const
export type SessionKind = (typeof SESSION_KINDS)[number]

// Who has to be standing there. 'independent' is a hard safety claim: no
// throwing at a person or into open space, no maximal loading, no equipment a
// child could hurt himself with alone. See safety.ts — it is computed from the
// exercises, never trusted from the model.
export const SUPERVISION = ['independent', 'parent', 'coach'] as const
export type Supervision = (typeof SUPERVISION)[number]

export const BLOCK_KINDS = ['warmup', 'skill', 'strength', 'throwing', 'assessment', 'cooldown'] as const
export type BlockKind = (typeof BLOCK_KINDS)[number]

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD')
const text = (max: number) => z.string().max(max)

// ── The request ──────────────────────────────────────────────────────────────

export const BriefSchema = z.object({
  playerId: z.string().min(1),
  playerName: z.string().nullable().optional(),
  age: z.number().int().min(4).max(19).nullable(),
  positions: z.array(z.string()).default([]),
  skillLevel: z.enum(['beginner', 'developing', 'advanced']).nullable().default(null),
  /** In the order the coach listed them. Order is a priority signal, not a filter. */
  skills: z.array(z.enum(SKILL_KEYS)).min(1),
  /** Skill → what the coach said is wrong, in their words. */
  concerns: z.array(z.object({ skill: z.enum(SKILL_KEYS), text: text(300) })).default([]),
  startDate: ymd,
  weeks: z.number().int().min(1).max(26),
  /** Days the coach said they can run a supervised session. */
  supervisedDaysPerWeek: z.number().int().min(1).max(6),
  sessionMinutes: z.number().int().min(20).max(120),
  independentMinutes: z.number().int().min(0).max(25),
  equipment: z.array(z.string()).default([]),
  /** null = not stated. Never defaulted into a filter. */
  indoorAccess: z.boolean().nullable().default(null),
  outdoorAccess: z.boolean().nullable().default(null),
  milestones: z.array(z.object({ label: text(80), date: ymd })).default([]),
  /** Where the arm stands. 'unknown' keeps the throwing gate closed. */
  throwing: z.object({
    status: z.enum(['active', 'resting', 'unknown']).default('unknown'),
    restDetails: text(300).nullable().default(null),
    painHistory: z.enum(['none_reported', 'reported', 'unknown']).default('unknown'),
  }).default({}),
  filming: z.boolean().default(false),
  /** Every default the generator chose because the coach did not say. */
  assumptions: z.array(text(240)).default([]),
})
export type ProgramBrief = z.infer<typeof BriefSchema>

// ── Evidence ─────────────────────────────────────────────────────────────────
// Where a statement about the player came from. A recorded fact, a coach's
// observation, a parent's worry and the model's reading of them are four
// different things and the coach must be able to tell them apart.

export const EVIDENCE_SOURCES = ['recorded', 'coach_observation', 'user_reported', 'ai_interpretation', 'missing'] as const
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number]

export const EvidenceSchema = z.object({
  source: z.enum(EVIDENCE_SOURCES),
  text: text(400),
  /** Date it was recorded, when the record has one. */
  on: ymd.nullable().optional(),
  /** Which skill it bears on, when it does. */
  skill: z.enum(SKILL_KEYS).nullable().optional(),
})
export type Evidence = z.infer<typeof EvidenceSchema>

// ── The draft ────────────────────────────────────────────────────────────────

export const DrillRowSchema = z.object({
  /** drill_resources.id. Null only for built-in program exercises. */
  drillId: z.string().uuid().nullable(),
  /** Built-in exercise key (exercises.ts) when drillId is null. */
  exerciseKey: z.string().nullable().default(null),
  name: text(120),
  skill: z.enum(SKILL_KEYS),
  minutes: z.number().int().min(1).max(60),
  sets: z.number().int().min(1).max(12).nullable().default(null),
  reps: text(60).nullable().default(null),
  rest: text(60).nullable().default(null),
  /** Plain language: 'easy' | 'moderate' | 'game speed' … never 'max' for a child alone. */
  intensity: z.enum(['easy', 'moderate', 'fast', 'game_speed']).default('moderate'),
  instructions: z.array(text(300)).max(8).default([]),
  cues: z.array(text(120)).max(4).default([]),
  success: z.array(text(200)).max(4).default([]),
  modification: text(300).nullable().default(null),
  equipment: z.array(z.string()).default([]),
  /** Where the video comes from. Resolved from the drill library at read time. */
  hasVideo: z.boolean().default(false),
})
export type DrillRow = z.infer<typeof DrillRowSchema>

export const BlockSchema = z.object({
  kind: z.enum(BLOCK_KINDS),
  title: text(100),
  skill: z.enum(SKILL_KEYS).nullable().default(null),
  minutes: z.number().int().min(1).max(90),
  drills: z.array(DrillRowSchema).default([]),
})
export type Block = z.infer<typeof BlockSchema>

export const AssessmentPlanSchema = z.object({
  /** metric_types.slug */
  metricSlug: z.string(),
  label: text(80),
  unit: z.string().nullable().default(null),
  direction: z.enum(['higher', 'lower']),
  shape: z.enum(['measurement', 'challenge']),
  attempts: z.number().int().nullable().default(null),
  /** The conditions that make two readings comparable. */
  protocol: text(300),
  skill: z.enum(SKILL_KEYS),
})
export type AssessmentPlan = z.infer<typeof AssessmentPlanSchema>

export const SessionSchema = z.object({
  /** Stable within the program, e.g. 'w3d2'. */
  key: z.string().regex(/^w\d{1,2}d\d(?:i)?$/),
  week: z.number().int().min(1),
  date: ymd,
  kind: z.enum(SESSION_KINDS),
  supervision: z.enum(SUPERVISION),
  title: text(120),
  focus: z.array(z.enum(SKILL_KEYS)).default([]),
  minutes: z.number().int().min(0).max(150),
  blocks: z.array(BlockSchema).default([]),
  /** 'baseline' | 'midpoint' | 'final' when this session measures progress. */
  checkpoint: z.enum(['baseline', 'midpoint', 'final']).nullable().default(null),
  assessments: z.array(AssessmentPlanSchema).default([]),
  /** A throwing session only happens once the gate below has been cleared. */
  requiresThrowingGate: z.boolean().default(false),
  coachNote: text(500).nullable().default(null),
  filmingNote: text(400).nullable().default(null),
  equipment: z.array(z.string()).default([]),
  /** Who wrote the last change. The coach's edits are never silently replaced. */
  origin: z.enum(['ai', 'coach']).default('ai'),
})
export type ProgramSession = z.infer<typeof SessionSchema>

export const PhaseSchema = z.object({
  order: z.number().int().min(1),
  key: z.enum(['foundation', 'controlled', 'reactive', 'game_speed', 'evaluation']),
  name: text(80),
  startDate: ymd,
  endDate: ymd,
  startWeek: z.number().int().min(1),
  endWeek: z.number().int().min(1),
  goals: z.array(text(200)).max(8),
  skills: z.array(z.enum(SKILL_KEYS)),
  progressionRequirements: z.array(text(240)).max(8),
  difficulty: text(240),
})
export type ProgramPhase = z.infer<typeof PhaseSchema>

export const SkillPlanSchema = z.object({
  skill: z.enum(SKILL_KEYS),
  label: text(80),
  /** 1 = most training time. Priorities shape time; they never remove a goal. */
  priority: z.number().int().min(1).max(10),
  rationale: text(400),
  baseline: text(300).nullable().default(null),
  target: text(300).nullable().default(null),
  /** Existing development plan this skill continues, when one exists. */
  progressId: z.string().uuid().nullable().default(null),
  pathwayName: text(120).nullable().default(null),
  currentStage: text(160).nullable().default(null),
})
export type SkillPlan = z.infer<typeof SkillPlanSchema>

export const ProgressionRuleSchema = z.object({
  skill: z.enum(SKILL_KEYS).nullable().default(null),
  action: z.enum(['advance', 'maintain', 'regress', 'repeat', 'pause', 'reassess']),
  when: text(300),
})
export type ProgressionRule = z.infer<typeof ProgressionRuleSchema>

export const ThrowingGateSchema = z.object({
  /** Open means the coach has cleared it. A new draft never starts open. */
  cleared: z.boolean().default(false),
  checklist: z.array(text(240)),
  ladder: z.array(z.object({ step: z.number().int(), name: text(80), description: text(400) })),
  note: text(600),
})
export type ThrowingGate = z.infer<typeof ThrowingGateSchema>

export const DraftSchema = z.object({
  schemaVersion: z.literal(1),
  title: text(140),
  summary: text(1200),
  brief: BriefSchema,
  assessment: z.object({
    strengths: z.array(EvidenceSchema),
    needs: z.array(EvidenceSchema),
    concerns: z.array(EvidenceSchema),
    history: z.array(EvidenceSchema),
    unknowns: z.array(EvidenceSchema),
  }),
  skills: z.array(SkillPlanSchema).min(1),
  phases: z.array(PhaseSchema).min(1),
  sessions: z.array(SessionSchema).min(1),
  progressionRules: z.array(ProgressionRuleSchema),
  throwingGate: ThrowingGateSchema.nullable(),
  weeklyLoad: z.array(z.object({
    week: z.number().int(),
    label: z.enum(['build', 'consolidate', 'deload', 'assess']),
    note: text(200),
  })),
  /** Library gaps the coach may want curated. Never invented URLs. */
  curationFlags: z.array(text(200)).default([]),
  assumptions: z.array(text(240)).default([]),
  /** What the generator checked, and what it repaired. Shown to the coach. */
  qualityReport: z.object({
    checks: z.array(z.object({ id: z.string(), ok: z.boolean(), detail: text(300) })),
    repairs: z.array(text(240)),
    warnings: z.array(text(240)),
  }).nullable().default(null),
  generation: z.object({
    method: z.enum(['deterministic', 'hybrid']),
    modelCalls: z.number().int(),
    inputTokens: z.number().int(),
    outputTokens: z.number().int(),
    ms: z.number().int(),
  }).nullable().default(null),
})
export type ProgramDraft = z.infer<typeof DraftSchema>
