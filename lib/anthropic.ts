import Anthropic from '@anthropic-ai/sdk'
import { COACH_VOICE, CHAT_ADDENDUM } from './coachVoice'
import { textFrom, requireText } from './claudeText'
import { drillMenuLine } from './drills'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

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
    pitching?: { outings: number; total_pitches: number; last_date: string; last_pitches: number } | null
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
  drillResources?: Array<{
    drill_name: string
    skill_category: string
    description: string
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
DRILL RESOURCES LIBRARY:
You have access to a curated library of ${context.drillResources.length} drills with YouTube video demonstrations from trusted channels. When recommending a drill, ALWAYS check this library first and include the YouTube link so the coach can see it demonstrated.

Available drills:
${context.drillResources.map(d => 
  `- "${d.drill_name}" (${d.skill_category}, ${d.difficulty_level || 'all levels'})
     ${d.common_flaws_fixed?.length ? `Fixes: ${d.common_flaws_fixed.join(', ')}` : ''}
     Ages: ${d.age_range || 'all ages'}
     ${d.youtube_url ? `📹 Video: ${d.youtube_url}` : ''}
     ${d.channel ? `Source: ${d.channel}` : ''}
     ${d.description || ''}`
).join('\n')}

IMPORTANT INSTRUCTIONS FOR DRILL RECOMMENDATIONS:
1. When you suggest a drill from the library, ALWAYS include the YouTube link
2. Credit the source channel (e.g., "Here's a great video from Dominate The Diamond...")
3. Include the coaching cues if available
4. Mention safety notes when relevant
5. Format like this:
   "I'd recommend the **High Tee Drill** to fix that uppercut. Here's an excellent video demonstration from Dominate The Diamond: https://www.youtube.com/watch?v=..."

This helps coaches who may not know the drill see exactly how it's done with proper form.
` : ''}

${context.scouting && (context.scouting.opponents.length > 0 || context.scouting.upcomingMatchups.length > 0) ? `
OPPONENT SCOUTING DATA (the coach's own logged notes and box scores):
${context.scouting.upcomingMatchups.length > 0 ? `
Upcoming/possible matchups:
${context.scouting.upcomingMatchups.map(m =>
  `- vs ${m.opponent_name}${m.scheduled_at ? ` at ${m.scheduled_at}` : ''} (${m.status}${m.tournament_name ? `, ${m.tournament_name}` : ''})`
).join('\n')}
` : ''}
${context.scouting.opponents.map(o => {
  const parts = [`OPPONENT: ${o.name}${o.age_group ? ` (${o.age_group})` : ''} — ${o.entry_count} logged entr${o.entry_count === 1 ? 'y' : 'ies'}, first seen ${o.first_seen || '?'}, last seen ${o.last_seen || '?'}`]
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
5. Pitching availability claims must state the inference explicitly (e.g. "Their #12 threw 68 Saturday — under most rule sets that's 3 days rest, so he shouldn't be available Sunday") AND repeat the coverage caveats: unlogged games are not counted, so never imply the picture is complete.
6. If a player's identity confidence is "probable" or "uncertain", say so whenever an availability or performance claim rests on them.
7. "Who should we start against them?" / "which pitchers should we use?" — answer from BOTH sides. Our own pitchers' rest status is above when we have logged counts: name who is available, who is short of rest and by how long, and why that pitcher suits this opponent's hitters. Never recommend an arm the rest math says is ineligible, and say plainly when nobody is available. Combine with our roster, skill ratings and lineup data for the batting order.

7b. Counts are what was LOGGED, not what was thrown. Both boards say so. If the coach asks who is available and the answer rests on a thin log, say that before the recommendation, not after it.
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

export async function generatePracticePlan(
  duration: number,
  focus: string[],
  context: TeamContext,
  constraints?: string,
  drillResources?: any[],
  // What the loop already concluded about this team: active priorities and
  // what the coach actually wrote down. Without this the practice builder is a
  // separate tool that has never heard of the check-in.
  loopContext?: string,
  // The roster size and recent attendance, already written as prose by the
  // caller. Station maths is most of what separates a plan a volunteer can run
  // from one they read and then improvise around.
  rosterSection?: string,
  // Which drills this coach has starred, and the sentence explaining what the
  // marks mean. Passed together because a mark with no key is noise.
  preference?: { favorites: Set<string>; note: string },
  // Called as text arrives, so a caller can stream progress to the browser.
  onProgress?: (charsSoFar: number, chunk: string) => void
): Promise<any> {
  try {
    // Build drill library context for the prompt
    let drillLibrarySection = ''
    if (drillResources && drillResources.length > 0) {
      drillLibrarySection = `

DRILL VIDEO LIBRARY:
You have access to a curated library of ${drillResources.length} drills with YouTube video demonstrations. When a drill from this library fits the practice plan, USE IT by including its exact drill_name and youtube_video_id in the block. This lets coaches see a video demo of exactly how to run the drill.

Available drills:
${drillResources.map(d =>
  // One line each. This is a menu to choose from, not a manual — the model
  // needs enough to pick well and nothing more. The full prose for every
  // drill used to be here, and it dominated the request.
  drillMenuLine(d, !!preference?.favorites?.has(d.id))
).join('\n')}
${preference?.note ? `\n${preference.note}\n` : ''}

CRITICAL: When you use a drill from the library, you MUST copy the exact "drill_name" and "youtube_video_id" into your JSON output. Do NOT make up video IDs.`
    }

    const prompt = `Create a ${duration}-minute practice plan for a ${context.team.age_group} ${context.team.skill_level} team.

Focus areas: ${focus.join(', ')}
${constraints ? `Additional context: ${constraints}` : ''}

Team context:
- Currently working on: ${context.team.primary_goals.length > 0 ? context.team.primary_goals.join(', ') : 'Not specified'}
- Areas showing improvement: ${context.team.improved_areas && context.team.improved_areas.length > 0 ? context.team.improved_areas.join(', ') : 'None yet'}
- Mastered skills (lighter maintenance): ${context.team.mastered_areas && context.team.mastered_areas.length > 0 ? context.team.mastered_areas.join(', ') : 'None yet'}
${context.teamNotes.length > 0 ? `- Current issues: ${context.teamNotes.map(n => n.note).join('; ')}` : ''}
${loopContext ? `
WHAT WE'RE ALREADY WORKING ON — build the practice around this, don't ignore it:

${loopContext}

If a priority above is live for this team, at least one drill block must move it forward, and say which one in that block's description. If a check-in concluded something stalled, do NOT put the same drill back in unchanged — that is the specific failure the coach is paying us to catch.
` : ''}${rosterSection ? `
${rosterSection}
` : ''}
${drillLibrarySection}

YOU MUST CREATE AN EXTREMELY DETAILED PRACTICE PLAN. The coach reading this has NEVER coached before. They are a parent who volunteered. They need to read this plan and know EXACTLY what to do, step by step, like following a cooking recipe.

STRUCTURE:
1. Warm-up (5-10 min) — A SPECIFIC dynamic warm-up with named exercises, reps, and distances. NOT "team jog." Include things like high knees for 30 feet, arm circles 10 each direction, bear crawls, etc.
2. 2-4 SPECIFIC NAMED DRILLS — Each drill block must be a REAL, NAMED baseball drill (e.g., "Alligator Ground Balls", "Two-Knee Throwing Drill", "Soft Toss Hitting", "Bucket Drill"). NOT vague categories like "Skill Assessment Rotation" or "Throwing Assessment."
3. A competitive game or scrimmage with SPECIFIC RULES explained
4. Cool-down / team talk (3-5 min)

===== MANDATORY RULES — VIOLATIONS WILL BE REJECTED =====

RULE 1 — NO GENERIC BLOCKS: Every drill block must be a SPECIFIC, NAMED drill. NEVER use vague titles like "Throwing Assessment", "Skill Assessment Rotation", "Hitting Station", or "Fielding Practice." Use the actual drill name like "Rollers Ground Ball Drill" or "One-Knee Throwing Drill."

RULE 2 — DETAILED INSTRUCTIONS ARE MANDATORY: Every block MUST have "detailed_instructions" with 5-10 numbered steps. Each step must include SPECIFIC distances (in feet), SPECIFIC rep counts, SPECIFIC player positioning, and SPECIFIC timing. Example of GOOD:
"1. Split players into pairs, each pair with one ball. Line them up facing each other 15 feet apart.
2. Round 1 (2 minutes): One-knee throwing. Both players take a knee (throwing-side knee down). Throw 10 balls back and forth focusing ONLY on wrist snap and follow-through.
3. Round 2 (2 minutes): Stand up. Move back to 25 feet apart. Throw 10 balls. Coach walks the line checking that every player steps toward their partner with their glove-side foot.
4. Round 3 (2 minutes): Move back to 35 feet. Throw 10 balls. Players must use full crow-hop: shuffle, skip, throw.
5. Coach pulls aside any player who needs extra help and demonstrates the grip (two fingers on top, thumb underneath, like holding a TV remote)."

Example of BAD (NEVER do this):
"Partner throwing to assess arm strength and accuracy" — This tells the coach NOTHING about how to run the drill.

RULE 3 — COACHING CUES MUST BE TECHNICAL: Every block must have 4-6 coaching cues. These are the EXACT words the coach says out loud. They must be SPECIFIC mechanical instructions, NOT cheerleading.
GOOD cues: "Point your glove at the ball like you're reaching for it", "Step with your LEFT foot toward your target", "Get your glove below the ball — scoop up, never stab down", "Squish the bug with your back foot when you swing"
BAD cues (NEVER use these): "Nice throw!", "Good effort!", "Hustle!", "Nice try!", "Show me your best!"

RULE 4 — MISTAKES MUST INCLUDE CORRECTIONS: Every block must have 3-5 common mistakes. Each one MUST follow the format "What you'll see — How to fix it." Example:
"Player throws sidearm — Have them start from one knee to force an overhand slot. Put your hand above their throwing shoulder as a target to reach for."
NOT just "Rushing" or "Bad form."

RULE 5 — USE DRILL VIDEOS: For EVERY drill block, search the DRILL VIDEO LIBRARY and find the most relevant drill video. If you find one that matches (even partially), you MUST include its youtube_video_id, youtube_channel, and drill_name. Coaches NEED to see what the drill looks like. This is critical — a volunteer coach who has never done the drill needs to watch a 60-second video to understand it.

RULE 6 — EQUIPMENT AND SETUP MUST BE SPECIFIC: "Setup: 3 stations, coaches assess" is NOT acceptable. Instead: "Setup: Place 3 cones in a line 10 feet apart along the third-base line. Coach stands 20 feet away with a bucket of 15 balls. Players line up single-file behind the first cone. You need: bucket of baseballs (15+), 3 cones, 1 glove per player."

RULE 7 — EVERY BLOCK NEEDS VARIATIONS AND SUCCESS INDICATORS:
- "drill_variations" must explain how to make it EASIER (for the weakest player) and HARDER (for the kid who's already good). Be specific.
- "success_indicators" must list 2-3 things the coach can OBSERVE that tell them the drill is working. Example: "Players are stepping toward their target on every throw", "You hear the ball pop in the glove consistently."

RULE 8 — COACH_NOTES AND FLAGS ARE NOT OPTIONAL: "coach_notes" explains the shape of the practice and names the block to cut when time runs short. "flags" names the problems in this coach's setup before they meet them on the field — headcount against stations, one adult against two places to stand, attention span against block length, throwing volume against what they played this weekend. A flag with no fix in it is a complaint; every flag says what to do about it. An empty flags array is acceptable ONLY when there is genuinely nothing — never as a shortcut.

RULE 9 — "watch_for" ON EVERY BLOCK: the thing you would see from the side that a first-time coach misses entirely. This is the single highest-value sentence in each block and the clearest signal that a coach wrote the plan rather than a template.

Format as JSON:
{
  "title": "Practice Plan Title",

  "coach_notes": "2-4 sentences, written to this coach, before they read a single block. Why this practice is shaped the way it is: what you are prioritising and why, what you deliberately left out today, and — concretely — what to cut first if you lose fifteen minutes to rain or a late start. Name the block you would cut. This is the part that makes them a better coach rather than a better schedule-follower.",

  "flags": [
    "Problems in what they told you, said before they hit them on the field. Each one names the problem AND what to do about it. e.g. 'Three cages and ten kids means seven are standing still — the field group needs a job every second, which is why Rotation 1 has the fungo line running continuously rather than one hitter at a time.' or 'If you are the only adult, you cannot watch the cages and the infield at once. Put the cages on a tee for the first ten minutes so they can run without you, and start yourself on the field where the mistakes are.' Include a workload flag if throwing volume looks high for the age or for what they played this weekend. Empty array if there is genuinely nothing worth flagging — do not invent one."
  ],

  "blocks": [
    {
      "type": "warmup|drill|station|game|cooldown",
      "title": "Specific Drill Name",
      "minutes": 10,
      "description": "One-sentence overview",
      "detailed_instructions": "1. [Step with distances, reps, positions]\\n2. [Next step]\\n3. [Continue for 5-10 steps]",
      "setup": "Exact equipment layout and player arrangement with distances",
      "equipment": ["baseballs (15+)", "cones (4)", "batting tee", "gloves"],
      "coaching_cues": ["Technical phrase coach says out loud", "Another specific mechanical cue"],
      "common_mistakes": ["What you'll see — How to fix it", "Another mistake — Its correction"],
      "drill_variations": "Easier: [specific modification]. Harder: [specific progression].",
      "success_indicators": ["Observable sign 1", "Observable sign 2"],
      "watch_for": "The one thing an experienced coach sees here that a first-time coach walks straight past. Written from where they are standing: what a good rep looks like versus the failure that is easy to miss. Not 'watch their form'.",
      "youtube_video_id": "exact_id_from_library",
      "youtube_channel": "Channel Name",
      "drill_name": "Exact Drill Name From Library"
    }
  ]
}`

    // Streamed for the length AND for the UI now: a plan this long is exactly
    // the kind of request that gets cut off at a platform timeout, and it is
    // also long enough that the coach needs to see it happening.
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-5',
      // Thinking counts against this and a full plan is long JSON; too low and
      // the response truncates mid-object and fails to parse.
      max_tokens: 20000,
      system: `${COACH_VOICE}

WHAT THIS SURFACE IS

You are writing a practice plan a volunteer parent will run on a field on Tuesday, holding a phone. They may never have coached before. The #1 reason youth practices fail is the coach not knowing exactly what to do next, and your plan removes that.

But a schedule is not coaching. You are not a form that turns focus areas into time blocks — you are the experienced coach standing next to them, and the plan should read like one built it. That means three things a schedule does not do:

1. YOU EXPLAIN THE SHAPE. Before the blocks, say why this practice is built the way it is — what you are prioritising, what you are deliberately not doing today, and what to cut first if you run out of time. A volunteer who understands the shape can adapt when it rains; one following a list cannot.

2. YOU FLAG PROBLEMS. If what they have told you creates a real problem, say so before they discover it on the field. One coach and two stations means nobody is watching one of them. Ten kids and three cages means seven are standing still unless you give them something. Forty-five minutes on hitting for 8-year-olds is longer than their attention. Twelve throwing minutes after a Saturday doubleheader is a workload question. You are not being negative — you are the person who has seen this go wrong before, and saying it costs nothing while finding out costs them the practice.

3. YOU COACH THE COACH. In each block, name what a good rep actually looks like and what the most common mistake looks like from where they are standing. Not "watch their form" — "you are looking for the glove to beat the ball to the spot; if his hand is moving backwards on contact he is catching it instead of receiving it".

Never generic. "Work on fundamentals", "keep it fun", "focus on the basics" are not coaching and must not appear. If a sentence in your plan could have been written without knowing this team's age, headcount, kit or history, cut it and write the one that could not.

The output is JSON, not prose — but everything above about naming mechanics applies harder here, not less. The writing standard governs the text inside the fields.

When a drill video library is available, match drills to videos so the coach can watch before running it. If a block genuinely has no matching video, say what to look for instead — do not invent an ID.

Always return valid JSON. No text outside the JSON.`,
      messages: [{ role: 'user', content: prompt }],
      // Raised from 'low'. That was right when this prompt was a rigid
      // template and the model was filling a form — but it is now asked to
      // judge whether the coach's setup has a problem in it, decide what to
      // cut when time runs short, and pick which mechanic to teach for this
      // age. That is reasoning, and at 'low' it produced plans that were
      // correct and plain.
      output_config: { effort: 'medium' },
    })

    // Let the caller watch it arrive. A plan is 30-60 seconds of silence
    // otherwise, and a spinner that long is indistinguishable from broken.
    if (onProgress) {
      let seen = 0
      stream.on('text', (chunk: string) => {
        seen += chunk.length
        onProgress(seen, chunk)
      })
    }

    const response = await stream.finalMessage()
    const content = textFrom(response)

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }

    throw new Error(
      'The plan came back in a shape we could not read. This is usually a plan ' +
      'that ran past its length limit — try a shorter practice or fewer focus areas.'
    )
  } catch (error: any) {
    // Was `throw new Error('Failed to generate practice plan')`, which
    // discarded the only useful thing in the whole failure. A coach reporting
    // "it failed to generate" had nothing to tell us and neither did the
    // client, because the message it showed was a constant.
    console.error('Practice plan generation error:', error)
    throw new Error(error?.message || 'Failed to generate practice plan')
  }
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
