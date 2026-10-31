// Speed, Agility & Explosiveness program — template, rules, routes.
//
//   npm run test:speed-program
//
// Pure tests plus static rules about the routes. Database access rules are
// proved in Postgres by test:migration-081; the browser flow by
// test:speed-program-e2e.

import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import path from 'path'
import {
  EXERCISES, EXERCISE_BY_KEY, LEVEL_DEFS, LEVELS, SESSION_KEYS, WEEKS, PROGRESSIONS, GUARDRAILS, TEMPLATE_KEY, TEMPLATE_VERSION,
  templateSnapshot, type SessionKey, type LevelKey,
} from '../lib/speedProgram/template'
import {
  effectivePlan, validateIntake, validateAssignmentInput, validateAdjustment, validateReferenceUrl, validateSessionInput,
  validateAdvanceInput, decideAdvance, eligibility, guidance, recommendedDays, scheduleWarning, weekSessions,
  validateAssessmentInput, compareAssessments, assessmentSummary, buildPlan,
  type AssignmentCore, type SessionRecord, type PlanEvent, type SessionInput,
} from '../lib/speedProgram/rules'
import { NEW_DRILLS, SPEED_PATHWAY } from './fixtures/speed-agility'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

const core = (over: Partial<AssignmentCore> = {}): AssignmentCore => ({
  level: 'development', space: 'outdoor_open', current_week: 1, days_per_week: 3, unlocks: [], status: 'active', plan: buildPlan(), ...over,
})
const TODAY = '2026-11-02'
const ok = <T,>(r: { ok: boolean } & any): T => { if (!r.ok) throw new Error(r.error); return r.value }

let n = 0
const dayN = (i: number) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10)
const sess = (over: Partial<SessionRecord> = {}): SessionRecord => ({
  id: `s${++n}`, week: 1, session_key: 'A', status: 'completed', occurred_on: dayN(n),
  created_at: `${dayN(n)}T12:00:00Z`, landing: null, braking: 2, reaction: 2, fatigue: 'some', pain_flag: false, ...over,
})

