// The skill catalogue: what a program can develop, how to recognise a request
// for it, how to find its drills, and how to measure it.
//
// Static knowledge only. Nothing here is player data. Metric slugs refer to
// metric_types rows: the system presets from migrations 019/073 plus the six
// added by 085. A program records assessments THROUGH those rows
// (player_metrics), so Player Reports and the metrics page see them for free
// and there is exactly one place a measurement lives.

import type { AssessmentPlan, SkillKey } from './types'

export interface SkillDef {
  key: SkillKey
  label: string
  /** Matches a coach's wording. Word-boundary-ish and case-insensitive. */
  pattern: RegExp
  /** Drill library skill_category matcher. */
  categoryPattern: RegExp
  /** Text scored against drill name / mechanics / flaws. */
  drillQuery: string
  /** 'baseball' | 'physical': physical skills draw on built-in exercises too. */
  family: 'baseball' | 'physical' | 'throwing'
  /** What each phase of a progression is about for this skill. */
  phaseFocus: Record<'foundation' | 'controlled' | 'reactive' | 'game_speed' | 'evaluation', string>
  /** What "better" looks like, used for default targets. Not a prediction. */
  targetPhrase: string
  metrics: AssessmentPlan[]
  /** One simple cue a nine-year-old can hold. */
  childCue: string
}

const M = (p: Omit<AssessmentPlan, 'unit' | 'attempts'> & Partial<Pick<AssessmentPlan, 'unit' | 'attempts'>>): AssessmentPlan =>
  ({ unit: null, attempts: null, ...p })

