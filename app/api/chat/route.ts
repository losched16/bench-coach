import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { generateChatResponse, TeamContext, ScoutingContext } from '@/lib/anthropic'
import { assembleCoachContext, renderCoachContext } from '@/lib/coachContext'
import { generateChatTitle } from '@/lib/chatTitles'
import {
  aggregateBattingLines,
  computePitcherAvailability,
  stalenessLabel,
  stalenessOf,
  MIN_PA_FOR_TENDENCY,
  PitchCountRuleSet,
  aggregatePitchingLines,
} from '@/lib/scouting'
import { guard, authorizeTeam, can } from '@/lib/authz'
import { visibleDrills } from '@/lib/drills'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// Use service role for server-side operations (bypasses RLS)
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Every other AI route got one of these and chat never did. The platform
// default is 15 seconds; a coach question that assembles context, reads the
// scouting data and then thinks before answering blows past that routinely,
// and the function is killed with no error the user can act on.
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const denied = await guard(request, 'ask')
  if (denied) return denied

  try {
    const {
      teamId, message, history, threadId: requestedThreadId, playerId,
      // Set when the coach opened this conversation from an opponent's page.
      // It replaces the guesswork below with a fact.
      opponentTeamId,
    } = await request.json()

    console.log('Chat API called with teamId:', teamId)

    if (!teamId || !message) {
      return NextResponse.json(
        { error: 'Missing teamId or message' },
        { status: 400 }
      )
    }

    // Check if Anthropic API key is set
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set')
      return NextResponse.json(
        { error: 'API key not configured' },
        { status: 500 }
      )
    }

    // Load team context
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select('*')
      .eq('id', teamId)
      .single()

    if (teamError) {
      console.error('Error loading team:', teamError)
      return NextResponse.json({ error: 'Failed to load team' }, { status: 500 })
    }

    if (!team) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 })
    }

    console.log('Loaded team:', team.name)

    // Load coach preferences
    const { data: preferences } = await supabaseAdmin
      .from('coach_preferences')
      .select('key, value')
      .eq('coach_id', team.coach_id)

    const coachPrefs: Record<string, string> = {}
    preferences?.forEach(p => {
      coachPrefs[p.key] = p.value
    })

    // Load team notes (pinned + recent)
    const { data: teamNotes } = await supabaseAdmin
      .from('team_notes')
      .select('note, pinned')
      .eq('team_id', teamId)
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)

    // Load team memory summary
    const { data: memorySummary } = await supabaseAdmin
      .from('team_memory_summaries')
      .select('summary')
      .eq('team_id', teamId)
      .single()

    // Load players (NO player_notes join - it breaks the query)
    const { data: teamPlayers } = await supabaseAdmin
      .from('team_players')
      .select(`
        *,
        player:players(id, name)
      `)
      .eq('team_id', teamId)

    // Legacy journal entries — only the ones migration 037 has not folded into
    // entries + observations yet. A migrated row is already reaching the model
    // through the activity log, and sending it twice reads as two independent
    // sources agreeing when it is one note counted twice.
    //
    // Two attempts, because migrated_at only exists once 037 has run and a
    // failed select here would silently drop every lesson from the context.
    const JOURNAL_FIELDS = `
        id,
        player_id,
        session_date,
        session_type,
        duration_minutes,
        instructor_name,
        focus_areas,
        went_well,
        needs_work,
        home_drills,
        notes,
        skills,
        player:players(name)
      `
    const journalQuery = (filterMigrated: boolean) => {
      let q = supabaseAdmin
        .from('player_journal_entries')
        .select(JOURNAL_FIELDS)
        .eq('team_id', teamId)
      // .is(), not .eq(): `= NULL` is never true in Postgres.
      if (filterMigrated) q = q.is('migrated_at', null)
      return q.order('session_date', { ascending: false }).limit(20)
    }

    let journalAttempt = await journalQuery(true)
    if (journalAttempt.error) journalAttempt = await journalQuery(false)
    const journalEntries = journalAttempt.data as any[] | null

    // Group journal entries by player
    const journalByPlayer: Record<string, any[]> = {}
    journalEntries?.forEach(entry => {
      const playerName = (entry.player as any)?.name || 'Unknown'
      if (!journalByPlayer[playerName]) {
        journalByPlayer[playerName] = []
      }
      journalByPlayer[playerName].push(entry)
    })

    const players = teamPlayers?.map(tp => {
      const playerName = tp.player.name
      const playerJournal = journalByPlayer[playerName] || []
      
      return {
        name: playerName,
        positions: tp.positions || [],
        hitting_level: tp.hitting_level,
        throwing_level: tp.throwing_level,
        fielding_level: tp.fielding_level,
        pitching_level: tp.pitching_level,
        baserunning_level: tp.baserunning_level,
        coachability_level: tp.coachability_level,
        notes: [],
        journal: playerJournal.slice(0, 5).map((j: any) => ({
          date: j.session_date,
          type: j.session_type,
          instructor: j.instructor_name,
          focus: j.focus_areas,
          went_well: j.went_well,
          needs_work: j.needs_work,
          home_drills: j.home_drills,
          skills: j.skills,
        })),
      }
    }) || []

    // Load recent practice plans
    const { data: recentPlans } = await supabaseAdmin
      .from('practice_plans')
      .select('title, content')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(3)

    const planSummaries = recentPlans?.map(p => p.title) || []

    // Load active playbooks with progress
    const { data: activePlaybooks } = await supabaseAdmin
      .from('player_playbooks')
      .select(`
        id,
        title,
        started_at,
        completed_sessions,
        status,
        player:players(name),
        template:playbook_templates(
          title,
          description,
          goal,
          age_group,
          skill_category,
          total_sessions,
          sessions
        )
      `)
      .eq('team_id', teamId)
      .eq('status', 'active')

    // Format playbook context for AI
    const playbookContext = activePlaybooks?.map(pb => {
      const completedCount = Array.isArray(pb.completed_sessions) ? pb.completed_sessions.length : 0
      // Template is returned as array from Supabase join
      const template = Array.isArray(pb.template) ? pb.template[0] : pb.template
      const totalSessions = template?.total_sessions || 0
      const sessions = template?.sessions || []
      
      // Get current session (next incomplete one)
      const currentSessionIndex = completedCount
      const currentSession = sessions[currentSessionIndex]
      const previousSession = currentSessionIndex > 0 ? sessions[currentSessionIndex - 1] : null
      
      return {
        playbook_title: template?.title || pb.title,
        assigned_to: (pb.player as any)?.name || 'Whole Team',
        skill_category: template?.skill_category,
        goal: template?.goal,
        progress: `${completedCount}/${totalSessions} sessions completed`,
        current_day: currentSessionIndex + 1,
        current_session: currentSession ? {
          day: currentSession.day,
          title: currentSession.title,
          phase: currentSession.phase,
          goal: currentSession.goal,
          activities: currentSession.activities?.map((a: any) => a.name) || []
        } : null,
        previous_session: previousSession ? {
          day: previousSession.day,
          title: previousSession.title,
          goal: previousSession.goal
        } : null,
        started_at: pb.started_at
      }
    }) || []

    // Load saved drills
    const { data: savedDrills } = await supabaseAdmin
      .from('saved_drills')
      .select('title, category')
      .eq('team_id', teamId)
      .order('created_at', { ascending: false })
      .limit(10)

    const drillsSummary = savedDrills?.map(d => `${d.title} (${d.category})`) || []

    // Load drill resources library for AI to reference
    let drillResources: any[] = []
    try {
      const { data: resources } = await visibleDrills(
        supabaseAdmin,
        team.coach_id,
        'id, drill_name, skill_category, description, youtube_url, youtube_video_id, channel, age_range, difficulty_level, mechanic_focus, common_flaws_fixed, equipment_needed, ai_coaching_notes, safety_notes, created_by_coach_id'
      ).limit(100)

      drillResources = resources || []
    } catch (e) {
      console.warn('Could not load drill resources (table may not exist yet)')
    }

    // Load recent practice recaps
    let practiceRecaps: any[] = []
    try {
      const { data: recaps } = await supabaseAdmin
        .from('practice_sessions')
        .select('*')
        .eq('team_id', teamId)
        .order('date', { ascending: false })
        .limit(5)

      if (recaps) {
        practiceRecaps = recaps
          .filter(r => r.what_worked || r.what_didnt_work || r.next_focus)
          .map(r => ({
            date: r.date,
            energy_level: r.energy_level,
            attendance_count: r.attendance_count,
            weather: r.weather,
            what_worked: r.what_worked || [],
            what_didnt_work: r.what_didnt_work || [],
            player_callouts: r.player_callouts || [],
            next_focus: r.next_focus || [],
            notes: r.notes,
          }))
      }
    } catch (e) {
      console.warn('Could not load practice recaps (columns may not exist yet)')
    }

    // Load player game stats for AI context
    let playerStats: any[] = []
    try {
      const { data: stats } = await supabaseAdmin
        .from('player_season_batting')
        .select('*')
        .eq('team_id', teamId)

      if (stats && stats.length > 0) {
        for (const ps of stats) {
          const { data: recentGames } = await supabaseAdmin
            .from('player_game_stats')
            .select('hits, at_bats, game_notes, game:games(game_date, opponent)')
            .eq('team_player_id', ps.team_player_id)
            .order('created_at', { ascending: false })
            .limit(3)

          ps.recent_games = recentGames?.map((g: any) => ({
            date: g.game?.game_date,
            opponent: g.game?.opponent,
            hits: g.hits || 0,
            at_bats: g.at_bats || 0,
            notes: g.game_notes,
          })) || []
        }
        playerStats = stats
      }
    } catch (e) {
      console.warn('Could not load player stats (tables may not exist yet)')
    }

    // Load recent games with notes and pitch counts
    let gameData: any[] = []
    try {
      const { data: recentGames } = await supabaseAdmin
        .from('games')
        .select('*')
        .eq('team_id', teamId)
        .order('game_date', { ascending: false })
        .limit(10)

      if (recentGames && recentGames.length > 0) {
        const gameIds = recentGames.map(g => g.id)

        const [notesRes, pitchRes] = await Promise.all([
          supabaseAdmin.from('game_notes').select('*, player:players(name)').in('game_id', gameIds).order('created_at', { ascending: false }),
          supabaseAdmin.from('game_pitch_counts').select('*, player:players(name)').in('game_id', gameIds),
        ])

        gameData = recentGames.map(g => ({
          date: g.game_date,
          opponent: g.opponent,
          status: g.status,
          score: g.team_score !== null ? `${g.team_score}-${g.opponent_score}` : null,
          result: g.result,
          game_notes: (notesRes.data || [])
            .filter(n => n.game_id === g.id)
            .slice(0, 20)
            .map(n => ({
              player: n.player?.name,
              type: n.note_type,
              note: n.note,
              inning: n.inning,
            })),
          pitch_counts: (pitchRes.data || [])
            .filter(pc => pc.game_id === g.id)
            .reduce((acc: any, pc: any) => {
              const name = pc.player?.name || 'Unknown'
              if (!acc[name]) acc[name] = { total: 0, by_inning: {} }
              acc[name].total += pc.pitch_count
              acc[name].by_inning[pc.inning] = pc.pitch_count
              return acc
            }, {}),
        }))
      }
    } catch (e) {
      console.warn('Could not load game data (tables may not exist yet)')
    }

    // Load scouting context when the conversation concerns an opponent.
    // Scouting data is scoped to this coach's account only.
    let scouting: ScoutingContext | undefined
    try {
      const { data: opponentTeams } = await supabaseAdmin
        .from('opponent_teams')
        .select('id, name, age_group, first_seen, last_seen, notes')
        .eq('coach_id', team.coach_id)

      if (opponentTeams && opponentTeams.length > 0) {
        const recentText = [
          message,
          ...(history || []).slice(-4).map((h: any) => h.content || ''),
        ].join('\n').toLowerCase()

        // A conversation opened from an opponent's page is about that opponent,
        // stated rather than inferred. "What about their two-hole?" names
        // nobody and would fall straight through the heuristics below.
        const pinned = opponentTeamId
          ? opponentTeams.filter(ot => ot.id === opponentTeamId)
          : []

        // Teams named in the conversation
        const namedTeams = opponentTeams.filter(ot => {
          const words = ot.name.toLowerCase().split(/\s+/).filter((w: string) => w.length >= 4)
          return recentText.includes(ot.name.toLowerCase()) || words.some((w: string) => recentText.includes(w))
        })

        // Generic scouting intent ("who can they pitch tomorrow?", "their #7")
        const scoutingIntent =
          pinned.length > 0 ||
          /(scout|opponent|matchup|bracket|availab)/i.test(recentText) ||
          /\b(they|them|their)\b[^.?!]*\b(pitch|throw|start|bunt|steal|hit|play)/i.test(recentText) ||
          /\b(their|that|the)\s*#\s?\d+/i.test(recentText) ||
          /\b(play|played|face|facing|against)\b[^.?!]*\b(them|these guys|that team)\b/i.test(recentText)

        const { data: allMatchups } = await supabaseAdmin
          .from('matchups')
          .select('opponent_team_id, scheduled_at, status, tournament_name')
          .eq('coach_id', team.coach_id)
          .in('status', ['upcoming', 'possible'])

        // The pinned team always leads. Another team mentioned in passing still
        // gets loaded — "we saw Springfield's ace at the Riverside tournament"
        // is a real thing a coach says — but it never displaces the one they
        // opened.
        let relevantTeams = pinned.length > 0
          ? [...pinned, ...namedTeams.filter(t => t.id !== opponentTeamId)]
          : namedTeams
        if (relevantTeams.length === 0 && scoutingIntent) {
          // No team named — fall back to teams with pending matchups, then most recently seen
          const matchupTeamIds = new Set((allMatchups || []).map(m => m.opponent_team_id))
          relevantTeams = opponentTeams
            .sort((a, b) => {
              const aM = matchupTeamIds.has(a.id) ? 0 : 1
              const bM = matchupTeamIds.has(b.id) ? 0 : 1
              if (aM !== bM) return aM - bM
              return (b.last_seen || '').localeCompare(a.last_seen || '')
            })
            .slice(0, 2)
        }
        relevantTeams = relevantTeams.slice(0, 3)

        if (relevantTeams.length > 0 || (scoutingIntent && (allMatchups || []).length > 0)) {
          const today = new Date().toISOString().split('T')[0]
          const opponentNameById: Record<string, string> = {}
          opponentTeams.forEach(ot => { opponentNameById[ot.id] = ot.name })

          // Rule sets for availability math (coach's own + system defaults)
          const { data: ruleRows } = await supabaseAdmin
            .from('pitch_count_rules')
            .select('*')
            .or(`coach_id.is.null,coach_id.eq.${team.coach_id}`)
          const pickRule = (ageGroup: string | null): PitchCountRuleSet | null => {
            const rules = (ruleRows || []) as PitchCountRuleSet[]
            if (rules.length === 0) return null
            const digits = (ageGroup || team.age_group || '').replace(/\D/g, '')
            const byAge = digits ? rules.find(r => r.age_group.replace(/\D/g, '').includes(digits)) : null
            return byAge
              || rules.find(r => r.sanctioning_body === 'Little League' && r.age_group === '11-12')
              || rules[0]
          }

          const opponentContexts = []
          const availabilityBoards = []

          for (const ot of relevantTeams) {
            const [playersRes, entriesRes] = await Promise.all([
              supabaseAdmin
                .from('opponent_players')
                .select('*, appearances:opponent_appearances(game_date, batting_line, pitches_thrown, positions_played)')
                .eq('opponent_team_id', ot.id),
              // Every entry, not just the ones carrying a note.
              //
              // This used to filter on `notes IS NOT NULL` and cap at 5, and
              // entry_count was the length of THAT — so a coach who logged six
              // box scores without typing a note was told the app had seen
              // zero, and one who logged a dozen games was told five. The
              // count and the notes are different questions and are now
              // answered separately.
              supabaseAdmin
                .from('scouting_entries')
                .select('entry_type, occurred_on, notes, tournament_name')
                .eq('opponent_team_id', ot.id)
                .order('occurred_on', { ascending: false })
                .limit(100),
            ])

            const players = (playersRes.data || []).slice(0, 18).map((p: any) => {
              const apps = p.appearances || []
              const batting = aggregateBattingLines(apps.map((a: any) => a.batting_line))
              const pitchApps = apps
                .filter((a: any) => (a.pitches_thrown || 0) > 0)
                .sort((a: any, b: any) => (a.game_date || '').localeCompare(b.game_date || ''))
              const lastPitch = pitchApps[pitchApps.length - 1]
              return {
                name: p.name,
                jersey_number: p.jersey_number,
                identity_confidence: p.confidence,
                positions: p.positions || [],
                notes: p.notes,
                last_seen: p.last_seen,
                batting: batting.pa > 0 ? batting : null,
                small_sample: batting.pa > 0 && batting.pa < MIN_PA_FOR_TENDENCY,
                pitching: lastPitch
                  ? {
                      outings: pitchApps.length,
                      total_pitches: pitchApps.reduce((s: number, a: any) => s + (a.pitches_thrown || 0), 0),
                      last_date: lastPitch.game_date,
                      last_pitches: lastPitch.pitches_thrown,
                      // What actually happened on the mound. Until now the
                      // model could see that a kid threw 62 pitches and had no
                      // idea whether he walked seven or struck out nine.
                      line: aggregatePitchingLines(pitchApps),
                    }
                  : null,
              }
            })

            // One row per date we have seen them, built from the appearances
            // and the entries together. Aggregated batting lines alone could
            // not answer "what happened in the games we've played them".
            const byDate: Record<string, {
              kinds: Set<string>; tournament: string | null
              players: Set<string>; pitchers: Record<string, number>; note: string | null
            }> = {}
            const slot = (d: string) => (byDate[d] ||= {
              kinds: new Set(), tournament: null, players: new Set(), pitchers: {}, note: null,
            })

            for (const e of (entriesRes.data || []) as any[]) {
              const d = e.occurred_on || 'undated'
              const g = slot(d)
              if (e.entry_type) g.kinds.add(e.entry_type)
              if (e.tournament_name) g.tournament = e.tournament_name
              // The first note on a date is enough; the full set is below.
              if (e.notes && !g.note) g.note = e.notes
            }

            for (const p of (playersRes.data || []) as any[]) {
              for (const a of (p.appearances || []) as any[]) {
                if (!a.game_date) continue
                const g = slot(a.game_date)
                g.players.add(p.name)
                if ((a.pitches_thrown || 0) > 0) {
                  g.pitchers[p.name] = (g.pitchers[p.name] || 0) + a.pitches_thrown
                }
              }
            }

            const games = Object.entries(byDate)
              .sort((a, b) => b[0].localeCompare(a[0]))
              .map(([date, g]) => ({
                date: date === 'undated' ? null : date,
                kinds: Array.from(g.kinds),
                tournament: g.tournament,
                players_seen: g.players.size,
                pitchers: Object.entries(g.pitchers).map(([name, pitches]) => ({ name, pitches })),
                note: g.note,
              }))

            opponentContexts.push({
              games,
              name: ot.name,
              age_group: ot.age_group,
              first_seen: ot.first_seen,
              last_seen: ot.last_seen,
              staleness_note:
                ot.last_seen && stalenessOf(ot.last_seen, today) !== 'current'
                  ? `Most recent data is ${stalenessLabel(ot.last_seen, today)}`
                  : null,
              team_notes: ot.notes,
              entry_count: (entriesRes.data || []).length,
              players,
              recent_notes: (entriesRes.data || [])
                .filter((e: any) => e.notes)
                .slice(0, 8)
                .map((e: any) => ({
                  date: e.occurred_on,
                  type: e.entry_type,
                  note: e.notes,
                })),
            })

            // Availability board for the nearest pending matchup (or tomorrow)
            const rule = pickRule(ot.age_group)
            if (rule) {
              const teamMatchups = (allMatchups || [])
                .filter(m => m.opponent_team_id === ot.id && m.scheduled_at)
                .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))
              const tomorrow = new Date()
              tomorrow.setDate(tomorrow.getDate() + 1)
              const targetDate =
                teamMatchups[0]?.scheduled_at?.split('T')[0] ||
                tomorrow.toISOString().split('T')[0]

              const rows = (playersRes.data || [])
                .filter((p: any) => (p.appearances || []).some((a: any) => (a.pitches_thrown || 0) > 0))
                .map((p: any) => {
                  const avail = computePitcherAvailability(p.appearances || [], rule, targetDate)
                  return {
                    name: p.name,
                    jersey_number: p.jersey_number,
                    identity_confidence: p.confidence,
                    status: avail.status,
                    explanation: avail.explanation,
                  }
                })

              if (rows.length > 0) {
                const gameDates = new Set<string>()
                ;(playersRes.data || []).forEach((p: any) =>
                  (p.appearances || []).forEach((a: any) => a.game_date && gameDates.add(a.game_date))
                )
                availabilityBoards.push({
                  opponent_name: ot.name,
                  target_date: targetDate,
                  rule_label: `${rule.sanctioning_body} ${rule.age_group}`,
                  coverage_notes: [
                    `Based on ${gameDates.size} logged game(s) only — unlogged games are not counted, so the picture may be incomplete.`,
                  ],
                  rows,
                })
              }
            }
          }

          // OUR arms, under the same rest rules we apply to theirs.
          //
          // "Which pitchers should we use against them" was previously
          // answerable only by eyeballing raw pitch totals in the game log —
          // the model had our counts but no rest arithmetic and no rule set, so
          // it either guessed or hedged. This is the same computePitcherAvailability
          // the scouting board uses, pointed at our own game_pitch_counts.
          let ourAvailability = null as any
          try {
            const ourRule = pickRule(team.age_group)
            const nextMatchup = (allMatchups || [])
              .filter(m => m.scheduled_at)
              .sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''))[0]
            const tmr = new Date()
            tmr.setDate(tmr.getDate() + 1)
            const targetDate =
              nextMatchup?.scheduled_at?.split('T')[0] || tmr.toISOString().split('T')[0]

            if (ourRule) {
              const { data: ourGames } = await supabaseAdmin
                .from('games').select('id, game_date').eq('team_id', teamId)
              const dateById: Record<string, string> = {}
              for (const g of (ourGames || []) as any[]) dateById[g.id] = g.game_date

              const { data: ourPitches } = await supabaseAdmin
                .from('game_pitch_counts')
                .select('player_id, game_id, pitch_count, is_opponent, player:players(name)')
                .in('game_id', Object.keys(dateById).length ? Object.keys(dateById) : ['none'])

              // Per pitcher, per DATE — a pitch count is stored per inning, and
              // rest is measured in days off, not innings.
              const perPitcher: Record<string, { name: string; byDate: Record<string, number> }> = {}
              for (const pc of (ourPitches || []) as any[]) {
                if (pc.is_opponent || !pc.player_id) continue
                const d = dateById[pc.game_id]
                if (!d) continue
                const e = (perPitcher[pc.player_id] ||= { name: pc.player?.name || 'Unknown', byDate: {} })
                e.byDate[d] = (e.byDate[d] || 0) + (pc.pitch_count || 0)
              }

              const rows = Object.values(perPitcher)
                .filter(p => Object.keys(p.byDate).length > 0)
                .map(p => {
                  const apps = Object.entries(p.byDate)
                    .map(([game_date, pitches_thrown]) => ({ game_date, pitches_thrown }))
                    .sort((a, b) => a.game_date.localeCompare(b.game_date))
                  const avail = computePitcherAvailability(apps as any, ourRule, targetDate)
                  return {
                    name: p.name,
                    status: avail.status,
                    explanation: avail.explanation,
                    recent: apps.slice(-4).map(a => ({ date: a.game_date, pitches: a.pitches_thrown })),
                  }
                })

              if (rows.length > 0) {
                ourAvailability = {
                  target_date: targetDate,
                  rule_label: `${ourRule.sanctioning_body} ${ourRule.age_group}`,
                  coverage_note:
                    'From pitch counts logged in Game Day only. An outing thrown ' +
                    'somewhere else, or one nobody counted, is not in here.',
                  rows,
                }
              }
            }
          } catch {
            // Our own availability is a bonus on top of the answer, never the
            // reason the whole chat fails.
          }

          scouting = {
            opponents: opponentContexts,
            availabilityBoards,
            ourAvailability,
            upcomingMatchups: (allMatchups || []).slice(0, 10).map(m => ({
              opponent_name: opponentNameById[m.opponent_team_id] || 'Unknown',
              scheduled_at: m.scheduled_at,
              status: m.status,
              tournament_name: m.tournament_name,
            })),
          }

          // Instrumentation: scouting chat queries
          if (relevantTeams.length > 0) {
            const { data: coachRow } = await supabaseAdmin
              .from('coaches')
              .select('user_id')
              .eq('id', team.coach_id)
              .single()
            if (coachRow?.user_id) {
              await supabaseAdmin.from('user_events').insert({
                user_id: coachRow.user_id,
                event_type: 'feature_use',
                event_name: 'scouting_chat_query',
                metadata: { opponents: relevantTeams.map(t => t.name) },
              })
            }
          }
        }
      }
    } catch (e) {
      console.warn('Could not load scouting context (tables may not exist yet)')
    }

    // Load the activity log: observations, lesson diagnoses, and the priority
    // currently in force. Without this, chat happily contradicts the plan the
    // analysis surface just issued.
    let activityLog: string | undefined
    try {
      const coachCtx = await assembleCoachContext(supabaseAdmin, {
        coachId: team.coach_id,
        teamId,
        // Scoped to one kid when the coach picks one. A question about
        // Charlie's swing should be answered from Charlie's history, not an
        // average of the roster.
        playerId: playerId || null,
      })
      const rendered = renderCoachContext(coachCtx)
      if (rendered && !rendered.startsWith('No history logged')) {
        activityLog = rendered
      }
    } catch (e) {
      console.warn('Could not load activity log context (tables may not exist yet)')
    }

    // Build context
    const context: TeamContext = {
      team: {
        name: team.name,
        age_group: team.age_group,
        skill_level: team.skill_level,
        practice_duration_minutes: team.practice_duration_minutes,
        primary_goals: team.primary_goals || [],
        improved_areas: team.improved_areas || [],
        mastered_areas: team.mastered_areas || [],
      },
      coachPreferences: coachPrefs,
      teamNotes: teamNotes || [],
      players,
      recentPlans: planSummaries,
      memorySummary: memorySummary?.summary,
      activePlaybooks: playbookContext,
      savedDrills: drillsSummary,
      drillResources: drillResources.length > 0 ? drillResources : undefined,
      practiceRecaps: practiceRecaps.length > 0 ? practiceRecaps : undefined,
      playerStats: playerStats.length > 0 ? playerStats : undefined,
      gameData: gameData.length > 0 ? gameData : undefined,
      scouting,
      activityLog,
    }

    // Convert history
    const conversationHistory = history?.map((h: any) => ({
      role: h.role,
      content: h.content,
    })) || []

    // Generate response
    const response = await generateChatResponse(message, context, conversationHistory)

    // Which conversation this belongs to. The client names it explicitly now
    // that a team can have many; falling back to the most recently used one
    // keeps older clients and direct API calls working.
    let thread: {
      id: string; title?: string | null; player_id?: string | null
      opponent_team_id?: string | null
    } | null = null

    const THREAD_COLS = 'id, title, player_id, opponent_team_id'

    if (requestedThreadId) {
      const { data } = await supabaseAdmin
        .from('chat_threads')
        .select(THREAD_COLS)
        .eq('id', requestedThreadId)
        .eq('team_id', teamId)   // a thread id from another team is not a match
        .maybeSingle()
      thread = data
    }

    if (!thread) {
      // Falling back to "the most recent conversation" is right for the general
      // chat and wrong for a scoped one — a coach who opens Springfield must
      // not land in whatever they were last talking about. Scoped asks only
      // ever resume a thread with the same scope.
      let q = supabaseAdmin
        .from('chat_threads')
        .select(THREAD_COLS)
        .eq('team_id', teamId)
      q = opponentTeamId
        ? q.eq('opponent_team_id', opponentTeamId)
        : q.is('opponent_team_id', null)

      const { data } = await q
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      thread = data
    }

    if (!thread) {
      const { data: newThread, error: threadErr } = await supabaseAdmin
        .from('chat_threads')
        .insert({ team_id: teamId, opponent_team_id: opponentTeamId || null })
        .select()
        .single()
      thread = newThread
      // Without this the next line throws "Cannot read properties of null",
      // which tells nobody that the conversation table is what failed.
      if (!thread) {
        throw new Error(`Could not open a chat thread for this team: ${threadErr?.message || 'unknown error'}`)
      }
    }

    // Save messages
    const { data: userMsg } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        thread_id: thread.id,
        role: 'user',
        content: message,
      })
      .select()
      .single()

    const { data: assistantMsg } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        thread_id: thread.id,
        role: 'assistant',
        content: response.message,
        memory_suggestions: response.memory_suggestions,
      })
      .select()
      .single()

    // Auto-save high-confidence coach preferences.
    //
    // Gated on 'remember', which contributors and viewers do not have. This
    // happens as a SIDE EFFECT of a conversation: an assistant coach asking a
    // question would otherwise reshape how the app understands the head coach,
    // invisibly and without either of them choosing it. They still get the
    // answer — the app just doesn't learn from them.
    const actor = await authorizeTeam(teamId, 'ask')
    const mayRemember = can(actor.role, 'remember')

    if (mayRemember && response.memory_suggestions.coach_preferences) {
      for (const pref of response.memory_suggestions.coach_preferences) {
        if (pref.confidence > 0.75) {
          await supabaseAdmin
            .from('coach_preferences')
            .upsert({
              coach_id: team.coach_id,
              key: pref.key,
              value: pref.value,
            })
        }
      }
    }

    // Name the conversation off its opening question. Only once — a title
    // that changes as the chat drifts is a title the coach can't scan for.
    let threadTitle = thread.title || null
    if (!threadTitle) {
      threadTitle = await generateChatTitle(message)
      await supabaseAdmin.from('chat_threads').update({ title: threadTitle }).eq('id', thread.id)
    }

    // Remember who this conversation is about, so reopening it on Thursday
    // puts the coach back in the same context without re-picking.
    const scopedPlayerId = playerId || null
    if (scopedPlayerId !== (thread.player_id ?? null)) {
      await supabaseAdmin
        .from('chat_threads')
        .update({ player_id: scopedPlayerId })
        .eq('id', thread.id)
    }

    return NextResponse.json({
      message: response.message,
      memory_suggestions: response.memory_suggestions,
      id: assistantMsg.id,
      user_message_id: userMsg.id,
      threadId: thread.id,
      threadTitle,
    })

  } catch (error: any) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// GET endpoint to load chat history (bypasses RLS)
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  try {
    const { searchParams } = new URL(request.url)
    const teamId = searchParams.get('teamId')
    const requestedThreadId = searchParams.get('threadId')

    if (!teamId) {
      return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })
    }

    // Scoped the same way the POST is: a request for Springfield's
    // conversation must not resume whatever was open last.
    const opponentTeamId = searchParams.get('opponentTeamId')

    let thread: {
      id: string; title?: string | null; player_id?: string | null
      opponent_team_id?: string | null
    } | null = null

    if (requestedThreadId) {
      const { data } = await supabaseAdmin
        .from('chat_threads')
        .select('id, title, player_id, opponent_team_id')
        .eq('id', requestedThreadId)
        .eq('team_id', teamId)
        .maybeSingle()
      thread = data
    }

    // No thread asked for: open the one they were last using, not the oldest.
    // Landing in a months-old conversation is how this looked broken.
    if (!thread) {
      let q = supabaseAdmin
        .from('chat_threads')
        .select('id, title, player_id, opponent_team_id')
        .eq('team_id', teamId)
      q = opponentTeamId
        ? q.eq('opponent_team_id', opponentTeamId)
        : q.is('opponent_team_id', null)

      const { data } = await q
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      thread = data
    }

    if (!thread) {
      const { data: newThread, error: threadErr } = await supabaseAdmin
        .from('chat_threads')
        .insert({ team_id: teamId, opponent_team_id: opponentTeamId || null })
        .select()
        .single()
      thread = newThread
      // Without this the next line throws "Cannot read properties of null",
      // which tells nobody that the conversation table is what failed.
      if (!thread) {
        throw new Error(`Could not open a chat thread for this team: ${threadErr?.message || 'unknown error'}`)
      }
    }

    // Load messages for this thread
    const { data: messages } = await supabaseAdmin
      .from('chat_messages')
      .select('id, role, content, memory_suggestions, created_at')
      .eq('thread_id', thread.id)
      .order('created_at', { ascending: true })

    return NextResponse.json({
      threadId: thread.id,
      threadTitle: thread.title ?? null,
      playerId: thread.player_id ?? null,
      opponentTeamId: thread.opponent_team_id ?? null,
      messages: messages || []
    })

  } catch (error: any) {
    console.error('Chat GET error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// DELETE endpoint to clear chat history (bypasses RLS)
export async function DELETE(request: NextRequest) {
  const denied = await guard(request, 'record')
  if (denied) return denied

  try {
    const { searchParams } = new URL(request.url)
    const threadId = searchParams.get('threadId')

    if (!threadId) {
      return NextResponse.json({ error: 'Missing threadId' }, { status: 400 })
    }

    // Delete all messages in the thread
    await supabaseAdmin
      .from('chat_messages')
      .delete()
      .eq('thread_id', threadId)

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Chat DELETE error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}
