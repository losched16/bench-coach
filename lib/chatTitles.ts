// Naming a conversation.
//
// A sidebar full of "New chat" is a sidebar nobody uses. The title is the only
// thing a coach has to go on when they come back Thursday looking for the
// pitching conversation, so it has to say what the chat was actually about.
//
// The first message is enough — someone opens a chat to ask one thing. Later
// turns drift, and a title that keeps changing is worse than one that's
// slightly stale, because the coach is scanning for a label they remember.

import { textFrom } from './claudeText'
import { claude as anthropic } from '@/lib/claudeClient'

export const MAX_TITLE_LENGTH = 48

/**
 * Truncated first message. Always available, never fails, and honestly not bad
 * — which is what makes it the right fallback rather than "New chat".
 */
export function fallbackTitle(firstMessage: string): string {
  const clean = firstMessage.replace(/\s+/g, ' ').trim()
  if (!clean) return 'New chat'
  if (clean.length <= MAX_TITLE_LENGTH) return clean
  // Cut at a word boundary so it doesn't end mid-word.
  const cut = clean.slice(0, MAX_TITLE_LENGTH)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 20 ? cut.slice(0, lastSpace) : cut) + '…'
}

/**
 * A short label for the conversation. Haiku, tiny budget, one sentence in and
 * a few words out — the cheapest call in the app.
 *
 * Never throws. A titling failure must not cost the coach their answer, so
 * every error path lands on the truncated first message.
 */
export async function generateChatTitle(firstMessage: string): Promise<string> {
  const fallback = fallbackTitle(firstMessage)
  if (!process.env.ANTHROPIC_API_KEY) return fallback

  try {
    const response = await anthropic.messages.create({
      // Pre-4.6, so no thinking to budget around — this stays fast and cheap.
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 40,
      system:
        'You name youth baseball coaching conversations. Reply with a title of 2 to 5 words ' +
        'naming the specific baseball topic, and nothing else. No quotes, no punctuation at the end, ' +
        'no "How to" or "Question about" preamble. Examples: "Outfield reads and routes", ' +
        '"Pitch count limits", "Fixing an uppercut swing".',
      messages: [{ role: 'user', content: firstMessage.slice(0, 1000) }],
    })

    const title = textFrom(response)
      .replace(/^["'`]+|["'`.]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    // A model that ignored the instruction and wrote a sentence is worse than
    // the truncated message, so only take it if it looks like a title.
    if (!title || title.length > MAX_TITLE_LENGTH) return fallback
    return title
  } catch (error) {
    console.warn('Chat title generation failed, using the first message:', (error as any)?.message)
    return fallback
  }
}
