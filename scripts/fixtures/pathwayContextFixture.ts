// SYNTHETIC. Every name, id, date and note below is invented for tests. No row
// here came from production, and none of it describes a real child.
//
// Two teams owned by two different coaches:
//
//   Team A — "Synthetic 9U Tigers", coach A
//     Marcus  three plans: Build the Arm (active, stage 2), Glove Work (paused),
//             an older Glove Work (completed). Real recorded history.
//     Eli     Build the Arm, active, stage 2 — enrolled and NOTHING else.
//     Sam     on the roster, no plans at all.
//
//   Team B — "Synthetic 10U Hawks", coach B
//     Zoe     Build the Arm, stage 3, with a note carrying LEAK_SENTINEL.
//
// LEAK_SENTINEL appears only in team B's rows. A test that finds it in anything
// assembled for team A has found a cross-team leak.

import type { Tables } from '../lib/strictSupabase'

export const LEAK_SENTINEL = 'TEAMB-PRIVATE-7f3a'

export const IDS = {
  teamA: 'team-a', teamB: 'team-b',
  coachA: 'coach-a', coachB: 'coach-b',
  marcus: 'player-marcus', eli: 'player-eli', sam: 'player-sam', zoe: 'player-zoe',
  arm: 'pathway-arm', glove: 'pathway-glove',
  marcusArm: 'prog-marcus-arm', marcusGlove: 'prog-marcus-glove', marcusOld: 'prog-marcus-glove-old',
  eliArm: 'prog-eli-arm', zoeArm: 'prog-zoe-arm',
} as const

export const ARM_SIGNALS = {
  s2a: 'Steps toward the target on every throw',
  s2b: 'Glove-side arm pulls in, not flying open',
  s2c: 'Hits a chest-high target 7 of 10 from 45 feet',
}

export function stageRows() {
  const arm = [
    { stage_number: 1, stage_key: 'arm-grip', name: 'Grip and set-up', objective: 'Four-seam grip without looking, every time.',
      mastery_signals: ['Finds the seams without looking'], common_failure_modes: ['Choking the ball deep in the palm'] },
    { stage_number: 2, stage_key: 'arm-direction', name: 'Direction to the target',
      objective: 'Front side and stride both point at the target, so the ball goes where the chest points.',
      why_it_matters: 'Most wild throws at 9U are direction, not arm strength.',
      coaching_emphasis: 'Point, step, throw. Say it out loud.',
      mastery_signals: [ARM_SIGNALS.s2a, ARM_SIGNALS.s2b, ARM_SIGNALS.s2c],
      common_failure_modes: ['Front shoulder flies open early', 'Steps across the body'] },
    { stage_number: 3, stage_key: 'arm-long-toss', name: 'Controlled long toss',
      objective: 'Keeps the same direction as distance grows to 70 feet.',
      mastery_signals: ['Throws stay on a line at 70 feet'], common_failure_modes: ['Arcing the ball to reach'] },
    { stage_number: 4, stage_key: 'arm-game', name: 'Throws in game situations',
      objective: 'Accurate throws after fielding, on the move.',
      mastery_signals: ['Accurate to first after a ground ball'], common_failure_modes: ['Rushing the feet'] },
  ].map(s => ({ pathway_id: IDS.arm, why_it_matters: null, coaching_emphasis: null, ...s }))

  const glove = [
    { stage_number: 1, stage_key: 'glove-ready', name: 'Ready position', objective: 'Athletic stance before every pitch.',
      mastery_signals: ['In a ready stance without a reminder'], common_failure_modes: ['Standing tall'] },
    { stage_number: 2, stage_key: 'glove-funnel', name: 'Funnel to the belly', objective: 'Glove works out front and brings the ball in.',
      mastery_signals: ['Glove out front on grounders'], common_failure_modes: ['Fielding beside the body'] },
    { stage_number: 3, stage_key: 'glove-throw', name: 'Field and throw', objective: 'One smooth motion from glove to throw.',
      mastery_signals: ['No double clutch'], common_failure_modes: ['Pausing after the catch'] },
  ].map(s => ({ pathway_id: IDS.glove, why_it_matters: null, coaching_emphasis: null, ...s }))

  return [...arm, ...glove]
}

