import { COACH_VOICE, CHAT_ADDENDUM } from './coachVoice'
import { textFrom, requireText } from './claudeText'
import { drillMenuLine } from './drills'
import { claude as anthropic } from '@/lib/claudeClient'
import { watchUrl } from '@/lib/drillVideo'

export interface JournalEntry {
  date: string
  type: string // lesson, practice, game, backyard, camp, other
  instructor?: string
  focus?: string
  went_well?: string
  needs_work?: string
  home_drills?: string
  skills?: string[]
}

export interface ScoutingOpponentContext {
  name: string
  /**
   * This record is the coach's OWN team, logged from published box scores the
   * same way an opponent is. Without the flag the model reads its own team's
   * players as strangers to scout, which is both wrong and unsettling.
   */
  is_own_team?: boolean
  age_group?: string | null
  first_seen?: string | null
  last_seen?: string | null
  staleness_note?: string | null   // e.g. "over a season old — historical, not current"
  team_notes?: string | null
  entry_count: number
  // Every logged sighting, one row per date. Without this the model saw
  // aggregated batting lines and no idea how many games they came from — so
  // "tell me about the games we've seen" had nothing to answer with.
  games: Array<{
    date: string | null
    kinds: string[]                  // box_score | recap | observation | bracket
    tournament?: string | null
    players_seen: number
    pitchers: Array<{ name: string; pitches: number }>
    note?: string | null
  }>
  players: Array<{
    name: string
    jersey_number?: string | null
    identity_confidence: string    // confirmed | probable | uncertain
    positions?: string[]
    notes?: string | null
    last_seen?: string | null
    batting?: { games: number; pa: number; ab: number; h: number; bb: number; k: number; xbh: number; sb: number } | null
    small_sample?: boolean         // under ~15 PA — observation, not a tendency
    pitching?: {
      outings: number; total_pitches: number; last_date: string; last_pitches: number
      // The outing itself, not just its volume. Pitch count answers "can he
      // throw"; this answers "should we be worried about him".
      line?: { ip: number; h: number; r: number; er: number; bb: number; k: number; hr: number; bf: number; strikes: number; strikePct: number | null } | null
    } | null
  }>
  recent_notes: Array<{ date: string | null; type: string; note: string }>
}

export interface ScoutingAvailabilityContext {
  opponent_name: string
  target_date: string
  rule_label: string
  coverage_notes: string[]
  rows: Array<{
    name: string
    jersey_number?: string | null
    identity_confidence: string
    status: string                 // ineligible | limited | available | unknown
    explanation: string
  }>
}

export interface ScoutingContext {
  opponents: ScoutingOpponentContext[]
  availabilityBoards: ScoutingAvailabilityContext[]
  // OUR pitchers, under the same rest rules — so "who should we start against
  // them" can be answered from both sides rather than half of one.
  ourAvailability?: {
    target_date: string
    rule_label: string
    coverage_note: string
    rows: Array<{
      name: string
      status: string
      explanation: string
      recent: Array<{ date: string; pitches: number }>
    }>
  } | null
  upcomingMatchups: Array<{
    opponent_name: string
    scheduled_at: string | null
    status: string
    tournament_name: string | null
  }>
}

export interface TeamContext {
  team: {
    name: string
    age_group: string
    skill_level: string
    practice_duration_minutes: number
    primary_goals: string[]
    improved_areas?: string[]
    mastered_areas?: string[]
  }
  coachPreferences: Record<string, string>
  teamNotes: Array<{ note: string; pinned: boolean }>
  players: Array<{
    name: string
    positions?: string[]
    hitting_level?: number
    throwing_level?: number
    fielding_level?: number
    pitching_level?: number
    baserunning_level?: number
    coachability_level?: number
    notes?: string[]
    traits?: string[]
    journal?: JournalEntry[]
  }>
  recentPlans?: string[]
  memorySummary?: string
  activePlaybooks?: Array<{
    playbook_title: string
    assigned_to: string
    skill_category: string
    goal: string
    progress: string
    current_day: number
    current_session?: {
      day: number
      title: string
      phase?: string
      goal: string
      activities: string[]
    }
    previous_session?: {
      day: number
      title: string
      goal: string
    }
    started_at: string
  }>
  savedDrills?: string[]
  practiceRecaps?: Array<{
    date: string
    energy_level?: string
    attendance_count?: number
    weather?: string
    what_worked: string[]
    what_didnt_work: string[]
    player_callouts: Array<{ player_name: string; note: string; type: string }>
    next_focus: string[]
    notes?: string
  }>
  playerStats?: Array<{
    player_name: string
    jersey_number?: string | null
    games_played: number
    total_ab: number
    total_hits: number
    total_doubles: number
    total_triples: number
    total_hr: number
    total_rbi: number
    total_runs: number
    total_walks: number
    total_strikeouts: number
    total_sb: number
    batting_avg: number
    obp: number
    slg: number
    total_errors: number
    recent_games?: Array<{
      date: string
      opponent: string | null
      hits: number
      at_bats: number
      notes: string | null
    }>
  }>
  /** One line on how these drills were chosen — diagnosis, filters applied. */
  drillContext?: string
  drillResources?: Array<{
    id?: string
    drill_name: string
    skill_category: string
    description: string
    primary_skill?: string
    secondary_skill?: string
    tags?: string[]
    indoor_outdoor?: string
    space_required?: string
    requires_partner?: boolean
    created_by_coach_id?: string | null
    youtube_url?: string
    youtube_video_id?: string
    channel?: string
    age_range?: string
    difficulty_level?: string
    mechanic_focus?: string[]
    common_flaws_fixed?: string[]
    equipment_needed?: string[]
    ai_coaching_notes?: string
    safety_notes?: string
  }>
  gameData?: Array<{
    date: string
    opponent?: string
    status: string
    score?: string | null
    result?: string | null
    game_notes: Array<{
      player?: string
      type: string
      note: string
      inning?: number
    }>
    pitch_counts: Record<string, {
      total: number
      by_inning: Record<number, number>
    }>
  }>
  scouting?: ScoutingContext
  // Everything captured through Log an Entry. Chat was blind to this until
  // now, which meant it could contradict the priority the analysis surface
  // had just issued.
  activityLog?: string
}

