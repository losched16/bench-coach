'use client'

// A bench for the practice builder. Development only.
//
// WHY THIS EXISTS
//
// The builder lives behind a login, on a page that reads a team, a roster, a
// drill library and a saved plan out of the database. That is the right shape
// for the product and the wrong one for proving the editing works: a browser
// test would spend all its effort on authentication and fixtures and still not
// isolate the thing under test.
//
// So this mounts the real PlanReview — not a copy, not a mock — over a fixed
// 9U plan and a fixed drill list, with no auth and no network. Every action a
// coach takes in the real builder is the same code path here.
//
// It renders nothing in production. `next build` still compiles the route, so
// it cannot rot silently, but the component returns null when NODE_ENV is
// production and there is no data behind it to expose in any case.
//
// The <pre id="state"> at the bottom is the whole point: a test can read the
// block list back and assert on it rather than on what the DOM looks like.

import { useState } from 'react'
import { PlanReview } from '@/components/PlanReview'
import { scheduleRows } from '@/lib/practicePlan'

const PLAN_9U = {
  title: 'Springford Blue (9U) — Throwing, Hitting, Infield',
  objective: 'Every infielder fields with two hands and comes up throwing.',
  coaching_points: ['Two hands', 'Through the ball', 'Feet before hands'],
  coach_notes: null,
  flags: [],
  start_time: '17:30',
  equipment_available: [],
  priority_coverage: null,
  blocks: [
    { type: 'warmup', title: 'Throwing Progression — Knee, Hip, Full', minutes: 12, description: 'Three phases.', skills: ['throwing'] },
    { type: 'drill', title: 'Stance, Grip, Load to Launch', minutes: 12, description: 'Build the swing from the ground up.', skills: ['hitting'] },
    { type: 'drill', title: 'Front Toss', minutes: 15, description: 'Feeder behind an L-screen.', skills: ['hitting'] },
    { type: 'drill', title: 'Kneeling Infield Hands Routine', minutes: 10, description: 'Hands only, no feet.', skills: ['infield'] },
    { type: 'drill', title: 'Standing Roll and Transfer', minutes: 10, description: 'Field and come up throwing.', skills: ['infield'] },
    { type: 'drill', title: 'Outside-the-Ball Cone Drill', minutes: 11, description: 'Round the ball to the glove side.', skills: ['infield'] },
    { type: 'drill', title: 'Bad-Hop Drill', minutes: 10, description: 'Short hops off the wall.', skills: ['infield'] },
    { type: 'game', title: 'Scrimmage', minutes: 10, description: 'Live.', skills: ['infield'] },
  ],
}

const DRILLS = [
  { id: 'd1', drill_name: 'High Tee Drill', skill_category: 'Hitting', description: 'Tee above the belt.', est_duration_minutes: 10, difficulty_level: 'beginner' },
  { id: 'd2', drill_name: 'Soft Toss From the Side', skill_category: 'Soft Toss', description: 'Partner feeds from the side.', est_duration_minutes: 10 },
  { id: 'd3', drill_name: 'One-Hand Tee Drill (Bottom Hand)', skill_category: 'Hitting', description: 'Lead arm only.', est_duration_minutes: 8 },
  { id: 'd4', drill_name: 'Four Cones Ground Ball Drill', skill_category: 'Fielding (Infield)', description: 'Four angles.', est_duration_minutes: 12 },
  { id: 'd5', drill_name: 'Daily Backhand Series', skill_category: 'Fielding (Infield)', description: 'Backhand reps.', est_duration_minutes: 10 },
  { id: 'd6', drill_name: 'Crow Hop Drill', skill_category: 'Throwing', description: 'Momentum into the throw.', est_duration_minutes: 8 },
  { id: 'd7', drill_name: 'Wall Ball', skill_category: 'Throwing', description: 'Solo reps off a wall.', est_duration_minutes: 8 },
  { id: 'd8', drill_name: 'Bullseye Challenge', skill_category: 'Throwing', description: 'Accuracy competition.', est_duration_minutes: 8 },
]

export default function BuilderHarness() {
  const [content, setContent] = useState<any>(() => JSON.parse(JSON.stringify(PLAN_9U)))
  // "Saved" content, so a test can prove the round trip without a database.
  const [saved, setSaved] = useState<any>(null)

  if (process.env.NODE_ENV === 'production') return null

  const blocks = content.blocks || []

  return (
    <div>
      <PlanReview
        draft={content}
        onBlocksChange={(next) => setContent((c: any) => ({ ...c, blocks: next }))}
        onOverviewChange={(patch) => setContent((c: any) => ({ ...c, ...patch }))}
        onClose={() => {}}
        duration={90}
        timeLabels={scheduleRows(blocks, content.start_time).map(r => `${r.from}–${r.to}`)}
        coverage={null}
        status="harness"
        drills={DRILLS as any}
        focusAreas={['throwing', 'hitting', 'infield']}
        drillResources={DRILLS as any}
        footer={
          <button
            data-testid="save"
            onClick={() => setSaved(JSON.parse(JSON.stringify(content)))}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm"
          >
            Save
          </button>
        }
      />

      {/* What a test reads instead of guessing from the DOM. */}
      <pre id="state" data-testid="state" style={{ display: 'none' }}>
        {JSON.stringify({
          titles: blocks.map((b: any) => b.title),
          minutes: blocks.map((b: any) => b.minutes),
          total: blocks.reduce((s: number, b: any) => s + (Number(b.minutes) || 0), 0),
          stations: blocks.map((b: any) => Array.isArray(b.stations) ? b.stations.map((s: any) => s.title) : null),
          rotations: blocks.map((b: any) => b.rotation_minutes ?? null),
        })}
      </pre>
      <pre id="saved" data-testid="saved" style={{ display: 'none' }}>
        {saved ? JSON.stringify({ titles: saved.blocks.map((b: any) => b.title) }) : ''}
      </pre>
    </div>
  )
}
