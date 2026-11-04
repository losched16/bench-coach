// Pure rules for Academy drill videos (no I/O), so they can be unit tested.
import type { DrillMedia } from '@/lib/drillMedia'
import { videoIdFor, parseVideoId, parseStartFromUrl } from '@/lib/drillVideo'

export interface LessonDrillVideo {
  drillName: string
  youtubeVideoId: string
  thumbnailUrl: string | null
  channel: string | null
  startSeconds: number | null
}

export type Approval = 'candidate' | 'approved' | 'rejected' | 'retired'

/** The YouTube id for a library drill: its own columns first, then a YouTube media row. Null = no usable video. */
export function youtubeIdFor(drill: Record<string, any> | null | undefined, media: DrillMedia[] | null | undefined): string | null {
  const own = videoIdFor(drill as any)
  if (own) return own
  const row = (media || []).filter(m => m.media_type === 'youtube' && m.verification_status !== 'rejected' && m.external_id)
    .sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))[0]
  return row?.external_id ? String(row.external_id) : null
}

/** Why an approval must be refused, or null if it may go ahead. */
export function approvalError(input: {
  reviewer: unknown; watched: unknown; hasVideo: boolean; sharedBy: number; startSeconds: number | null; acceptCompilation: unknown
}): string | null {
  if (!input.hasVideo) return 'That video is not available on YouTube (or the library drill has none).'
  if (typeof input.reviewer !== 'string' || input.reviewer.trim().length < 2) return 'Enter the reviewer’s name.'
  if (input.watched !== true) return 'Approval means a person watched the whole video. Confirm that you did.'
  if (input.sharedBy > 1 && input.startSeconds == null && input.acceptCompilation !== true)
    return `This video is used by ${input.sharedBy} library drills (a compilation). Enter the start time of this drill, or confirm that opening it at the beginning is right.`
  return null
}

export function parseStart(v: unknown): number | null | 'invalid' {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) && n >= 0 && n <= 36000 ? n : 'invalid'
}


/** A lesson's drill label is "Drill A" in the manuscript; mappings key on the letter alone. */
export function drillLetter(label: unknown): string | null {
  const m = /^(?:Drill\s+)?([A-Z])$/.exec(String(label ?? '').trim())
  return m ? m[1] : null
}

/**
 * A YouTube link the owner pasted: the video id and any start time already in the link.
 * Only real YouTube watch / share / embed / shorts links count. Anything else (another site,
 * a script URL, plain text) returns null, so it can never become a mapping.
 */
export function parseYoutubeInput(input: unknown): { videoId: string; start: number | null } | null {
  const s = String(input ?? '').trim()
  if (!/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(s)) return null
  const videoId = parseVideoId(s)
  if (!videoId) return null
  const start = parseStartFromUrl(s)
  return { videoId, start: start > 0 ? start : null }
}