export function seedTables(): Tables {
  return {
    coaches: [
      { id: IDS.coachA, user_id: 'user-a', name: 'Synthetic Coach A', subscription_tier: 'team', is_subscribed: true },
      { id: IDS.coachB, user_id: 'user-b', name: 'Synthetic Coach B', subscription_tier: 'team', is_subscribed: true },
    ],
    seasons: [{ id: 'season-1', league_type: 'rec', start_date: '2026-03-01', end_date: '2026-11-30' }],
    teams: [
      { id: IDS.teamA, coach_id: IDS.coachA, name: 'Synthetic 9U Tigers', age_group: '9U', skill_level: 'Beginner',
        season_id: 'season-1', created_at: '2026-03-01T00:00:00Z', primary_goals: [] },
      { id: IDS.teamB, coach_id: IDS.coachB, name: 'Synthetic 10U Hawks', age_group: '10U', skill_level: 'Intermediate',
        season_id: 'season-1', created_at: '2026-03-01T00:00:00Z', primary_goals: [] },
    ],
    players: [
      { id: IDS.marcus, name: 'Marcus Synthetic', birth_year: 2017, jersey_number: '7' },
      { id: IDS.eli, name: 'Eli Synthetic', birth_year: 2017, jersey_number: '12' },
      { id: IDS.sam, name: 'Sam Synthetic', birth_year: 2017, jersey_number: '3' },
      { id: IDS.zoe, name: 'Zoe Synthetic', birth_year: 2016, jersey_number: '9' },
    ],
    team_players: [
      { id: 'tp-marcus', team_id: IDS.teamA, player_id: IDS.marcus, positions: ['SS'], throwing_level: 2 },
      { id: 'tp-eli', team_id: IDS.teamA, player_id: IDS.eli, positions: ['2B'], throwing_level: 2 },
      { id: 'tp-sam', team_id: IDS.teamA, player_id: IDS.sam, positions: ['OF'], throwing_level: 3 },
      { id: 'tp-zoe', team_id: IDS.teamB, player_id: IDS.zoe, positions: ['P'], throwing_level: 4 },
    ],
    development_pathways: [
      { id: IDS.arm, slug: 'build-the-arm', name: 'Build the Arm', skill_category: 'throwing', status: 'published', version: 1 },
      { id: IDS.glove, slug: 'glove-work', name: 'Glove Work', skill_category: 'fielding', status: 'published', version: 1 },
    ],
    development_pathway_stages: stageRows().map((s, i) => ({ id: `stage-${i + 1}`, ...s })),
    player_pathway_progress: [
      { id: IDS.marcusArm, player_id: IDS.marcus, team_id: IDS.teamA, pathway_id: IDS.arm, pathway_version: 1,
        current_stage_key: 'arm-direction', current_stage_number: 2, status: 'active',
        started_at: '2026-08-15T17:00:00Z', stage_started_at: '2026-09-01T17:00:00Z', completed_at: null },
      { id: IDS.marcusGlove, player_id: IDS.marcus, team_id: IDS.teamA, pathway_id: IDS.glove, pathway_version: 1,
        current_stage_key: 'glove-funnel', current_stage_number: 2, status: 'paused',
        started_at: '2026-08-20T17:00:00Z', stage_started_at: '2026-08-28T17:00:00Z', completed_at: null },
      { id: IDS.marcusOld, player_id: IDS.marcus, team_id: IDS.teamA, pathway_id: IDS.glove, pathway_version: 1,
        current_stage_key: 'glove-throw', current_stage_number: 3, status: 'completed',
        started_at: '2026-05-01T17:00:00Z', stage_started_at: '2026-07-01T17:00:00Z', completed_at: '2026-07-30T17:00:00Z' },
      { id: IDS.eliArm, player_id: IDS.eli, team_id: IDS.teamA, pathway_id: IDS.arm, pathway_version: 1,
        current_stage_key: 'arm-direction', current_stage_number: 2, status: 'active',
        started_at: '2026-09-05T17:00:00Z', stage_started_at: '2026-09-05T17:00:00Z', completed_at: null },
      { id: IDS.zoeArm, player_id: IDS.zoe, team_id: IDS.teamB, pathway_id: IDS.arm, pathway_version: 1,
        current_stage_key: 'arm-long-toss', current_stage_number: 3, status: 'active',
        started_at: '2026-08-01T17:00:00Z', stage_started_at: '2026-09-02T17:00:00Z', completed_at: null },
    ],
    player_pathway_events: [
      ev('e-m1', IDS.marcusArm, IDS.teamA, 'enrolled', '2026-08-15', { stage_key: 'arm-grip', stage_number: 1 }),
      ev('e-m2', IDS.marcusArm, IDS.teamA, 'advanced', '2026-09-01',
        { stage_key: 'arm-direction', stage_number: 2, from_stage_key: 'arm-grip', to_stage_key: 'arm-direction' }),
      ev('e-m3', IDS.marcusArm, IDS.teamA, 'session_logged', '2026-09-10',
        { stage_key: 'arm-direction', stage_number: 2, detail: { minutes: 20, drill_ids: [] } }),
      // An older mastery record that a later one supersedes — unticking must stick.
      ev('e-m4', IDS.marcusArm, IDS.teamA, 'mastery_recorded', '2026-09-08',
        { stage_key: 'arm-direction', stage_number: 2, detail: { signals: [ARM_SIGNALS.s2a, ARM_SIGNALS.s2b, ARM_SIGNALS.s2c] } },
        '2026-09-08T18:00:00Z'),
      // The current one: two canonical signals and one the stage no longer lists.
      ev('e-m5', IDS.marcusArm, IDS.teamA, 'mastery_recorded', '2026-09-12',
        { stage_key: 'arm-direction', stage_number: 2, detail: { signals: [ARM_SIGNALS.s2a, ARM_SIGNALS.s2b, 'A signal this stage never had'] } },
        '2026-09-12T18:00:00Z'),
      ev('e-m6', IDS.marcusArm, IDS.teamA, 'note', '2026-09-14',
        { stage_key: 'arm-direction', stage_number: 2, note: 'Front shoulder still opens early on throws from deep short.' }),
      ev('e-mg1', IDS.marcusGlove, IDS.teamA, 'enrolled', '2026-08-20', { stage_key: 'glove-ready', stage_number: 1 }),
      ev('e-mg2', IDS.marcusGlove, IDS.teamA, 'paused', '2026-09-03', { stage_key: 'glove-funnel', stage_number: 2 }),
      ev('e-mo1', IDS.marcusOld, IDS.teamA, 'completed', '2026-07-30', { stage_key: 'glove-throw', stage_number: 3 }),
      ev('e-e1', IDS.eliArm, IDS.teamA, 'enrolled', '2026-09-05', { stage_key: 'arm-direction', stage_number: 2 }),
      ev('e-z1', IDS.zoeArm, IDS.teamB, 'enrolled', '2026-08-01', { stage_key: 'arm-grip', stage_number: 1 }),
      ev('e-z2', IDS.zoeArm, IDS.teamB, 'note', '2026-09-15',
        { stage_key: 'arm-long-toss', stage_number: 3, note: `Team B only: ${LEAK_SENTINEL}` }),
    ],
    // The existing context sources, so "existing sections intact" has something to hold.
    observations: [
      { id: 'obs-1', coach_id: IDS.coachA, team_id: IDS.teamA, player_id: IDS.marcus, prompt_key: 'unseen',
        observed_on: '2026-09-20', body: 'Throws from short were on target after the direction cue.', entry_id: null },
      { id: 'obs-b', coach_id: IDS.coachB, team_id: IDS.teamB, player_id: IDS.zoe, prompt_key: 'unseen',
        observed_on: '2026-09-20', body: `Team B observation ${LEAK_SENTINEL}`, entry_id: null },
    ],
    player_notes: [
      { id: 'pn-1', team_id: IDS.teamA, player_id: IDS.marcus, note: 'Loves playing short.', created_at: '2026-09-02T00:00:00Z' },
    ],
    player_traits: [], player_journal_entries: [], player_season_batting: [], player_game_stats: [],
    metric_types: [], player_metrics: [], prescriptions: [], entries: [],
  }
}

function ev(
  id: string, progress_id: string, team_id: string, event_type: string, occurred_on: string,
  extra: Record<string, any> = {}, created_at?: string
) {
  return {
    id, progress_id, team_id, event_type, occurred_on,
    stage_key: null, stage_number: null, from_stage_key: null, to_stage_key: null,
    detail: {}, note: null, actor_user_id: 'user-a',
    created_at: created_at || `${occurred_on}T19:00:00Z`,
    ...extra,
  }
}

/** A fixed "today", so every rendered date in a test is stable. */
export const TODAY = new Date(2026, 8, 29) // 2026-09-29, local time
