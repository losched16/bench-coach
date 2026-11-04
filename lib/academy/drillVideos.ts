// Academy drill videos: a lesson drill ("Drill A") points at one drill in the BenchCoach library,
// and the lesson plays that drill's YouTube video the way the development plans do.
//
// Rules this file keeps:
//  * Only APPROVED mappings reach a learner. Approval needs a named reviewer, a date, and the
//    owner's statement that they watched the video (enforced in the admin API and in the table).
//  * Nothing here copies drill text. Only the video fields of the library row are read.
//  * A library video shared by several drills is a compilation. Without a start time it opens at
//    0:00 of something covering other drills, so approving it needs the owner to say so on purpose.
//  * Missing table (migration 083 not applied), missing drill, or a drill with no YouTube video
//    all mean "no video", never an error on the lesson page.

import { adminDb } from './server'
import { loadMediaFor } from '@/lib/drillMedia'
import { youtubeIdFor, type LessonDrillVideo } from './drillVideoRules'

/** Approved video for each drill label in one lesson. Empty object when there is none. */
export async function getLessonDrillVideos(courseId: string, lessonKey: string): Promise<Record<string, LessonDrillVideo>> {
  const db = adminDb()
  // Migration 084 adds pasted videos. Until it is applied the new columns do not exist, so fall back to the 083 shape.
  let q: any = await db.from('academy_drill_videos')
    .select('drill_label, drill_id, start_seconds, approval_status, youtube_video_id, title, channel')
    .eq('course_id', courseId).eq('lesson_key', lessonKey).eq('approval_status', 'approved')
  if (q.error) {
    q = await db.from('academy_drill_videos')
      .select('drill_label, drill_id, start_seconds, approval_status')
      .eq('course_id', courseId).eq('lesson_key', lessonKey).eq('approval_status', 'approved')
  }
  const { data: maps, error } = q
  if (error || !maps?.length) return {}
  const out: Record<string, LessonDrillVideo> = {}
  const rows = (maps as any[]).filter(m => m.approval_status === 'approved')
  const mediaById = await loadMediaFor(db, rows.map(m => m.drill_id))
  for (const m of rows) {
    // A pasted YouTube video: the id was checked with YouTube when it was saved and again when approved.
    if (m.youtube_video_id && /^[A-Za-z0-9_-]{11}$/.test(m.youtube_video_id)) {
      out[m.drill_label] = { drillName: String(m.title || ''), youtubeVideoId: m.youtube_video_id, thumbnailUrl: null, channel: m.channel || null, startSeconds: m.start_seconds ?? null }
      continue
    }
    if (!m.drill_id) continue
    const { data: drill } = await db.from('drill_resources')
      .select('id, drill_name, youtube_video_id, youtube_url, thumbnail_url, channel, youtube_start_seconds, status')
      .eq('id', m.drill_id).maybeSingle()
    const d = drill as any
    if (!d || (d.status && d.status !== 'approved')) continue
    const id = youtubeIdFor(d, mediaById.get(String(m.drill_id)))
    if (!id) continue
    const start = m.start_seconds ?? (Number.isInteger(d.youtube_start_seconds) && d.youtube_start_seconds >= 0 ? d.youtube_start_seconds : null)
    out[m.drill_label] = { drillName: String(d.drill_name || ''), youtubeVideoId: id, thumbnailUrl: d.thumbnail_url || null, channel: d.channel || null, startSeconds: start }
  }
  return out
}
