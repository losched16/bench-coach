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

USING PRACTICE RECAPS:
When the coach asks about what to work on, what went well, or how practice is going:
- Reference recent practice recaps to give informed advice
- Repeat and build on what worked well
- Avoid or modify drills/activities that didn't work
- Honor the coach's stated "next focus" areas
- Note player callouts — celebrate positives, address concerns
- Factor in energy levels and attendance patterns

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
  constraints?: string,
  drillResources?: any[]
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
  `- "${d.drill_name}" (${d.skill_category}, ${d.difficulty_level || 'all levels'}, Ages: ${d.age_range || 'all'})
     ${d.youtube_video_id ? `youtube_video_id: "${d.youtube_video_id}"` : ''}
     ${d.channel ? `Channel: ${d.channel}` : ''}
     ${d.description || ''}
     ${d.mechanic_focus?.length ? `Mechanics: ${d.mechanic_focus.join(', ')}` : ''}
     ${d.common_flaws_fixed?.length ? `Fixes: ${d.common_flaws_fixed.join(', ')}` : ''}
     ${d.equipment_needed?.length ? `Equipment: ${d.equipment_needed.join(', ')}` : ''}
     ${d.ai_coaching_notes || ''}`
).join('\n')}

CRITICAL: When you use a drill from the library, you MUST copy the exact "drill_name" and "youtube_video_id" into your JSON output. Do NOT make up video IDs.`
    }

    const prompt = `Create a ${duration}-minute practice plan for a ${context.team.age_group} ${context.team.skill_level} team.

Focus areas: ${focus.join(', ')}
${constraints ? `Constraints: ${constraints}` : ''}

Team context:
- Currently working on: ${context.team.primary_goals.length > 0 ? context.team.primary_goals.join(', ') : 'Not specified'}
- Areas showing improvement: ${context.team.improved_areas && context.team.improved_areas.length > 0 ? context.team.improved_areas.join(', ') : 'None yet'}
- Mastered skills (lighter maintenance): ${context.team.mastered_areas && context.team.mastered_areas.length > 0 ? context.team.mastered_areas.join(', ') : 'None yet'}
${context.teamNotes.length > 0 ? `- Current issues: ${context.teamNotes.map(n => n.note).join('; ')}` : ''}
${drillLibrarySection}

Create a DETAILED practice plan. This is for volunteer coaches who may have never coached before — they need step-by-step instructions they can follow like a recipe.

Structure:
1. Warm-up (age-appropriate, dynamic — not just jogging)
2. 2-4 focused drill blocks based on focus areas
3. Game-like activity or competition that reinforces the skills practiced
4. Cool-down / team talk

DETAIL REQUIREMENTS FOR EVERY BLOCK:
- "detailed_instructions": Write 4-8 numbered steps explaining EXACTLY how to run this drill. Include player positioning, distances, repetitions, timing, and transitions. A first-time coach should be able to read this and run the drill perfectly.
- "coaching_cues": Give 4-6 SPECIFIC phrases the coach should say OUT LOUD during the drill. Not generic ("Nice job!") but technical ("Squeeze the glove shut like you're catching an egg", "Step toward your target with your front foot pointing at them", "Get your glove below the ball and scoop up").
- "common_mistakes": List 3-5 specific mistakes you'll see, with the CORRECTION for each. Format: "Mistake — Correction" (e.g., "Throwing with just the arm — Have them point their front shoulder at the target and step with the opposite foot")
- "setup": Exactly what equipment is needed and how to arrange players/cones/bases.
- "equipment": List of equipment needed for this block.
- "drill_variations": How to make it easier for struggling players AND harder for advanced players.
- "success_indicators": 2-3 observable signs that players are doing the drill correctly.

If a drill from the DRILL VIDEO LIBRARY matches what you're recommending, include:
- "youtube_video_id": The exact video ID from the library
- "youtube_channel": The channel name
- "drill_name": The exact drill name from the library

Format as JSON:
{
  "title": "Practice Plan Title",
  "blocks": [
    {
      "type": "warmup|drill|station|game|cooldown",
      "title": "Block Title",
      "minutes": 10,
      "description": "One-sentence overview of this block",
      "detailed_instructions": "1. Line players up in two lines facing each other, about 15 feet apart...\\n2. Each player needs a glove and one ball per pair...\\n3. Start with 5 wrist-flick throws (elbow on glove, flick only)...\\n4. Back up to 25 feet and throw 10 full throws focusing on stepping toward partner...\\n(continue with specific steps)",
      "setup": "Equipment and field arrangement details",
      "equipment": ["baseballs", "gloves", "cones"],
      "coaching_cues": ["Specific technical phrase 1", "Specific technical phrase 2"],
      "common_mistakes": ["Mistake — Correction", "Mistake — Correction"],
      "drill_variations": "Easier: ... Harder: ...",
      "success_indicators": ["What good execution looks like"],
      "youtube_video_id": "abc123 (only if from drill library)",
      "youtube_channel": "Channel Name (only if from drill library)",
      "drill_name": "Exact Drill Name (only if from drill library)"
    }
  ]
}`

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 6000,
      system: `You are an expert youth baseball coach who has coached thousands of practices across all age groups. You create incredibly detailed, actionable practice plans that a first-time volunteer parent-coach can follow step by step. You know that most youth coaches are dads and moms who volunteered — they need SPECIFIC instructions, not vague suggestions. Every drill should be explained like a recipe: exact setup, exact steps, exact words to say. Always return valid JSON.`,
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
