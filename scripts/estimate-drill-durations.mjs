// How long does a drill take? Nobody wrote it down, so this works it out.
//
// est_duration_minutes is 0/206 populated in production. Nothing in the
// library states a duration except five drills that happen to mention minutes
// in prose. So this is an ESTIMATE built from a stated model, not a reading of
// data that was already there — and the column name is honest about that.
//
// The model, in one paragraph: a drill's length is how many reps it
// prescribes, times how long one rep physically takes in that category,
// plus the setup and instruction the category needs before the first rep.
// Where a rep count exists we use it. Where it does not, we use the category's
// median rep count as the stand-in and say so by lowering the confidence.
//
// WHY THIS IS NOT DRESSED UP AS DATA
//
// The seconds-per-rep constants below are coaching judgement. They are not
// measured, they are not derived from the library, and no amount of arithmetic
// on top of them makes them measured. They are written here, in one table,
// with the reasoning attached, precisely so a coach can disagree with a number
// and re-run this in one command rather than hunting through 206 rows.
//
//   node scripts/estimate-drill-durations.mjs            summary + distribution
//   node scripts/estimate-drill-durations.mjs --table    full 206-row review table
//   node scripts/estimate-drill-durations.mjs --csv      review table as CSV
//   node scripts/estimate-drill-durations.mjs --sql      emit the migration
//   node scripts/estimate-drill-durations.mjs --low      only LOW-confidence rows
//
// Reads a drill export from disk. Writes nothing to the database, ever.

import { readFileSync } from 'fs'

const SRC = process.env.DRILL_EXPORT || 'docs/audits/drill-library-production.json'

// ---------------------------------------------------------------------------
// The buckets
//
// Six values, not a continuous number. A practice runs in blocks a coach can
// hold in their head, and "this drill takes 13.4 minutes" is false precision
// that invites arithmetic nobody should trust. Rounding to a bucket makes the
// uncertainty visible instead of hiding it behind a decimal.
// ---------------------------------------------------------------------------
export const BUCKETS = [5, 8, 10, 12, 15, 20]

function bucket(minutes) {
  return BUCKETS.reduce((best, b) =>
    Math.abs(b - minutes) < Math.abs(best - minutes) ? b : best
  )
}

// ---------------------------------------------------------------------------
// Seconds per rep, and setup minutes, by category.
//
// secPerRep is one full cycle for ONE player: execute, reset, and whatever
// ball retrieval or walk-back the rep forces. It is not the swing.
//
// setupMin is what happens before the first rep — screens dragged out, a tee
// positioned, the drill explained to eight-year-olds who have not seen it.
// It is why a 12-rep drill is never a two-minute drill.
// ---------------------------------------------------------------------------
export const CATEGORY_MODEL = {
  // Tee and toss work cycles fast: the ball is right there, the reset is a
  // step. Retrieval happens on a shared bucket between rounds, not per swing.
  'Hitting':               { secPerRep: 12, setupMin: 3 },
  'Soft Toss':             { secPerRep: 10, setupMin: 3 },
  'Bunting':               { secPerRep: 10, setupMin: 3 },

  // A partner catch cycle is throw, receive, throw back. Two players, one rep.
  'Throwing':              { secPerRep: 10, setupMin: 3 },

  // Ground ball, field, throw to a target, reset the fielder, feed the next
  // ball. Longer than a swing because two positions have to recover.
  'Fielding (Infield)':    { secPerRep: 15, setupMin: 3 },

  // Fly balls move players thirty yards and back. The travel IS the rep.
  'Fielding (Fly Balls)':  { secPerRep: 25, setupMin: 3 },

  // Blocking and receiving reps are quick, but gear and the catcher's reset
  // put the cycle above a hitting rep.
  'Catching':              { secPerRep: 12, setupMin: 4 },

  // A full delivery plus the walk back to the rubber. Bullpen pace, not
  // machine-gun pace, because that is how arms stay attached.
  'Pitching':              { secPerRep: 20, setupMin: 4 },

  // Sprint the bases, then walk back. The walk-back dominates.
  'Baserunning':           { secPerRep: 30, setupMin: 3 },
  'Athletic Development':  { secPerRep: 30, setupMin: 3 },

  // Nine players have to reset before the next rep can start, and someone is
  // always in the wrong place. Team reps are expensive and the setup is a
  // walk-through, which is why the setup number is the largest here.
  'Team Defense':          { secPerRep: 45, setupMin: 6 },

  // Band and stretch work: short cycles, but a long sequence of them.
  'Arm Care':              { secPerRep: 20, setupMin: 2 },
  'Warmup':                { secPerRep: 20, setupMin: 2 },
}