export const SKILLS: Record<SkillKey, SkillDef> = {
  first_step: {
    key: 'first_step', label: 'First-step quickness', family: 'baseball',
    pattern: /first[\s-]?step|quick(?:er|ness)|reaction|explosive|defensive footwork|footwork|get(?:ting)? a jump|jump on/i,
    categoryPattern: /speed|agility|athletic|baserun|footwork/i,
    drillQuery: 'first step quickness reaction start explosive footwork agility',
    childCue: 'Push the ground away. Short, fast steps.',
    targetPhrase: 'a faster, more consistent first step on a reaction start',
    phaseFocus: {
      foundation: 'Stance, weight on the balls of the feet, and a clean push off the ground from a planned start.',
      controlled: 'Planned starts in set directions, first three steps only, then stop and check posture.',
      reactive: 'Start on a signal the player cannot predict: a clap, a hand drop, a ball flick.',
      game_speed: 'Starts out of a game-like stance (fielder ready position) toward a ball in play.',
      evaluation: 'Re-test the same reaction start under the baseline conditions.',
    },
    metrics: [
      M({ metricSlug: 'sprint_5y', label: '5-yard acceleration', unit: 'sec', direction: 'lower', shape: 'measurement', skill: 'first_step',
        protocol: 'Staggered start from a standing position, 5 yards, 2 timed runs, record the best. Same surface and shoes every time.' }),
      M({ metricSlug: 'first_step_pct', label: 'Correct first step', direction: 'higher', shape: 'challenge', attempts: 10, skill: 'first_step',
        protocol: '10 reaction starts to a hand signal. Count the starts where the first move is a push in the right direction with no false step or rock-back.' }),
    ],
  },
  acceleration: {
    key: 'acceleration', label: 'Acceleration and sprint speed', family: 'baseball',
    pattern: /accelerat|sprint|speed|faster|run(?:ning)? (?:form|mechanics)|get faster|burst/i,
    categoryPattern: /speed|agility|athletic|baserun/i,
    drillQuery: 'acceleration sprint speed running mechanics drive phase arm action',
    childCue: 'Lean, drive the knees, pump the arms.',
    targetPhrase: 'a quicker 10-yard time with the same running form',
    phaseFocus: {
      foundation: 'Body lean and arm swing at low speed; wall-drive and marching positions.',
      controlled: 'Short sprints (5–10 yards) with full recovery; stand-and-go starts.',
      reactive: 'Sprints that begin from a signal or a change of direction.',
      game_speed: 'Sprints that begin out of baseball positions: leaving the box, breaking on a ball.',
      evaluation: 'Re-time the 10-yard sprint under the baseline conditions.',
    },
    metrics: [
      M({ metricSlug: 'sprint_10y', label: '10-yard sprint', unit: 'sec', direction: 'lower', shape: 'measurement', skill: 'acceleration',
        protocol: 'Standing start, 10 yards, 2 timed runs, record the best. Same surface, shoes and start line every time.' }),
    ],
  },
  outfield_tracking: {
    key: 'outfield_tracking', label: 'Outfield tracking and fly-ball routes', family: 'baseball',
    pattern: /outfield|fly[\s-]?ball|fly ball|track(?:ing)? (?:the )?ball|drop[\s-]?step|route|pop[\s-]?fly|get(?:ting)? to (?:fly|balls)/i,
    categoryPattern: /fly|outfield/i,
    drillQuery: 'outfield fly ball tracking drop step route first step read ball',
    childCue: 'Read the ball, turn and go, then look back up.',
    targetPhrase: 'more fly balls caught after a direct first move',
    phaseFocus: {
      foundation: 'Ready position, the drop step, and turning without crossing the feet — no ball yet.',
      controlled: 'Thrown fly balls with a known direction; focus on the first move and the route.',
      reactive: 'Unknown direction and depth; the first step is decided by the ball, not a call.',
      game_speed: 'Balls hit or thrown off a coach with a throw back in; communication and backup.',
      evaluation: 'Repeat the baseline fly-ball set under the same conditions.',
    },
    metrics: [
      M({ metricSlug: 'first_step_outfield_pct', label: 'Outfield first step in the right direction', direction: 'higher', shape: 'challenge', attempts: 10, skill: 'outfield_tracking',
        protocol: '10 fly balls from the same thrower at the same distance and mix of directions. Count balls where the first move was a drop-step or turn in the correct direction.' }),
      M({ metricSlug: 'fly_ball_catch_pct', label: 'Fly balls caught', direction: 'higher', shape: 'challenge', attempts: 10, skill: 'outfield_tracking',
        protocol: '10 fly balls, same thrower, same distance and mix of directions. Count catches. Record wind.' }),
    ],
  },
  infield_fundamentals: {
    key: 'infield_fundamentals', label: 'Infield fundamentals', family: 'baseball',
    pattern: /infield|ground[\s-]?ball|fielding|backhand|forehand|transfer|shortstop|second base|third base|footwork/i,
    categoryPattern: /infield|fielding \(infield\)|^fielding$|team defense/i,
    drillQuery: 'infield ground ball fielding footwork glove transfer backhand forehand',
    childCue: 'Glove down, work through the ball, quick feet to the throw.',
    targetPhrase: 'more clean fields and a quicker transfer',
    phaseFocus: {
      foundation: 'Ready position, glove out front, and fielding a rolled ball with soft hands.',
      controlled: 'Planned grounders to the glove side and forehand; clean fields and a controlled throw.',
      reactive: 'Unknown-direction grounders; backhand and movement to the ball.',
      game_speed: 'Game-pace grounders with throws to a target and a runner-clock rep.',
      evaluation: 'Repeat the baseline grounder set under the same conditions.',
    },
    metrics: [
      M({ metricSlug: 'clean_fielding_pct', label: 'Grounders fielded cleanly', direction: 'higher', shape: 'challenge', attempts: 10, skill: 'infield_fundamentals',
        protocol: '10 grounders at the same speed from the same distance (mix of forehand, backhand, straight on). Count balls fielded without a bobble.' }),
    ],
  },
  hitting: {
    key: 'hitting', label: 'Hitting: sequencing, contact and power', family: 'baseball',
    pattern: /hit(?:ting)?|swing|power|\bbat\b|\btee\b|contact|exit velo|pull(?:ing)? off|hips? (?:open|fly)|stride|hands? drift|launch|\bload\b/i,
    categoryPattern: /^hitting$|batting|hitting/i,
    drillQuery: 'hitting swing sequencing hips hands stride load tee contact power stay inside the ball',
    childCue: 'Stay balanced, let the ball get deep, then turn.',
    targetPhrase: 'harder contact without leaving the ball early',
    phaseFocus: {
      foundation: 'Balance and stride with the hands staying back; slow-motion swings, tee only.',
      controlled: 'Tee and soft toss with one mechanical focus; contact point and finish.',
      reactive: 'Front toss with varied locations; adjusting to the ball without changing the sequence.',
      game_speed: 'Live-speed or machine reps and situational at-bats with the same single cue.',
      evaluation: 'Repeat the baseline tee and toss sessions under the same conditions.',
    },
    metrics: [
      M({ metricSlug: 'exit_velo', label: 'Exit velocity off the tee', unit: 'mph', direction: 'higher', shape: 'measurement', skill: 'hitting',
        protocol: 'Same tee height and location, same ball type, 10 swings, record best and average. Only if a radar or similar device is available.' }),
      M({ metricSlug: 'contact_quality_pct', label: 'Solid contact', direction: 'higher', shape: 'challenge', attempts: 10, skill: 'hitting',
        protocol: '10 swings off the tee at the same location. Count swings with solid, centred contact that stays on a line or hard ground ball to the middle or opposite side.' }),
    ],
  },
  strength_athleticism: {
    key: 'strength_athleticism', label: 'Athletic strength and coordination', family: 'physical',
    pattern: /strength|stronger|athletic|coordination|power(?:ful)?\b.*(?:legs|core)|med(?:icine)? ball|resistance|balance|mobility|agility ladder|jump/i,
    categoryPattern: /athletic|strength|conditioning/i,
    drillQuery: 'athletic development strength coordination balance jump landing core medicine ball',
    childCue: 'Move well first. Land quiet. Stop if it hurts.',
    targetPhrase: 'better balance, landing control and general strength',
    phaseFocus: {
      foundation: 'Movement quality: squat, hinge, lunge, push, pull and plank patterns with body weight.',
      controlled: 'Light resistance or bodyweight work with controlled tempo and a stop before form breaks.',
      reactive: 'Jumps and landings, light throws into a padded wall, and balance under distraction.',
      game_speed: 'Athletic circuits at a pace that keeps technique clean; no new loads.',
      evaluation: 'Re-test balance, broad jump and landing control under the baseline conditions.',
    },
    metrics: [
      M({ metricSlug: 'broad_jump', label: 'Standing broad jump', unit: 'in', direction: 'higher', shape: 'measurement', skill: 'strength_athleticism',
        protocol: 'Standing start, two feet together, 3 jumps, record the best landing you can hold for 2 seconds. Same surface and shoes.' }),
      M({ metricSlug: 'balance_hold_sec', label: 'Single-leg balance hold', unit: 'sec', direction: 'higher', shape: 'measurement', skill: 'strength_athleticism',
        protocol: 'Barefoot or same shoes, eyes open, hands on hips, best of 2 per leg; report the weaker leg. Stop at 30 seconds.' }),
    ],
  },
  pitching_readiness: {
    key: 'pitching_readiness', label: 'Pitching readiness and throwing performance', family: 'throwing',
    pattern: /pitch(?:ing|er)?\b|velocity|velo\b|mound|arm strength|throw(?:ing)? harder/i,
    categoryPattern: /pitch|throw/i,
    drillQuery: 'pitching delivery balance lower half hinge drift throwing mechanics',
    childCue: 'Balance first. Smooth, then athletic.',
    targetPhrase: 'a pain-free arm, a repeatable delivery and better command',
    phaseFocus: {
      foundation: 'Readiness check, arm care and legs-and-balance work without throwing hard.',
      controlled: 'Easy, short-distance throwing when the gate is cleared; one delivery cue.',
      reactive: 'Throws to a target with variation; delivery work without a velocity goal.',
      game_speed: 'Easy throws to a target and delivery balance work, only if the gate is cleared and the arm has stayed pain-free. No velocity goal.',
      evaluation: 'Re-check readiness, command and delivery consistency under the baseline conditions.',
    },
    metrics: [
      M({ metricSlug: 'strike_pct', label: 'Strikes thrown', direction: 'higher', shape: 'challenge', attempts: 10, skill: 'pitching_readiness',
        protocol: '10 pitches at an easy effort to a catcher at the age-appropriate distance. Count strikes. Only once the throwing gate is cleared.' }),
    ],
  },
  throwing: {
    key: 'throwing', label: 'Throwing accuracy', family: 'throwing',
    pattern: /throwing accuracy|accurate throw|arm care|long toss|crow hop/i,
    categoryPattern: /throw/i,
    drillQuery: 'throwing accuracy footwork crow hop target',
    childCue: 'Step to the target, point the glove, finish through.',
    targetPhrase: 'more throws on target at a comfortable effort',
    phaseFocus: {
      foundation: 'Grip, feet and finish at short distance.',
      controlled: 'Throws to a target with one cue.',
      reactive: 'Throws after fielding or moving.',
      game_speed: 'Throws under game-like pressure.',
      evaluation: 'Repeat the baseline throwing set.',
    },
    metrics: [
      M({ metricSlug: 'throw_accuracy', label: 'Throws on target', direction: 'higher', shape: 'challenge', attempts: 10, skill: 'throwing',
        protocol: '10 throws at the same distance and target size, comfortable effort.' }),
    ],
  },
  catching: {
    key: 'catching', label: 'Catching', family: 'baseball',
    pattern: /catcher|catching|receiving|blocking/i,
    categoryPattern: /catch/i,
    drillQuery: 'catching receiving blocking stance',
    childCue: 'Quiet hands, soft catch.',
    targetPhrase: 'steadier receiving',
    phaseFocus: {
      foundation: 'Stance and receiving.', controlled: 'Receiving with a set target.',
      reactive: 'Blocking balls in the dirt.', game_speed: 'Receiving at game speed.', evaluation: 'Repeat the baseline set.',
    },
    metrics: [],
  },
  baserunning: {
    key: 'baserunning', label: 'Baserunning', family: 'baseball',
    pattern: /baserunning|base running|steal|lead[\s-]?off|home to first|running the bases/i,
    categoryPattern: /baserun/i,
    drillQuery: 'baserunning lead jump turn first to third',
    childCue: 'Run through the bag. Eyes up on the turn.',
    targetPhrase: 'quicker home-to-first and smarter reads',
    phaseFocus: {
      foundation: 'Running through first and rounding technique.', controlled: 'Planned turns.',
      reactive: 'Reads on a ball in play.', game_speed: 'Game-pace running.', evaluation: 'Re-time home to first.',
    },
    metrics: [
      M({ metricSlug: 'home_to_first', label: 'Home to first', unit: 'sec', direction: 'lower', shape: 'measurement', skill: 'baserunning',
        protocol: 'Bat in hand, swing and run through first, 2 timed runs, record the best. Same surface.' }),
    ],
  },
}

export const SKILL_LIST: SkillDef[] = Object.values(SKILLS)

/**
 * Skills a coach's text names, in the order they first appear.
 *
 * A pattern matches a word, not an intent: "outfield" in "my outfielder is
 * great, work on his swing" would also match. That is acceptable HERE because
 * this only proposes skills for the coach to confirm in the editor — it never
 * silently narrows a request (narrowing was the original failure).
 */
export function detectSkills(text: string): SkillKey[] {
  const found: Array<{ key: SkillKey; at: number }> = []
  for (const def of SKILL_LIST) {
    // 'footwork' is shared by first_step and infield; both firing is correct.
    const m = def.pattern.exec(text)
    if (m) found.push({ key: def.key, at: m.index })
  }
  found.sort((a, b) => a.at - b.at)
  return found.map(f => f.key)
}

export function skillLabel(k: SkillKey): string { return SKILLS[k].label }
