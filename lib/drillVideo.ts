// Where a drill's video should open.
//
// A good part of the library is anchored to compilation videos. One row is
// literally "10 Best Baseball Throwing Drills for Kids"; another nineteen rows
// share a single pitching video. Opening those at 0:00 and calling it a drill
// recommendation is how a practice plan starts feeling like a folder of
// general YouTube links — the coach taps "Low Tee", gets a twelve-minute
// compilation starting at the presenter's introduction, and has to go find the
// bit you meant.
//
// WHY THIS FILE EXISTS AT ALL
//
// The timestamp column (youtube_start_seconds, migration 036) has been in the
// schema and in DRILL_FIELDS the whole time. It was reaching exactly two of
// the ten places that render a video, because every other surface built its
// own URL:
//
//     href={d.youtube_url || `https://www.youtube.com/watch?v=${d.youtube_video_id}`}
//
// Written out eight times, in eight files. Note what it does: it prefers the
// STORED URL, which has no timestamp in it. So even a fully curated
// youtube_start_seconds would have been ignored by six of the seven links a
// coach can actually click, including both of chat's.
//
// That is the real defect this phase fixes. Timestamps are data and can be
// added later by anyone; a codebase where adding them only works in two of ten
// places is a bug that would have quietly wasted the curation effort.
//
// scripts/verify-video-links.mjs fails the build if a surface constructs a
// YouTube URL by hand again, because "remember to use the helper" has never
// once been a control that holds.

export interface VideoDrill {
  youtube_video_id?: string | null
  youtube_url?: string | null
  thumbnail_url?: string | null
  youtube_start_seconds?: number | null
  [key: string]: any
}

/**
 * The eleven-character id, from the column or dug out of a stored URL.
 *
 * A coach adding their own drill pastes a URL, and it may be any of the four
 * shapes YouTube hands out depending on which button they used.
 */
export function videoIdFor(drill: VideoDrill | null | undefined): string | null {
  if (!drill) return null
  const direct = String(drill.youtube_video_id || '').trim()
  if (direct) return direct
  return parseVideoId(drill.youtube_url)
}

const ID = '([A-Za-z0-9_-]{11})'
const URL_SHAPES = [
  new RegExp(`youtube\\.com/watch\\?(?:.*&)?v=${ID}`),
  new RegExp(`youtu\\.be/${ID}`),
  new RegExp(`youtube\\.com/embed/${ID}`),
  new RegExp(`youtube\\.com/shorts/${ID}`),
]

export function parseVideoId(url: string | null | undefined): string | null {
  const s = String(url || '')
  if (!s) return null
  for (const re of URL_SHAPES) {
    const m = s.match(re)
    if (m) return m[1]
  }
  return null
}

/**
 * The start time already inside a URL, in seconds.
 *
 * Chat does not render from drill rows. It reads the answer the model wrote,
 * finds YouTube links in the prose and embeds them — so the only place a
 * timestamp can reach chat's player is the URL itself, and the previous
 * version threw it away. Handles `t=90`, `t=90s`, `t=1m30s` and `start=90`,
 * which are the shapes YouTube's own share button produces.
 */
export function parseStartFromUrl(url: string | null | undefined): number {
  const s = String(url || '')
  const m = s.match(/[?&](?:t|start)=([0-9hms]+)/i)
  if (!m) return 0
  const v = m[1]
  if (/^\d+s?$/.test(v)) return Math.floor(Number(v.replace('s', '')))
  const hms = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/i)
  if (!hms || (!hms[1] && !hms[2] && !hms[3])) return 0
  return Number(hms[1] || 0) * 3600 + Number(hms[2] || 0) * 60 + Number(hms[3] || 0)
}

/**
 * Where this drill starts, in whole seconds, or 0 for "the beginning".
 *
 * Everything unusable collapses to 0 rather than being passed through:
 * null, undefined, negative, NaN and Infinity all mean "no segment known".
 * A negative or non-finite value in a `start=` parameter does not degrade
 * gracefully — YouTube fails the whole embed rather than ignoring it.
 */
export function startSecondsFor(drill: VideoDrill | null | undefined): number {
  const raw = drill?.youtube_start_seconds
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return 0
  return Math.floor(raw)
}

