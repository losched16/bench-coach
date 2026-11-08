// The Anthropic adapter for the optional enrichment layer. Kept apart so the
// rest of lib/programs has no SDK import and tests inject a stub.
//
// Logging: token counts and timing only. Prompts contain a child's details
// and are never logged.

import { claude } from '../claudeClient'
import { textFrom } from '../claudeText'
import type { ModelCaller } from './author'

export function anthropicCaller(): ModelCaller | null {
  if (!process.env.ANTHROPIC_API_KEY) return null
  return async ({ system, user, maxTokens }) => {
    const t0 = Date.now()
    const stream = claude.messages.stream({
      model: 'claude-sonnet-5',
      // Thinking and the JSON share this budget (see lib/anthropic.ts).
      max_tokens: Math.max(maxTokens, 6000),
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { effort: 'low' },
    })
    const res = await stream.finalMessage()
    console.log(`[programs] model call ${Date.now() - t0}ms in=${res.usage?.input_tokens ?? '?'} out=${res.usage?.output_tokens ?? '?'}`)
    return { text: textFrom(res), inputTokens: res.usage?.input_tokens ?? 0, outputTokens: res.usage?.output_tokens ?? 0 }
  }
}
