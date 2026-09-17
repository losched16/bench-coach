// Phase 2F.2 — one row per THIN or GAP pathway stage.
//
//   npm run emit:gap-audit
//
// Writes docs/audits/development-pathway-canonical-gap-audit.csv. Reads
// nothing from the network and writes nothing to the database.
//
// HOW THIS FILE IS SPLIT, AND WHY
//
// Half the columns are facts: which stage, what status the coverage audit gave
// it, which drills are attached, which problems the stage claims. Those are
// parsed out of migrations/070_pathway_content.sql and the Phase 2E coverage
// CSV, so they cannot drift away from what the pathway actually holds.
//
// The other half are judgements: is the missing teaching job real, is there
// already a drill doing it, should a new canonical row exist. Those are
// written by hand below, one entry per stage, because a disposition is an
// editorial decision and pretending a script derived it would be a lie.
//
// If the two halves disagree — an entry here for a stage the coverage audit
// now calls READY, or a THIN stage with no entry — this script fails rather
// than emitting a half-audited file.

import * as fs from 'fs'
import * as path from 'path'

const ROOT = path.join(__dirname, '..')
const SQL = path.join(ROOT, 'migrations', '070_pathway_content.sql')
const COVERAGE = path.join(ROOT, 'docs', 'audits', 'development-pathway-coverage.csv')
const OUT = path.join(ROOT, 'docs', 'audits', 'development-pathway-canonical-gap-audit.csv')

type Disposition =
  | 'ALREADY_COVERED' | 'VARIATION_ONLY' | 'PROGRESSION_ONLY'
  | 'DISTINCT_CANONICAL_MISSING' | 'NO_NEW_DRILL_NEEDED' | 'REVIEW'

// 2F.4's vocabulary. MATCH_EXISTING is used where the fix is to attach a drill
// the library already holds to a stage that does not yet link it — no new row.
type Editorial =
  | 'ADD_CANONICAL' | 'MATCH_EXISTING' | 'MERGE_INTO' | 'VARIATION_OF'
  | 'PROGRESSION_OF' | 'PRACTICE_UNIT' | 'TEACHING_CONTENT' | 'SKIP' | 'REVIEW'

interface Judgement {
  pathway: string
  stage: number
  teaching_job_missing: string
  existing_library_candidate: string
  existing_candidate_disposition: Disposition
  proposed_activity_name: string
  proposed_category: string
  proposed_problem_slug: string
  proposed_stage_role: string
  evidence_basis: string
  confidence: 'high' | 'medium' | 'low'
  editorial_decision: Editorial
  notes: string
}

const N = '' // nothing proposed