/** Does this drill claim a specific segment rather than the whole video? */
export function hasSegment(drill: VideoDrill | null | undefined): boolean {
  return startSecondsFor(drill) > 0
}

/**
 * The link a coach taps to watch this drill on YouTube.
 *
 * Prefers a stored youtube_url when there is one, because a coach's own drill
 * may point somewhere the id alone cannot express — but always re-stamps the
 * time parameter from youtube_start_seconds, which is the thing the old
 * inline version got wrong.
 *
 * A drill with no start_seconds and a stored URL is returned untouched, so a
 * coach who pasted their own `?t=90` link keeps it.
 */
export function watchUrl(drill: VideoDrill | null | undefined): string | null {
  const id = videoIdFor(drill)
  const stored = String(drill?.youtube_url || '').trim()
  if (!id && !stored) return null

  const start = startSecondsFor(drill)
  const base = stored || `https://www.youtube.com/watch?v=${id}`
  if (start <= 0) return base

  // Replace any existing t=, rather than appending a second one. A URL with
  // two time parameters is not merely untidy — YouTube honours the first.
  const stripped = base
    .replace(/([?&])t=[^&]*(&|$)/, (_m, p1, p2) => (p2 ? p1 : ''))
    .replace(/[?&]$/, '')
  const sep = stripped.includes('?') ? '&' : '?'
  return `${stripped}${sep}t=${start}s`
}

/**
 * The src for an inline player.
 *
 * youtube-nocookie because these are embedded on pages parents open on a
 * phone, and there is no reason for this product to set advertising cookies on
 * their behalf. It honours `start` identically to youtube.com.
 */
export function embedUrl(
  drill: VideoDrill | null | undefined,
  opts: { autoplay?: boolean } = {}
): string | null {
  const id = videoIdFor(drill)
  if (!id) return null
  const params = ['rel=0']
  const start = startSecondsFor(drill)
  if (start > 0) params.push(`start=${start}`)
  if (opts.autoplay) params.push('autoplay=1')
  return `https://www.youtube-nocookie.com/embed/${id}?${params.join('&')}`
}

/**
 * The still image.
 *
 * Not segment-aware: YouTube only serves thumbnails at fixed positions, so a
 * drill starting at 4:12 still shows the video's cover frame. Worth knowing
 * rather than worth faking — a wrong frame is more confusing than a generic
 * one.
 */
export function thumbnailUrl(
  drill: VideoDrill | null | undefined,
  quality: 'mq' | 'hq' = 'hq'
): string | null {
  const stored = String(drill?.thumbnail_url || '').trim()
  if (stored) return stored
  const id = videoIdFor(drill)
  if (!id) return null
  return `https://img.youtube.com/vi/${id}/${quality}default.jpg`
}

/** Does this drill have a video at all? */
export function hasVideo(drill: VideoDrill | null | undefined): boolean {
  return videoIdFor(drill) != null
}

// ---------------------------------------------------------------------------
// Human-readable time, both directions
//
// Curation happens by a person watching a video and writing down "4:12". These
// two are what turn that into a number and back, and they are here rather than
// in a script because the display side needs the same formatting.
// ---------------------------------------------------------------------------

/** 252 -> "4:12".  3725 -> "1:02:05". */
export function formatTimestamp(seconds: number | null | undefined): string {
  const s = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
    ? Math.floor(seconds) : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`
}

/**
 * "4:12" -> 252.  "1:02:05" -> 3725.  "252" -> 252.
 *
 * Returns null for anything it does not understand, rather than a plausible
 * wrong number. This parses hand-typed curation input, and silently reading
 * "4:1x" as 4 minutes would put a drill at the wrong place in a video with
 * nothing to show that it happened.
 */
export function parseTimestamp(input: string | number | null | undefined): number | null {
  if (typeof input === 'number') {
    return Number.isFinite(input) && input >= 0 ? Math.floor(input) : null
  }
  const s = String(input ?? '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return Number(s)
  const m = s.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = m[1] ? Number(m[1]) : 0
  const min = Number(m[2])
  const sec = Number(m[3])
  if (sec > 59 || (m[1] && min > 59)) return null
  return h * 3600 + min * 60 + sec
}
