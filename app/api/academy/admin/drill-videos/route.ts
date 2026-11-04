import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/authz'
import { adminDb, listLessonDrills } from '@/lib/academy/server'
import { isCourseSlug, isLessonKey } from '@/lib/academy/catalog'
import { approvalError, parseStart, parseYoutubeInput, youtubeIdFor } from '@/lib/academy/drillVideoRules'
import { checkYoutubeVideo } from '@/lib/academy/youtubeCheck'
import { loadMediaFor } from '@/lib/drillMedia'

// The owner's tool for putting a library video under an Academy lesson drill.
// GET  ?course=slug            the lesson drills and their mappings
// GET  ?course=slug&q=text     search the curated drill library (names and video facts only)
// POST map | approve | reject | retire | unmap
// Nothing here is visible to a learner until a mapping is APPROVED with a reviewer name, a date and
// the owner's statement that they watched the video. The owner is the only caller.
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function courseId(slug: unknown): Promise<string | null> {
  if (!isCourseSlug(slug)) return null
  const { data } = await adminDb().from('academy_courses').select('id').eq('slug', slug).maybeSingle()
  return (data as any)?.id ?? null
}

async function sharedBy(videoId: string): Promise<number> {
  const { data } = await adminDb().from('drill_resources').select('id').eq('youtube_video_id', videoId).limit(50)
  return (data || []).length
}