const JUDGEMENTS: Judgement[] = [
  {
    pathway: 'build-the-swing', stage: 2,
    teaching_job_missing:
      'Finding and checking the grip as its own repeatable rep, rather than as one clause inside a stance drill.',
    existing_library_candidate: 'Stance & Athletic Position Drill',
    existing_candidate_disposition: 'DISTINCT_CANONICAL_MISSING',
    proposed_activity_name: 'Grip Check — Find It Without Looking',
    proposed_category: 'Hitting',
    proposed_problem_slug: 'rolling-over',
    proposed_stage_role: 'primary',
    evidence_basis:
      'Searched all 47 Hitting, 3 Soft Toss and 3 Bunting rows. Exactly one carries "grip" in mechanic_focus — the stance drill, where grip is one of five things it trains and gets one clause of set-up and one mastery signal.',
    confidence: 'medium',
    editorial_decision: 'ADD_CANONICAL',
    notes:
      'Only defensible as a drill if written rep-based — bat down, pick it up, find the grip without looking, coach checks, eight of ten. Written as a paragraph about knuckle alignment it is TEACHING_CONTENT and must not take a drill row. Problem mapping is the honest half-fit: rolled knuckles limit the wrist hinge and show up as rolling-over. No grip-specific slug exists in the taxonomy and one is not proposed here.',
  },
  {
    pathway: 'infield-fundamentals', stage: 4,
    teaching_job_missing:
      'Choosing the hop: reading the ball early, counting hops, and moving the feet to create a long hop or a short one rather than fielding whatever arrives.',
    existing_library_candidate:
      'Recovery Drill; Advanced First Base — Off-Line Throws, Picks & Short Hops; The Hands Routine; Wall Ball',
    existing_candidate_disposition: 'DISTINCT_CANONICAL_MISSING',
    proposed_activity_name: 'Pick Your Hop — Read It and Move to It',
    proposed_category: 'Fielding (Infield)',
    proposed_problem_slug: 'poor-fielding-footwork',
    proposed_stage_role: 'primary',
    evidence_basis:
      'All 20 Fielding (Infield) rows checked. Recovery Drill trains recovery after a misplay; Advanced First Base trains short-hop picks at the bag; Wall Ball gives solo short hops. None trains hop selection — the charge-or-drop-back decision — and no mechanic_focus in the category mentions reading or counting hops.',
    confidence: 'high',
    editorial_decision: 'ADD_CANONICAL',
    notes:
      'The highest-confidence candidate in this audit. Must train the decision, not just the pick: balls rolled at varied distances, fielder calls the hop they are going to take. A drill that only feeds clean short hops is a variation of Advanced First Base and should not be added.',
  },
  {
    pathway: 'outfield-development', stage: 1,
    teaching_job_missing:
      'Pre-pitch ready position and a first movement in any direction from a standing start.',
    existing_library_candidate:
      'Outfield Drop Step Drill; On the Run; Infield/Outfield Priority Drill',
    existing_candidate_disposition: 'DISTINCT_CANONICAL_MISSING',
    proposed_activity_name: 'Ready and Go — Outfield First Step',
    proposed_category: 'Fielding (Fly Balls)',
    proposed_problem_slug: 'slow-first-step',
    proposed_stage_role: 'primary',
    evidence_basis:
      'The drop-step drill trains the first step for balls hit overhead only. On the Run starts the fielder already moving, which is why it cannot teach the start. The priority drill lists ready position in mechanic_focus but its teaching job is who calls the ball.',
    confidence: 'medium',
    editorial_decision: 'ADD_CANONICAL',
    notes:
      'The brief warns against a renamed drop step and the warning is right. This is only distinct if the fielder starts set and the ball goes in four directions — in, back, and both gaps. If it ends up being balls hit over the head, it is VARIATION_OF the drop-step drill and must be dropped.',
  },
  {
    pathway: 'outfield-development', stage: 2,
    teaching_job_missing: 'None. The stage has one teaching job and two drills that do it.',
    existing_library_candidate: 'Outfield Drop Step Drill; On the Run',
    existing_candidate_disposition: 'NO_NEW_DRILL_NEEDED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The drop step is a single movement. The library has the drill that teaches it and the drill that makes it finish in a catch.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes:
      'THIN here is an artefact of a three-drill threshold, not a content gap. Adding a third drop-step drill would turn the row green and teach a coach nothing.',
  },
  {
    pathway: 'outfield-development', stage: 7,
    teaching_job_missing:
      'The routine outfield ground ball — get around it, field it in the middle of the body, come up into the throw — and the knee-down block when nobody is advancing.',
    existing_library_candidate: 'Do-or-Die Charge & Throw; Four Cones Ground Ball Drill',
    existing_candidate_disposition: 'DISTINCT_CANONICAL_MISSING',
    proposed_activity_name: 'Routine Outfield Ground Ball — Field It and Come Up Throwing',
    proposed_category: 'Fielding (Fly Balls)',
    proposed_problem_slug: 'poor-fielding-footwork',
    proposed_stage_role: 'primary',
    evidence_basis:
      'Do-or-Die is the only outfield ground-ball drill and it is explicitly the highest-urgency version — attack angle, glove-side pickup, momentum through the throw. Four Cones is infield-framed and attached here as a regression for the approach alone.',
    confidence: 'high',
    editorial_decision: 'ADD_CANONICAL',
    notes:
      'The knee-down block is NOT a second row. It is the same play with the urgency removed and belongs inside this drill as its easier version — VARIATION_OF, per 2F.4. The fence carom is a genuinely separate job but is deferred: most fields these teams play on have no fence, so the leverage is low.',
  },
  {
    pathway: 'outfield-development', stage: 10,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'Do-or-Die Charge & Throw; Crow Hop',
    existing_candidate_disposition: 'NO_NEW_DRILL_NEEDED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'Do-or-Die is the play itself; Crow Hop is the footwork underneath it when the throw is the part failing. That is the whole job.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes: 'Two drills is the right number for one play. Threshold artefact.',
  },

  // ── Pitching. Sixteen drills in the library and eight THIN stages: almost
  // all of it is under-attachment, not missing content. ───────────────────
  {
    pathway: 'pitching-development', stage: 2,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'Balance Point Drill — Leg Lift & Pause; Flamingo Balance Drill',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The brief floats a Balance Hold / Balance Beam candidate. Both halves already exist: Balance Point holds the top of the delivery, Flamingo trains single-leg stability with no delivery attached. They are the only two balance drills in the library and both are attached.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes: 'A balance beam is equipment, not a teaching job.',
  },
  {
    pathway: 'pitching-development', stage: 3,
    teaching_job_missing:
      'Nothing canonical. The stage would be stronger with an existing row attached as a regression.',
    existing_library_candidate:
      '4-Part Windup Drill; Throwing Progression for Youth Players — Knee, Hip, Full (not attached)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The brief floats a Segmented Delivery Drill. The 4-Part Windup Drill is that drill — windup sequencing, position checkpoints, complete motion. The knee-hip-full throwing progression is the same idea one level below and is currently attached only to Throwing Development.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes:
      'Fix by attaching the knee-hip-full progression as a regression in 2F.8. Zero new rows.',
  },
  {
    pathway: 'pitching-development', stage: 5,
    teaching_job_missing: 'Nothing canonical.',
    existing_library_candidate:
      'Stride Direction Drill — Using a Chalk Line or Tape; The Heel-Toe Drill; Towel Drill (not attached)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The brief floats a Stride-Line Landing Drill. The Stride Direction Drill literally uses a chalk line and trains stride direction, stride length and landing-spot consistency. The Towel Drill also carries stride direction in mechanic_focus and is not attached here.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes: 'Attach the Towel Drill as reinforcement in 2F.8. Zero new rows.',
  },
  {
    pathway: 'pitching-development', stage: 6,
    teaching_job_missing: 'Nothing canonical.',
    existing_library_candidate:
      'Glove-Side Pull Drill — Front Side Control; Square Hips / Hip Lock Drill (not attached)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The brief floats a Front-Side Stability Drill. Glove-Side Pull is named for it and trains glove arm control, front side stability and chest drive. Square Hips / Hip Lock trains front hip locking and is mapped to flying-open — the failure this stage is about — and is not attached.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes:
      'Attach Square Hips / Hip Lock in 2F.8. Also note the current second drill here is Follow-Through Hold as an assessment, which is a weaker fit than the row that is sitting unattached.',
  },
  {
    pathway: 'pitching-development', stage: 8,
    teaching_job_missing: 'Nothing canonical.',
    existing_library_candidate:
      'Towel Drill; Kneel-Down (Wrist Snap) Drill; Wrist Snap Drill (not attached)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'Three release-point drills exist and two are attached. The Wrist Snap Drill is mapped to inconsistent-release, which is this stage\'s problem, and is unattached.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes:
      'The brief warns not to map an extension drill onto an early-front-arm-lock problem. Nothing here does that: the mapping used is inconsistent-release, which is what a wandering release point is.',
  },
  {
    pathway: 'pitching-development', stage: 9,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'Follow-Through Hold Drill — Finishing Strong; Glove-Side Pull Drill',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'Follow-Through Hold is the only drill in the library that trains deceleration and the fielding-ready finish, and it trains all of it. Nothing else finishes a delivery.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes:
      'A second finish drill would be the same hold with a different name. Two is the honest number and the stage stays THIN.',
  },
  {
    pathway: 'pitching-development', stage: 10,
    teaching_job_missing: 'Nothing canonical.',
    existing_library_candidate: 'The Swing Shuffle Drill — Momentum & Rhythm; The Rocker Drill (not attached)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The brief floats a Tempo / Momentum Delivery Drill. Swing Shuffle trains momentum, rhythm, linear drive and weight transfer into the throw. The Rocker Drill trains hip lead and weight shift and is attached only to earlier stages.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes:
      'Attach The Rocker Drill as reinforcement in 2F.8. The current second drill is Balance Point as a regression, which is right — tempo problems usually start at the balance point.',
  },
  {
    pathway: 'pitching-development', stage: 11,
    teaching_job_missing:
      'Throwing the second pitch from the mound, in sequence with the fastball, to a hitter.',
    existing_library_candidate: 'Changeup Catch Play',
    existing_candidate_disposition: 'DISTINCT_CANONICAL_MISSING',
    proposed_activity_name: 'Changeup Off the Mound — Same Arm Speed, Real Sequence',
    proposed_category: 'Pitching',
    proposed_problem_slug: 'no-changeup',
    proposed_stage_role: 'progression',
    evidence_basis:
      'One changeup drill exists and it is catch play — grip and arm speed on flat ground. Nothing takes the pitch onto a mound or puts it in a sequence, and the stage is served by a single row.',
    confidence: 'medium',
    editorial_decision: 'ADD_CANONICAL',
    notes:
      'Changeup only. No breaking ball is proposed for this age band and none should be. The row must carry the same arm-speed cue as the catch-play drill or it teaches a slower arm, which is the way a changeup gets hit and an elbow gets sore.',
  },

  // ── Catching. Six drills, six stages. Genuinely the thinnest area, but the
  // two candidates the brief names are already in the library. ────────────
  {
    pathway: 'catching-development', stage: 1,
    teaching_job_missing:
      'The stance itself — how a catcher sets up before any pitch is received.',
    existing_library_candidate: 'Youth Receiving Foundations — Quiet Glove & Soft Hands; Two Hand Catch',
    existing_candidate_disposition: 'DISTINCT_CANONICAL_MISSING',
    proposed_activity_name: "Catcher's Stance — Set Up to Receive",
    proposed_category: 'Catching',
    proposed_problem_slug: 'catcher-receiving',
    proposed_stage_role: 'regression',
    evidence_basis:
      'The brief floats Quiet Hands Receiving; the library already has it, named Quiet Glove & Soft Hands, and it is this stage\'s primary. What is absent is the stance: all six Catching rows assume a catcher already crouched. The stage\'s second drill is Two Hand Catch, borrowed from Throwing.',
    confidence: 'medium',
    editorial_decision: 'ADD_CANONICAL',
    notes:
      'Distinct from One-Knee Receiving, which is a later setup for a catcher who has outgrown two knees. This is the first one. A stance row is at risk of being TEACHING_CONTENT, so it must carry reps — set up, hold, receive one, reset — or it does not earn a drill row.',
  },
  {
    pathway: 'catching-development', stage: 2,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'MLB-Style Receiving & Framing Circuit; Youth Receiving Foundations',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The framing circuit is five stations on its own — beating the ball to the spot, sticking pitches, working the edges. The foundations drill sits under it as the regression.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes: 'A five-station circuit counted as one drill is why this row reads THIN. Threshold artefact.',
  },
  {
    pathway: 'catching-development', stage: 3,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'Blocking the Right Way — Technique to Reaction Reps',
    existing_candidate_disposition: 'VARIATION_ONLY',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The drill carries its own three-stage progression — placed balls, rolled balls, short-hop throws — inside one row. Splitting those into three rows would be slicing one drill, which 2F.4 calls VARIATION_OF and forbids as new canonical content.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes:
      'A one-drill stage that is honestly one drill. The coaching value is in the drill\'s internal stages, which the pathway already points at.',
  },
  {
    pathway: 'catching-development', stage: 4,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'Game-Speed Reaction Blocking; Blocking the Right Way',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The brief floats Blocking Reaction / Game-Speed Blocking. It exists, it is this stage\'s primary, and its mechanic_focus already includes read and react, lateral quickness and recovery to throw.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes: 'Adding the brief\'s candidate would duplicate a row by name.',
  },
  {
    pathway: 'catching-development', stage: 6,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'One-Knee Receiving — Advanced Framing Setup; MLB-Style Receiving & Framing Circuit',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'One drill for the one-knee setup and the two-knee circuit underneath it as the regression. That is the stage.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes: 'Threshold artefact.',
  },

  // ── Baserunning. Twelve drills, and several of them are attached to no
  // stage that needs them. One attachment here is wrong and is called out. ─
  {
    pathway: 'baserunning-development', stage: 1,
    teaching_job_missing:
      'Nothing canonical — but the current second drill does not belong to this stage.',
    existing_library_candidate:
      'Swing and Sprint; Base Running Circuit (not attached); Simple Base Running Drills (not attached)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'Swing and Sprint trains the swing-to-sprint transition and running through first — the stage exactly. Base Running Circuit is mapped to slow-first-step and Simple Base Running Drills trains running through first base; neither is attached.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes:
      'CURATION DEFECT, mine, from Phase 2E: the reinforcement slot holds Baseball Dynamic Stretches for Youth Players — an Athletic Development row whose job is warming up and which is mapped to cold-arm. That is the category-match error 2E.4 forbids. Detach it in 2F.8 and attach the two rows above.',
  },
  {
    pathway: 'baserunning-development', stage: 2,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'First Base Decision; Swing and Sprint',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'First Base Decision trains reading the ball out of the box, rounding technique and running through the bag — which is the whole of "through it or around it".',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes: 'Threshold artefact.',
  },
  {
    pathway: 'baserunning-development', stage: 3,
    teaching_job_missing: 'Nothing canonical.',
    existing_library_candidate:
      'Base Running Athletic Circuit; Simple Base Running Drills; First Base Decision (not attached here)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'First Base Decision carries rounding technique in mechanic_focus and is mapped to bad-base-turns, which is this stage\'s problem. It is attached to stage 2 only.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes: 'Attach it here as reinforcement in 2F.8. Zero new rows.',
  },
  {
    pathway: 'baserunning-development', stage: 4,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'Bent-Leg Slide Basics; Sliding Practice Stations',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'Bent-Leg Slide Basics trains the figure-4 tuck, the start distance and hands up. Sliding Practice Stations gives the volume. Both are mapped to cant-slide.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes:
      'Sliding is the one area where a third drill would mean more repetitions on grass in cleats, which is a safety cost and not a coaching gain.',
  },
  {
    pathway: 'baserunning-development', stage: 5,
    teaching_job_missing: 'Nothing canonical.',
    existing_library_candidate: 'Pop-Up Slide; Bent-Leg Slide Basics; Sliding Practice Stations (not attached here)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'Sliding Practice Stations trains slide timing and consistent form under control and is attached to stage 4 only.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes: 'Attach as reinforcement in 2F.8. Zero new rows.',
  },
  {
    pathway: 'baserunning-development', stage: 6,
    teaching_job_missing: 'Nothing canonical. Two lead drills are sitting unattached.',
    existing_library_candidate:
      'Secondary Lead & Delayed Steal; Pro Base-Stealing Package — Leads, Reads & Jumps (not attached); Steal Breaks (not attached)',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'The Pro Base-Stealing Package trains the primary lead, pitcher tells and jump quality. Steal Breaks trains the crossover step and the reaction to the first move. Both are squarely this stage and neither is linked to it.',
    confidence: 'high',
    editorial_decision: 'MATCH_EXISTING',
    notes:
      'The clearest under-attachment in the audit: the stage reads THIN while the library holds three drills for it. 2F.8 fix, zero new rows.',
  },
  {
    pathway: 'baserunning-development', stage: 8,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'Progressive Tag Up',
    existing_candidate_disposition: 'VARIATION_ONLY',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'Progressive Tag Up is the only drill in the library that trains tagging up, and it carries its own three rounds. A second tagging-up drill would be one of those rounds with a new name.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes: 'One drill, honestly one drill.',
  },
  {
    pathway: 'baserunning-development', stage: 9,
    teaching_job_missing: 'None.',
    existing_library_candidate: 'Wild Pitch Advance; Secondary Lead & Delayed Steal',
    existing_candidate_disposition: 'ALREADY_COVERED',
    proposed_activity_name: N, proposed_category: N, proposed_problem_slug: N, proposed_stage_role: N,
    evidence_basis:
      'Wild Pitch Advance trains reading a ball in the dirt, the secondary lead and the first step. Secondary Lead sits under it as the regression.',
    confidence: 'high',
    editorial_decision: 'SKIP',
    notes: 'Threshold artefact.',
  },
]

