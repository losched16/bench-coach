// One Anthropic client, configured once, and one way to describe a failure.
//
// This exists because of a 529 a coach saw with their own eyes. Uploading
// scouting screenshots returned, verbatim, to the screen:
//
//   529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"},"request_id":"req_..."}
//
// Two separate faults, and neither of them was the screenshots.
//
// FAULT ONE: NOT ENOUGH RETRIES. A 529 is Anthropic saying "we are at capacity
// right now" — transient, not caused by anything in the request, and the
// correct response is to wait and ask again. Thirteen files each built their
// own `new Anthropic()` and every one took the SDK default of two retries.
// Two quick attempts during a busy period is not enough, and there was no
// single place to change it.
//
// FAULT TWO: THE RAW BODY REACHED A COACH. On an Anthropic APIError,
// `error.message` IS the response body — so every `error.message || 'Failed'`
// in the codebase (there were forty) is a leak waiting for the right upstream
// error. A parent trying to log an opponent's box score at 9pm should be told
// "their servers are busy, try again in a minute", not handed a request id.
//
// scripts/verify-claude-calls.mjs fails the build if a route constructs its
// own client, because thirteen copies is how the retry setting got lost in the
// first place.

import Anthropic from '@anthropic-ai/sdk'

/**
 * The client every surface uses.
 *
 * maxRetries covers 408, 409, 429 and every 5xx — which is exactly the set
 * that is worth trying again — with exponential backoff and jitter handled by
 * the SDK. Five rather than the default two: an overloaded_error clears in
 * seconds, and the difference between a coach seeing a plan and a coach seeing
 * an error is usually one more attempt. The backoff tops out around 8s per
 * gap, so the worst case stays inside the routes' maxDuration.
 */
export const claude = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
  maxRetries: 5,
})

export interface ClaudeFailure {
  /** What to show a coach. Never contains a request id or a JSON body. */
  message: string
  /** Is trying the same thing again a reasonable suggestion? */
  retryable: boolean
  /** What the route should return. 503 for "come back in a moment". */
  status: number
}

/**
 * Turn whatever the SDK threw into something worth showing someone — or say
 * this is not mine.
 *
 * Returns null when the error carries no sign of being an upstream AI failure,
 * because most routes catch Supabase errors in the same block and those
 * messages are genuinely useful ("column does not exist" is worth reading).
 * Swallowing them behind "something went wrong talking to the AI service"
 * would trade one bad error message for another.
 *
 * Deliberately does NOT pass the upstream text through. It is either a JSON
 * body (useless and alarming) or an internal detail. The real error still goes
 * to the server log — `logClaudeFailure` below — so debugging loses nothing.
 */
export function describeClaudeFailure(error: any): ClaudeFailure | null {
  const status: number | undefined = error?.status ?? error?.statusCode
  const type: string | undefined = error?.error?.error?.type ?? error?.error?.type

  const looksUpstream =
    typeof status === 'number' ||
    typeof type === 'string' ||
    error?.name === 'APIConnectionError' ||
    error?.name === 'APIConnectionTimeoutError'
  if (!looksUpstream) return null

  // Capacity. The one the coach hit, and the one most worth wording kindly:
  // nothing they did caused it and nothing they change will fix it.
  if (status === 529 || type === 'overloaded_error') {
    return {
      message:
        'The AI service is busy right now — this is on their end, not yours, and it ' +
        'usually clears within a minute. Your upload is still here, so just try again.',
      retryable: true,
      status: 503,
    }
  }

  if (status === 429 || type === 'rate_limit_error') {
    return {
      message:
        'We are sending requests faster than our limit allows. Wait about a minute ' +
        'and try again — nothing you did is wrong.',
      retryable: true,
      status: 503,
    }
  }

  // 500/502/503/504 upstream, or a socket that died mid-request.
  if ((status && status >= 500) || error?.name === 'APIConnectionError' ||
      error?.name === 'APIConnectionTimeoutError') {
    return {
      message:
        'The AI service did not respond. That is usually temporary — try again in a moment.',
      retryable: true,
      status: 503,
    }
  }

  // Ours, not theirs. A coach can do nothing about either of these, so say so
  // rather than inviting them to retry forever.
  if (status === 401 || status === 403 || type === 'authentication_error') {
    return {
      message:
        'BenchCoach could not reach the AI service — that is a configuration problem ' +
        'on our side. Please let us know if it keeps happening.',
      retryable: false,
      status: 502,
    }
  }

  if (status === 413 || type === 'request_too_large') {
    return {
      message:
        'That was too much at once. Try fewer screenshots, or a smaller image, and ' +
        'send them in two goes.',
      retryable: false,
      status: 413,
    }
  }

  if (status === 400 || type === 'invalid_request_error') {
    return {
      message:
        'The AI service could not read what we sent. If this was a screenshot, try a ' +
        'clearer one or a different format (PNG or JPG).',
      retryable: false,
      status: 400,
    }
  }

  // An upstream error with a status we have no special case for.
  return {
    message: 'Something went wrong talking to the AI service. Try again in a moment.',
    retryable: true,
    status: 502,
  }
}

/**
 * The full truth, to the server log, where it belongs.
 *
 * Includes the request id when there is one — that is the thing worth having
 * when reporting an upstream problem, and the thing a coach should never be
 * shown.
 */
export function logClaudeFailure(surface: string, error: any): void {
  const status = error?.status ?? error?.statusCode
  const requestId = error?.request_id ?? error?.requestID
  console.error(
    `[claude:${surface}] ${status || error?.name || 'error'}` +
    `${requestId ? ` request_id=${requestId}` : ''}: ${error?.message || error}`
  )
}
