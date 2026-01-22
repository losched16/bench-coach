import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

export interface TeamContext {
  team: {
    name: string
    age_group: string
    skill_level: string
    practice_duration_minutes: number
    primary_goals: string[]
  }
  coachPreferences: Record<string, string>
  teamNotes: Array<{ note: string; pinned: boolean }>
  players: Array<{
    name: string
    positions?: string[]
    notes?: string[]
    traits?: string[]
  }>
  recentPlans?: string[]
  memorySummary?: string
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

function buildSystemPrompt(context: TeamContext): string {
  return `You are Bench Coach, an expert youth baseball coaching assistant. You help volunteer coaches plan practices, solve problems, and develop their players.

CRITICAL INSTRUCTIONS:
1. Give age-appropriate, practical advice
2. Always provide specific drills with setup, coaching cues, and common mistakes
3. Use the provided team context - do not invent details
4. Keep answers concise but complete
5. Speak like an experienced coach, not a textbook
6. Focus on what matters at this age level

CURRENT TEAM CONTEXT:
- Team: ${context.team.name}
- Age Group: ${context.team.age_group}
- Skill Level: ${context.team.skill_level}
- Practice Duration: ${context.team.practice_duration_minutes} minutes
- Primary Goals: ${context.team.primary_goals.join(', ')}

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

${context.players && context.players.length > 0 ? `
NOTABLE PLAYERS:
${context.players.slice(0, 5).map(p => `- ${p.name}${p.positions ? ` (${p.positions.join('/')})` : ''}${p.notes ? `: ${p.notes[0]}` : ''}`).join('\n')}
` : ''}

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
- ${context.team.primary_goals.join(', ')} are team goals
${context.teamNotes.length > 0 ? `- Current issues: ${context.teamNotes.map(n => n.note).join('; ')}` : ''}

Create a practice plan with time blocks that includes:
1. Warm-up (age-appropriate)
2. 3 stations or drills focused on the goals
3. Game-like activity or competition
4. Cool-down / reflection

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
