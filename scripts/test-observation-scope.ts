// Observation scope: whose observations reach the coaching context.
//
//   npm run test:observation-scope
//
// An assistant coach records observations under their own coach account. The
// context readers used to filter by the team owner's coach id, so everything an
// assistant wrote was stored and never read. They now filter by the team when
// there is one (lib/observationScope.ts). This suite runs the three readers
// that feed the model against the strict in-memory database
// (scripts/lib/strictSupabase.ts), which applies every filter:
//
//   lib/coachContext.ts            assembleCoachContext + renderCoachContext
//   lib/checkin.ts                 gatherCheckinEvidence
//   lib/playerReportSourcesStore   gatherSources
//
// All data is synthetic — scripts/fixtures/playerScopeFixture.ts, extended
// below with the rows this suite needs.

import { StrictSupabase, Tables } from './lib/strictSupabase'
import { seed, C, T, P, mark } from './fixtures/playerScopeFixture'
import { assembleCoachContext, renderCoachContext } from '../lib/coachContext'
import { gatherCheckinEvidence } from '../lib/checkin'
import { gatherSources } from '../lib/playerReportSourcesStore'

let passed = 0
const failures: string[] = []
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) { passed++; return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
}
const has = (name: string, text: string, m: string) => check(name, text.includes(m), `missing ${m}`)
const lacks = (name: string, text: string, m: string) => check(name, !text.includes(m), `found ${m}`)

// ── Extra synthetic rows ──
//
// The assistant on team A gets a coach account of their own, as every signed-in
// user has in production (the new-user trigger creates one). That is the id the
// log page writes on their observations.
const ASSISTANT_COACH = 'coach-assistant'
const M = {
  asstMarcus: 'MK-obs-assistant-on-marcus',
  asstTeamA: 'MK-obs-assistant-team-a-wide',
  ownerMarcusTeamC: 'MK-obs-owner-marcus-recorded-on-team-c',
  ownerCleoTeamC: 'MK-obs-owner-cleo-team-c',
  ownerTeamC: 'MK-obs-owner-team-c-wide',
  ownerMarcusA: mark(P.marcus, 'observation'),
  ownerTeamA: 'MK-team-a-wide-observation',
  zoe: mark(P.zoe, 'observation'),
  solokid: mark(P.solokid, 'observation'),
}

function tables(): Tables {
  const t = seed()
  t.coaches.push({ id: ASSISTANT_COACH, user_id: 'user-assistant', display_name: 'Synthetic Assistant', subscription_tier: 'free', is_subscribed: false })
  // Marcus also plays on team C, the owner's other team.
  t.team_players.push({ id: 'tp-marcus-c', team_id: T.c, player_id: P.marcus, positions: ['2B'], throwing_level: 2 })
  const obs = (id: string, coach: string, team: string | null, player: string | null, body: string) =>
    ({ id, coach_id: coach, team_id: team, player_id: player, prompt_key: 'unseen', observed_on: '2026-09-05', body, entry_id: null })
  t.observations.push(
    obs('obs-asst-marcus', ASSISTANT_COACH, T.a, P.marcus, M.asstMarcus),
    obs('obs-asst-team-a', ASSISTANT_COACH, T.a, null, M.asstTeamA),
    obs('obs-owner-marcus-c', C.a, T.c, P.marcus, M.ownerMarcusTeamC),
    obs('obs-owner-cleo-c', C.a, T.c, P.cleo, M.ownerCleoTeamC),
    obs('obs-owner-team-c', C.a, T.c, null, M.ownerTeamC),
  )
  // Logged sessions: the assistant's on team A, and the owner's for the same
  // player recorded against team C.
  const entry = (id: string, coach: string, team: string, player: string, title: string) =>
    ({ id, coach_id: coach, team_id: team, player_id: player, entry_type: 'lesson', occurred_on: '2026-09-05', title, instructor_name: null, duration_min: 30 })
  t.entries.push(
    entry('ent-asst-marcus', ASSISTANT_COACH, T.a, P.marcus, 'MK-entry-assistant-marcus'),
    entry('ent-owner-marcus-a', C.a, T.a, P.marcus, 'MK-entry-owner-marcus'),
    entry('ent-owner-marcus-c', C.a, T.c, P.marcus, 'MK-entry-owner-marcus-team-c'),
  )
  return t
}

