// SYNTHETIC. Every account, name, id, note and number here is invented for
// tests. Nothing came from production and nothing describes a real child.
//
// Accounts (auth users) and what each may reach:
//
//   owner-a     head coach of Team A, owns coach-a
//   assistant   contributor on Team A, no coach account of their own
//   viewer      viewer on Team A, with a coach account of their own (empty)
//   owner-b     head coach of Team B
//   solo        a Personal-plan coach: no teams, one player of their own
//   league      an administrator of a league that sponsors Team A — and no
//               membership of Team A itself
//   stranger    a signed-in coach with no relationship to anything here
//
// Players:
//
//   marcus      Team A roster (created by coach-a)
//   archie      archived from Team A
//   homekid     coach-a's own player, on no team
//   zoe         Team B roster
//   solokid     the solo coach's player, on no team
//
// Every private field carries a marker naming its player, so a test can tell
// exactly whose data reached any output.

import type { Tables } from '../lib/strictSupabase'

export const U = {
  ownerA: 'user-owner-a', assistant: 'user-assistant', viewer: 'user-viewer',
  ownerB: 'user-owner-b', solo: 'user-solo', league: 'user-league', stranger: 'user-stranger',
} as const

export const C = {
  a: 'coach-a', b: 'coach-b', viewer: 'coach-viewer', solo: 'coach-solo', stranger: 'coach-stranger',
} as const

export const T = { a: 'team-a', b: 'team-b' } as const

export const P = {
  marcus: 'player-marcus', archie: 'player-archie', homekid: 'player-homekid',
  zoe: 'player-zoe', solokid: 'player-solokid', missing: 'player-does-not-exist',
} as const

/** The marker every private field of a player carries. */
export const mark = (player: string, field: string) => `MK-${player}-${field}`
export const markers = (player: string) =>
  ['name', 'trait', 'metric', 'note', 'observation'].map(f => mark(player, f))

const player = (id: string, coach: string, birth_year: number) =>
  ({ id, coach_id: coach, name: `${mark(id, 'name')}`, birth_year, jersey_number: '1', created_at: '2026-03-01T00:00:00Z' })

export function seed(): Tables {
  const ids = [P.marcus, P.archie, P.homekid, P.zoe, P.solokid]
  return {
    coaches: [
      { id: C.a, user_id: U.ownerA, display_name: 'Synthetic Coach A', subscription_tier: 'team', is_subscribed: true },
      { id: C.b, user_id: U.ownerB, display_name: 'Synthetic Coach B', subscription_tier: 'team', is_subscribed: true },
      { id: C.viewer, user_id: U.viewer, display_name: 'Synthetic Viewer', subscription_tier: 'free', is_subscribed: false },
      { id: C.solo, user_id: U.solo, display_name: 'Synthetic Solo', subscription_tier: 'personal', is_subscribed: true },
      { id: C.stranger, user_id: U.stranger, display_name: 'Synthetic Stranger', subscription_tier: 'team', is_subscribed: true },
    ],
    seasons: [{ id: 'season-1', name: 'Fall 2026', league_type: 'rec', start_date: '2026-03-01', end_date: '2026-11-30' }],
    teams: [
      { id: T.a, coach_id: C.a, name: 'Synthetic Team A', age_group: '9U', skill_level: 'Beginner', season_id: 'season-1', created_at: '2026-03-01T00:00:00Z', primary_goals: [] },
      { id: T.b, coach_id: C.b, name: 'Synthetic Team B', age_group: '10U', skill_level: 'Beginner', season_id: 'season-1', created_at: '2026-03-01T00:00:00Z', primary_goals: [] },
    ],
    team_members: [
      { id: 'tm-1', team_id: T.a, user_id: U.assistant, role: 'contributor' },
      { id: 'tm-2', team_id: T.a, user_id: U.viewer, role: 'viewer' },
    ],
    leagues: [{ id: 'league-1', name: 'Synthetic League' }],
    league_members: [{ id: 'lm-1', league_id: 'league-1', user_id: U.league, role: 'owner' }],
    league_licenses: [{ id: 'lic-1', league_id: 'league-1', team_id: T.a, status: 'active' }],
    players: [
      player(P.marcus, C.a, 2017), player(P.archie, C.a, 2017), player(P.homekid, C.a, 2016),
      player(P.zoe, C.b, 2016), player(P.solokid, C.solo, 2018),
    ],
    team_players: [
      { id: 'tp-marcus', team_id: T.a, player_id: P.marcus, positions: ['SS'], throwing_level: 2 },
      { id: 'tp-zoe', team_id: T.b, player_id: P.zoe, positions: ['P'], throwing_level: 4 },
    ],
    team_player_archive: [
      { id: 'arch-archie', team_id: T.a, player_id: P.archie, archived_at: '2026-08-01T00:00:00Z', roster: {} },
    ],
    player_traits: ids.map(id => ({ id: `trait-${id}`, player_id: id, note: mark(id, 'trait'), created_at: '2026-04-01T00:00:00Z' })),
    metric_types: [{ id: 'mt-sprint', coach_id: null, slug: 'sprint', label: 'Sprint', unit: 's', shape: 'measurement', direction: 'lower', sort_order: 1 }],
    player_metrics: ids.map((id, i) => ({
      id: `metric-${id}`, coach_id: id === P.zoe ? C.b : id === P.solokid ? C.solo : C.a, player_id: id,
      metric_type_id: 'mt-sprint', metric: 'sprint', value: 4 + i / 10, unit: 's', measured_on: '2026-05-01',
      note: mark(id, 'metric'),
    })),
    player_notes: [
      { id: 'pn-marcus', team_id: T.a, player_id: P.marcus, note: mark(P.marcus, 'note'), created_at: '2026-05-02T00:00:00Z' },
      { id: 'pn-zoe', team_id: T.b, player_id: P.zoe, note: mark(P.zoe, 'note'), created_at: '2026-05-02T00:00:00Z' },
    ],
    observations: [
      { id: 'obs-marcus', coach_id: C.a, team_id: T.a, player_id: P.marcus, prompt_key: 'unseen', observed_on: '2026-09-01', body: mark(P.marcus, 'observation'), entry_id: null },
      { id: 'obs-team-a', coach_id: C.a, team_id: T.a, player_id: null, prompt_key: 'unseen', observed_on: '2026-09-02', body: 'MK-team-a-wide-observation', entry_id: null },
      { id: 'obs-zoe', coach_id: C.b, team_id: T.b, player_id: P.zoe, prompt_key: 'unseen', observed_on: '2026-09-01', body: mark(P.zoe, 'observation'), entry_id: null },
      { id: 'obs-solokid', coach_id: C.solo, team_id: null, player_id: P.solokid, prompt_key: 'unseen', observed_on: '2026-09-01', body: mark(P.solokid, 'observation'), entry_id: null },
    ],
    player_journal_entries: [], player_season_batting: [], player_game_stats: [],
    prescriptions: [], entries: [], checkins: [], chat_threads: [], chat_messages: [],
    player_reports: [], player_report_focus_areas: [], player_report_drills: [],
    team_notes: [], saved_drills: [], practice_plans: [], player_playbooks: [], coach_preferences: [],
    problem_taxonomy: [{
      slug: 'throwing-accuracy', label: 'Throwing accuracy', skill_category: 'throwing', description: 'Throws miss.',
      aliases: ['throws'], do_not_coach_flag: false, do_not_coach_note: null, age_relevance: null,
    }],
  }
}
