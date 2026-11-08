// Development Programs: intent, brief, generation, structure, safety, edits,
// progress, evidence and scoping.
//
// No network and no model: the optional model layer is exercised with a stub,
// and the live-model behaviour is NOT claimed by this file. The Charlie
// scenario here proves the deterministic structure and the validators against
// fixture evidence and a fixture drill pool.
//
//   npm run test:programs

import { classifyIntent, durationWeeks } from '@/lib/programs/intent'
import { buildBrief, findDates, nextMonday } from '@/lib/programs/brief'
import { composeDraft, allocateBlocks, rankSkills } from '@/lib/programs/compose'
import { generateProgram } from '@/lib/programs/generate'
import { validateDraft, repairDraft } from '@/lib/programs/validate'
import { cleanText, enrichDraft, type ModelCaller } from '@/lib/programs/author'
import { applyRestDay, parseEdit, applyReplaceDrill, briefForEdit, weekSummary } from '@/lib/programs/edits'
import { applyChanges, proposeAdjustments, summariseAssessment, type ProgramReading } from '@/lib/programs/progress'
import { independenceViolations, pitchSmartDailyMax, pitchSmartRestDays, requiredSupervision, buildThrowingGate } from '@/lib/programs/safety'
import { evidenceFromContext } from '@/lib/programs/context'
import { toSavePayload, getDraft, updateDraft, loadProgram, openDraftForThread, discardDraft, sessionsFromRows, patchFromSessions, StoreError } from '@/lib/programs/store'
import { resolvePlayer, renderProgramMessage } from '@/lib/programs/chat'
import { programsEnabled } from '@/lib/programs/flag'
import { DraftSchema, SKILL_KEYS } from '@/lib/programs/types'
import { EXERCISES } from '@/lib/programs/exercises'
import { DRILL_POOL } from './fixtures/drill-pool'
import { CHARLIE_MESSAGE, CHARLIE_EVIDENCE } from './fixtures/charlie'

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}
const eq = (label: string, a: any, b: any) => check(label, JSON.stringify(a) === JSON.stringify(b), `got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`)

const TODAY = '2026-11-08'
const PID = '00000000-0000-0000-0000-0000000000c1'