async function context(opts: { coachId: string; teamId?: string | null; playerId?: string | null }) {
  const db = new StrictSupabase(tables())
  const ctx = await assembleCoachContext(db as any, opts)
  const bodies = (ctx.observations || []).map(o => o.body).join('\n')
  return { db, ctx, bodies, text: renderCoachContext(ctx) }
}

async function main() {
  // ── 1. Player on a team: the assistant's observation reaches the model ──
  {
    const { bodies, text } = await context({ coachId: C.a, teamId: T.a, playerId: P.marcus })
    has('player context: assistant observation included', bodies, M.asstMarcus)
    has('player context: assistant observation rendered for the model', text, M.asstMarcus)
    has('player context: owner observation still included', bodies, M.ownerMarcusA)
    // The same child, recorded against the owner's OTHER team, is not this team's.
    lacks('player context: same player, other team of the same coach, excluded', bodies, M.ownerMarcusTeamC)
    lacks('player context: team-wide assistant note is not about this player', bodies, M.asstTeamA)
    for (const m of [M.ownerCleoTeamC, M.ownerTeamC, M.zoe, M.solokid]) lacks(`player context: excludes ${m}`, text, m)
  }

  // ── 2. Team-level context ──
  {
    const { bodies, text } = await context({ coachId: C.a, teamId: T.a })
    for (const m of [M.asstMarcus, M.asstTeamA, M.ownerMarcusA, M.ownerTeamA]) has(`team context: includes ${m}`, bodies, m)
    for (const m of [M.ownerMarcusTeamC, M.ownerCleoTeamC, M.ownerTeamC, M.zoe, M.solokid]) lacks(`team context: excludes ${m}`, text, m)
  }

  // ── 3. The other team of the same coach sees only its own ──
  {
    const { bodies, text } = await context({ coachId: C.a, teamId: T.c })
    for (const m of [M.ownerMarcusTeamC, M.ownerCleoTeamC, M.ownerTeamC]) has(`team C context: includes ${m}`, bodies, m)
    for (const m of [M.asstMarcus, M.asstTeamA, M.ownerMarcusA, M.ownerTeamA, M.zoe]) lacks(`team C context: excludes ${m}`, text, m)
  }

  // ── 4. Another coach's team never sees team A ──
  {
    const { bodies, text } = await context({ coachId: C.b, teamId: T.b })
    has('team B context: includes its own observation', bodies, M.zoe)
    for (const m of [M.asstMarcus, M.asstTeamA, M.ownerMarcusA, M.ownerTeamA, M.ownerTeamC]) lacks(`team B context: excludes ${m}`, text, m)
  }

  // ── 5. A refused player still gets nothing, assistant notes included ──
  {
    const { db, ctx, text } = await context({ coachId: C.a, teamId: T.a, playerId: P.zoe })
    check('refused player: no observations', (ctx.observations || []).length === 0)
    check('refused player: observations table never queried', db.queriesOn('observations').length === 0)
    for (const m of Object.values(M)) lacks(`refused player: excludes ${m}`, text, m)
    const c = await context({ coachId: C.a, teamId: T.a, playerId: P.cleo })
    for (const m of Object.values(M)) lacks(`other-team player of the same coach: excludes ${m}`, c.text, m)
  }

  // ── 6. The no-team path is unchanged: the coach's own observations ──
  {
    const solo = await context({ coachId: C.solo, playerId: P.solokid })
    has('no team: solo coach sees their own player observation', solo.bodies, M.solokid)
    const q = solo.db.queriesOn('observations')[0]
    check('no team: filtered by coach_id, as before', !!q && q.filters.some(f => f.column === 'coach_id' && f.value === C.solo))
    check('no team: not filtered by team_id', !!q && !q.filters.some(f => f.column === 'team_id'))

    const owner = await context({ coachId: C.a })
    has('no team, no player: owner sees their own observations', owner.bodies, M.ownerMarcusA)
    for (const m of [M.asstMarcus, M.asstTeamA, M.zoe, M.solokid]) lacks(`no team, no player: excludes ${m}`, owner.bodies, m)

    const cross = await context({ coachId: C.solo, playerId: P.marcus })
    check('no team: another coach\'s player is refused', (cross.ctx.observations || []).length === 0)
  }

  // ── 7. The query itself: team-scoped, not owner-scoped ──
  {
    const { db } = await context({ coachId: C.a, teamId: T.a, playerId: P.marcus })
    const q = db.queriesOn('observations')[0]
    check('team query: filtered by team_id', !!q && q.filters.some(f => f.column === 'team_id' && f.value === T.a))
    check('team query: filtered by player_id', !!q && q.filters.some(f => f.column === 'player_id' && f.value === P.marcus))
    check('team query: not filtered by the owner coach id', !!q && !q.filters.some(f => f.column === 'coach_id'))
  }

  // ── 8. Check-in evidence (the analysis writer's follow-up read) ──
  {
    const t = tables()
    t.prescriptions.push(
      { id: 'pres-marcus', coach_id: C.a, team_id: T.a, player_id: P.marcus, scope: 'player', status: 'active',
        summary: 'Synthetic priority', issued_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      { id: 'pres-team-a', coach_id: C.a, team_id: T.a, player_id: null, scope: 'team', status: 'active',
        summary: 'Synthetic team priority', issued_at: '2026-09-01T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },
      { id: 'pres-solo', coach_id: C.solo, team_id: null, player_id: P.solokid, scope: 'player', status: 'active',
        summary: 'Synthetic solo priority', issued_at: '2026-08-01T00:00:00Z', created_at: '2026-08-01T00:00:00Z' },
    )
    const run = async (id: string, coach: string) => {
      const ev = await gatherCheckinEvidence(new StrictSupabase(t) as any, id, coach)
      return (ev?.observationsSince || []).map(o => o.body).join('\n')
    }
    const player = await run('pres-marcus', C.a)
    has('check-in (player): assistant observation included', player, M.asstMarcus)
    has('check-in (player): owner observation included', player, M.ownerMarcusA)
    lacks('check-in (player): same player on the other team excluded', player, M.ownerMarcusTeamC)
    lacks('check-in (player): team-wide note excluded', player, M.asstTeamA)

    const team = await run('pres-team-a', C.a)
    for (const m of [M.asstMarcus, M.asstTeamA, M.ownerTeamA]) has(`check-in (team): includes ${m}`, team, m)
    for (const m of [M.ownerMarcusTeamC, M.ownerTeamC, M.zoe]) lacks(`check-in (team): excludes ${m}`, team, m)

    const solo = await run('pres-solo', C.solo)
    has('check-in (no team): solo coach\'s own observation, unchanged', solo, M.solokid)
  }

  // ── 9. Report sources (the analysis writer's draft) ──
  {
    const bundle = await gatherSources(new StrictSupabase(tables()) as any, { teamId: T.a, playerId: P.marcus, coachId: C.a })
    const text = JSON.stringify(bundle.items)
    has('report sources: assistant observation offered', text, M.asstMarcus)
    has('report sources: owner observation offered', text, M.ownerMarcusA)
    lacks('report sources: same player on the other team excluded', text, M.ownerMarcusTeamC)
    lacks('report sources: team-wide note excluded', text, M.asstTeamA)
    has('report sources: the assistant\'s logged session offered', text, 'MK-entry-assistant-marcus')
    has('report sources: the owner\'s logged session offered', text, 'MK-entry-owner-marcus')
    lacks('report sources: the same player\'s session on the other team excluded', text, 'MK-entry-owner-marcus-team-c')
    const denied = await gatherSources(new StrictSupabase(tables()) as any, { teamId: T.a, playerId: P.zoe, coachId: C.a })
    check('report sources: refused player offers nothing', denied.items.length === 0)
  }

  console.log(`observation scope: ${passed} passed, ${failures.length} failed`)
  if (failures.length) {
    for (const f of failures) console.log(`  FAIL ${f}`)
    process.exit(1)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