// ── the computed half ───────────────────────────────────────────────────────

function parseAttachments(sql: string) {
  const drills = new Map<string, Array<{ id: string; role: string; name: string }>>()
  const probs = new Map<string, string[]>()
  const stageKey = new Map<string, string>()

  const drillRe = new RegExp(
    "SELECT s\\.id, '([0-9a-f-]{36})', '(\\w+)', \\d+,\\n" +
    '(?:[^\\n]*\\n)+?' +
    "WHERE p\\.slug = '([a-z0-9-]+)' AND s\\.stage_key = '([a-z0-9-]+)';\\n" +
    '-- ([^\\n]+)', 'g')
  let m: RegExpExecArray | null
  while ((m = drillRe.exec(sql))) {
    const k = `${m[3]}|${m[4]}`
    drills.set(k, (drills.get(k) || []).concat([{ id: m[1], role: m[2], name: m[5].trim() }]))
  }

  const probRe = new RegExp(
    "SELECT s\\.id, '([a-z0-9-]+)'\\n" +
    'FROM public\\.development_pathway_stages s\\n' +
    'JOIN public\\.development_pathways p ON p\\.id = s\\.pathway_id\\n' +
    "WHERE p\\.slug = '([a-z0-9-]+)' AND s\\.stage_key = '([a-z0-9-]+)';", 'g')
  while ((m = probRe.exec(sql))) {
    const k = `${m[2]}|${m[3]}`
    probs.set(k, (probs.get(k) || []).concat([m[1]]))
  }

  const stageRe = new RegExp(
    "SELECT p\\.id,\\n  (\\d+), '([a-z0-9-]+)', '[^\\n]*\\n" +
    '(?:[^\\n]*\\n)+?' +
    "FROM public\\.development_pathways p WHERE p\\.slug = '([a-z0-9-]+)';", 'g')
  while ((m = stageRe.exec(sql))) stageKey.set(`${m[3]}|${m[1]}`, m[2])

  return { drills, probs, stageKey }
}