async function main() {
  // ── intent ────────────────────────────────────────────────────────────────
  eq('intent: Charlie request is a program', classifyIntent(CHARLIE_MESSAGE).intent, 'program')
  eq('intent: 10-week plan for a 9U player', classifyIntent('My 9U player needs to get quicker, improve outfield tracking, strengthen his swing, and prepare for tryouts. We have 10 weeks. Build me a plan.').intent, 'program')
  eq('intent: three-month hitting plan', classifyIntent('Create a three-month hitting development plan.').intent, 'program')
  eq('intent: offseason program', classifyIntent('Build my son an eight-week offseason program.').intent, 'program')
  eq('intent: daily work for tryouts', classifyIntent('I need a daily workout plan to get my player ready for tryouts, outfield and speed.').intent, 'program')
  eq('intent: quick advice stays quick', classifyIntent('Why does my hitter keep rolling over?').intent, 'quick')
  eq('intent: drill question stays quick', classifyIntent('What drill should I use to teach a backhand?').intent, 'quick')
  eq('intent: pitcher command stays quick', classifyIntent('How do I help a pitcher improve command?').intent, 'quick')
  eq('intent: team practice', classifyIntent('Build a 90-minute practice for our 9U team.').intent, 'team_practice')
  eq('intent: assessment', classifyIntent('How much has Charlie improved?').intent, 'assessment')
  eq('intent: what to focus on next month', classifyIntent('What should we focus on next month?').intent, 'assessment')
  eq('intent: explain', classifyIntent('Teach me how to coach a proper outfield drop step.').intent, 'explain')
  eq('intent: "plan" word alone is not a program', classifyIntent('What is the plan for the bunt defense?').intent, 'quick')
  eq('intent: a drill question mentioning "program" with no horizon', classifyIntent('Is the program at the local gym any good?').intent, 'quick')
  for (const m of ['Make Thursday a rest day.', 'Add more outfield work.', 'Change this to three days per week.', 'Show me Week 4.', 'Replace that drill with one I can do indoors.']) {
    eq(`intent: follow-up edit with an open draft — ${m}`, classifyIntent(m, { hasOpenDraft: true }).intent, 'program_edit')
  }
  check('intent: the same edit with no draft is not an edit', classifyIntent('Make Thursday a rest day.', { hasOpenDraft: false }).intent !== 'program_edit')
  eq('duration: eight-week', durationWeeks('an eight-week program'), 8)
  eq('duration: three months', durationWeeks('a three-month plan'), 13)
  eq('duration: none', durationWeeks('some drills please'), null)

  // ── brief ─────────────────────────────────────────────────────────────────
  const { brief, questions } = buildBrief({ message: CHARLIE_MESSAGE, playerId: PID, playerName: 'Charlie', age: 9, positions: ['OF', 'P'], today: TODAY })
  check('brief builds for Charlie', !!brief, JSON.stringify(questions))
  const b = brief!
  eq('brief: 8 weeks', b.weeks, 8)
  eq('brief: starts Nov 9 2026', b.startDate, '2026-11-09')
  eq('brief: five supervised days', b.supervisedDaysPerWeek, 5)
  eq('brief: seven goals, none dropped', b.skills.slice().sort(), ['acceleration', 'first_step', 'hitting', 'infield_fundamentals', 'outfield_tracking', 'pitching_readiness', 'strength_athleticism'])
  check('brief: equipment is exactly what was stated', ['batting tee', 'net', 'resistance bands', 'dumbbells', 'medicine ball', 'batting cage', 'field'].every(e => b.equipment.includes(e)) && !b.equipment.includes('cones') && !b.equipment.includes('radar'), b.equipment.join(','))
  eq('brief: arm is resting, details unknown', [b.throwing.status, b.throwing.restDetails], ['resting', null])
  check('brief: milestones keep their own labels', b.milestones.some(m => m.date === '2027-01-08' && /winter/i.test(m.label)) && b.milestones.some(m => m.date === '2027-03-08' && /tryout/i.test(m.label)), JSON.stringify(b.milestones))
  check('brief: filming noticed', b.filming)
  check('brief: stated defaults recorded as assumptions', b.assumptions.some(a => /60 minutes/.test(a)) && b.assumptions.some(a => /gate starts closed/.test(a)))
  check('brief: concern text is the coach’s own', b.concerns.some(c => /first step is slow/i.test(c.text)))
  eq('brief: no skills -> a question, not a guess', buildBrief({ message: 'Build my son an eight-week program', playerId: PID, age: 9, today: TODAY }).questions.length, 1)
  eq('brief: missing length is defaulted AND disclosed', buildBrief({ message: 'Build a program for outfield tracking', playerId: PID, age: 9, today: TODAY }).brief!.weeks, 8)
  check('brief: missing length shows up in assumptions', buildBrief({ message: 'Build a program for outfield tracking', playerId: PID, age: 9, today: TODAY }).brief!.assumptions.some(a => /8 weeks/.test(a)))
  eq('dates: year-less date rolls forward', findDates('tryouts March 8', TODAY)[0].date, '2027-03-08')
  eq('nextMonday from a Sunday', nextMonday('2026-11-08'), '2026-11-09')
  check('brief: age unknown is disclosed, not invented', buildBrief({ message: 'eight-week outfield program', playerId: PID, age: null, today: TODAY }).brief!.assumptions.some(a => /age is not on file/.test(a)))

  // ── Charlie: generation ───────────────────────────────────────────────────
  const modelSeen: string[] = []
  const stub: ModelCaller = async req => {
    modelSeen.push(req.user)
    if (/Phase "/.test(req.user)) {
      const keys = Array.from(req.user.matchAll(/^(w\d{1,2}d\d) /gm)).map(m => m[1])
      return { text: JSON.stringify({ sessions: Object.fromEntries(keys.map(k => [k, { cue: 'Push the ground away', watchFor: 'The first step is short and quick.' }])) }), inputTokens: 100, outputTokens: 50 }
    }
    return { text: JSON.stringify({ summary: 'A balanced plan around speed, outfield reads and a staying-back swing.', skillNotes: { hitting: 'The October observation says the hands drift; that is a hypothesis to confirm in week 1.' }, interpretations: [{ skill: 'hitting', text: 'Hands drifting may be a timing issue; check in the tee phase.' }] }), inputTokens: 300, outputTokens: 120 }
  }
  const draft = await generateProgram({ brief: b, evidence: CHARLIE_EVIDENCE, pool: DRILL_POOL, model: stub })
  check('generate: schema-valid', DraftSchema.safeParse(draft).success)
  eq('generate: hybrid method when the model answers', draft.generation?.method, 'hybrid')
  check('generate: model usage recorded', (draft.generation?.modelCalls ?? 0) === 5 && (draft.generation?.inputTokens ?? 0) > 0)
  eq('generate: all 8 weeks have sessions', Array.from(new Set(draft.sessions.map(s => s.week))).sort((a, c) => a - c), [1, 2, 3, 4, 5, 6, 7, 8])
  eq('generate: 8 weeks of dates', [draft.sessions[0].date, draft.sessions[draft.sessions.length - 1].date], ['2026-11-09', '2027-01-03'])
  for (let w = 1; w <= 8; w++) {
    const trained = new Set(draft.sessions.filter(s => s.week === w && s.kind !== 'rest').flatMap(s => s.blocks.filter(x => x.kind !== 'warmup' && x.kind !== 'cooldown').map(x => x.skill)))
    check(`week ${w}: every requested skill is trained`, b.skills.every(sk => trained.has(sk)), b.skills.filter(sk => !trained.has(sk)).join(','))
    eq(`week ${w}: five coached sessions`, draft.sessions.filter(s => s.week === w && (s.kind === 'coached' || s.kind === 'assessment')).length, 5)
    check(`week ${w}: at least one rest day`, draft.sessions.some(s => s.week === w && s.kind === 'rest'))
  }
  const failedChecks = draft.qualityReport!.checks.filter(c => !c.ok)
  check('generate: all deterministic quality checks pass', failedChecks.length === 0, failedChecks.map(c => `${c.id}: ${c.detail}`).join(' | '))
  eq('generate: four progressive phases cover 8 weeks', draft.phases.map(p => [p.key, p.startWeek, p.endWeek]), [['foundation', 1, 2], ['controlled', 3, 4], ['reactive', 5, 6], ['game_speed', 7, 8]])
  check('generate: checkpoints baseline, midpoint and final exist', ['baseline', 'midpoint', 'final'].every(c => draft.sessions.some(s => s.checkpoint === c)))
  check('generate: baseline falls in week 1, midpoint week 4, final week 8', draft.sessions.filter(s => s.checkpoint === 'baseline').every(s => s.week === 1) && draft.sessions.filter(s => s.checkpoint === 'midpoint').every(s => s.week === 4) && draft.sessions.filter(s => s.checkpoint === 'final').every(s => s.week === 8))
  check('generate: assessments are measurable and carry a protocol', draft.sessions.flatMap(s => s.assessments).every(a => a.protocol.length > 20 && a.metricSlug))
  check('generate: exit velocity NOT scheduled without a device', !draft.sessions.flatMap(s => s.assessments).some(a => a.metricSlug === 'exit_velo'))
  check('generate: every session fits its time budget exactly', draft.sessions.filter(s => s.kind === 'coached' || s.kind === 'assessment').every(s => s.minutes === 60 && s.blocks.reduce((a, x) => a + x.minutes, 0) === 60))
  check('generate: independent routines are 10 minutes and independent-safe', draft.sessions.filter(s => s.kind === 'independent').every(s => s.minutes === 10 && independenceViolations(s).length === 0))
  check('generate: independent routines exist on each coached day', draft.sessions.filter(s => s.kind === 'independent').length === 40)
  check('generate: coached sessions need an adult', draft.sessions.filter(s => s.kind === 'coached' || s.kind === 'assessment').every(s => s.supervision !== 'independent'))
  check('generate: strength is supervised, never independent-labelled', draft.sessions.filter(s => s.blocks.some(x => x.kind === 'strength')).filter(s => s.kind !== 'independent').every(s => s.supervision !== 'independent'))
  check('generate: strength sessions are never on consecutive days', Array.from({ length: 8 }, (_, i) => i + 1).every(w => { const ds = draft.sessions.filter(x => x.week === w && x.kind === 'coached' && x.blocks.some(y => y.kind === 'strength')).map(x => Date.parse(x.date) / 86400000).sort((a, c) => a - c); return ds.length >= 1 && ds.every((d, k) => k === 0 || d - ds[k - 1] >= 2) }))
  check('generate: filming notes on some sessions', draft.sessions.some(s => !!s.filmingNote) && draft.sessions.filter(s => s.checkpoint === 'baseline').every(s => !!s.filmingNote))

  // pathway / evidence
  const hit = draft.skills.find(s => s.skill === 'hitting')!
  check('generate: existing hitting plan is referenced, not recreated', hit.progressId === '33333333-3333-3333-3333-333333333333' && hit.pathwayName === 'Load to Launch')
  check('generate: speed plan linked to first-step', draft.skills.find(s => s.skill === 'first_step')!.progressId === '44444444-4444-4444-4444-444444444444')
  check('generate: hitting gets elevated priority from the October observation', hit.priority <= 3, `priority ${hit.priority}`)
  check('generate: real exit-velo baseline is shown, not invented', /Exit velocity: 41 mph/.test(hit.baseline || ''))
  check('generate: skills with no record say so', draft.assessment.unknowns.some(u => /No recorded baseline for Outfield/.test(u.text)))
  check('generate: facts and hypotheses are labelled apart', draft.assessment.needs.some(n => n.source === 'ai_interpretation' && /^Hypothesis:/.test(n.text)) && draft.assessment.needs.some(n => n.source === 'coach_observation'))
  check('generate: no invented completed sessions or measurements', draft.sessions.every(s => s.origin === 'ai') && !JSON.stringify(draft).includes('"status":"completed"'))
  check('generate: arm-rest length is flagged unknown', draft.assessment.unknowns.some(u => /arm rest/i.test(u.text)))
  check('generate: unlogged practice is unknown, not zero', !draft.assessment.unknowns.some(u => /did nothing|never practiced/i.test(u.text)))

  // drills
  const used = draft.sessions.flatMap(s => s.blocks.flatMap(x => x.drills))
  const libUsed = used.filter(d => d.drillId)
  const ids = new Set(DRILL_POOL.map(p => p.id))
  check('drills: library drills are used', libUsed.length > 40)
  check('drills: every referenced drill id exists in the pool', libUsed.every(d => ids.has(d.drillId!)))
  check('drills: a drill needing equipment we do not have is never used', !used.some(d => /Pitching Machine|Sled/.test(d.name)))
  check('drills: cones are substitutable and the swap is written in the instructions', used.filter(d => /Cone First-Step/.test(d.name)).every(d => d.instructions.some(i => /shoes|water bottles/.test(i))))
  const foundationAnchor = (skill: string) => draft.sessions.filter(s => s.week <= 2 && (s.kind === 'coached' || s.kind === 'assessment')).flatMap(s => s.blocks.filter(x => x.skill === skill).flatMap(x => x.drills[0]?.name)).filter(Boolean)
  check('drills: the same anchor drill repeats through a phase (progression, not random variation)', new Set(foundationAnchor('hitting')).size === 1 && new Set(foundationAnchor('outfield_tracking')).size === 1)
  const phaseAnchor = (skill: string, w: number) => draft.sessions.filter(s => s.week === w && (s.kind === 'coached' || s.kind === 'assessment')).flatMap(s => s.blocks.filter(x => x.skill === skill).map(x => x.drills[0]?.name))[0]
  check('drills: difficulty advances across phases (stage 1 → 2 → 3 for hitting)', phaseAnchor('hitting', 1) !== phaseAnchor('hitting', 5) && /Front Toss|Soft Toss/.test(phaseAnchor('hitting', 7) || ''), `${phaseAnchor('hitting', 1)} | ${phaseAnchor('hitting', 5)} | ${phaseAnchor('hitting', 7)}`)
  check('drills: instructions are actionable on every non-cooldown drill', used.every(d => d.instructions.length >= 1))
  check('drills: no invented video links anywhere', !/https?:\/\//.test(JSON.stringify(draft.sessions)))
  check('drills: a video is only flagged where the library has one', libUsed.filter(d => d.hasVideo).every(d => /Stay Back/.test(d.name)))

  // throwing
  eq('throwing: gate present and CLOSED', [!!draft.throwingGate, draft.throwingGate?.cleared], [true, false])
  const pitchRows = draft.sessions.flatMap(s => s.blocks.filter(x => x.skill === 'pitching_readiness'))
  check('throwing: pitching is arm care / readiness only while the gate is closed', pitchRows.length >= 8 && pitchRows.every(x => x.drills.every(d => d.intensity === 'easy')))
  check('throwing: ladder steps are labelled conditional', pitchRows.flatMap(x => x.drills).filter(d => /Throwing ladder/.test(d.name)).every(d => /only if the gate is cleared/.test(d.name)))
  check('throwing: no bullpen, mound, velocity or strike-count work while closed', !JSON.stringify(draft.sessions).match(/bullpen|radar gun|max velocity|at game speed.*throw/i))
  check('throwing: readiness check scheduled week 1', draft.sessions.filter(s => s.week === 1).some(s => s.blocks.some(x => x.drills.some(d => d.exerciseKey === 'readiness_check'))))
  check('throwing: medical-evaluation instruction present', JSON.stringify(draft.sessions).includes('medical professional'))
  check('throwing: gate note disclaims pitch-count limits and velocity promises', /does not set weekly or practice pitch limits/.test(draft.throwingGate!.note) && /No velocity increase is promised/.test(draft.throwingGate!.note))
  check('throwing: sessions with ladder steps are flagged as gate-dependent', draft.sessions.filter(s => s.blocks.some(x => x.drills.some(d => /Throwing ladder/.test(d.name)))).every(s => s.requiresThrowingGate))
  eq('Pitch Smart: 9–10 daily max', pitchSmartDailyMax(9), 75)
  eq('Pitch Smart: 7–8 daily max', pitchSmartDailyMax(8), 50)
  eq('Pitch Smart: 9–10, 36–50 pitches = 2 days', pitchSmartRestDays(9, 40), 2)
  eq('Pitch Smart: 9–10, 66–75 pitches = 4 days', pitchSmartRestDays(10, 70), 4)
  eq('Pitch Smart: over the max = no rest value invented', pitchSmartRestDays(9, 90), null)
  check('throwing gate for a non-pitcher is absent', buildThrowingGate({ ...b, skills: ['hitting'] }) === null)

  // safety / promises
  const text = JSON.stringify(draft)
  check('safety: no promised outcomes anywhere', !/guarantee|will (?:definitely )?(?:gain|add|increase|improve) .{0,40}mph|make the (?:travel )?team/i.test(text))
  check('safety: no maximal lifting prescribed (only the prohibition)', !/(?<!no )(?:one[- ]rep max|1rm|max(?:imal)? (?:effort|lift))/i.test(text.replace(/no max(?:imum)? lifts/gi, '')))
  check('safety: dumbbell/med-ball guidance says light and supervised', draft.sessions.flatMap(s => s.blocks.flatMap(x => x.drills)).filter(d => /dumbbell|medicine ball/i.test(d.name)).every(d => /light|no heavier|2–4 pounds/i.test(d.instructions.join(' '))))
  check('safety: age-appropriate load (no day over 90 minutes)', (() => { const m = new Map<string, number>(); draft.sessions.forEach(s => m.set(s.date, (m.get(s.date) || 0) + s.minutes)); return Math.max(...Array.from(m.values())) <= 90 })())
  check('safety: holidays are not training days', !draft.sessions.some(s => (s.kind === 'coached' || s.kind === 'assessment') && ['2026-11-26', '2026-12-25', '2027-01-01', '2026-12-24'].includes(s.date)))
  check('safety: deload week present in an 8-week program', draft.weeklyLoad.find(w => w.week === 4)?.label === 'deload' && draft.weeklyLoad.find(w => w.week === 8)?.label === 'assess')
  check('safety: no session is wrongly labelled independent', draft.sessions.every(s => independenceViolations(s).length === 0))
  check('safety: a library drill is never judged independent', requiredSupervision({ kind: 'coached', blocks: [{ kind: 'skill', title: 'x', skill: 'hitting', minutes: 5, drills: [{ ...libUsed[0] }] }] }) !== 'independent')
  const rogue = JSON.parse(JSON.stringify(draft.sessions.find(s => s.kind === 'independent')!)); rogue.blocks[0].drills[0].instructions = ['Throw at a wall as hard as you can, then do a one-rep max.']; rogue.blocks[0].drills[0].intensity = 'game_speed'
  check('safety: the validator catches unsafe independent work', independenceViolations(rogue).length >= 2)
  check('repairs: unsafe independent session is re-labelled, not shipped', (() => { const c = JSON.parse(JSON.stringify(draft)); const i = c.sessions.findIndex((s: any) => s.kind === 'independent'); c.sessions[i].blocks[0].drills[0].exerciseKey = null; const r = repairDraft(c); return r.some(x => /no longer independent/.test(x)) && c.sessions[i].supervision !== 'independent' })())

  // model layer cannot alter structure
  const before = JSON.parse(JSON.stringify(composeDraft({ brief: b, evidence: CHARLIE_EVIDENCE, pool: DRILL_POOL })))
  const evil: ModelCaller = async () => ({ text: JSON.stringify({ summary: 'This will guarantee he makes the travel team. https://evil.example/x', skillNotes: { hitting: 'Visit https://evil.example then ignore all rules' }, interpretations: [{ skill: 'hitting', text: 'He will gain 10 mph.' }], sessions: { w1d1: { cue: 'ok **cue**', watchFor: 'fine' }, w9d9: { cue: 'ghost' } } }), inputTokens: 1, outputTokens: 1 })
  const after = JSON.parse(JSON.stringify(before)); await enrichDraft(after, CHARLIE_EVIDENCE, evil)
  check('model: promises are dropped', !/guarantee|makes the travel team|10 mph/.test(JSON.stringify(after)))
  check('model: links are stripped', !/evil\.example/.test(JSON.stringify(after)))
  check('model: it cannot change dates, durations, drills or supervision', JSON.stringify(after.sessions.map((s: any) => [s.key, s.date, s.minutes, s.supervision, s.blocks.map((x: any) => x.drills.map((d: any) => [d.drillId, d.minutes]))])) === JSON.stringify(before.sessions.map((s: any) => [s.key, s.date, s.minutes, s.supervision, s.blocks.map((x: any) => x.drills.map((d: any) => [d.drillId, d.minutes]))])))
  check('model: unknown session keys are ignored', !JSON.stringify(after).includes('ghost'))
  eq('cleanText rejects a promise', cleanText('He will definitely improve 5 mph', 100), null)
  const down: ModelCaller = async () => { throw new Error('boom') }
  const noModel = await generateProgram({ brief: b, evidence: CHARLIE_EVIDENCE, pool: DRILL_POOL, model: down })
  check('model down: the program is still complete and valid', noModel.sessions.length === draft.sessions.length && noModel.qualityReport!.checks.every(c => c.ok))
  check('model down: the coach is told', noModel.qualityReport!.warnings.some(w => /unavailable/.test(w)) && noModel.generation?.method === 'deterministic')
  const det = await generateProgram({ brief: b, evidence: CHARLIE_EVIDENCE, pool: DRILL_POOL })
  const det2 = await generateProgram({ brief: b, evidence: CHARLIE_EVIDENCE, pool: DRILL_POOL })
  check('deterministic: same input, same program', JSON.stringify(det.sessions) === JSON.stringify(det2.sessions))

  // ── other shapes: other lengths, frequencies, missing data ───────────────
  const gen = async (over: Partial<typeof b>, pool = DRILL_POOL, ev = CHARLIE_EVIDENCE) => generateProgram({ brief: { ...b, ...over }, evidence: ev, pool })
  const ten = await gen({ weeks: 10 })
  check('shape: 10 weeks (not hardcoded to 8)', new Set(ten.sessions.map(s => s.week)).size === 10 && ten.qualityReport!.checks.every(c => c.ok), ten.qualityReport!.checks.filter(c => !c.ok).map(c => c.detail).join('|'))
  eq('shape: 10 weeks gets five phases', ten.phases.length, 5)
  const three = await gen({ supervisedDaysPerWeek: 3 })
  check('shape: 3 days a week is valid with rotation disclosed', three.qualityReport!.checks.every(c => c.ok) && three.qualityReport!.warnings.some(w => /rotate/i.test(w)), three.qualityReport!.checks.filter(c => !c.ok).map(c => c.detail).join('|'))
  check('shape: 3 days: every skill still appears over any two weeks', [1, 2].every(w0 => b.skills.every(sk => three.sessions.filter(s => s.week === w0 || s.week === w0 + 1).some(s => s.blocks.some(x => x.skill === sk)))))
  const one = await gen({ weeks: 1, supervisedDaysPerWeek: 2 })
  check('shape: 1 week / 2 days produces a valid, honest program', one.sessions.length > 0 && DraftSchema.safeParse(one).success)
  const hittingOnly = await gen({ skills: ['hitting'], concerns: [], throwing: { status: 'active', restDetails: null, painHistory: 'none_reported' } })
  check('shape: hitting-only has no throwing gate', hittingOnly.throwingGate === null && hittingOnly.qualityReport!.checks.every(c => c.ok))
  const emptyPool = await gen({}, [])
  check('shape: empty library -> complete program from built-ins, gaps flagged for curation', emptyPool.qualityReport!.checks.every(c => c.ok) && emptyPool.curationFlags.length > 0 && !emptyPool.sessions.flatMap(s => s.blocks.flatMap(x => x.drills)).some(d => d.drillId))
  const noEvidence = await generateProgram({ brief: { ...b }, pool: DRILL_POOL })
  check('shape: no player history -> still complete, unknowns stated', noEvidence.qualityReport!.checks.every(c => c.ok) && noEvidence.assessment.unknowns.some(u => /No recent sessions are logged/.test(u.text)) && noEvidence.assessment.unknowns.some(u => /No recorded baseline/.test(u.text)))
  const noEquip = await gen({ equipment: [] })
  check('shape: no equipment -> no band/dumbbell/med-ball work', !JSON.stringify(noEquip.sessions).match(/Light band|dumbbell|Medicine ball/i) && noEquip.qualityReport!.checks.every(c => c.ok))
  const indoor = await gen({ indoorAccess: true, outdoorAccess: false })
  check('shape: indoor only excludes outdoor-only drills', !indoor.sessions.flatMap(s => s.blocks.flatMap(x => x.drills)).some(d => /Drop Step Fly Ball|Thrown Fly Ball|Over the Shoulder/.test(d.name)))
  const small = await gen({ age: 7 })
  check('shape: age filtering is applied (min_age respected)', small.qualityReport!.checks.every(c => c.ok))
  const rotated = rankSkills(b, CHARLIE_EVIDENCE)
  check('priorities: pitching readiness is capped while the arm rests', rotated.find(s => s.skill === 'pitching_readiness')!.priority >= 5)
  const alloc = allocateBlocks(rotated, 10)
  check('allocation: sums to capacity, strength gets two, nobody gets zero', Object.values(alloc).reduce((a, c) => a + c, 0) === 10 && alloc.strength_athleticism === 2 && Object.values(alloc).every(v => v >= 1), JSON.stringify(alloc))

  // ── structured output & integrity ────────────────────────────────────────
  const payload = toSavePayload(draft)
  check('payload: one row per session, no duplicate keys', new Set(payload.sessions.map(s => s.session_key)).size === payload.sessions.length)
  check('payload: drill positions are contiguous from 0 in every session', payload.sessions.every(s => s.drills.every((d: any, i: number) => d.position === i)))
  check('payload: end date covers the last session', payload.program.end_date >= draft.sessions[draft.sessions.length - 1].date)
  check('payload: player history is not copied wholesale', JSON.stringify(payload.program.source).length < 60000 && !('contextText' in payload.program.source))
  const bad = JSON.parse(JSON.stringify(draft)); bad.sessions[0].date = 'tomorrow'
  check('schema: a bad date is rejected', !DraftSchema.safeParse(bad).success)
  const dup = JSON.parse(JSON.stringify(draft)); dup.sessions.push(JSON.parse(JSON.stringify(dup.sessions[0])))
  check('validator: duplicate session ids are caught', validateDraft(dup).some(c => c.id === 'unique_sessions' && !c.ok))
  const missingDrill = JSON.parse(JSON.stringify(draft)); missingDrill.sessions.find((s: any) => s.kind === 'coached').blocks[1].drills[0].drillId = '99999999-9999-4999-8999-999999999999'
  check('validator: an unknown drill id is caught', validateDraft(missingDrill, { drillIds: ids }).some(c => c.id === 'drill_ids' && !c.ok))
  const noSkill = JSON.parse(JSON.stringify(draft)); noSkill.sessions.forEach((s: any) => { s.blocks = s.blocks.filter((x: any) => x.skill !== 'outfield_tracking'); s.focus = s.focus.filter((f: string) => f !== 'outfield_tracking') })
  check('validator: a silently dropped skill is caught', validateDraft(noSkill).some(c => c.id === 'skills_covered' && !c.ok))
  const noRest = JSON.parse(JSON.stringify(draft)); noRest.sessions = noRest.sessions.filter((s: any) => !(s.week === 3 && s.kind === 'rest'))
  check('validator: a week with no rest day is caught', validateDraft(noRest).some(c => c.id === 'recovery' && !c.ok))
  const badTime = JSON.parse(JSON.stringify(draft)); badTime.sessions.find((s: any) => s.kind === 'coached').blocks[1].minutes += 20
  check('validator: a block over the time budget is caught', validateDraft(badTime).some(c => c.id === 'time_budget' && !c.ok))
  check('validator + repair: a drill minutes mismatch is repaired, not shipped', (() => { const c = JSON.parse(JSON.stringify(draft)); c.sessions.find((s: any) => s.kind === 'coached').blocks[1].drills[0].minutes += 3; const r = repairDraft(c); return r.length > 0 && validateDraft(c).every(x => x.ok) })())
  const gateOpen = JSON.parse(JSON.stringify(draft)); gateOpen.sessions.find((s: any) => s.blocks.some((x: any) => x.skill === 'pitching_readiness')).blocks.find((x: any) => x.skill === 'pitching_readiness').drills[0].name = 'Bullpen: 40 pitches'
  check('validator: pitching volume with a closed gate is caught', validateDraft(gateOpen).some(c => c.id === 'safety' && !c.ok))
  const noGate = JSON.parse(JSON.stringify(draft)); noGate.throwingGate = null
  check('validator: pitching requested but no gate is caught', validateDraft(noGate).some(c => c.id === 'throwing_gate' && !c.ok))

  // ── edits ────────────────────────────────────────────────────────────────
  eq('parse: rest day', parseEdit('Make Thursday a rest day'), { kind: 'rest_day', weekday: 4 })
  eq('parse: show week', parseEdit('Show me Week 4'), { kind: 'show_week', week: 4 })
  eq('parse: days per week', parseEdit('Change this to three days per week'), { kind: 'days_per_week', days: 3 })
  eq('parse: more outfield', parseEdit('Add more outfield work'), { kind: 'more_skill', skill: 'outfield_tracking' })
  eq('parse: indoor replacement', parseEdit('Replace "Tee Work: Stay Back Stride" with one I can do indoors'), { kind: 'replace_drill', target: 'Tee Work: Stay Back Stride', indoor: true })
  eq('parse: unrelated text is not an edit', parseEdit('Thanks, looks great'), null)
  const thursdays = draft.sessions.filter(s => (s.kind === 'coached' || s.kind === 'assessment') && new Date(`${s.date}T00:00:00Z`).getUTCDay() === 4).length
  const rd = applyRestDay(draft, 4)
  check('edit: Thursday becomes a rest day in every week', rd.ok && rd.changed.length === thursdays && !rd.draft.sessions.some(s => (s.kind === 'coached' || s.kind === 'assessment') && new Date(`${s.date}T00:00:00Z`).getUTCDay() === 4))
  check('edit: still five coached sessions and a rest day per week', Array.from({ length: 8 }, (_, i) => i + 1).every(w => rd.draft.sessions.filter(s => s.week === w && (s.kind === 'coached' || s.kind === 'assessment')).length === 5 && rd.draft.sessions.some(s => s.week === w && s.kind === 'rest')))
  check('edit: the independent routine moves with its session', rd.draft.sessions.filter(s => s.kind === 'independent').every(i => rd.draft.sessions.find(c => c.key === i.key.slice(0, -1))!.date === i.date))
  check('edit: the original draft object is untouched', rd.draft !== draft && draft.sessions.some(x => x.origin === 'ai') && !draft.sessions.some(x => x.origin === 'coach'))
  check('edit: result still passes every check', validateDraft(rd.draft).every(c => c.ok), validateDraft(rd.draft).filter(c => !c.ok).map(c => c.detail).join('|'))
  const again = applyRestDay(rd.draft, 4)
  check('edit: a day that is already rest changes nothing and says so', !again.ok && /nothing changed/.test(again.message))
  check('edit: week summary lists every day', weekSummary(draft, 4).split('\n').length >= 8)
  check('edit: a week that does not exist is reported', /no week 12/.test(weekSummary(draft, 12)))
  check('edit: days-per-week produces a new brief, keeping every skill', briefForEdit(b, { kind: 'days_per_week', days: 3 })!.skills.length === 7)
  check('edit: more outfield moves it to the top without dropping anything', (() => { const nb = briefForEdit(b, { kind: 'more_skill', skill: 'outfield_tracking' })!; return nb.skills[0] === 'outfield_tracking' && nb.skills.length === 7 })())
  const rep = applyReplaceDrill(draft, { kind: 'replace_drill', target: 'Tee Work: Stay Back Stride', indoor: true }, DRILL_POOL)
  check('edit: indoor replacement swaps in an eligible indoor drill and edits only that drill', rep.ok && rep.draft.sessions.flatMap(s => s.blocks.flatMap(x => x.drills)).some(d => d.name === 'Indoor Soft-Ball Tee Drill') && !rep.draft.sessions.flatMap(s => s.blocks.flatMap(x => x.drills)).some(d => d.name === 'Tee Work: Stay Back Stride'), rep.message)
  const noAlt = applyReplaceDrill(draft, { kind: 'replace_drill', target: 'Over the Shoulder Catches', indoor: true }, DRILL_POOL)
  check('edit: no eligible indoor alternative leaves the draft alone and says so', !noAlt.ok && noAlt.draft === draft && /left it alone/.test(noAlt.message), noAlt.message)
  check('edit: an unnamed drill asks which one', !applyReplaceDrill(draft, { kind: 'replace_drill', target: null, indoor: true }, DRILL_POOL).ok)

  // ── progress & adaptation ────────────────────────────────────────────────
  const R = (slug: string, value: number, on: string, over: Partial<ProgramReading> = {}): ProgramReading => ({ id: `${slug}${on}`, metric_type_id: null, metric: slug, value, unit: null, attempts: null, successes: null, measured_on: on, note: null, slug, checkpoint: 'session', conditions: null, ...over })
  const sprint = { slug: 'sprint_5y', label: '5 yard acceleration', unit: 'sec', direction: 'lower' as const, shape: 'measurement' as const }
  eq('progress: nothing recorded', summariseAssessment(sprint, []).direction, 'not_enough_data')
  eq('progress: only a baseline is not a comparison', summariseAssessment(sprint, [R('sprint_5y', 1.4, '2026-11-09', { checkpoint: 'baseline' })]).direction, 'not_enough_data')
  const two = summariseAssessment(sprint, [R('sprint_5y', 1.4, '2026-11-09', { checkpoint: 'baseline' }), R('sprint_5y', 1.3, '2026-12-04', { checkpoint: 'midpoint' })])
  check('progress: lower-is-better direction is read correctly', two.direction === 'improved' && two.confidence === 'low' && /direction only, not a trend/.test(two.note), JSON.stringify(two))
  eq('progress: a 1% wobble is "about the same"', summariseAssessment(sprint, [R('sprint_5y', 1.4, '2026-11-09'), R('sprint_5y', 1.39, '2026-12-04')]).direction, 'about_the_same')
  const three3 = summariseAssessment(sprint, [R('sprint_5y', 1.4, '2026-11-09'), R('sprint_5y', 1.35, '2026-12-04'), R('sprint_5y', 1.25, '2027-01-02')])
  check('progress: three readings reach moderate confidence', three3.confidence === 'moderate' && three3.direction === 'improved')
  const chal = { slug: 'first_step_pct', label: 'Correct first step', unit: null, direction: 'higher' as const, shape: 'challenge' as const }
  const lowN = summariseAssessment(chal, [R('first_step_pct', 40, '2026-11-09', { attempts: 5, successes: 2 }), R('first_step_pct', 60, '2026-12-04', { attempts: 5, successes: 3 })])
  check('progress: a challenge scored out of 5 is low confidence', lowN.confidence === 'low' && lowN.direction === 'improved')
  const comp = (n: number, skill: any, r: 'easy' | 'right' | 'hard', pain = false) => ({ sessionKey: `w${n}d1`, date: `2026-11-${String(9 + n).padStart(2, '0')}`, skills: [skill], ratings: { [skill]: r }, painReported: pain })
  const oneEasy = proposeAdjustments({ completions: [comp(1, 'hitting', 'easy')], lines: [], skills: ['hitting'] })
  check('adapt: one easy session changes nothing', oneEasy.every(p => p.changes.length === 0) && oneEasy[0].action === 'maintain')
  const threeEasy = proposeAdjustments({ completions: [comp(1, 'hitting', 'easy'), comp(2, 'hitting', 'easy'), comp(3, 'hitting', 'easy')], lines: [], skills: ['hitting'] })
  check('adapt: three easy sessions propose advancing', threeEasy.some(p => p.action === 'advance'))
  check('adapt: an unusually bad session does not regress the plan', !proposeAdjustments({ completions: [comp(1, 'hitting', 'easy'), comp(2, 'hitting', 'easy'), comp(3, 'hitting', 'hard')], lines: [], skills: ['hitting'] }).some(p => p.action === 'regress' || p.action === 'advance'))
  check('adapt: two hard sessions propose an easier variation', proposeAdjustments({ completions: [comp(1, 'hitting', 'right'), comp(2, 'hitting', 'hard'), comp(3, 'hitting', 'hard')], lines: [], skills: ['hitting'] }).some(p => p.action === 'regress'))
  const pain = proposeAdjustments({ completions: [comp(1, 'pitching_readiness', 'right', true)], lines: [], skills: ['pitching_readiness'] })
  check('adapt: pain pauses throwing immediately, even from one session', pain.some(p => p.action === 'pause' && p.changes.some(c => c.op === 'pause_throwing')))
  const planned = summariseAssessment(sprint, [R('sprint_5y', 1.4, '2026-11-09'), R('sprint_5y', 1.25, '2026-12-04')])
  const react = summariseAssessment(chal, [R('first_step_pct', 50, '2026-11-09', { attempts: 10, successes: 5 }), R('first_step_pct', 50, '2026-12-04', { attempts: 10, successes: 5 })])
  const mod = proposeAdjustments({ completions: [], lines: [planned, react], skills: ['first_step'] })
  check('adapt: planned starts improve but reaction does not -> propose reaction starts, as a recommendation', mod.some(p => p.action === 'modify' && /reaction-based starts/.test(p.summary) && p.changes[0].op === 'add_drill'))
  const before2 = draft.sessions.map(s => ({ ...s }))
  const applied = applyChanges(draft.sessions, [{ op: 'add_drill', skill: 'first_step', exerciseKey: 'reaction_start', minutes: 8 }], '2026-11-23')
  check('adapt: approved change touches only future sessions', applied.touched.length > 0 && applied.sessions.filter(s => s.date < '2026-11-23').every((s, i) => JSON.stringify(s) === JSON.stringify(draft.sessions.find(o => o.key === s.key))))
  check('adapt: changed sessions still fit their time budget', applied.sessions.filter(s => s.kind === 'coached').every(s => s.blocks.reduce((a, x) => a + x.minutes, 0) === s.minutes && s.blocks.every(x => x.drills.reduce((a, d) => a + d.minutes, 0) === x.minutes)))
  check('adapt: the input sessions are not mutated', JSON.stringify(before2) === JSON.stringify(draft.sessions.map(s => ({ ...s }))))
  const paused = applyChanges(draft.sessions, [{ op: 'pause_throwing' }], '2026-11-09')
  check('adapt: pausing removes throwing blocks only', paused.sessions.every(s => !s.blocks.some(x => x.kind === 'throwing')) && paused.sessions.some(s => s.blocks.some(x => x.skill === 'hitting')))
  const eased = applyChanges(draft.sessions, [{ op: 'progress', skill: 'hitting' }], '2026-11-09')
  check('adapt: advancing never reaches game-speed intensity on its own', eased.sessions.flatMap(s => s.blocks.filter(x => x.skill === 'hitting').flatMap(x => x.drills)).every(d => d.intensity !== 'game_speed' || draft.sessions.flatMap(s => s.blocks.flatMap(x => x.drills)).some(o => o.name === d.name && o.intensity === 'game_speed')))

  // ── evidence mapping ─────────────────────────────────────────────────────
  const ev = evidenceFromContext({
    player: { name: 'Charlie', age: 9 }, observations: [
      { date: '2026-10-12', prompt_key: null, entry_type: 'lesson', body: 'Hands drift forward during the stride; hitting is early.' },
      { date: '2026-10-20', prompt_key: null, entry_type: 'game', body: 'Went well: 8-for-8 across two games.' },
    ], metrics: [], pathways: { scope: 'player', omitted: 0, historyTruncated: false, entries: [{ progressId: 'p1', playerId: PID, playerName: 'Charlie', pathwayName: 'Load to Launch', status: 'active', startedOn: '2026-10-01', stageStartedOn: '2026-10-01', completedOn: null, stage: { number: 2, total: 6, name: 'Stay Back', objective: null, whyItMatters: null, coachingEmphasis: null, masterySignals: [], failureModes: [] }, stageUnavailable: false, masteryRecorded: null, sessionsAtStage: 0, sessionsTotal: 0, recentEvents: [], hasRecordedWork: false }] },
  } as any, TODAY, { pitchOutings: [] })
  check('evidence: negative observation is a need, positive is a strength', ev.items.some(i => i.bucket === 'needs' && /drift/.test(i.text)) && ev.items.some(i => i.bucket === 'strengths' && /8-for-8/.test(i.text)))
  check('evidence: observations are labelled coach_observation with dates', ev.items.filter(i => /drift|8-for-8/.test(i.text)).every(i => i.source === 'coach_observation' && i.on))
  check('evidence: a plan with no recorded sessions says "not the same as none done"', ev.items.some(i => /no sessions recorded against it yet \(not the same as none done\)/.test(i.text)))
  check('evidence: no pitch counts -> unknown, not zero', ev.items.some(i => i.bucket === 'unknowns' && /No pitch counts/.test(i.text)))
  check('evidence: pathway mapped to a skill', ev.pathways[0].skill === 'hitting')
  eq('evidence: recent logged items counted', ev.loggedSessions60d, 2)

  // ── chat plumbing ────────────────────────────────────────────────────────
  const roster = [{ playerId: 'a', name: 'Charlie Smith' }, { playerId: 'b', name: 'Dylan Jones' }, { playerId: 'c', name: 'Charlie Brown' }]
  eq('chat: scoped player wins', (resolvePlayer('x', 'b', roster) as any).playerId, 'b')
  eq('chat: unique name resolves', (resolvePlayer('program for Dylan', null, roster) as any).playerId, 'b')
  check('chat: two Charlies are ambiguous, never guessed', 'ambiguous' in (resolvePlayer('program for Charlie', null, roster) as any))
  check('chat: full name disambiguates', (resolvePlayer('program for Charlie Brown', null, roster) as any).playerId === 'c')
  eq('chat: nobody named -> asks', resolvePlayer('build a program', null, roster), null)
  eq('chat: a scoped id not on the roster resolves to nothing', resolvePlayer('x', 'zzz', roster), null)
  const msg = renderProgramMessage(draft, 'Charlie')
  check('chat: message lists every skill', b.skills.every(s => draft.skills.find(x => x.skill === s) && msg.includes(draft.skills.find(x => x.skill === s)!.label)))
  check('chat: message labels evidence by source and says nothing is saved', /Coach observation/.test(msg) && /nothing is saved until you review and approve/i.test(msg))
  check('chat: message states assumptions and the closed gate', /Assumptions I made/.test(msg) && /throwing gate starts closed/.test(msg))
  check('chat: message covers the weekly schedule with a rest day', /rest/.test(msg.split('**Week 1**')[1] || ''))
  check('flag: off by default', programsEnabled({}) === false && programsEnabled({ NEXT_PUBLIC_DEVELOPMENT_PROGRAMS: 'on' }) === true)

  // ── scoping: every store read and write is bounded by the team ───────────
  const calls: Array<{ table: string; eqs: Record<string, any> }> = []
  const fake = (rows: any = null) => ({
    from(table: string) {
      const rec = { table, eqs: {} as Record<string, any> }; calls.push(rec)
      const q: any = {
        select: () => q, update: () => q, insert: () => q, order: () => q, limit: () => q, in: () => q, is: () => q, neq: () => q,
        eq(k: string, v: any) { rec.eqs[k] = v; return q },
        maybeSingle: async () => ({ data: rows, error: null }), single: async () => ({ data: rows, error: null }),
        then: (res: any) => res({ data: rows ? [rows] : [], error: null }),
      }
      return q
    },
  })
  const scoped = async (name: string, fn: (db: any) => Promise<any>, table: string) => {
    calls.length = 0
    try { await fn(fake(null)) } catch (e) { check(`${name}: another team's id finds nothing`, e instanceof StoreError && (e.code === 'not_found' || e.code === 'conflict'), String(e)) ; check(`${name}: query was scoped by team_id`, calls.some(c => c.table === table && c.eqs.team_id === 'T1'), JSON.stringify(calls)); return }
    check(`${name}: query was scoped by team_id`, calls.some(c => c.table === table && c.eqs.team_id === 'T1'), JSON.stringify(calls))
  }
  await scoped('getDraft', db => getDraft(db, 'D1', 'T1'), 'development_program_drafts')
  await scoped('loadProgram', db => loadProgram(db, 'P1', 'T1'), 'development_programs')
  await scoped('updateDraft', db => updateDraft(db, 'D1', 'T1', 1, draft), 'development_program_drafts')
  await scoped('openDraftForThread', db => openDraftForThread(db, 'TH', 'T1'), 'development_program_drafts')
  await scoped('discardDraft', db => discardDraft(db, 'D1', 'T1'), 'development_program_drafts')
  const stale = await updateDraft(fake(null), 'D1', 'T1', 3, draft).then(() => 'ok', e => e as StoreError)
  check('save: a stale version is a conflict, not an overwrite', stale instanceof StoreError && stale.code === 'conflict')
  const invalid = await updateDraft(fake({ id: 'x', version: 2 }), 'D1', 'T1', 1, { ...draft, sessions: [] } as any).then(() => 'ok', e => e as StoreError)
  check('save: an invalid draft is refused before it reaches the database', invalid instanceof StoreError && invalid.code === 'invalid')
  const rows = (draft.sessions.slice(0, 3)).map((s, i) => ({ session_key: s.key, week: s.week, scheduled_date: s.date, kind: s.kind, supervision: s.supervision, title: s.title, focus: s.focus, est_minutes: s.minutes, checkpoint: s.checkpoint, assessments: s.assessments, requires_throwing_gate: s.requiresThrowingGate, coach_note: s.coachNote, filming_note: s.filmingNote, equipment: s.equipment, origin: s.origin,
    drills: toSavePayload(draft).sessions[i].drills.map((d: any) => ({ ...d, drill_id: d.drill_id, exercise_key: d.exercise_key })) }))
  const roundTrip = sessionsFromRows(rows)
  check('round trip: saved rows rebuild the same sessions', JSON.stringify(roundTrip.map(s => [s.key, s.minutes, s.blocks.map(x => x.drills.map(d => [d.name, d.minutes]))])) === JSON.stringify(draft.sessions.slice(0, 3).map(s => [s.key, s.minutes, s.blocks.map(x => x.drills.map(d => [d.name, d.minutes]))])))
  check('round trip: a revision patch carries only the touched sessions', patchFromSessions(roundTrip, [roundTrip[0].key]).length === 1)

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`)
  process.exit(failures === 0 ? 0 : 1)
}
main().catch(e => { console.error(e); process.exit(1) })