async function libraryFacts(drillId: string) {
  const db = adminDb()
  const { data } = await db.from('drill_resources').select('id, drill_name, youtube_video_id, youtube_url, thumbnail_url, channel, youtube_start_seconds, status').eq('id', drillId).maybeSingle()
  const d = data as any
  if (!d) return null
  const media = await loadMediaFor(db, [drillId])
  const videoId = youtubeIdFor(d, media.get(drillId))
  return { id: d.id as string, name: String(d.drill_name || ''), videoId, channel: d.channel ?? null, libraryStart: Number.isInteger(d.youtube_start_seconds) ? d.youtube_start_seconds : null, retired: !!d.status && d.status !== 'approved', sharedBy: videoId ? await sharedBy(videoId) : 0 }
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const id = await courseId(request.nextUrl.searchParams.get('course'))
  if (!id) return NextResponse.json({ error: 'Unknown course.' }, { status: 404 })

  const q = request.nextUrl.searchParams.get('q')
  if (q !== null) {
    const term = q.replace(/[^A-Za-z0-9 '’-]/g, ' ').trim().slice(0, 60)
    if (term.length < 2) return NextResponse.json({ results: [] })
    const { data } = await adminDb().from('drill_resources')
      .select('id, drill_name, youtube_video_id, youtube_url, channel, youtube_start_seconds')
      .eq('status', 'approved').is('created_by_coach_id', null).ilike('drill_name', `*${term}*`).limit(15)
    const results = []
    for (const d of (data || []) as any[]) {
      const f = await libraryFacts(d.id)
      if (f) results.push({ drill_id: f.id, name: f.name, hasVideo: !!f.videoId, videoId: f.videoId, channel: f.channel, libraryStart: f.libraryStart, sharedBy: f.sharedBy })
    }
    return NextResponse.json({ results })
  }

  const drills = await listLessonDrills(id)
  // Before migration 083 is applied the table does not exist: show no mappings, do not fail.
  // Before 084 the pasted-video columns do not exist: fall back to the 083 shape.
  let mq: any = await adminDb().from('academy_drill_videos')
    .select('lesson_key, drill_label, drill_id, start_seconds, approval_status, reviewed_by, reviewed_at, youtube_video_id, title, channel').eq('course_id', id)
  const pastedReady = !mq.error
  if (mq.error) mq = await adminDb().from('academy_drill_videos')
    .select('lesson_key, drill_label, drill_id, start_seconds, approval_status, reviewed_by, reviewed_at').eq('course_id', id)
  const { data: maps, error } = mq
  const mappings: any[] = []
  for (const m of (error ? [] : maps || []) as any[]) {
    if (m.youtube_video_id) {
      mappings.push({ ...m, library: { name: m.title || 'YouTube video', videoId: m.youtube_video_id, channel: m.channel || null, libraryStart: null, sharedBy: 0, retired: false, pasted: true } })
      continue
    }
    const f = m.drill_id ? await libraryFacts(m.drill_id) : null
    mappings.push({ ...m, library: f ? { name: f.name, videoId: f.videoId, channel: f.channel, libraryStart: f.libraryStart, sharedBy: f.sharedBy, retired: f.retired, pasted: false } : null })
  }
  return NextResponse.json({ drills, mappings, migrationApplied: !error, pastedReady })
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const body = await request.json().catch(() => ({}))
  const id = await courseId(body.course)
  if (!id) return NextResponse.json({ error: 'Unknown course.' }, { status: 404 })
  const { lesson_key, label, action } = body
  if (!isLessonKey(lesson_key) || typeof label !== 'string' || !/^[A-Z]$/.test(label)) return NextResponse.json({ error: 'Pick a lesson drill.' }, { status: 400 })
  if (!['map', 'approve', 'reject', 'retire', 'unmap'].includes(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  const drills = await listLessonDrills(id)
  if (!drills.some(d => d.lesson_key === lesson_key && d.label === label)) return NextResponse.json({ error: 'That lesson has no such drill.' }, { status: 404 })

  const db = adminDb()
  const key = { course_id: id, lesson_key, drill_label: label }
  let rd: any = await db.from('academy_drill_videos').select('id, drill_id, start_seconds, approval_status, youtube_video_id').match(key).maybeSingle()
  if (rd.error) rd = await db.from('academy_drill_videos').select('id, drill_id, start_seconds, approval_status').match(key).maybeSingle()
  const { data: existing, error: readErr } = rd
  if (readErr) return NextResponse.json({ error: 'Drill videos are not set up yet (migration 083 has not been applied).' }, { status: 503 })
  const row = existing as any

  if (action === 'unmap') {
    if (row) await db.from('academy_drill_videos').delete().eq('id', row.id)
    return NextResponse.json({ status: 'unmapped' })
  }

  if (action === 'map') {
    const start = parseStart(body.start_seconds)
    if (start === 'invalid') return NextResponse.json({ error: 'Start time must be whole seconds.' }, { status: 400 })
    const now = new Date().toISOString()
    // Any change of video or start time sends the mapping back to candidate: an approval is for one exact video and start.
    const reset = { approval_status: 'candidate', reviewed_by: null, reviewed_at: null, updated_at: now }
    let fields: Record<string, unknown>

    if (typeof body.youtube_url === 'string' && body.youtube_url.trim()) {
      const parsed = parseYoutubeInput(body.youtube_url)
      if (!parsed) return NextResponse.json({ error: 'Paste a YouTube link (youtube.com or youtu.be).' }, { status: 400 })
      const facts = await checkYoutubeVideo(parsed.videoId)
      if (!facts) return NextResponse.json({ error: 'YouTube says that video is not available or cannot be played here. Check the link and try again.' }, { status: 400 })
      fields = { drill_id: null, youtube_video_id: parsed.videoId, title: facts.title, channel: facts.channel || null, start_seconds: start ?? parsed.start, ...reset }
    } else {
      if (typeof body.drill_id !== 'string' || !UUID.test(body.drill_id)) return NextResponse.json({ error: 'Pick a library drill or paste a YouTube link.' }, { status: 400 })
      const f = await libraryFacts(body.drill_id)
      if (!f || f.retired) return NextResponse.json({ error: 'That library drill is not available.' }, { status: 404 })
      if (!f.videoId) return NextResponse.json({ error: 'That library drill has no YouTube video.' }, { status: 400 })
      fields = { drill_id: body.drill_id, youtube_video_id: null, title: null, channel: null, start_seconds: start, ...reset }
    }
    const { error } = row ? await db.from('academy_drill_videos').update(fields).eq('id', row.id) : await db.from('academy_drill_videos').insert({ ...key, ...fields })
    if (error) {
      const pasted = fields.youtube_video_id != null || row?.youtube_video_id
      return NextResponse.json({ error: pasted ? 'Pasted videos are not set up on this database yet (migration 084 has not been applied).' : 'Could not save.' }, { status: pasted ? 503 : 500 })
    }
    return NextResponse.json({ status: 'candidate' })
  }

  if (!row) return NextResponse.json({ error: 'Map a library drill first.' }, { status: 404 })

  if (action === 'approve') {
    let hasVideo = false, sharedByN = 0, start: number | null = row.start_seconds ?? null
    if (row.youtube_video_id) {
      // A pasted video is checked with YouTube again at approval: it may have been removed since it was saved.
      hasVideo = !!(await checkYoutubeVideo(row.youtube_video_id))
    } else {
      const f = await libraryFacts(row.drill_id)
      hasVideo = !!f?.videoId && !f.retired
      sharedByN = f?.sharedBy ?? 0
      start = row.start_seconds ?? f?.libraryStart ?? null
    }
    const err = approvalError({ reviewer: body.reviewer, watched: body.watched, hasVideo, sharedBy: sharedByN, startSeconds: start, acceptCompilation: body.acceptCompilation })
    if (err) return NextResponse.json({ error: err }, { status: 400 })
    const { error } = await db.from('academy_drill_videos').update({ approval_status: 'approved', reviewed_by: String(body.reviewer).trim().slice(0, 80), reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', row.id)
    if (error) return NextResponse.json({ error: 'Could not approve.' }, { status: 500 })
    return NextResponse.json({ status: 'approved' })
  }

  const next = action === 'reject' ? 'rejected' : 'retired'
  await db.from('academy_drill_videos').update({ approval_status: next, updated_at: new Date().toISOString() }).eq('id', row.id)
  return NextResponse.json({ status: next })
}