async function main() {
  // ── template: the specification's own numbers ─────────────────────────────
  const dev = LEVEL_DEFS.development.sessions
  const row = (k: SessionKey, ex: string) => dev[k].items.find(i => i.exercise === ex)!
  check('Development Day A: wall drive 2 × 5 per leg, 30 sec', row('A', 'wall_drive').sets === 2 && row('A', 'wall_drive').reps === 5 && row('A', 'wall_drive').rest![0] === 30)
  check('Day A: falling start 4 reps, 45–60 sec', row('A', 'falling_start').reps === 4 && row('A', 'falling_start').rest!.join() === '45,60')
  check('Day A: 10-yard acceleration 3 reps, 60–90 sec, indoor substitute is the spec text',
    row('A', 'accel_10').reps === 3 && row('A', 'accel_10').rest!.join() === '60,90' && /2–3-yard takeoff and brake/.test(row('A', 'accel_10').indoorSubstitute!))
  check('Day A: cone reaction chase 4 reps, 45–60 sec', row('A', 'cone_reaction_chase').reps === 4 && row('A', 'cone_reaction_chase').rest!.join() === '45,60')
  check('Day B: shuffle 2 × 2 trips per side 30 sec; plant 3 each direction; half-circle 2 each; 4 field rounds',
    row('B', 'shuffle_stop').sets === 2 && row('B', 'shuffle_stop').reps === 2 && row('B', 'shuffle_plant_accel').reps === 3 &&
    row('B', 'half_circle_cut').reps === 2 && row('B', 'react_roll_field').reps === 4 && row('B', 'react_roll_field').rest!.join() === '30,45')
  check('Day C: pogo 2 × 8 / 45 sec; broad jump 3 × 2 / 45–60; skater 2 × 3 each side; infield 4–6 rounds',
    row('C', 'pogo_jumps').sets === 2 && row('C', 'pogo_jumps').reps === 8 && row('C', 'broad_jump_freeze').sets === 3 && row('C', 'broad_jump_freeze').reps === 2 &&
    row('C', 'skater_step_stick').sets === 2 && row('C', 'skater_step_stick').reps === 3 && row('C', 'infield_react_throw').reps === '4–6')
  check('Day C: the outdoor broad jump into acceleration is optional, gated and replaces rather than adds',
    row('C', 'broad_to_accel').optional === true && row('C', 'broad_to_accel').gate === 'broad_jump_to_sprint' && /Replace an exercise rather than adding/.test(row('C', 'broad_to_accel').note!))
  check('Day C: the skater exercise is step-only until the hop is unlocked', row('C', 'skater_step_stick').gate === 'skater_hop' && /No hop yet/.test(row('C', 'skater_step_stick').lockedText!))
  check('three levels, three sessions each, four weeks', LEVELS.length === 3 && SESSION_KEYS.every(k => LEVELS.every(l => LEVEL_DEFS[l].sessions[k])) && WEEKS.length === 4)
  check('weeks are Learn → Build → Transfer → Integrate and assess', WEEKS.map(w => w.name).join() === 'Learn,Build,Transfer,Integrate and assess')
  check('age bands are advisory, never gates', LEVELS.every(l => /Advisory only/.test(LEVEL_DEFS[l].typicalFit)))

  const fd = LEVEL_DEFS.foundation.sessions
  check('Foundation: one set of every movement', SESSION_KEYS.every(k => fd[k].items.filter(i => i.exercise !== 'warmup').every(i => i.sets === 1)))
  check('Foundation: starts are 2–3, no rep above 4', SESSION_KEYS.every(k => fd[k].items.every(i => i.exercise === 'warmup' || typeof i.reps === 'string' || i.reps <= 4)) &&
    fd.A.items.find(i => i.exercise === 'falling_start')!.reps === '2–3')
  check('Foundation: no timed or maximal races, low jumps', /Not timed, not a race/.test(fd.A.items.find(i => i.exercise === 'accel_10')!.note!) && /Low, comfortable jumps/.test(fd.C.items.find(i => i.exercise === 'broad_jump_freeze')!.note!))
  check('Foundation: two sessions a week; Development and Advanced three', LEVEL_DEFS.foundation.sessionsPerWeek === 2 && LEVEL_DEFS.development.sessionsPerWeek === 3 && LEVEL_DEFS.advanced.sessionsPerWeek === 3)
  const adv = LEVEL_DEFS.advanced.sessions
  check('Advanced: 4–6 quality reps, rest is a floor the coach sets (no invented numbers)',
    adv.A.items.find(i => i.exercise === 'falling_start')!.reps === '4–6' && /Coach sets it/.test(adv.A.items.find(i => i.exercise === 'wall_drive')!.restNote!))
  check('Foundation and Advanced are marked as unreviewed drafts; Development is the source', LEVEL_DEFS.foundation.review === 'draft' && LEVEL_DEFS.advanced.review === 'draft' && LEVEL_DEFS.development.review === 'source')
  check('guardrails keep the indoor limit and the pain rule', GUARDRAILS.some(g => /20×15 ft/.test(g) && /Not full 10-yard sprints/.test(g)) && GUARDRAILS.some(g => /pain/i.test(g)))

  // ── mapping to canonical drills ───────────────────────────────────────────
  const known = new Set<string>([...NEW_DRILLS.map(d => d.name), ...SPEED_PATHWAY.stages.flatMap(s => s.drills.map(d => d.drill))])
  const mapped = EXERCISES.filter(e => e.drillMap.name)
  check('every mapped drill name is a real drill in the existing speed pathway', mapped.every(e => known.has(e.drillMap.name!)), mapped.filter(e => !known.has(e.drillMap.name!)).map(e => e.drillMap.name).join('; '))
  check('every exercise has a mapping entry; "none" has no name and "exact"/"close" have one',
    EXERCISES.every(e => e.drillMap) && EXERCISES.filter(e => e.drillMap.match === 'none').every(e => e.drillMap.name === null) && EXERCISES.filter(e => ['exact', 'close'].includes(e.drillMap.match)).every(e => e.drillMap.name))
  check('exactly two exercises have no library drill (skater step, half-circle only partial)', EXERCISES.filter(e => e.drillMap.match === 'none').map(e => e.key).join() === 'skater_step_stick' &&
    EXERCISES.find(e => e.key === 'half_circle_cut')!.drillMap.match === 'partial')
  check('every prescription points at a defined exercise', LEVELS.every(l => SESSION_KEYS.every(k => LEVEL_DEFS[l].sessions[k].items.every(i => EXERCISE_BY_KEY[i.exercise]))))

  // ── references: credited, unreviewed, removable, never "verified" ─────────
  const refs = EXERCISES.flatMap(e => e.references)
  check('every reference is https Instagram, credited, and unreviewed', refs.length >= 9 && refs.every(r => /^https:\/\/www\.instagram\.com\/reel\/[\w-]+\/$/.test(r.url) && r.creator && r.title && r.status === 'unreviewed'))
  check('no reference or text claims verification or approval', !/verified|approved/i.test(JSON.stringify(EXERCISES.map(e => e.references))))
  check('no reference carries a URL on a drill record or in the library mapping', EXERCISES.every(e => !/https?:/.test(JSON.stringify(e.drillMap))))

  // ── snapshot ──────────────────────────────────────────────────────────────
  const snap = buildPlan()
  snap.levels.development.sessions.A.items[1].reps = 99
  check('a snapshot is a copy: changing it never reaches the template', LEVEL_DEFS.development.sessions.A.items[1].reps === 5 && buildPlan().levels.development.sessions.A.items[1].reps === 5)
  check('the snapshot carries its template version and all three levels', snap.template.key === TEMPLATE_KEY && snap.template.version === TEMPLATE_VERSION && Object.keys(snap.levels).length === 3)

  // ── effective plan: space, gates, adjustments ─────────────────────────────
  let plan = effectivePlan(core(), [])
  check('outdoors the 10-yard acceleration is as written', plan.A.items.find(i => i.exercise === 'accel_10')!.space === 'as_written')
  const indoor = effectivePlan(core({ space: 'indoor_small' }), [])
  check('indoors (20×15 ft) the 10-yard and the 5-yard starts become short controlled takeoffs',
    indoor.A.items.find(i => i.exercise === 'accel_10')!.space === 'indoor_substitute' && /2–3-yard/.test(indoor.A.items.find(i => i.exercise === 'accel_10')!.indoorText!) &&
    indoor.A.items.find(i => i.exercise === 'falling_start')!.space === 'indoor_substitute')
  check('the optional outdoor broad jump into a sprint is hidden until unlocked', !plan.C.items.some(i => i.exercise === 'broad_to_accel'))
  check('...and when unlocked outdoors it appears', effectivePlan(core({ unlocks: ['broad_jump_to_sprint'] }), []).C.items.some(i => i.exercise === 'broad_to_accel'))
  check('...but never indoors', !effectivePlan(core({ space: 'indoor_small', unlocks: ['broad_jump_to_sprint'] }), []).C.items.some(i => i.exercise === 'broad_to_accel'))
  const sk = plan.C.items.find(i => i.exercise === 'skater_step_stick')!
  check('the skater exercise shows the step-only text while locked', sk.locked && /No hop yet/.test(sk.note!))
  check('...and the unlocked text once the hop is unlocked', !effectivePlan(core({ unlocks: ['skater_hop'] }), []).C.items.find(i => i.exercise === 'skater_step_stick')!.locked)
  check('every session observes at least one score; landing is only in session C', plan.A.observes.length > 0 && plan.C.observes.includes('landing') && !plan.A.observes.includes('landing') && !plan.B.observes.includes('landing'))

  const adjRes = validateAdjustment({ kind: 'exercise', session: 'A', exercise: 'wall_drive', set: { sets: 1, reps: 4, note: 'Sore calf earlier this week' } }, core())
  check('a coach can change sets, reps and notes', adjRes.ok)
  const ev: PlanEvent[] = [{ event_type: 'adjustment', detail: ok<any>(adjRes) }]
  const adjusted = effectivePlan(core(), ev)
  const wd = adjusted.A.items.find(i => i.exercise === 'wall_drive')!
  check('the change shows in the effective plan and is marked modified', wd.sets === 1 && wd.reps === 4 && wd.modified && wd.note === 'Sore calf earlier this week')
  check('...while the snapshot itself is untouched', core().plan.levels.development.sessions.A.items[1].sets === 2 && effectivePlan(core(), []).A.items.find(i => i.exercise === 'wall_drive')!.sets === 2)
  const rm = effectivePlan(core(), [{ event_type: 'adjustment', detail: ok<any>(validateAdjustment({ kind: 'exercise', session: 'B', exercise: 'half_circle_cut', remove: true }, core())) }])
  check('a coach can remove an exercise from one session only', !rm.B.items.some(i => i.exercise === 'half_circle_cut') && effectivePlan(core(), []).B.items.some(i => i.exercise === 'half_circle_cut'))
  check('the warm-up cannot be removed', !validateAdjustment({ kind: 'exercise', session: 'A', exercise: 'warmup', remove: true }, core()).ok)
  check('bad adjustments are refused (unknown exercise, wrong session, huge numbers)',
    !validateAdjustment({ kind: 'exercise', session: 'A', exercise: 'nope', set: { sets: 1 } }, core()).ok &&
    !validateAdjustment({ kind: 'exercise', session: 'A', exercise: 'pogo_jumps', set: { sets: 1 } }, core()).ok &&
    !validateAdjustment({ kind: 'exercise', session: 'A', exercise: 'wall_drive', set: { sets: 40 } }, core()).ok &&
    !validateAdjustment({ kind: 'exercise', session: 'A', exercise: 'wall_drive', set: { rest: [90, 30] } }, core()).ok)
  const hidden = effectivePlan(core(), [{ event_type: 'adjustment', detail: ok<any>(validateAdjustment({ kind: 'reference', exercise: 'wall_drive', action: 'hide' }, core())) }])
  check('a coach can remove a video reference', hidden.A.items.find(i => i.exercise === 'wall_drive')!.references.length === 0 && effectivePlan(core(), []).A.items.find(i => i.exercise === 'wall_drive')!.references.length === 1)
  const rep = validateAdjustment({ kind: 'reference', exercise: 'wall_drive', action: 'replace', url: 'https://www.youtube.com/watch?v=abc123', creator: 'A Coach', title: 'Wall drives' }, core())
  const replaced = effectivePlan(core(), [{ event_type: 'adjustment', detail: ok<any>(rep) }]).A.items.find(i => i.exercise === 'wall_drive')!.references[0]
  check('...or replace it, still credited and still unreviewed', replaced.creator === 'A Coach' && replaced.status === 'unreviewed' && replaced.added === true)
  check('reference links must be https Instagram or YouTube, nothing else',
    validateReferenceUrl('https://www.instagram.com/reel/x/').ok && validateReferenceUrl('https://youtu.be/abc').ok &&
    !validateReferenceUrl('http://www.instagram.com/reel/x/').ok && !validateReferenceUrl('javascript:alert(1)').ok &&
    !validateReferenceUrl('https://evil.example/reel/x/').ok && !validateReferenceUrl('https://user:pw@www.instagram.com/x').ok && !validateReferenceUrl('https://www.instagram.com.evil.example/').ok)
  check('a replacement link must credit its creator', !validateAdjustment({ kind: 'reference', exercise: 'wall_drive', action: 'replace', url: 'https://youtu.be/abc' }, core()).ok)

  // ── intake, schedule ──────────────────────────────────────────────────────
  const intake = { age_band: '9-12', training_background: 'plays rec ball', weekly_games: 1, weekly_hard_practices: 1, space: 'outdoor_open', goals: 'first step', notes: '' }
  check('a valid intake is accepted; age is a band, not a birthdate', validateIntake(intake).ok && !('birth_date' in ok<any>(validateIntake(intake))))
  check('bad intakes are refused', !validateIntake({ ...intake, space: 'backyard' }).ok && !validateIntake({ ...intake, weekly_games: -1 }).ok && !validateIntake({ ...intake, goals: 'x'.repeat(301) }).ok && !validateIntake({ ...intake, age_band: '10' }).ok)
  check('no games or hard practices: Development suggests 3, Foundation 2', recommendedDays('development', 0, 0).days === 3 && recommendedDays('foundation', 0, 0).days === 2)
  check('games and hard practices reduce the dedicated sessions (never below 1)', recommendedDays('development', 1, 1).days === 1 && recommendedDays('development', 1, 0).days === 2 && recommendedDays('development', 3, 3).days === 1)
  check('picking more than the load allows warns, it does not block', scheduleWarning(3, 1, 1) !== null && scheduleWarning(1, 1, 1) === null && validateAssignmentInput({ level: 'development', daysPerWeek: 3, intake }).ok)
  check('sessions per week must be 1–3', !validateAssignmentInput({ level: 'development', daysPerWeek: 4, intake }).ok && !validateAssignmentInput({ level: 'expert', intake }).ok)
  check('weekly pattern: 3 days A-B-C; 2 days alternate B and C; 1 day rotates',
    weekSessions(3, 1).join() === 'A,B,C' && weekSessions(2, 1).join() === 'A,B' && weekSessions(2, 2).join() === 'A,C' && weekSessions(1, 1).join() === 'A' && weekSessions(1, 2).join() === 'B' && weekSessions(1, 3).join() === 'C')

  // ── logging a session ─────────────────────────────────────────────────────
  const base = { week: 1, session_key: 'C', status: 'completed', occurred_on: TODAY, performed: [{ exercise: 'pogo_jumps', sets_done: 2, reps_done: '8' }], landing: 2, reaction: 2, braking: 2, fatigue: 'some', effort: 'just_right', pain_flag: false }
  check('a completed session is accepted', validateSessionInput(base, core(), plan, TODAY).ok)
  check('a score outside 0–2 is refused', !validateSessionInput({ ...base, landing: 3 }, core(), plan, TODAY).ok && !validateSessionInput({ ...base, landing: 1.5 }, core(), plan, TODAY).ok)
  check('landing cannot be scored in a session that has no jumps', !validateSessionInput({ ...base, session_key: 'A', performed: [], landing: 2 }, core(), plan, TODAY).ok)
  check('an exercise from another session is refused', !validateSessionInput({ ...base, performed: [{ exercise: 'wall_drive', sets_done: 1 }] }, core(), plan, TODAY).ok)
  check('a week beyond the current week, a future date and an old date are refused',
    !validateSessionInput({ ...base, week: 2 }, core(), plan, TODAY).ok && !validateSessionInput({ ...base, occurred_on: '2026-12-25' }, core(), plan, TODAY).ok && !validateSessionInput({ ...base, occurred_on: '2024-01-01' }, core(), plan, TODAY).ok)
  check('a paused or finished program takes no new sessions', !validateSessionInput(base, core({ status: 'paused' }), plan, TODAY).ok && !validateSessionInput(base, core({ status: 'completed' }), plan, TODAY).ok)
  const skipped = validateSessionInput({ week: 1, session_key: 'B', status: 'skipped', skip_reason: 'game', occurred_on: TODAY }, core(), plan, TODAY)
  check('a session can be skipped with a reason, and has no scores', skipped.ok && ok<SessionInput>(skipped).landing === null && ok<SessionInput>(skipped).skip_reason === 'game')
  check('a skipped session needs a reason and cannot be scored', !validateSessionInput({ week: 1, session_key: 'B', status: 'skipped', occurred_on: TODAY }, core(), plan, TODAY).ok && !validateSessionInput({ week: 1, session_key: 'B', status: 'skipped', skip_reason: 'game', occurred_on: TODAY, braking: 2 }, core(), plan, TODAY).ok)
  check('a pain flag is accepted on a completed or a skipped session', validateSessionInput({ ...base, pain_flag: true, pain_note: 'left calf' }, core(), plan, TODAY).ok && validateSessionInput({ week: 1, session_key: 'B', status: 'skipped', skip_reason: 'sick', pain_flag: true, occurred_on: TODAY }, core(), plan, TODAY).ok)

  // ── guidance: never more after a bad day ──────────────────────────────────
  check('no sessions: start', guidance([]).state === 'start')
  check('pain: hold, with no advance', guidance([sess({ pain_flag: true })]).state === 'hold')
  check('a 0 or high fatigue: reduce, not add', guidance([sess({ landing: 0 })]).state === 'reduce' && guidance([sess({ fatigue: 'high' })]).state === 'reduce')
  check('a 1: repeat the same work', /Repeat the same work/.test(guidance([sess({ braking: 1 })]).message))
  check('good control still does not say "progress now"', !/advance now|move up now/i.test(guidance([sess()]).message) && /two sessions in a row/.test(guidance([sess()]).message))
  check('a skipped session is neutral, not a failure', guidance([sess({ status: 'skipped', braking: null, reaction: null })]).state === 'continue' && !/fail/i.test(guidance([sess({ status: 'skipped', braking: null, reaction: null })]).message))

  // ── the two-session gate ──────────────────────────────────────────────────
  n = 0
  const good1 = sess({ session_key: 'B', braking: 2, reaction: 2 })
  const good2 = sess({ session_key: 'C', landing: 2, braking: null, reaction: 2 })
  let e = eligibility(['landing', 'braking'], [good1, good2], null)
  check('two clean sessions covering landing and braking: eligible', e.eligible && e.blocked === null)
  check('one session is not enough (insufficient, overridable)', eligibility([], [good1], null).blocked === 'insufficient' && eligibility([], [good1], null).canOverride)
  check('a required kind never observed is insufficient', eligibility(['landing'], [good1, sess({ session_key: 'A' })], null).blocked === 'insufficient')
  check('a score of 1 in either session is a quality block', eligibility([], [good1, sess({ braking: 1 })], null).blocked === 'quality')
  check('high fatigue in either session is a quality block', eligibility([], [good1, sess({ fatigue: 'high' })], null).blocked === 'quality')
  check('an older bad session does not count; only the last two do', (() => { const o = sess({ braking: 0, created_at: '2026-01-01T00:00:00Z', occurred_on: '2026-01-01' }); return eligibility([], [o, good1, good2], null).eligible })())
  check('pain in the most recent session blocks outright, with no override', (() => { const x = eligibility([], [good1, good2, sess({ pain_flag: true })], null); return !x.eligible && x.blocked === 'pain' && !x.canOverride })())
  check('pain on a SKIPPED most recent session also blocks', eligibility([], [good1, good2, sess({ status: 'skipped', pain_flag: true, braking: null, reaction: null })], null).blocked === 'pain')
  check('skipped sessions do not count toward the two', eligibility([], [good1, sess({ status: 'skipped', braking: null, reaction: null })], null).blocked === 'insufficient')
  const advAt = '2026-10-12T12:00:00Z'
  check('sessions before the last advance do not count toward the next', (() => { n = 0; const a = sess(), b = sess(); return eligibility([], [a, b], '2026-12-01T00:00:00Z').blocked === 'insufficient' && eligibility([], [a, b], null).eligible })())

  // ── advancing ─────────────────────────────────────────────────────────────
  n = 0
  const s1 = sess({ session_key: 'B' }), s2 = sess({ session_key: 'C', landing: 2, braking: null })
  const wk = decideAdvance(ok(validateAdvanceInput({ kind: 'week' })), { core: core(), sessions: [s1, s2], events: [] })
  check('week advance with two clean sessions is allowed', wk.ok && wk.to === 2 && !wk.overridden)
  const noWk = decideAdvance(ok(validateAdvanceInput({ kind: 'week' })), { core: core(), sessions: [s1], events: [] })
  check('week advance with one session is refused, and says a coach can override', !noWk.ok && /override/.test((noWk as any).error))
  check('an override needs a written reason', !validateAdvanceInput({ kind: 'week', override: true }).ok && !validateAdvanceInput({ kind: 'week', override: true, reason: 'ok' }).ok && validateAdvanceInput({ kind: 'week', override: true, reason: 'Player moves well in games; first week was split by rain' }).ok)
  const ov = decideAdvance(ok(validateAdvanceInput({ kind: 'week', override: true, reason: 'Rain cancelled two sessions this week' })), { core: core(), sessions: [s1], events: [] })
  check('an override is allowed and is recorded as one, with why it was not eligible', ov.ok && ov.overridden && /two completed sessions/.test(JSON.stringify((ov as any).detail.eligibility.reasons)))
  const painful = [s1, s2, sess({ pain_flag: true })]
  const painAdv = decideAdvance(ok(validateAdvanceInput({ kind: 'week', override: true, reason: 'Coach decides this is fine to move up' })), { core: core(), sessions: painful, events: [] })
  check('with pain at the last session even a written override cannot advance', !painAdv.ok && /Pain was reported/.test((painAdv as any).error))
  check('a program in the last week cannot advance a week', !decideAdvance(ok(validateAdvanceInput({ kind: 'week' })), { core: core({ current_week: 4 }), sessions: [s1, s2], events: [] }).ok)
  check('a paused program cannot advance', !decideAdvance(ok(validateAdvanceInput({ kind: 'week' })), { core: core({ status: 'paused' }), sessions: [s1, s2], events: [] }).ok)

  const lvl = decideAdvance(ok(validateAdvanceInput({ kind: 'level' })), { core: core(), sessions: [sess({ session_key: 'B', braking: 2, reaction: 2 }), sess({ session_key: 'C', landing: 2, braking: null, reaction: 2 })], events: [] })
  check('level up needs landing, braking and reaction across the last two sessions', lvl.ok && lvl.to === 'advanced')
  check('level up from the highest level is refused', !decideAdvance(ok(validateAdvanceInput({ kind: 'level' })), { core: core({ level: 'advanced' }), sessions: [s1, s2], events: [] }).ok)
  const lvlNo = decideAdvance(ok(validateAdvanceInput({ kind: 'level' })), { core: core(), sessions: [sess({ session_key: 'A' }), sess({ session_key: 'B' })], events: [] })
  check('level up without ever observing landing is refused', !lvlNo.ok && /landing/.test((lvlNo as any).error))

  const un = (key: string, c = core(), ses = [sess({ session_key: 'B' }), sess({ session_key: 'C', landing: 2, braking: 2, reaction: 2 })], events: PlanEvent[] = []) =>
    decideAdvance(ok(validateAdvanceInput({ kind: 'unlock', key })), { core: c, sessions: ses, events })
  check('skater hop unlocks after controlled landings', un('skater_hop').ok)
  check('an unknown progression is refused', !validateAdvanceInput({ kind: 'unlock', key: 'max_effort_sprints' }).ok)
  check('an unlocked progression cannot be unlocked twice', !un('skater_hop', core({ unlocks: ['skater_hop'] })).ok)
  check('broad jump into a sprint needs Week 3 and outdoor space', !un('broad_jump_to_sprint').ok && un('broad_jump_to_sprint', core({ current_week: 3 })).ok && !un('broad_jump_to_sprint', core({ current_week: 3, space: 'indoor_small' })).ok)
  check('single-leg hops are Advanced only', !un('single_leg_hops').ok && un('single_leg_hops', core({ level: 'advanced' })).ok)
  check('reaction cue games start in Week 2', !un('reactive_partner_cues').ok && un('reactive_partner_cues', core({ current_week: 2 })).ok)
  const stacked: PlanEvent[] = [{ event_type: 'advance', detail: { kind: 'unlock', key: 'skater_hop', week: 1 }, occurred_at: '2026-10-01T00:00:00Z' }]
  const stackedTry = un('reactive_partner_cues', core({ current_week: 2, unlocks: ['skater_hop'] }), [sess({ session_key: 'B' }), sess({ session_key: 'C', landing: 2, braking: 2 })], [{ ...stacked[0], detail: { ...stacked[0].detail, week: 2 } }])
  check('one harder step per week: a second unlock the same week is refused, even with clean sessions', !stackedTry.ok && /One harder step per week/.test((stackedTry as any).error))
  const stackedOverride = decideAdvance(ok(validateAdvanceInput({ kind: 'unlock', key: 'single_leg_hops', override: true, reason: 'Coach wants it now regardless' })), { core: core({ level: 'advanced', current_week: 1, unlocks: ['skater_hop'] }), sessions: [], events: stacked })
  check('...and a written override cannot stack harder steps either', !stackedOverride.ok)
  check('advancing the week is not limited by that rule', decideAdvance(ok(validateAdvanceInput({ kind: 'week' })), { core: core({ current_week: 1 }), sessions: [s1, s2], events: stacked }).ok)

  // ── assessments ───────────────────────────────────────────────────────────
  const timed = (over: any = {}) => ({ kind: 'baseline', method: 'timed', metric_slug: 'sprint_10y', value: 2.31, occurred_on: TODAY, conditions: { location: 'outdoor_open', surface: 'grass', timing_method: 'stopwatch', start_type: 'standing_start' }, ...over })
  check('a timed 10-yard baseline outdoors is accepted, in seconds, distance fixed at 10', (() => { const r = validateAssessmentInput(timed(), core(), TODAY); return r.ok && r.value.unit === 's' && r.value.conditions!.distance_yards === 10 })())
  check('timed sprints are refused in the small indoor space', !validateAssessmentInput(timed({ conditions: { location: 'indoor_small', surface: 'hard_floor', timing_method: 'stopwatch', start_type: 'standing_start' } }), core(), TODAY).ok)
  check('timed sprints are refused at Foundation (rubric only)', !validateAssessmentInput(timed(), core({ level: 'foundation' }), TODAY).ok)
  check('home-to-first is timed only on a baseball field', !validateAssessmentInput(timed({ metric_slug: 'home_to_first', conditions: { location: 'outdoor_open', surface: 'grass', timing_method: 'stopwatch', start_type: 'batting_stance', distance_yards: 20 } }), core(), TODAY).ok &&
    validateAssessmentInput(timed({ metric_slug: 'home_to_first', conditions: { location: 'field', surface: 'dirt', timing_method: 'stopwatch', start_type: 'batting_stance', distance_yards: 20 } }), core(), TODAY).ok)
  check('every condition is required so results can be compared', !validateAssessmentInput(timed({ conditions: { location: 'outdoor_open', surface: 'grass' } }), core(), TODAY).ok && !validateAssessmentInput(timed({ value: -1 }), core(), TODAY).ok && !validateAssessmentInput(timed({ value: 0 }), core(), TODAY).ok)
  check('the 0–2 form rubric works at any level and in any space', ['foundation', 'development', 'advanced'].every(l => validateAssessmentInput({ kind: 'baseline', method: 'rubric', rubric: { landing: 2, braking: 1, reaction: 2 }, occurred_on: TODAY }, core({ level: l as LevelKey, space: 'indoor_small' }), TODAY).ok))
  check('rubric scores must each be 0–2', !validateAssessmentInput({ kind: 'baseline', method: 'rubric', rubric: { landing: 3, braking: 1, reaction: 2 }, occurred_on: TODAY }, core(), TODAY).ok && !validateAssessmentInput({ kind: 'baseline', method: 'rubric', rubric: { landing: 2 }, occurred_on: TODAY }, core(), TODAY).ok)

  const base10 = ok<any>(validateAssessmentInput(timed(), core(), TODAY))
  const re = (over: any = {}) => ok<any>(validateAssessmentInput(timed({ kind: 'retest', value: 2.2, ...over }), core(), TODAY))
  let cmp = compareAssessments(base10, re())
  check('same conditions: compared as a number, with no verdict', cmp.comparable && cmp.delta === -0.11 && cmp.towardFaster === true && !/improv|better|worse|progress/i.test(JSON.stringify(cmp)))
  cmp = compareAssessments(base10, re({ conditions: { location: 'outdoor_open', surface: 'turf', timing_method: 'stopwatch', start_type: 'standing_start' } }))
  check('a different surface is NOT comparable, and no number is produced', !cmp.comparable && cmp.delta === null && /surface/.test(cmp.reasons.join(' ')))
  check('a different timing method or start cue is not comparable either', !compareAssessments(base10, re({ conditions: { location: 'outdoor_open', surface: 'grass', timing_method: 'phone_video', start_type: 'standing_start' } })).comparable &&
    !compareAssessments(base10, re({ conditions: { location: 'outdoor_open', surface: 'grass', timing_method: 'stopwatch', start_type: 'falling_start' } })).comparable)
  const rub = (l: number, b: number, r: number, kind: any = 'baseline') => ok<any>(validateAssessmentInput({ kind, method: 'rubric', rubric: { landing: l, braking: b, reaction: r }, occurred_on: TODAY }, core(), TODAY))
  const rc = compareAssessments(rub(1, 1, 2), rub(2, 1, 2, 'retest'))
  check('rubric results compare per kind as numbers', rc.comparable && (rc.delta as any).landing === 1 && (rc.delta as any).braking === 0)
  check('timed against rubric is not comparable', !compareAssessments(base10, rub(2, 2, 2, 'retest')).comparable)
  const sum = assessmentSummary([{ ...base10, occurred_on: '2026-10-01' }, { ...re(), occurred_on: '2026-10-29' }])
  check('a retest is compared to the baseline of the same measure', sum.length === 1 && sum[0].retests.length === 1 && sum[0].retests[0].comparison.comparable)
  check('a retest with no baseline is not compared', assessmentSummary([{ ...re(), occurred_on: '2026-10-29' }])[0].retests[0].comparison.comparable === false)

  // ── the migration's mapping equals the template's (no drift) ──────────────
  const sql = readFileSync('migrations/081_speed_program.sql', 'utf8')
  const block = sql.slice(sql.indexOf('FROM (VALUES'), sql.indexOf(') AS v(k, n, m, note)'))
  const rows = Array.from(block.matchAll(/^\s*\('([a-z_0-9]+)', (NULL|'(?:[^']|'')*'), '([a-z]+)', (NULL|'(?:[^']|'')*')\)/gm))
  const unq = (x: string) => (x === 'NULL' ? null : x.slice(1, -1).replace(/''/g, "'"))
  check('the migration maps every exercise in the template, and no other', rows.length === EXERCISES.length && EXERCISES.every(e => rows.some(r => r[1] === e.key)))
  check('...with the same drill name and match for each', EXERCISES.every(e => { const r = rows.find(x => x[1] === e.key)!; return unq(r[2]) === e.drillMap.name && r[3] === e.drillMap.match }))

  // ── routes: static rules ──────────────────────────────────────────────────
  const root = 'app/api/speed-program'
  const files: string[] = []
  const walk = (d: string) => readdirSync(d).forEach(f => { const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : f === 'route.ts' && files.push(p) })
  if (existsSync(root)) walk(root)
  check('the API exists: list/create, one program, sessions, assessments, advance', files.length >= 5, files.join(', '))
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    const handlers = (src.match(/export async function (GET|POST|PATCH|DELETE)/g) || []).length
    check(`${f}: every handler is behind the flag and a session`, (src.match(/const off = notEnabled\(\)/g) || []).length === handlers && (src.match(/await requireSession\(\)/g) || []).length === handlers)
    check(`${f}: never updates or deletes history tables`, !/from\('speed_program_(sessions|assessments|events)'\)\s*\.(update|delete|upsert)/.test(src))
    check(`${f}: scope comes from the stored program or an authorized player, never the request body`, /authorizeProgram\(|authorizePlayer\(/.test(src))
    check(`${f}: no write to player measurements, priorities or plans`, !/from\(['"](player_metrics|prescriptions|player_pathway_progress|player_pathway_events|practice_plans)['"]\)\s*\.(insert|update|upsert|delete)/.test(src))
  }

  console.log('')
  if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
  console.log('ALL PASS')
}

main().catch(e => { console.error(e); process.exit(1) })
