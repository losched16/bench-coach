// The Charlie acceptance scenario, as a fixture. The message and the facts are
// what the coach supplied; the player evidence is FIXTURE data standing in for
// what the authorised loader would read from a real account — it is labelled
// as such and nothing in lib/ hardcodes any of it.

import type { PlayerEvidence } from '@/lib/programs/evidence'

export const CHARLIE_MESSAGE =
  "Build my 9-year-old son Charlie an eight-week development program starting November 9, 2026. " +
  "Winter workouts begin January 8, 2027 and official tryouts are around March 8, 2027. " +
  "I want to improve his first-step quickness, acceleration, outfield tracking and fly-ball routes, infield fundamentals, " +
  "hitting sequencing and quality of contact (more power without pulling off the ball), athletic strength, and pitching readiness and velocity safely. " +
  "We can do five supervised training days a week plus short independent routines, and some sessions will be filmed for our father-son baseball channel. " +
  "We have a batting tee, a net, resistance bands, small dumbbells, medicine balls, batting cage access and an outdoor field. " +
  "His first step is slow, he has several outfield tracking difficulties, his hips may open too early, and he is anxious about making the travel team. " +
  "He has been resting his arm."

export const CHARLIE_EVIDENCE: PlayerEvidence = {
  items: [
    { bucket: 'needs', source: 'coach_observation', on: '2026-10-12', skill: 'hitting', text: 'Hitting assessment: hands drift forward during the stride.' },
    { bucket: 'strengths', source: 'recorded', on: '2026-10-20', skill: 'hitting', text: 'Went 8-for-8 across two games.' },
    { bucket: 'history', source: 'recorded', on: '2026-10-05', skill: 'hitting', text: 'One exit-velocity session is on file.' },
    { bucket: 'concerns', source: 'user_reported', skill: 'first_step', text: 'Parent reports a slow first step.' },
  ],
  pathways: [
    { progressId: '33333333-3333-3333-3333-333333333333', skill: 'hitting', pathwayName: 'Load to Launch', stageName: 'Stay Back', status: 'active' },
    { progressId: '44444444-4444-4444-4444-444444444444', skill: 'first_step', pathwayName: 'Speed & Agility Development', stageName: 'First-step explosion', status: 'active' },
  ],
  metrics: [{ slug: 'exit_velo', label: 'Exit velocity', value: 41, unit: 'mph', on: '2026-10-05', attempts: null, successes: null }],
  loggedSessions60d: 3,
  contextText: '',
}