// Used when a category is not in the table above. Present so an unknown
// category produces a defensible number rather than NaN.
const FALLBACK = { secPerRep: 15, setupMin: 3 }

// ---------------------------------------------------------------------------
// Structural modifiers
//
// Category and rep count alone put two thirds of the library on a single
// number, because two thirds of the library states no reps and falls to its
// category median. That is not a useful answer — a budget where every drill is
// eight minutes tells a coach nothing they could not get by counting drills.
//
// These four fields are populated on every one of the 206 rows and describe
// real differences in how long a drill takes to run. Using them is reading
// signal that is already there; it is not manufacturing spread.
// ---------------------------------------------------------------------------

// An Advanced drill is not a harder version of the same rep — it is live arms,
// competitive rounds, and a coach stopping to correct. A Beginner drill with
// eight-year-olds is the opposite: short cycles, and attention runs out first.
const DIFFICULTY_PACE = { Beginner: 0.9, Intermediate: 1.0, Advanced: 1.25 }

// Progression level 4 is the game-speed tier — every one of the 18 is Advanced.
// Live reps need the field set before the first one, which is setup, not pace.
const GAME_SPEED_SETUP = 2

/** Dragging a drill across a full field costs minutes before anyone moves. */
function spaceSetup(d) {
  const s = String(d.space_required || '').toLowerCase()
  if (s.includes('full field') || s.includes('large') || s.includes('outfield')) return 2
  if (s.includes('medium')) return 1
  return 0
}

/** Screens, tees, nets, buckets. Each thing carried out is a thing set up. */
function equipmentSetup(d) {
  const n = (d.equipment_needed || []).length
  return n >= 5 ? 2 : n >= 3 ? 1 : 0
}

// ---------------------------------------------------------------------------
// Evidence extraction
// ---------------------------------------------------------------------------

/** An explicit duration stated in the drill's own prose. The only hard data. */
function statedMinutes(d) {
  const fields = ['reps_guidance', 'frequency_guidance', 'description', 'ai_coaching_notes']
  for (const f of fields) {
    const v = Array.isArray(d[f]) ? d[f].join(' ') : String(d[f] || '')
    // "10-min", "5 min", "15 minutes". Deliberately NOT matching seconds —
    // "freeze 2 sec on the stride" is a coaching cue, not a drill length.
    const m = v.match(/(\d+)\s*[-–]?\s*(?:min\b|minute)/i)
    if (m) return { minutes: Number(m[1]), field: f, quote: m[0] }
  }
  return null
}

/**
 * Total reps a drill prescribes, from reps_guidance.
 *
 * Handles the three shapes the library actually uses — "3 sets of 8",
 * "10-15 slides per session", "Pick 2 drills, 10 throws each" — and returns
 * null rather than guessing when it recognises none of them. All 72 populated
 * rows parse today; the null path is for rows added later.
 */
export function totalReps(guidance) {
  if (!guidance) return null
  const t = String(guidance).toLowerCase()
  const mid = (lo, hi) => (Number(lo) + Number(hi ?? lo)) / 2

  // Groups a coach counts in. "circuits" and "drills" are here because the
  // library uses them as set-words — "3 circuits of 3 balls", "5 drills x 6
  // reps" — and leaving them out made those read as three and five reps.
  const GROUP = '(?:sets?|rounds?|circuits?|stations?|drills?|series)'

  // "3 rounds: 5 heavy + 5 light + 5 game-bat swings" — a group of summed
  // terms. Checked first: every later rule would grab the leading 3 and stop.
  // The terms carry their own labels — "5 heavy + 5 light + 5 game-bat" — so
  // the words between the numbers have to be allowed through and dropped.
  let m = t.match(new RegExp(`(\\d+)\\s*(?:\\w+\\s+)?${GROUP}\\s*[:\\-–]\\s*(\\d+(?:[^+\\d]*\\+[^+\\d]*\\d+)+)`))
  if (m) {
    const sum = m[2].split('+').reduce((s, term) => s + Number((term.match(/\d+/) || [0])[0]), 0)
    return Number(m[1]) * sum
  }

  // "3 sets of 8", "4 rounds of 8-10", "2 situational rounds of 6 scenarios".
  // The optional word before the group noun is what "2 situational rounds"
  // needs — without it that parsed as two reps instead of twelve.
  m = t.match(new RegExp(`(\\d+)\\s*(?:\\w+\\s+)?${GROUP}\\s*(?:of|x)\\s*(\\d+)(?:\\s*[-–]\\s*(\\d+))?`))
  if (m) return Number(m[1]) * mid(m[2], m[3])

  // "5 drills x 6 reps daily", "3 x 10"
  m = t.match(new RegExp(`(\\d+)\\s*(?:${GROUP})?\\s*x\\s*(\\d+)`))
  if (m) return Number(m[1]) * Number(m[2])

  // "Pick 2 drills, 10 throws each" / "4 scenarios, then 2 live reps each" —
  // a count of things, then a per-thing rep count closed by "each".
  m = t.match(/(\d+)\s+\w+[^.]*?\b(\d+)(?:\s*[-–]\s*(\d+))?\s+[\w\s-]*?\beach\b/)
  if (m) return Number(m[1]) * mid(m[2], m[3])

  // "10-15 slides per session"
  m = t.match(/(\d+)\s*[-–]\s*(\d+)\s*[a-z]/)
  if (m) return mid(m[1], m[2])

  // "10 secondary leads"
  m = t.match(/(\d+)\s*[a-z]/)
  if (m) return Number(m[1])
  return null
}