export interface MemorySuggestion {
  coach_preferences?: Array<{
    key: string
    value: string
    confidence: number
  }>
  team_issues?: Array<{
    title: string
    detail: string
    confidence: number
  }>
  player_notes?: Array<{
    player_name: string
    type: 'season' | 'trait'
    note: string
    confidence: number
  }>
}

export interface ChatResponse {
  message: string
  memory_suggestions: MemorySuggestion
}

function getSkillLevelLabel(level: number | undefined): string {
  if (!level) return 'Not rated'
  const labels = ['', 'Beginner', 'Developing', 'Intermediate', 'Advanced', 'Expert']
  return labels[level] || 'Not rated'
}

function formatJournalEntry(entry: JournalEntry): string {
  const parts = []
  const date = new Date(entry.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const typeLabels: Record<string, string> = {
    lesson: 'Lesson',
    practice: 'Practice',
    game: 'Game',
    backyard: 'Backyard',
    camp: 'Camp',
    other: 'Session',
  }
  const typeLabel = typeLabels[entry.type] || typeLabels.other
  
  parts.push(`${date} - ${typeLabel}${entry.instructor ? ` with ${entry.instructor}` : ''}`)
  
  if (entry.skills && entry.skills.length > 0) {
    parts.push(`  Skills: ${entry.skills.join(', ')}`)
  }
  if (entry.focus) {
    parts.push(`  Worked on: ${entry.focus}`)
  }
  if (entry.went_well) {
    parts.push(`  Went well: ${entry.went_well}`)
  }
  if (entry.needs_work) {
    parts.push(`  Needs work: ${entry.needs_work}`)
  }
  if (entry.home_drills) {
    parts.push(`  Home drills: ${entry.home_drills}`)
  }
  
  return parts.join('\n')
}

function buildSystemPrompt(context: TeamContext): string {
  // Build playbook section if there are active playbooks
  let playbookSection = ''
  if (context.activePlaybooks && context.activePlaybooks.length > 0) {
    playbookSection = `
ACTIVE TRAINING PLAYBOOKS:
${context.activePlaybooks.map(pb => {
  let pbText = `"${pb.playbook_title}" - ${pb.assigned_to}
   Skill: ${pb.skill_category} | Goal: ${pb.goal}
   Progress: ${pb.progress} (Currently on Day ${pb.current_day})
   Started: ${new Date(pb.started_at).toLocaleDateString()}`
  
  if (pb.current_session) {
    pbText += `
   TODAY'S SESSION (Day ${pb.current_session.day}): "${pb.current_session.title}"
     - Goal: ${pb.current_session.goal}
     - Activities: ${pb.current_session.activities.join(', ')}`
  }
  
  if (pb.previous_session) {
    pbText += `
   PREVIOUS SESSION (Day ${pb.previous_session.day}): "${pb.previous_session.title}"
     - Goal: ${pb.previous_session.goal}`
  }
  
  return pbText
}).join('\n\n')}

HOW A PLAYBOOK RANKS AGAINST A PRIORITY

A playbook is a pre-written program picked off a shelf. A priority under "currently working on" above was diagnosed from this specific player's logged evidence and comes with success criteria and a review date. When the two point in different directions, THE PRIORITY WINS — say so plainly and explain why rather than letting the coach work both.

If they agree, say so and treat the playbook's current session as the vehicle for the priority. If the playbook has drifted onto something the evidence says is no longer the problem, tell them to park it. Do not enumerate a playbook day just because it is next in sequence.

Reference the specific day and activities when asked about progress. If a day was missed, that is a scheduling fact, not a failing — suggest picking up where they left off and move on.
`
  }

  // Build player section with journal entries
  let playerSection = ''
  if (context.players && context.players.length > 0) {
    playerSection = `
ROSTER & PLAYER DEVELOPMENT (${context.players.length} players):
${context.players.map(p => {
  let playerText = `\n${p.name}${p.positions && p.positions.length > 0 ? ` (${p.positions.join('/')})` : ''}`
  
  // Add skill levels if available
  const skillLevels = []
if (p.hitting_level) skillLevels.push(`Hitting: ${getSkillLevelLabel(p.hitting_level)}`)
  if (p.throwing_level) skillLevels.push(`Throwing: ${getSkillLevelLabel(p.throwing_level)}`)
  if (p.fielding_level) skillLevels.push(`Fielding: ${getSkillLevelLabel(p.fielding_level)}`)
  if (p.pitching_level) skillLevels.push(`Pitching: ${getSkillLevelLabel(p.pitching_level)}`)
  if (p.baserunning_level) skillLevels.push(`Baserunning: ${getSkillLevelLabel(p.baserunning_level)}`)
  if (p.coachability_level) skillLevels.push(`Coachability: ${getSkillLevelLabel(p.coachability_level)}`)
  if (skillLevels.length > 0) {
    playerText += `\n   Skill Ratings: ${skillLevels.join(' | ')}`
  }
  
  // Add notes if available
  if (p.notes && p.notes.length > 0) {
    playerText += `\n   Coach Notes: ${p.notes.map((n: string) => `"${n}"`).join(' | ')}`
  }
  
  // Add journal entries if available - THIS IS THE KEY ADDITION
  if (p.journal && p.journal.length > 0) {
    playerText += `\n   DEVELOPMENT JOURNAL (${p.journal.length} recent entries):`
    p.journal.forEach(entry => {
      playerText += `\n${formatJournalEntry(entry).split('\n').map(line => '      ' + line).join('\n')}`
    })
  }
  
  return playerText
}).join('\n')}
`
  }

  return `${COACH_VOICE}

${CHAT_ADDENDUM}

Everything below is what you know about this team and these players. Use it — do not invent details it does not contain, and do not ignore it and answer generically.

CURRENT TEAM CONTEXT:
- Team: ${context.team.name}
- Age Group: ${context.team.age_group}
- Skill Level: ${context.team.skill_level}
- Practice Duration: ${context.team.practice_duration_minutes} minutes

SKILL DEVELOPMENT STATUS:
- Currently Working On: ${context.team.primary_goals.length > 0 ? context.team.primary_goals.join(', ') : 'None set'}
- Showing Improvement: ${context.team.improved_areas && context.team.improved_areas.length > 0 ? context.team.improved_areas.join(', ') : 'None yet'}
- Mastered Skills: ${context.team.mastered_areas && context.team.mastered_areas.length > 0 ? context.team.mastered_areas.join(', ') : 'None yet'}

${context.coachPreferences && Object.keys(context.coachPreferences).length > 0 ? `
COACH PREFERENCES:
${Object.entries(context.coachPreferences).map(([key, value]) => `- ${key}: ${value}`).join('\n')}
` : ''}

${context.teamNotes && context.teamNotes.length > 0 ? `
CURRENT TEAM ISSUES/NOTES:
${context.teamNotes.map(n => `${n.pinned ? '[PINNED] ' : ''}${n.note}`).join('\n')}
` : ''}

${context.memorySummary ? `
TEAM MEMORY SUMMARY:
${context.memorySummary}
` : ''}
${context.activityLog ? `
WHAT'S BEEN LOGGED (games, practices, lessons, home sessions — and what the coach wrote about them):
${context.activityLog}
` : ''}
${playerSection}
${playbookSection}
${context.savedDrills && context.savedDrills.length > 0 ? `
COACH'S SAVED DRILLS:
${context.savedDrills.slice(0, 5).join(', ')}${context.savedDrills.length > 5 ? `, and ${context.savedDrills.length - 5} more` : ''}
` : ''}

${context.recentPlans && context.recentPlans.length > 0 ? `
RECENT PRACTICE PLANS:
${context.recentPlans.join(', ')}
` : ''}

${context.practiceRecaps && context.practiceRecaps.length > 0 ? `
RECENT PRACTICE RECAPS (Coach's notes from recent practices):
${context.practiceRecaps.map(r => {
  const date = new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const parts = [`${date}:`]
  if (r.energy_level) parts.push(`Energy: ${r.energy_level}`)
  if (r.attendance_count) parts.push(`Attendance: ${r.attendance_count}`)
  if (r.weather) parts.push(`Weather: ${r.weather}`)
  if (r.what_worked.length > 0) parts.push(`What worked: ${r.what_worked.join(', ')}`)
  if (r.what_didnt_work.length > 0) parts.push(`What didn't work: ${r.what_didnt_work.join(', ')}`)
  if (r.player_callouts.length > 0) {
    parts.push(`Player notes: ${r.player_callouts.map(pc => `${pc.player_name} (${pc.type}): ${pc.note}`).join('; ')}`)
  }
  if (r.next_focus.length > 0) parts.push(`Coach wants to focus on next: ${r.next_focus.join(', ')}`)
  if (r.notes) parts.push(`Additional notes: ${r.notes}`)
  return parts.join('\n  ')
}).join('\n\n')}
` : ''}

The coach's stated "next focus" is their decision, not a suggestion — work with it rather than around it. What didn't work last time usually failed for a reason worth naming before repeating it.

${context.playerStats && context.playerStats.length > 0 ? `
PLAYER GAME STATS (Season):
${context.playerStats.map(ps => {
  let statLine = `${ps.player_name}${ps.jersey_number ? ` (#${ps.jersey_number})` : ''}: ${ps.games_played || 0} games`
  if (ps.total_ab > 0) {
    const avg = Number(ps.batting_avg) || 0
    const obp = Number(ps.obp) || 0
    const slg = Number(ps.slg) || 0
    statLine += ` | AVG: ${avg.toFixed(3)} | OBP: ${obp.toFixed(3)} | SLG: ${slg.toFixed(3)} | OPS: ${(obp + slg).toFixed(3)}`
    statLine += `\n   ${ps.total_hits || 0}H, ${ps.total_doubles || 0}×2B, ${ps.total_triples || 0}×3B, ${ps.total_hr || 0}HR, ${ps.total_rbi || 0}RBI, ${ps.total_runs || 0}R, ${ps.total_walks || 0}BB, ${ps.total_strikeouts || 0}K, ${ps.total_sb || 0}SB`
  }
  if ((ps.total_errors || 0) > 0) statLine += ` | ${ps.total_errors}E`
  if (ps.recent_games && ps.recent_games.length > 0) {
    statLine += `\n   Last ${ps.recent_games.length} games: ${ps.recent_games.map(g => `${g.hits}-${g.at_bats} vs ${g.opponent || '?'}`).join(', ')}`
  }
  return statLine
}).join('\n')}

Read these as a youth line, not an MLB one — a .300 average at 9U against volunteer scorekeeping means less than the walk and strikeout rates, which stabilize far faster. Connect a number to a mechanism before you act on it: a high K rate is a timing or recognition question, a low slugging with contact is a bat-path question. Small samples are observations, not tendencies.
` : ''}

${context.gameData && context.gameData.length > 0 ? `
RECENT GAME DATA (${context.gameData.length} games):
${context.gameData.map(g => {
  const date = new Date(g.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const parts = [`${date} vs ${g.opponent || 'Unknown'}${g.score ? ` — Score: ${g.score}` : ''}${g.result ? ` (${g.result.toUpperCase()})` : ''}`]

  // Pitch counts
  const pitchers = Object.entries(g.pitch_counts || {})
  if (pitchers.length > 0) {
    parts.push(`  Pitch counts: ${pitchers.map(([name, data]: [string, any]) => {
      const innings = Object.entries(data.by_inning).map(([inn, count]) => `Inn ${inn}: ${count}`).join(', ')
      return `${name}: ${data.total} total (${innings})`
    }).join('; ')}`)
  }

  // Game notes grouped by player
  if (g.game_notes.length > 0) {
    const byPlayer: Record<string, string[]> = {}
    g.game_notes.forEach((n: any) => {
      const key = n.player || 'Team'
      if (!byPlayer[key]) byPlayer[key] = []
      byPlayer[key].push(`[${n.type}${n.inning ? ` Inn ${n.inning}` : ''}] ${n.note}`)
    })
    Object.entries(byPlayer).forEach(([player, notes]) => {
      parts.push(`  ${player}: ${notes.join('; ')}`)
    })
  }

  return parts.join('\n')
}).join('\n\n')}

Pitch counts are the one place to be proactive without being asked — flag a player approaching these limits:
  * 7-8 year olds: 50 pitches/game, 75/week recommended max
  * 9-10 year olds: 75 pitches/game, 100/week recommended max
  * 11-12 year olds: 85 pitches/game, 115/week recommended max
` : ''}

${context.drillResources && context.drillResources.length > 0 ? `
DRILLS RETRIEVED FOR THIS QUESTION (${context.drillResources.length}):
These were selected from the full BenchCoach library by reading what the coach
just asked against a catalogue of named coaching problems, then filtering on
age and on whatever they told you about their situation. They are ranked — the
first is the best match, not merely the first row of a table.
${context.drillContext ? `\n${context.drillContext}\n` : ''}
${context.drillResources.map((d: any, i: number) => {
  const facts = [
    d.skill_category,
    d.difficulty_level,
    d.age_range ? `ages ${d.age_range}` : null,
    d.indoor_outdoor,
    d.space_required ? `${d.space_required} space` : null,
    d.requires_partner === true ? 'needs a partner' : d.requires_partner === false ? 'works solo' : null,
  ].filter(Boolean).join(' · ')
  const lines = [
    `${i + 1}. "${d.drill_name}"${d.created_by_coach_id ? "  [the coach's own drill]" : ''}`,
    `   ${facts}`,
  ]
  if (d.description) lines.push(`   ${String(d.description).slice(0, 200)}`)
  if (d.common_flaws_fixed?.length) lines.push(`   fixes: ${d.common_flaws_fixed.slice(0, 6).join(', ')}`)
  if (d.mechanic_focus?.length) lines.push(`   trains: ${d.mechanic_focus.slice(0, 5).join(', ')}`)
  if (d.equipment_needed?.length) lines.push(`   needs: ${d.equipment_needed.join(', ')}`)
  { const link = watchUrl(d); if (link) lines.push(`   video: ${link}`) }
  if (d.channel) lines.push(`   source: ${d.channel}`)
  if (i < 5 && d.ai_coaching_notes) lines.push(`   coaching: ${String(d.ai_coaching_notes).slice(0, 240)}`)
  return lines.join('\n')
}).join('\n\n')}

USING THESE DRILLS:
1. When you name a BenchCoach drill, it MUST be one of the drills listed above,
   spelled exactly as written. Do not invent a drill name, do not invent a
   video link, and do not describe a drill as being "in the library" unless it
   is in this list. A coach who searches for a drill you made up finds nothing
   and stops trusting the rest of the answer.
2. Include the video link and credit the channel when you recommend one.
3. This list is a shortlist, not an instruction to use all of it. Two or three
   well-chosen drills beat six.
4. You are NOT required to recommend a drill at all. Plenty of good coaching
   answers are about what to say, what to stop doing, or what to expect at this
   age. Answer the question that was asked.
5. General technique advice from your own knowledge is fine and welcome — just
   do not dress it up as a BenchCoach library drill.
${context.drillResources.some((d: any) => d.created_by_coach_id) ? `6. A drill marked [the coach's own drill] was written by this coach. Use their name and their wording as written — do not rewrite or improve it.\n` : ''}` : `
No library drill matched this question closely enough to be worth putting in
front of the coach. Answer from your own coaching knowledge, and do not
reference the BenchCoach drill library or name drills as though they came from
it.
`}

${context.scouting && (context.scouting.opponents.length > 0 || context.scouting.upcomingMatchups.length > 0) ? `
OPPONENT SCOUTING DATA (the coach's own logged notes and box scores):
${context.scouting.upcomingMatchups.length > 0 ? `
Upcoming/possible matchups:
${context.scouting.upcomingMatchups.map(m =>
  `- vs ${m.opponent_name}${m.scheduled_at ? ` at ${m.scheduled_at}` : ''} (${m.status}${m.tournament_name ? `, ${m.tournament_name}` : ''})`
).join('\n')}
` : ''}
${context.scouting.opponents.map(o => {
  const parts = [
    `${o.is_own_team ? 'YOUR OWN TEAM' : 'OPPONENT'}: ${o.name}${o.age_group ? ` (${o.age_group})` : ''} — ` +
    `${o.entry_count} logged entr${o.entry_count === 1 ? 'y' : 'ies'}, ` +
    `first seen ${o.first_seen || '?'}, last seen ${o.last_seen || '?'}`,
  ]
  if (o.is_own_team) {
    parts.push(
      `  THIS IS THE COACH'S OWN TEAM, logged from box scores the same way an opponent is. ` +
      `Say "you" and "your" about them, never "they". Use it to compare: their pitcher's ` +
      `strike rate against your hitters' strikeout rate, their staff's workload against ` +
      `yours. That comparison is the reason this data exists and it is the most useful ` +
      `thing you can do with it.`
    )
  }
  if (o.staleness_note) parts.push(`  DATA AGE: ${o.staleness_note}`)
  if (o.team_notes) parts.push(`  Coach's team notes: ${o.team_notes}`)
  if (o.recent_notes.length > 0) {
    parts.push(`  Recent entry notes:`)
    o.recent_notes.forEach(n => parts.push(`    ${n.date || '?'} [${n.type}]: ${n.note}`))
  }
  if (o.games && o.games.length > 0) {
    parts.push(`  GAMES LOGGED (${o.games.length}) — every time you've seen them:`)
    o.games.forEach(g => {
      const bits = [`    ${g.date || 'undated'} [${g.kinds.join(', ') || 'entry'}]`]
      if (g.tournament) bits.push(`(${g.tournament})`)
      if (g.players_seen > 0) bits.push(`— ${g.players_seen} players seen`)
      if (g.pitchers.length > 0) {
        bits.push(`— pitched: ${g.pitchers.map(p => `${p.name} ${p.pitches}`).join(', ')}`)
      }
      parts.push(bits.join(' '))
      if (g.note) parts.push(`      note: ${g.note}`)
    })
  }
  if (o.players.length > 0) {
    parts.push(`  Known players:`)
    o.players.forEach(p => {
      let line = `    ${p.jersey_number ? `#${p.jersey_number} ` : ''}${p.name}`
      if (p.identity_confidence !== 'confirmed') line += ` [identity: ${p.identity_confidence}]`
      if (p.positions && p.positions.length > 0) line += ` (${p.positions.join('/')})`
      if (p.batting && p.batting.pa > 0) {
        line += ` — batting ${p.batting.h}/${p.batting.ab}, ${p.batting.bb}BB ${p.batting.k}K over ${p.batting.games} logged games`
        if (p.small_sample) line += ` [SMALL SAMPLE: ${p.batting.pa} PA — an observation, not a tendency]`
      }
      if (p.pitching) {
        line += ` — pitched ${p.pitching.outings} outing${p.pitching.outings === 1 ? '' : 's'}, ${p.pitching.total_pitches} total pitches, last ${p.pitching.last_date} (${p.pitching.last_pitches} pitches)`
        // Only worth saying when there is something behind it. Outings logged
        // before the pitching line existed have counts and nothing else, and
        // "0 H, 0 BB, 0 K" would read as a shutout rather than as no data.
        const pl = p.pitching.line
        if (pl && (pl.h || pl.bb || pl.k || pl.r)) {
          line += `; over ${pl.ip} IP: ${pl.h} H, ${pl.r} R (${pl.er} ER), ${pl.bb} BB, ${pl.k} K`
          if (pl.hr) line += `, ${pl.hr} HR`
          // The number a coach can actually use from the dugout. Around 40%
          // means wait him out; around 65% means he is in the zone.
          if (pl.strikePct !== null && pl.strikePct !== undefined) {
            line += `; ${pl.strikePct}% strikes (${pl.strikes} of ${p.pitching.total_pitches})`
          }
        }
      }
      if (p.notes) line += ` — notes: ${p.notes}`
      parts.push(line)
    })
  }
  return parts.join('\n')
}).join('\n\n')}

${context.scouting.availabilityBoards.length > 0 ? `
PITCHING AVAILABILITY (derived from logged pitch counts + rest-day rules):
${context.scouting.availabilityBoards.map(b => {
  const parts = [`vs ${b.opponent_name} on ${b.target_date} (rules: ${b.rule_label}):`]
  b.rows.forEach(r => {
    parts.push(`  ${r.jersey_number ? `#${r.jersey_number} ` : ''}${r.name}: ${r.status.toUpperCase()}${r.identity_confidence !== 'confirmed' ? ` [identity: ${r.identity_confidence}]` : ''} — ${r.explanation}`)
  })
  b.coverage_notes.forEach(n => parts.push(`  COVERAGE: ${n}`))
  return parts.join('\n')
}).join('\n\n')}
` : ''}

${context.scouting.ourAvailability ? `
OUR OWN PITCHERS — rest status for ${context.scouting.ourAvailability.target_date}
Rule set: ${context.scouting.ourAvailability.rule_label}
${context.scouting.ourAvailability.coverage_note}
${context.scouting.ourAvailability.rows.map(r =>
  `  ${r.name}: ${r.status.toUpperCase()} — ${r.explanation}` +
  (r.recent.length > 0 ? ` (recent: ${r.recent.map(a => `${a.date} ${a.pitches}p`).join(', ')})` : '')
).join('\n')}
` : ''}
USING SCOUTING DATA — ANSWER STYLE (follow strictly):
1. Lead with what's known and HOW RECENTLY it was observed. If the data is one box score from four months ago, say that first.
2. Never present a single game as a pattern. Anything under ~15 plate appearances is an observation with a small-sample caveat, not a tendency.
3. Weight recent appearances heavily; anything over ~4 months old is decayed, and anything over a season old is historical — on re-encountering a team after a long gap, open with "here's what we saw last spring, but this is a year old."
4. The coach's own written notes outweigh parsed stats when they conflict.
5. Pitching availability claims must state the inference explicitly (e.g. "Their #12 threw 68 Saturday — under most rule sets that's 3 days rest, so he shouldn't be available Sunday").
6. If a player's identity confidence is "probable" or "uncertain", say so whenever an availability or performance claim rests on them.
7. "Who should we start against them?" / "which pitchers should we use?" — answer from BOTH sides. Our own pitchers' rest status is above when we have logged counts: name who is available, who is short of rest and by how long, and why that pitcher suits this opponent's hitters. Never recommend an arm the rest math says is ineligible, and say plainly when nobody is available. Combine with our roster, skill ratings and lineup data for the batting order.

7b. ANSWER FIRST. Open with the answer to the question they asked. Never open with what you do not know, what the limitations are, or how old the data is — a coach asking "who are their top pitchers" wants two names in the first sentence. Caveats go in ONE line at the END, and only when they would change a decision. Do not repeat the same caveat twice in a reply, and never say a version of "before I answer" or "here's the honest limitation". Counts are what was LOGGED rather than what was thrown, and one closing line covers that.

7c. SCOUT THE ARM, NOT JUST THE WORKLOAD. Pitch counts say who they lean on. The line says how he pitches, and that is what the coach actually wants — say it in plain language and commit to a read:
   - Strike percentage is the headline. Roughly 60%+ is a strike-thrower: tell them to be ready early because he is not going to walk anybody. Around 50% or below is wild: take a pitch, make him prove it, and expect free bases.
   - K rate against batters faced or innings: a kid missing bats is a different problem from one letting the ball get put in play. Say which he is.
   - BB rate: name whether he gives away free bases, and what that means for the approach.
   - Hits and runs against innings: is he getting hit hard, or getting outs?
   Then give the approach in one sentence a coach can repeat in the dugout — "sit on the first strike, he's around the plate" or "he's walked seven in five innings, make him throw it".

7d. When you have the numbers, USE them rather than describing what you have. "124 pitches over 4 outings" is inventory. "Gio C is their guy — 53 pitches on 7/14, 75% strikes, one walk. He's in the zone, so tell your hitters to be ready in the first two pitches" is scouting. Give the second.
8. BOUNDARIES: stick to observable baseball facts about opposing players (stats, pitch counts, positions, on-field tendencies). Never characterize an opposing child's personality, attitude, body, or potential. This is the coach's organized note-taking on games they already watched, using data the tournament already published — keep your language there.
` : ''}

A theme repeating across several lessons is worth naming out loud — it usually means the fix hasn't held, not that the instructor forgot. Skill ratings are the coach's own 1-5 read (Beginner through Expert) and set the ceiling on drill complexity, not on how specific your cues are.

RESPONSE FORMAT:
Provide your coaching advice in natural prose. At the end of your response, include a JSON object in this exact format:

MEMORY_SUGGESTIONS:
{
  "coach_preferences": [{"key": "...", "value": "...", "confidence": 0.0-1.0}],
  "team_issues": [{"title": "...", "detail": "...", "confidence": 0.0-1.0}],
  "player_notes": [{"player_name": "...", "type": "season|trait", "note": "...", "confidence": 0.0-1.0}]
}

Only suggest memories with confidence > 0.65. Keep suggestions minimal and high-signal.`
}

export async function generateChatResponse(
  userMessage: string,
  context: TeamContext,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = []
): Promise<ChatResponse> {
  try {
    const systemPrompt = buildSystemPrompt(context)
    
    const messages = [
      ...conversationHistory.slice(-6), // Last 3 exchanges
      { role: 'user' as const, content: userMessage }
    ]

    // Streamed even though the caller wants the whole message at once. A
    // non-streaming request that runs long gets killed at the platform timeout
    // with nothing to show for it, and thinking made these replies markedly
    // slower than they were before.
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-5',
      // A hard cap on thinking AND the answer together. Thinking is on by
      // default on this model, so a budget sized for the answer alone gets
      // spent before the answer starts — which is how this surface broke.
      max_tokens: 10000,
      system: systemPrompt,
      messages: messages,
      // A chat reply doesn't need deep reasoning; the system prompt already
      // carries the structure and the evidence. Low effort keeps thinking from
      // dominating both the token budget and the coach's wait.
      output_config: { effort: 'low' },
    })

    const response = await stream.finalMessage()

    if (!textFrom(response)) {
      // Log the shape before throwing. "Failed to generate response" with no
      // detail is what let the empty-reply bug live in production.
      console.error('Chat returned no text.', {
        stop_reason: response.stop_reason,
        blocks: response.content.map((b: any) => b.type),
        usage: response.usage,
      })
    }

    // An empty reply is a failure here, not a valid answer — throw rather than
    // save a blank message to the conversation.
    const fullContent = requireText(response, 'chat reply')

    // Extract memory suggestions from the response
    const memorySuggestionsMatch = fullContent.match(/MEMORY_SUGGESTIONS:\s*(\{[\s\S]*?\})\s*$/m)
    let memorySuggestions: MemorySuggestion = {}
    let cleanMessage = fullContent

    if (memorySuggestionsMatch) {
      try {
        memorySuggestions = JSON.parse(memorySuggestionsMatch[1])
        cleanMessage = fullContent.replace(/MEMORY_SUGGESTIONS:[\s\S]*$/m, '').trim()
      } catch (e) {
        console.error('Failed to parse memory suggestions:', e)
      }
    }

    return {
      message: cleanMessage,
      memory_suggestions: memorySuggestions,
    }
  } catch (error: any) {
    console.error('Claude API error:', error)
    // Keep the real reason. Collapsing every failure into one generic string is
    // how a silent empty-response bug survives — the log said nothing useful
    // and the UI said nothing at all.
    throw new Error(error?.message || 'Failed to generate response')
  }
}

// What this surface is, said once. Both phases need it and a drift between
// them would show up as a plan whose blocks were written to a different
// standard than the plan they belong to.
const PRACTICE_SURFACE = `WHAT THIS SURFACE IS

You are writing a practice a volunteer parent will run on a field on Tuesday, holding a phone. They may never have coached before. The #1 reason youth practices fail is the coach not knowing exactly what to do next, and your work removes that.

A schedule is not coaching. You are the experienced coach standing next to them: you explain the shape, you flag what is about to go wrong, and you name what a good rep looks like from where they are standing.

Never generic. "Work on fundamentals", "keep it fun", "focus on the basics" are not coaching and must not appear. If a sentence could have been written without knowing this team's age, headcount, kit or history, cut it and write the one that could not.

Return valid JSON and nothing else.`

// ---------------------------------------------------------------------------
// Two-phase practice generation
// ---------------------------------------------------------------------------
// The single-call version below produced a good plan and took 45-60 seconds to
// do it, most of which the coach spent looking at "Picking the drills…". Two
// causes, and only one of them was the model thinking.
//
// A full plan is five blocks times ten prose fields — instructions, setup,
// cues, mistakes, variations, indicators, watch_for. That is 6-10k output
// tokens generated strictly in series, and output tokens are the wall clock.
//
// So it is generated in two phases instead:
//
//   1. The SKELETON — title, coach_notes, flags, and the block list with its
//      titles, durations, one-line descriptions and drill matches. Under a
//      thousand tokens. The coach has the whole shape of the practice, and can
//      already tell whether it is the practice they wanted, in a few seconds.
//
//   2. Every block EXPANDED IN PARALLEL, one call each. Wall clock becomes the
//      slowest single block rather than the sum of five, and each call has
//      room to be thorough about one block instead of rationing tokens across
//      the whole plan. Faster AND more detailed, which is the only reason this
//      is worth the extra complexity.
//
// The single-call version that used to live here is gone. The refine path
// was its last caller, and refine now runs through the two phases like
// everything else — a rewrite that streams nothing for two minutes is how a
// coach gets a 504 instead of a practice plan.

export interface PracticeInputs {
  duration: number
  focus: string[]
  context: TeamContext
  constraints?: string
  drillResources?: any[]
  loopContext?: string
  rosterSection?: string
  preference?: { favorites: Set<string>; note: string }
  // The one thing the coach wants out of the night, in their words. Optional:
  // when they leave it blank the model decides and writes it back, which is
  // usually better than a coach guessing at a goal to fill a box.
  objective?: string
  // What is actually in the car. A plan that stations four kids at a tee this
  // team does not own is worse than no plan — the coach finds out in front of
  // everybody. Empty means unknown, and the model should assume the ordinary
  // kit rather than refuse to plan.
  equipmentAvailable?: string[]
  // The time budget and the drills that fit it, from lib/practiceScheduler.
  // A recommendation the model may depart from — it knows things the
  // scheduler does not — but the budget itself is enforced on the way out
  // regardless, so a plan that ignores it gets trimmed rather than shipped.
  scheduleGuidance?: string
}

// The situation, written once and reused by both phases. Sending it to every
// block expansion is what lets each one stay specific to this team rather
// than producing a generic description of a drill.
function practiceSituation(i: PracticeInputs): string {
  const c = i.context
  return `A ${c.team.age_group} ${c.team.skill_level} team, ${i.duration}-minute practice.
Focus areas: ${i.focus.join(', ')}
${i.objective ? `\nTHE COACH'S #1 GOAL FOR TONIGHT — every block must earn its place against this:\n${i.objective}\n` : ''}${i.constraints ? `\nWHAT THE COACH SAID THEY WANT — this outranks everything else here:\n${i.constraints}\n` : ''}${i.equipmentAvailable?.length ? `\nWHAT THEY HAVE WITH THEM — you may not require anything outside this list:\n${i.equipmentAvailable.join(', ')}\nIf a drill you want needs something they do not have, either adapt it and say so in the setup, or pick a different drill. Never write a block a coach cannot physically run.\n` : ''}
- Currently working on: ${c.team.primary_goals.length > 0 ? c.team.primary_goals.join(', ') : 'Not specified'}
${c.teamNotes.length > 0 ? `- Current issues: ${c.teamNotes.map(n => n.note).join('; ')}` : ''}
${i.loopContext ? `\nWHAT WE'RE ALREADY WORKING ON — build around this, don't ignore it:\n\n${i.loopContext}\n` : ''}${i.rosterSection ? `\n${i.rosterSection}\n` : ''}${i.scheduleGuidance ? `\n${i.scheduleGuidance}\n` : ''}`
}

function drillMenu(i: PracticeInputs): string {
  const drills = i.drillResources || []
  if (drills.length === 0) return ''
  return `\nDRILL VIDEO LIBRARY (${drills.length} available). Use these by their exact drill_name and youtube_video_id. Never invent an ID.\n\n${
    drills.map(d => drillMenuLine(d, !!i.preference?.favorites?.has(d.id))).join('\n')
  }\n${i.preference?.note ? `\n${i.preference.note}\n` : ''}`
}

/**
 * Phase 1 — the shape of the practice, fast.
 *
 * Deliberately small output. Everything here is judgement (what to work, in
 * what order, what is wrong with their setup) and none of it is prose the
 * model has to grind out, so it comes back in a few seconds and the coach can
 * tell immediately whether it is the practice they asked for.
 */
export async function generatePracticeSkeleton(i: PracticeInputs): Promise<any> {
  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 4000,
    system: `${COACH_VOICE}

${PRACTICE_SURFACE}

You are doing the THINKING half of the job: deciding what this practice is, in what order, and what is wrong with how the coach has set it up. Somebody else writes out the step-by-step for each block afterwards — do not write it here, and do not pad. Short, specific, decided.`,
    messages: [{ role: 'user', content: `${practiceSituation(i)}
${drillMenu(i)}

Design the practice. Warm-up, two to four named drill blocks, a competitive game with real rules, cool-down.

The block minutes must add to ${i.duration} or less — never more. A practice that runs over is a coach still going when the parents have arrived. Finishing three or four minutes short is fine and often better than padding; do not add a weak block just to fill the clock. For a short session, drop blocks rather than shrinking every block to nothing: two real drills beat six three-minute ones.

Every block must be a REAL, NAMED drill — "Alligator Ground Balls", "Four Corners Rundown". Never a category like "Fielding Practice" or "Throwing Assessment".

Return ONLY this JSON:
{
  "title": "Specific to this team and this practice, not 'Youth Baseball Practice'",
  "objective": "ONE sentence. The single thing that has to be better when everyone goes home, written so the coach could say it out loud to the team in the first minute. Concrete and observable — 'every infielder fields with two hands and comes up throwing' beats 'improve fielding'. If the coach gave you their own #1 goal, this is that goal in their words, sharpened, not replaced.",
  "coaching_points": ["Exactly 3. The things this coach should be saying and looking for ALL PRACTICE, across every block — not cues for one drill. These are what they repeat until the kids hear it in their sleep. Mechanical and specific."],
  "coach_notes": "2-4 sentences to this coach before they read a block. Why the practice is shaped this way, what you deliberately left out, and — naming the block — what to cut first if they lose fifteen minutes.",
  "flags": ["Problems in what they told you, each with its fix. Headcount against stations. One adult against two places to stand. Block length against attention span at this age. Throwing volume against what they played this weekend. Empty array only if there is genuinely nothing."],
  "blocks": [
    {
      "type": "warmup|drill|station|game|cooldown",
      "title": "The named drill",
      "minutes": 10,
      "description": "One sentence: what happens and why it is in this practice.",
      "drill_name": "exact name from the library, or omit",
      "youtube_video_id": "exact id from the library, or omit",
      "youtube_channel": "channel from the library, or omit"
    }
  ]
}` }],
    // The decisions here are the valuable part and there are not many tokens
    // to produce, so this is the one place deliberation is cheap.
    output_config: { effort: 'medium' },
  })

  const content = textFrom(await stream.finalMessage())
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('The plan outline came back unreadable. Try again.')
  return JSON.parse(match[0])
}

/**
 * Phase 2 — one block, in full.
 *
 * Called once per block, all at the same time. Each gets the whole situation
 * and the rest of the plan for context, so it can say "the group you sent to
 * the cages in block 2" rather than describing a drill in the abstract.
 */
export async function expandPracticeBlock(
  i: PracticeInputs,
  block: any,
  index: number,
  allBlocks: any[]
): Promise<any> {
  const outline = allBlocks
    .map((b, n) => `${n + 1}. ${b.title} (${b.minutes} min)${n === index ? '  <-- the one you are writing' : ''}`)
    .join('\n')

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-5',
    max_tokens: 3000,
    system: `${COACH_VOICE}

${PRACTICE_SURFACE}

You are writing ONE block of a practice somebody has already designed. Do not redesign it, do not change its length, do not comment on the other blocks. Write this one so well that a parent who has never coached can run it without looking anything up.`,
    messages: [{ role: 'user', content: `${practiceSituation(i)}

THE PRACTICE:
${outline}

THE BLOCK YOU ARE WRITING:
${JSON.stringify(block, null, 1)}

Write it out. Return ONLY this JSON:
{
  "detailed_instructions": "5-10 numbered steps, each with SPECIFIC distances in feet, SPECIFIC rep counts, SPECIFIC player positions and SPECIFIC timing. 'Round 1 (2 minutes): pairs 15 feet apart, both on their throwing-side knee, 10 throws each focusing only on wrist snap' — not 'partner throwing to work on mechanics'.",
  "setup": "Exact layout with distances and where the coach stands. 'Three cones in a line 10 feet apart along the third-base line, coach 20 feet away with a bucket of 15 balls, players single-file behind the first cone.' Never '3 stations, coaches assess'.",
  "equipment": ["specific", "with counts where it matters"],
  "coaching_cues": ["4-6 phrases the coach says OUT LOUD. Mechanical and specific: 'step with your left foot at your target', 'glove below the ball, scoop up never stab down'. Never 'nice throw', 'hustle', 'good effort'."],
  "common_mistakes": ["3-5, each as 'What you will see — how to fix it'. 'Throws sidearm — start him on one knee to force an overhand slot, hold your hand above his throwing shoulder as a target'."],
  "drill_variations": "Easier: [for the weakest kid]. Harder: [for the one who is already good].",
  "success_indicators": ["2-3 things the coach can OBSERVE that say it is working"],
  "watch_for": "The one thing you would see from the side that a first-time coach walks straight past. What a good rep looks like versus the failure that is easy to miss, from where they are standing. Not 'watch their form'."
}` }],
    // Low here on purpose. The hard decisions were made in phase 1; this is
    // writing out a drill the model already knows, and effort buys nothing
    // except the wait the coach is complaining about.
    output_config: { effort: 'low' },
  })

  const content = textFrom(await stream.finalMessage())
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) return {}
  try { return JSON.parse(match[0]) } catch { return {} }
}

export async function generateReplacementBlock(
  ageGroup: string,
  blockToReplace: any,
  otherBlocks: any[],
  coachNote: string,
  drillResources?: any[]
): Promise<any> {
  try {
    let drillLibrarySection = ''
    if (drillResources && drillResources.length > 0) {
      drillLibrarySection = `\nDRILL VIDEO LIBRARY (${drillResources.length} drills available):
${drillResources.map(d =>
  `- "${d.drill_name}" (${d.skill_category}, ${d.difficulty_level || 'all levels'}, Ages: ${d.age_range || 'all'})
     ${d.youtube_video_id ? `youtube_video_id: "${d.youtube_video_id}"` : ''}
     ${d.channel ? `Channel: ${d.channel}` : ''}
     ${d.description || ''}`
).join('\n')}

CRITICAL: When you use a drill from the library, copy the exact "drill_name" and "youtube_video_id" into your JSON output.`
    }

    const otherDrillNames = otherBlocks.map(b => b.title).join(', ')

    const prompt = `I'm coaching a ${ageGroup} youth baseball team. I have a practice plan but I want to REPLACE one specific drill block.

THE DRILL I WANT TO REPLACE:
- Title: "${blockToReplace.title}"
- Type: ${blockToReplace.type || 'drill'}
- Duration: ${blockToReplace.minutes} minutes
- Description: ${blockToReplace.description || 'N/A'}

OTHER DRILLS ALREADY IN THIS PLAN (do NOT duplicate these):
${otherDrillNames}

${coachNote ? `COACH'S REQUEST: "${coachNote}"` : 'The coach wants a different drill that still fits this practice. Suggest something engaging and age-appropriate.'}
${drillLibrarySection}

Generate ONE replacement drill block that:
1. Is a SPECIFIC, NAMED drill (not a vague category)
2. Fits the ${ageGroup} age group
3. Takes approximately ${blockToReplace.minutes} minutes
4. Is the same type: ${blockToReplace.type || 'drill'}
5. Does NOT duplicate any drill already in the plan
6. Has full detailed instructions a first-time coach can follow
7. Matches a drill video from the library if one exists

Return ONLY valid JSON for a single block:
{
  "type": "${blockToReplace.type || 'drill'}",
  "title": "Specific Drill Name",
  "minutes": ${blockToReplace.minutes},
  "description": "One-sentence overview",
  "detailed_instructions": "1. [Step with distances, reps]\\n2. [Next step]\\n(5-10 steps)",
  "setup": "Equipment layout and player arrangement",
  "equipment": ["list", "of", "equipment"],
  "coaching_cues": ["Technical phrase 1", "Technical phrase 2"],
  "common_mistakes": ["Mistake — Correction", "Mistake — Correction"],
  "drill_variations": "Easier: ... Harder: ...",
  "success_indicators": ["Observable sign 1", "Observable sign 2"],
  "watch_for": "The one thing an experienced coach sees here that a first-time coach walks straight past — what a good rep looks like versus the failure that is easy to miss, from where the coach is standing. Not \"watch their form\".",
  "youtube_video_id": "exact_id_from_library_if_match",
  "youtube_channel": "Channel Name",
  "drill_name": "Exact Drill Name From Library"
}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 10000,
      system: `You are Coach Mike, a 25-year veteran youth baseball coach. You create incredibly detailed drill instructions that a first-time volunteer parent-coach can follow perfectly. Every drill has exact distances, reps, words to say, and a YouTube video when available. Always return valid JSON. No text outside the JSON.`,
      messages: [{ role: 'user', content: prompt }],
      output_config: { effort: 'low' },
    })

    const content = textFrom(response)

    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }

    throw new Error('Failed to parse replacement block')
  } catch (error) {
    console.error('Replacement block generation error:', error)
    throw new Error('Failed to generate replacement block')
  }
}
