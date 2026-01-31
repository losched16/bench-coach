import Anthropic from '@anthropic-ai/sdk'

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

PLAYBOOK GUIDANCE:
- If asked about playbook progress, reference the specific day and activities
- If a day was missed, suggest reviewing the previous session before continuing
- Connect playbook work to the player's overall development
- Encourage consistency but be flexible with timing
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

  return `You are Bench Coach, an expert youth baseball coaching assistant. You help volunteer coaches plan practices, solve problems, and develop their players.

CRITICAL INSTRUCTIONS:
1. Give age-appropriate, practical advice
2. Always provide specific drills with setup, coaching cues, and common mistakes
3. Use the provided team context - do not invent details
4. Keep answers concise but complete
5. Speak like an experienced coach, not a textbook
6. Focus on what matters at this age level
7. Prioritize current focus areas over mastered skills in practice plans
8. Build on improved areas to help them become mastered
9. Reference active playbooks when relevant to the question
10. Be aware of the team's full context including notes, players, and training programs
11. USE THE DEVELOPMENT JOURNAL DATA - when asked about a player, reference their recent lessons, what went well, what needs work, and suggested home drills
12. Connect advice to what instructors have been working on with the player

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

USING DEVELOPMENT JOURNAL DATA:
When the coach asks about a specific player:
- Reference their recent lessons and training sessions
- Note what instructors have been working on with them
- Highlight what's going well (celebrate wins!)
- Focus advice on areas that still need work
- Suggest home drills that reinforce recent lessons
- Track patterns across multiple sessions (e.g., "I see throwing mechanics has been a focus in the last 3 lessons")

Example: If asked "What should Charlie work on this week?", look at his journal entries and say something like:
"Based on Charlie's recent lesson with Coach Smith, he's making good progress on his load timing but still needs work on keeping his head still through contact. I'd suggest continuing the tee work focusing on contact point that was assigned as homework."

USING SKILL RATINGS:
Players have skill ratings from 1-5 (Beginner, Developing, Intermediate, Advanced, Expert) in these areas:
- Hitting, Throwing, Fielding, Pitching, Baserunning, Coachability

When giving advice:
- Tailor drill difficulty to their skill level (don't suggest advanced drills for beginners)
- Identify skill gaps (e.g., "Charlie's hitting is Intermediate but throwing is still Developing")
- Suggest focusing practice time on weaker areas
- For high coachability players, you can push them harder with complex drills
- For lower coachability, suggest fun, game-based activities to keep engagement high

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

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemPrompt,
      messages: messages,
    })

    const fullContent = response.content[0].type === 'text' 
      ? response.content[0].text 
      : ''

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
  } catch (error) {
    console.error('Claude API error:', error)
    throw new Error('Failed to generate response')
  }
}

export async function generatePracticePlan(
  duration: number,
  focus: string[],
  context: TeamContext,
  constraints?: string
): Promise<any> {
  try {
    const prompt = `Create a ${duration}-minute practice plan for a ${context.team.age_group} ${context.team.skill_level} team.

Focus areas: ${focus.join(', ')}
${constraints ? `Constraints: ${constraints}` : ''}

Team context:
- Currently working on: ${context.team.primary_goals.length > 0 ? context.team.primary_goals.join(', ') : 'Not specified'}
- Areas showing improvement: ${context.team.improved_areas && context.team.improved_areas.length > 0 ? context.team.improved_areas.join(', ') : 'None yet'}
- Mastered skills (lighter maintenance): ${context.team.mastered_areas && context.team.mastered_areas.length > 0 ? context.team.mastered_areas.join(', ') : 'None yet'}
${context.teamNotes.length > 0 ? `- Current issues: ${context.teamNotes.map(n => n.note).join('; ')}` : ''}

Create a practice plan with time blocks that includes:
1. Warm-up (age-appropriate)
2. 3 stations or drills focused on the goals
3. Game-like activity or competition
4. Cool-down / reflection

Prioritize the focus areas and current work-on items. For improved areas, include challenging progressions. For mastered areas, only light maintenance if relevant.

For each block, include:
- Time allocation
- Setup instructions
- Coaching cues (what to say)
- Common mistakes to watch for
- Adjustments for different skill levels

Format as JSON with this structure:
{
  "title": "Practice Plan Title",
  "blocks": [
    {
      "type": "warmup|drill|station|game|cooldown",
      "title": "Block Title",
      "minutes": 10,
      "description": "What we're doing",
      "setup": "How to set it up",
      "coaching_cues": ["Cue 1", "Cue 2"],
      "common_mistakes": ["Mistake 1", "Mistake 2"],
      "adjustments": "How to make easier/harder"
    }
  ]
}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      system: 'You are an expert youth baseball coach creating practice plans. Always return valid JSON.',
      messages: [{ role: 'user', content: prompt }],
    })

    const content = response.content[0].type === 'text' 
      ? response.content[0].text 
      : ''

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0])
    }

    throw new Error('Failed to parse practice plan')
  } catch (error) {
    console.error('Practice plan generation error:', error)
    throw new Error('Failed to generate practice plan')
  }
}
