// progression_level uses the REAL library's four-point scale (lib/progression.ts:
// levels 1-4 map to stages 1,2,2,3; only level 4 is live/game speed).
//
// A small synthetic drill library for tests. These are FIXTURE rows with
// fixture ids, not production drills — the tests prove the selection rules,
// not the content of the real library.

import type { DrillRecord } from '@/lib/drills'

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const d = (x: Partial<DrillRecord> & { drill_name: string; skill_category: string }): DrillRecord => ({
  id: id(), description: `${x.drill_name}. Set up as described and complete the reps with the cue. Reset between reps.`,
  ai_coaching_notes: 'Say one cue at a time. Watch the first move.', min_age: 6, max_age: 12, progression_level: 1,
  equipment_needed: [], indoor_outdoor: 'both', requires_partner: false, success_markers: ['Clean first move on most reps'],
  reps_guidance: '3 sets of 8', youtube_video_id: null, status: 'approved', ...x,
})

export const DRILL_POOL: DrillRecord[] = [
  d({ drill_name: 'Tee Work: Stay Back Stride', skill_category: 'Hitting', mechanic_focus: ['hands stay back', 'stride', 'sequencing'], equipment_needed: ['batting tee', 'net'], progression_level: 1, youtube_video_id: 'abcdefghijk' }),
  d({ drill_name: 'Soft Toss Front Hip Turn', skill_category: 'Hitting', mechanic_focus: ['hip rotation', 'contact point'], equipment_needed: ['net'], progression_level: 2, requires_partner: true }),
  d({ drill_name: 'Front Toss Situational Swings', skill_category: 'Hitting', mechanic_focus: ['timing', 'sequencing'], equipment_needed: ['batting cage'], progression_level: 4, requires_partner: true }),
  d({ drill_name: 'Pitching Machine Live Reps', skill_category: 'Hitting', mechanic_focus: ['timing'], equipment_needed: ['pitching machine'], progression_level: 4 }),
  d({ drill_name: 'Drop Step Fly Ball Reads', skill_category: 'Fielding (Fly Balls)', mechanic_focus: ['drop step', 'first step', 'route'], equipment_needed: ['field'], progression_level: 1, requires_partner: true, indoor_outdoor: 'outdoor' }),
  d({ drill_name: 'Thrown Fly Ball Routes', skill_category: 'Fielding (Fly Balls)', mechanic_focus: ['route', 'tracking'], equipment_needed: ['field'], progression_level: 2, requires_partner: true, indoor_outdoor: 'outdoor' }),
  d({ drill_name: 'Over the Shoulder Catches', skill_category: 'Fielding (Fly Balls)', mechanic_focus: ['tracking', 'catching while moving'], equipment_needed: ['field'], progression_level: 4, requires_partner: true, indoor_outdoor: 'outdoor' }),
  d({ drill_name: 'Ready Position Ground Balls', skill_category: 'Fielding (Infield)', mechanic_focus: ['glove out front', 'footwork'], progression_level: 1, requires_partner: true }),
  d({ drill_name: 'Backhand and Forehand Funnel', skill_category: 'Fielding (Infield)', mechanic_focus: ['backhand', 'transfer'], progression_level: 2, requires_partner: true }),
  d({ drill_name: 'Game Speed Grounders and Throws', skill_category: 'Fielding (Infield)', mechanic_focus: ['transfer', 'footwork'], progression_level: 4, requires_partner: true }),
  d({ drill_name: 'Cone First-Step Starts', skill_category: 'Athletic Development', mechanic_focus: ['first step', 'explosive start'], equipment_needed: ['cones'], progression_level: 1 }),
  d({ drill_name: 'Resisted Sled Sprints', skill_category: 'Athletic Development', mechanic_focus: ['acceleration'], equipment_needed: ['sled'], progression_level: 2 }),
  d({ drill_name: 'Reaction Ball Starts', skill_category: 'Athletic Development', mechanic_focus: ['reaction', 'first step'], progression_level: 2, requires_partner: true }),
  d({ drill_name: 'Indoor Soft-Ball Tee Drill', skill_category: 'Hitting', mechanic_focus: ['contact point'], equipment_needed: ['batting tee'], progression_level: 1, indoor_outdoor: 'indoor' }),
]