// ---------------------------------------------------------------------------
// The estimate
// ---------------------------------------------------------------------------

/**
 * Category median rep counts, computed from the drills that DO prescribe reps.
 *
 * This is the one place the library gets to inform the model rather than the
 * other way round: if the hitting drills that state their reps cluster at 24,
 * a hitting drill that states nothing is more likely to be a 24-rep drill than
 * a 6-rep one. It is still an assumption, which is why every drill resolved
 * this way is marked LOW.
 */
export function categoryMedians(drills) {
  const by = {}
  for (const d of drills) {
    const r = totalReps(d.reps_guidance)
    if (r != null) (by[d.skill_category] = by[d.skill_category] || []).push(r)
  }
  const out = {}
  for (const [c, arr] of Object.entries(by)) {
    arr.sort((a, b) => a - b)
    out[c] = arr[Math.floor(arr.length / 2)]
  }
  return out
}

// Categories the library gives no rep anchor for at all. Stated here rather
// than silently inheriting a global default, because a made-up number should
// have to be typed by a human somewhere.
const ASSUMED_REPS = {
  'Soft Toss': 24,             // matches the hitting stations it belongs to
  'Warmup': 10,                // a warm-up is a sequence of exercises, not reps
  'Athletic Development': 10,
}

// A named routine, circuit or progression is a block of work, not a handful of
// reps. Whatever the arithmetic says, these do not belong in the 5-minute
// bucket — a coach who reads "J-Band Routine: 5 min" will run it wrong.
const BLOCK_SHAPED = /\b(routine|program|series|system|package|progression|circuit)\b/i
const BLOCK_FLOOR = 10

export function estimate(d, medians) {
  const model = CATEGORY_MODEL[d.skill_category] || FALLBACK
  const notes = []

  const stated = statedMinutes(d)
  if (stated) {
    return {
      minutes: bucket(stated.minutes),
      raw: stated.minutes,
      confidence: 'HIGH',
      basis: 'stated',
      evidence: `${stated.field}: "${stated.quote}"`,
      notes,
    }
  }

  const reps = totalReps(d.reps_guidance)
  const assumed = reps == null
  const n = reps ?? ASSUMED_REPS[d.skill_category] ?? medians[d.skill_category] ?? 12

  const pace = DIFFICULTY_PACE[d.difficulty_level] ?? 1.0
  const setup =
    model.setupMin +
    spaceSetup(d) +
    equipmentSetup(d) +
    (d.progression_level === 4 ? GAME_SPEED_SETUP : 0)

  const raw = setup + (n * model.secPerRep * pace) / 60
  let minutes = bucket(raw)

  // Applied last, and never undone. A named routine or progression is a block
  // of work; a coach who reads "J-Band Routine: 5 min" will run it wrong no
  // matter how few reps the arithmetic counted.
  const blockShaped = BLOCK_SHAPED.test(d.drill_name)
  if (blockShaped && minutes < BLOCK_FLOOR) {
    notes.push(`block-shaped name, raised from ${minutes}`)
    minutes = BLOCK_FLOOR
  }

  const setupParts = [`${model.setupMin}m base`]
  if (spaceSetup(d)) setupParts.push(`+${spaceSetup(d)}m ${d.space_required}`)
  if (equipmentSetup(d)) setupParts.push(`+${equipmentSetup(d)}m equipment`)
  if (d.progression_level === 4) setupParts.push(`+${GAME_SPEED_SETUP}m game speed`)

  return {
    minutes,
    raw: Math.round(raw * 10) / 10,
    floored: blockShaped && notes.length > 0,
    confidence: assumed ? 'LOW' : 'MED',
    basis: assumed ? 'category model' : 'reps',
    evidence:
      (assumed
        ? `no reps_guidance; ${d.skill_category} assumed ${n} reps`
        : `reps_guidance "${d.reps_guidance}" -> ${n} reps`) +
      ` @ ${model.secPerRep}s x${pace} pace, setup ${setupParts.join(' ')}`,
    notes,
  }
}