function readCsv(file: string): Array<Record<string, string>> {
  const text = fs.readFileSync(file, 'utf8')
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = '' }
    else if (c !== '\r') cell += c
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  const head = rows.shift() || []
  return rows.filter(r => r.length === head.length)
    .map(r => head.reduce((o, h, i) => (o[h] = r[i], o), {} as Record<string, string>))
}

const q = (v: string) => `"${String(v ?? '').replace(/"/g, '""')}"`

// The six proposed rows, as a sheet somebody can sit down and reject line by
// line. The teaching job and the duplication argument come from the audit
// above; the rest is read out of migration 071, so the sheet describes the row
// that would actually be inserted rather than the row that was proposed.
function emitReview() {
  const mig = path.join(ROOT, 'migrations', '071_pathway_coverage_expansion.sql')
  if (!fs.existsSync(mig)) { console.log('  (071 not written yet — no review sheet)'); return }
  const sql = fs.readFileSync(mig, 'utf8')
  const block = sql.split('ON CONFLICT (id) DO NOTHING')[0]

  // id, name, category, primary_skill are the first four values of each tuple.
  const rows: Array<Record<string, string>> = []
  const re = /^\('([0-9a-f-]{36})','((?:[^']|'')*)','((?:[^']|'')*)','((?:[^']|'')*)'/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    rows.push({ id: m[1], name: m[2].replace(/''/g, "'"), category: m[3], skill: m[4] })
  }

  const attach = new Map<string, { pathway: string; stage: string; role: string }>()
  const aRe = /\('([a-z0-9-]+)','([a-z0-9-]+)','([0-9a-f-]{36})','(\w+)',\d+,/g
  while ((m = aRe.exec(sql))) attach.set(m[3], { pathway: m[1], stage: m[2], role: m[4] })

  const mapped = new Map<string, string[]>()
  const mBlock = sql.split('drill_problem_map')[1]?.split('ON CONFLICT')[0] || ''
  const mRe = /\('([0-9a-f-]{36})','([a-z0-9-]+)',\d+,true\)/g
  while ((m = mRe.exec(mBlock))) mapped.set(m[1], (mapped.get(m[1]) || []).concat([m[2]]))

  const head = ['drill_id', 'drill_name', 'skill_category', 'primary_skill',
    'pathway_slug', 'stage_key', 'stage_role', 'problem_slugs',
    'teaching_job', 'why_not_a_duplicate', 'confidence',
    'runnable_with_no_video', 'has_safety_note', 'reviewer_decision']
  const lines = [head.join(',')]

  for (const r of rows) {
    const j = JUDGEMENTS.find(x => x.proposed_activity_name.replace(/''/g, "'") === r.name)
    const a = attach.get(r.id)
    // Bounded to this tuple. An unbounded slice runs into the next row and
    // reports its NULL safety note as this one's.
    const start = block.indexOf(`('${r.id}'`)
    const nextAt = block.indexOf("\n('", start + 1)
    const tuple = block.slice(start, nextAt < 0 ? undefined : nextAt)
    lines.push([
      r.id, r.name, r.category, r.skill,
      a?.pathway || '', a?.stage || '', a?.role || '',
      (mapped.get(r.id) || []).join(' '),
      j?.teaching_job_missing || '', j?.evidence_basis || '', j?.confidence || '',
      // Every row in this library must work with no video. None of the six
      // references one, and this reads the row rather than trusting that.
      /youtube|video|watch the clip/i.test(tuple) ? 'NO — references video' : 'yes',
      /,NULL,ARRAY\['/.test(tuple) ? 'no' : 'yes',
      '',
    ].map(q).join(','))
  }
  const out = path.join(ROOT, 'docs', 'audits', 'new-canonical-review.csv')
  fs.writeFileSync(out, lines.join('\n') + '\n')
  console.log(`  ${rows.length} proposed rows → ${path.relative(ROOT, out)}`)
}

function main() {
  const sql = fs.readFileSync(SQL, 'utf8')
  const { drills, probs, stageKey } = parseAttachments(sql)
  const coverage = readCsv(COVERAGE)

  const needed = coverage.filter(r => r.status !== 'READY')
  const seen = new Set<string>()
  const problems: string[] = []

  const header = [
    'pathway_slug', 'pathway_name', 'stage_number', 'stage_key', 'stage_name',
    'current_status', 'current_drill_count', 'current_drill_ids', 'current_drill_names',
    'stage_problem_slugs', 'teaching_job_missing', 'existing_library_candidate',
    'existing_candidate_disposition', 'proposed_activity_name', 'proposed_category',
    'proposed_problem_slug', 'proposed_stage_role', 'evidence_basis', 'confidence',
    'editorial_decision', 'notes',
  ]
  const out: string[] = [header.join(',')]

  for (const r of needed) {
    const n = Number(r.stage_number)
    const j = JUDGEMENTS.find(x => x.pathway === r.pathway && x.stage === n)
    if (!j) { problems.push(`no judgement for ${r.pathway} stage ${n} (${r.status})`); continue }
    seen.add(`${j.pathway}|${j.stage}`)

    const key = stageKey.get(`${r.pathway}|${n}`) || ''
    const ds = drills.get(`${r.pathway}|${key}`) || []
    const ps = probs.get(`${r.pathway}|${key}`) || []
    const pathwayName = r.pathway.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')

    out.push([
      j.pathway, pathwayName, String(n), key, r.stage_name,
      r.status, String(ds.length), ds.map(d => d.id).join(' '), ds.map(d => d.name).join(' | '),
      ps.join(' '), j.teaching_job_missing, j.existing_library_candidate,
      j.existing_candidate_disposition, j.proposed_activity_name, j.proposed_category,
      j.proposed_problem_slug, j.proposed_stage_role, j.evidence_basis, j.confidence,
      j.editorial_decision, j.notes,
    ].map(q).join(','))
  }

  for (const j of JUDGEMENTS) {
    if (!seen.has(`${j.pathway}|${j.stage}`)) {
      problems.push(`judgement for ${j.pathway} stage ${j.stage} matches no THIN/GAP stage`)
    }
  }

  if (problems.length) {
    console.error('The audit and the coverage data disagree:')
    for (const p of problems) console.error(`  ${p}`)
    process.exit(1)
  }

  fs.writeFileSync(OUT, out.join('\n') + '\n')
  emitReview()
  const adds = JUDGEMENTS.filter(j => j.editorial_decision === 'ADD_CANONICAL')
  const attach = JUDGEMENTS.filter(j => j.editorial_decision === 'MATCH_EXISTING')
  console.log(`${needed.length} THIN/GAP stages audited → ${path.relative(ROOT, OUT)}`)
  console.log(`  ${adds.length} propose a new canonical row`)
  console.log(`  ${attach.length} are fixed by attaching a drill the library already holds`)
  console.log(`  ${JUDGEMENTS.length - adds.length - attach.length} need nothing`)
}

main()
