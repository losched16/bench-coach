// Getting the text out of a Claude response.
//
// This exists because of a bug that took down the chat silently.
//
// Every call in this codebase used to read `response.content[0].text`. That was
// correct for years: the first block in a non-streaming response was the text.
// On Claude Sonnet 5 and Opus 5 it is not. Those models run thinking by default
// when the request omits a `thinking` field, and `thinking.display` defaults to
// "omitted" — so `content[0]` is a thinking block whose text is empty, and the
// real answer is in `content[1]`.
//
// The failure mode is the dangerous kind. No exception, no 500, no log line.
// `content[0].type === 'text'` is simply false, the ternary yields '', and an
// empty assistant message gets saved to the database and rendered as a blank
// bubble. Chat looked like it was working and returning nothing.
//
// So: never index into content. Find the text blocks and join them.

interface TextBlock { type: 'text'; text: string }
interface AnyBlock { type: string; [k: string]: any }
interface AnyMessage { content: AnyBlock[]; stop_reason?: string | null }

/**
 * All text from a Claude response, joined. Returns '' if the model produced
 * no text at all (refusal, pure tool use, or thinking that hit max_tokens).
 */
export function textFrom(response: AnyMessage): string {
  if (!response?.content || !Array.isArray(response.content)) return ''
  return response.content
    .filter((b): b is TextBlock => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text)
    .join('\n')
    .trim()
}

/**
 * Same, but throws when there is nothing — for surfaces where an empty answer
 * is a failure rather than a valid result. The message names the actual cause
 * so the next person doesn't have to rediscover any of the above.
 */
export function requireText(response: AnyMessage, what = 'response'): string {
  const text = textFrom(response)
  if (text) return text

  const kinds = (response?.content || []).map(b => b?.type).join(', ') || 'nothing'
  // max_tokens with thinking on is the likeliest cause of an empty result:
  // thinking tokens count against the budget, so a limit that was generous
  // before can now be spent before the answer starts.
  const truncated = response?.stop_reason === 'max_tokens'
    ? ' The response hit its token limit before any text was produced — raise max_tokens.'
    : ''
  throw new Error(`Claude returned no text for the ${what} (blocks: ${kinds}).${truncated}`)
}