// ---------------------------------------------------------------------------
// Coherence: near-duplicate drills must not disagree
//
// 103 drills share a video with at least one other. Most of those are distinct
// segments of one compilation and may legitimately differ in length. But some
// are the SAME drill entered twice under a long and a short name — "High Tee
// Drill — Hitting Up in the Zone" and "High Tee" — and those disagreeing about
// their own duration is incoherent no matter which number is right.
//
// So: same video AND one name contained in the other, snap to the value with
// the better evidence. Ties go to the longer, because under-running a drill is
// the cheaper mistake.
// ---------------------------------------------------------------------------
const RANK = { HIGH: 3, MED: 2, LOW: 1 }
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function reconcileDuplicates(rows) {
  const byVideo = {}
  for (const r of rows) {
    if (r.drill.youtube_video_id) {
      (byVideo[r.drill.youtube_video_id] = byVideo[r.drill.youtube_video_id] || []).push(r)
    }
  }

  const changes = []
  for (const group of Object.values(byVideo)) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j]
        const na = norm(a.drill.drill_name), nb = norm(b.drill.drill_name)
        if (!(na.includes(nb) || nb.includes(na))) continue
        if (a.est.minutes === b.est.minutes) continue

        let [keep, fix] =
          RANK[a.est.confidence] !== RANK[b.est.confidence]
            ? (RANK[a.est.confidence] > RANK[b.est.confidence] ? [a, b] : [b, a])
            : (a.est.minutes > b.est.minutes ? [a, b] : [b, a])

        // The block floor is protective and reconciliation does not get to
        // undo it. "10 Best Throwing Drills — Full Progression" losing to its
        // own short-form twin and dropping below the floor is the exact
        // mistake the floor exists to prevent, so the pair converges upward
        // instead: better evidence normally wins, but not by shortening a
        // block of work to the length of one of its parts.
        if (fix.est.floored && keep.est.minutes < fix.est.minutes) [keep, fix] = [fix, keep]

        changes.push({
          from: fix.est.minutes, to: keep.est.minutes,
          fixed: fix.drill.drill_name, matched: keep.drill.drill_name,
        })
        fix.est.minutes = keep.est.minutes
        fix.est.notes.push(`reconciled with duplicate "${keep.drill.drill_name}"`)
      }
    }
  }
  return changes
}

// ---------------------------------------------------------------------------

export function estimateAll(drills) {
  const medians = categoryMedians(drills)
  const rows = drills.map(d => ({ drill: d, est: estimate(d, medians) }))
  const reconciled = reconcileDuplicates(rows)
  return { rows, medians, reconciled }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2)
  const has = f => argv.includes(f)

  const raw = JSON.parse(readFileSync(SRC, 'utf8'))
  const drills = (Array.isArray(raw) ? raw : raw.drills).filter(
    d => d.status === 'approved' || d.status == null
  )

  const { rows, medians, reconciled } = estimateAll(drills)

  if (has('--sql')) return emitSql(rows)

  if (has('--csv')) {
    console.log('drill_name,category,difficulty,progression,minutes,confidence,basis,evidence')
    for (const r of rows) {
      const c = s => `"${String(s ?? '').replace(/"/g, '""')}"`
      console.log([
        c(r.drill.drill_name), c(r.drill.skill_category), c(r.drill.difficulty_level),
        r.drill.progression_level ?? '', r.est.minutes, r.est.confidence,
        c(r.est.basis), c(r.est.evidence),
      ].join(','))
    }
    return
  }

  const shown = has('--low') ? rows.filter(r => r.est.confidence === 'LOW') : rows

  if (has('--table') || has('--low')) {
    console.log(
      'Drill'.padEnd(52) + 'Category'.padEnd(22) + 'Diff'.padEnd(14) +
      'L'.padEnd(3) + 'Min'.padEnd(5) + 'Conf'.padEnd(6) + 'Evidence'
    )
    console.log('-'.repeat(150))
    for (const r of shown) {
      console.log(
        r.drill.drill_name.slice(0, 50).padEnd(52) +
        String(r.drill.skill_category || '').slice(0, 20).padEnd(22) +
        String(r.drill.difficulty_level || '?').padEnd(14) +
        String(r.drill.progression_level ?? '-').padEnd(3) +
        String(r.est.minutes).padEnd(5) +
        r.est.confidence.padEnd(6) +
        r.est.evidence.slice(0, 70) +
        (r.est.notes.length ? '  [' + r.est.notes.join('; ') + ']' : '')
      )
    }
    console.log('')
  }

  console.log(`Duration estimates for ${rows.length} drills (source: ${SRC})\n`)

  console.log('Category rep medians observed in the 72 drills that state reps:')
  for (const [c, m] of Object.entries(medians).sort()) {
    console.log(`  ${c.padEnd(24)} ${m} reps`)
  }

  console.log('\nConfidence:')
  const conf = {}
  for (const r of rows) conf[r.est.confidence] = (conf[r.est.confidence] || 0) + 1
  for (const k of ['HIGH', 'MED', 'LOW']) {
    const n = conf[k] || 0
    console.log(`  ${k.padEnd(6)} ${String(n).padStart(3)}  ${(100 * n / rows.length).toFixed(0)}%`)
  }

  console.log('\nDistribution:')
  const dist = {}
  for (const r of rows) dist[r.est.minutes] = (dist[r.est.minutes] || 0) + 1
  for (const b of BUCKETS) {
    const n = dist[b] || 0
    console.log(`  ${String(b).padStart(2)} min  ${String(n).padStart(3)}  ${'#'.repeat(Math.round(n / 2))}`)
  }

  console.log('\nBy category (median estimate):')
  const byCat = {}
  for (const r of rows) (byCat[r.drill.skill_category] = byCat[r.drill.skill_category] || []).push(r.est.minutes)
  for (const [c, arr] of Object.entries(byCat).sort()) {
    arr.sort((a, b) => a - b)
    console.log(`  ${c.padEnd(24)} n=${String(arr.length).padStart(3)}  median ${arr[Math.floor(arr.length / 2)]} min  [${arr[0]}..${arr[arr.length - 1]}]`)
  }

  console.log(`\nDuplicate reconciliation: ${reconciled.length} adjusted`)
  for (const c of reconciled) {
    console.log(`  ${c.fixed.slice(0, 46).padEnd(48)} ${c.from} -> ${c.to}  (matches "${c.matched.slice(0, 40)}")`)
  }

  const total = rows.reduce((s, r) => s + r.est.minutes, 0)
  console.log(`\nWhole library end to end: ${total} min (${(total / 60).toFixed(1)} h)`)
  console.log('\nNothing here writes to the database. --sql emits the migration.')
}

function emitSql(rows) {
  const values = rows
    .map(r => `  ('${r.drill.id}', ${r.est.minutes})`)
    .join(',\n')

  console.log(`-- 047_drill_durations.sql
--
-- Give every drill an estimated length.
--
-- est_duration_minutes was 0/206 populated. Nothing downstream could answer
-- "does this fit in the forty minutes I have left", so nothing tried.
--
-- These are estimates from a stated model, not measurements — see
-- scripts/estimate-drill-durations.mjs for the model and
-- docs/audits/drill-duration-model.md for the reasoning. Regenerate with:
--
--   node scripts/estimate-drill-durations.mjs --sql > migrations/047_drill_durations.sql
--
-- Matched on drill id, never on title: 103 drills share a video and several
-- share a name prefix, so a title match would hit the wrong row.
--
-- Only fills nulls. A duration a human has since corrected by hand wins over
-- anything this script computed, and re-running the migration must not
-- silently undo that correction.

BEGIN;

UPDATE drill_resources AS d
SET est_duration_minutes = v.minutes
FROM (VALUES
${values}
) AS v(id, minutes)
WHERE d.id = v.id::uuid
  AND d.est_duration_minutes IS NULL;

COMMIT;

-- Verification. Expect: 206 populated, 0 null, 0 non-positive.
-- SELECT count(*) FILTER (WHERE est_duration_minutes IS NOT NULL) AS populated,
--        count(*) FILTER (WHERE est_duration_minutes IS NULL)     AS still_null,
--        count(*) FILTER (WHERE est_duration_minutes <= 0)        AS non_positive,
--        min(est_duration_minutes), max(est_duration_minutes)
-- FROM drill_resources WHERE status = 'approved';`)
}

// Only when run directly. The tests import estimate() and totalReps() and must
// not trigger a 206-row report as a side effect of an import statement.
if (process.argv[1] && process.argv[1].endsWith('estimate-drill-durations.mjs')) main()
