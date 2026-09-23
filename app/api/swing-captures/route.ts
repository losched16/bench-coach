import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeTeam, authzResponse } from '@/lib/authz'

export const dynamic = 'force-dynamic'

const VIDEO_BUCKET = 'journal-media'
const MAX_VIDEO_BYTES = 500 * 1024 * 1024

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function numberInRange(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n) || n < min || n > max) return null
  return n
}

async function playerIsOnTeam(playerId: string, teamId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('team_players')
    .select('id')
    .eq('team_id', teamId)
    .eq('player_id', playerId)
    .maybeSingle()
  return Boolean(data)
}

async function signedVideoUrl(bucket: string, path: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(path, 60 * 60)
  if (error) return null
  return data?.signedUrl || null
}

// GET ?teamId=&playerId=
// Private capture history plus short-lived video URLs for review.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')
  const playerId = searchParams.get('playerId')

  try {
    await authorizeTeam(teamId, 'read')
    if (!playerId) {
      return NextResponse.json({ error: 'playerId required' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('swing_captures')
      .select('*')
      .eq('team_id', teamId!)
      .eq('player_id', playerId)
      .order('recorded_at', { ascending: false })
      .limit(30)

    if (error) throw error

    const captures = await Promise.all((data || []).map(async capture => ({
      ...capture,
      video_url: await signedVideoUrl(capture.storage_bucket, capture.storage_path),
    })))

    return NextResponse.json({ captures })
  } catch (error: unknown) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Swing captures GET error:', error)
    return NextResponse.json({ error: 'Could not load swing captures.' }, { status: 500 })
  }
}

// POST
// Registers a video that the authenticated client already uploaded to the
// private bucket. Registration is intentionally separate from analysis: upload
// failure, analyzer failure and a questionable result are three different
// states and the UI needs to tell the coach which one happened.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const teamId = typeof body.teamId === 'string' ? body.teamId : null
    const playerId = typeof body.playerId === 'string' ? body.playerId : null
    const storagePath = typeof body.storagePath === 'string' ? body.storagePath.trim() : ''
    const storageBucket = typeof body.storageBucket === 'string' ? body.storageBucket : VIDEO_BUCKET

    const actor = await authorizeTeam(teamId, 'record')

    if (!playerId || !storagePath) {
      return NextResponse.json({ error: 'playerId and storagePath are required.' }, { status: 400 })
    }
    if (!(await playerIsOnTeam(playerId, teamId!))) {
      return NextResponse.json({ error: 'Player is not on this team.' }, { status: 404 })
    }
    if (storageBucket !== VIDEO_BUCKET) {
      return NextResponse.json({ error: 'Unsupported video bucket.' }, { status: 400 })
    }

    // Do not let a caller register somebody else's private object as their own
    // capture just because they know or guessed its path.
    const requiredPrefix = `swing-captures/${teamId}/${playerId}/`
    if (!storagePath.startsWith(requiredPrefix)) {
      return NextResponse.json({ error: 'Invalid swing video path.' }, { status: 400 })
    }

    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : null
    if (mimeType && !mimeType.startsWith('video/')) {
      return NextResponse.json({ error: 'Swing capture must be a video.' }, { status: 400 })
    }

    const sizeBytes = body.sizeBytes == null ? null : Number(body.sizeBytes)
    if (sizeBytes != null && (!Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_VIDEO_BYTES)) {
      return NextResponse.json({ error: 'Video is too large.' }, { status: 400 })
    }

    const fps = body.captureFps == null ? null : numberInRange(body.captureFps, 24, 1000)
    if (body.captureFps != null && fps == null) {
      return NextResponse.json({ error: 'Capture frame rate is invalid.' }, { status: 400 })
    }

    const recordedAt = body.recordedAt ? new Date(body.recordedAt) : new Date()
    if (Number.isNaN(recordedAt.getTime())) {
      return NextResponse.json({ error: 'recordedAt is invalid.' }, { status: 400 })
    }

    const source = ['video_upload', 'native_ios', 'native_android'].includes(body.source)
      ? body.source
      : 'video_upload'

    const row = {
      team_id: teamId,
      player_id: playerId,
      storage_bucket: storageBucket,
      storage_path: storagePath,
      original_filename: typeof body.originalFilename === 'string' ? body.originalFilename.slice(0, 255) : null,
      mime_type: mimeType,
      size_bytes: sizeBytes,
      source,
      capture_fps: fps,
      frame_width: body.frameWidth == null ? null : numberInRange(body.frameWidth, 1, 20000),
      frame_height: body.frameHeight == null ? null : numberInRange(body.frameHeight, 1, 20000),
      duration_ms: body.durationMs == null ? null : numberInRange(body.durationMs, 1, 60 * 60 * 1000),
      recorded_at: recordedAt.toISOString(),
      recorded_on: recordedAt.toISOString().slice(0, 10),
      status: 'uploaded',
      created_by: actor.userId,
    }

    const { data, error } = await supabaseAdmin
      .from('swing_captures')
      .insert(row)
      .select('*')
      .single()

    if (error) throw error

    return NextResponse.json({
      capture: {
        ...data,
        video_url: await signedVideoUrl(data.storage_bucket, data.storage_path),
      },
    }, { status: 201 })
  } catch (error: unknown) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Swing captures POST error:', error)
    return NextResponse.json({ error: 'Could not register swing capture.' }, { status: 500 })
  }
}

// PATCH
// Human review is the trust boundary. The analyzer may propose numbers, but no
// proposed number enters reports, trend charts or player-development reasoning
// until a contributor/head coach explicitly confirms it here.
//
// { teamId, captureId, action:'review'|'confirm', exitVelocityMph?,
//   launchAngleDeg?, projectedDistanceFt?, confidence? }
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const teamId = typeof body.teamId === 'string' ? body.teamId : null
    const captureId = typeof body.captureId === 'string' ? body.captureId : null
    const action = body.action
    const actor = await authorizeTeam(teamId, 'record')

    if (!captureId || !['review', 'confirm'].includes(action)) {
      return NextResponse.json({ error: 'captureId and a valid action are required.' }, { status: 400 })
    }

    const { data: current, error: captureError } = await supabaseAdmin
      .from('swing_captures')
      .select('*')
      .eq('id', captureId)
      .eq('team_id', teamId!)
      .maybeSingle()

    if (captureError) throw captureError
    if (!current) return NextResponse.json({ error: 'Swing capture not found.' }, { status: 404 })

    const exitVelocityMph = body.exitVelocityMph == null
      ? current.exit_velocity_mph
      : numberInRange(body.exitVelocityMph, 1, 200)
    const launchAngleDeg = body.launchAngleDeg == null
      ? current.launch_angle_deg
      : numberInRange(body.launchAngleDeg, -90, 90)
    const projectedDistanceFt = body.projectedDistanceFt == null
      ? current.projected_distance_ft
      : numberInRange(body.projectedDistanceFt, 0, 1000)
    const confidence = body.confidence == null
      ? current.confidence
      : numberInRange(body.confidence, 0, 1)

    if (body.exitVelocityMph != null && exitVelocityMph == null) {
      return NextResponse.json({ error: 'Exit velocity is invalid.' }, { status: 400 })
    }
    if (body.launchAngleDeg != null && launchAngleDeg == null) {
      return NextResponse.json({ error: 'Launch angle is invalid.' }, { status: 400 })
    }
    if (body.projectedDistanceFt != null && projectedDistanceFt == null) {
      return NextResponse.json({ error: 'Projected distance is invalid.' }, { status: 400 })
    }
    if (body.confidence != null && confidence == null) {
      return NextResponse.json({ error: 'Confidence is invalid.' }, { status: 400 })
    }

    if (action === 'review') {
      const { data, error } = await supabaseAdmin
        .from('swing_captures')
        .update({
          exit_velocity_mph: exitVelocityMph,
          launch_angle_deg: launchAngleDeg,
          projected_distance_ft: projectedDistanceFt,
          confidence,
          status: 'review',
          reviewed_by: actor.userId,
          reviewed_at: new Date().toISOString(),
          analysis_error: null,
        })
        .eq('id', captureId)
        .eq('team_id', teamId!)
        .select('*')
        .single()

      if (error) throw error
      return NextResponse.json({ capture: data })
    }

    if (exitVelocityMph == null || projectedDistanceFt == null) {
      return NextResponse.json({
        error: 'Exit velocity and projected distance are required before confirmation.',
      }, { status: 400 })
    }

    // The team owner is the canonical coach_id for shared-team measurements.
    // A contributor may record the fact, but it still belongs to the workspace.
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select('coach_id')
      .eq('id', teamId!)
      .maybeSingle()
    if (teamError) throw teamError
    if (!team?.coach_id) throw new Error('Team owner could not be resolved.')

    const { data: metricTypes, error: typeError } = await supabaseAdmin
      .from('metric_types')
      .select('id, slug, unit')
      .is('coach_id', null)
      .in('slug', ['exit_velo', 'projected_hit_distance'])
      .order('sort_order')
    if (typeError) throw typeError

    // Migration 019's NULL uniqueness caveat means older databases can contain
    // duplicate system presets. Choosing the first of each slug keeps this
    // write deterministic while the metric row uniqueness is capture+type.
    const typeBySlug = new Map<string, { id: string; slug: string; unit: string | null }>()
    for (const type of metricTypes || []) {
      if (!typeBySlug.has(type.slug)) typeBySlug.set(type.slug, type)
    }
    const exitType = typeBySlug.get('exit_velo')
    const distanceType = typeBySlug.get('projected_hit_distance')
    if (!exitType || !distanceType) {
      return NextResponse.json({ error: 'Swing metric presets are not installed.' }, { status: 503 })
    }

    const metricRows = [
      {
        coach_id: team.coach_id,
        player_id: current.player_id,
        team_id: teamId,
        metric_type_id: exitType.id,
        metric: exitType.slug,
        value: exitVelocityMph,
        unit: exitType.unit,
        attempts: null,
        successes: null,
        measured_on: current.recorded_on,
        note: 'BenchCoach phone swing capture',
        source_capture_id: captureId,
      },
      {
        coach_id: team.coach_id,
        player_id: current.player_id,
        team_id: teamId,
        metric_type_id: distanceType.id,
        metric: distanceType.slug,
        value: projectedDistanceFt,
        unit: distanceType.unit,
        attempts: null,
        successes: null,
        measured_on: current.recorded_on,
        note: 'BenchCoach phone swing capture — projected distance',
        source_capture_id: captureId,
      },
    ]

    const { error: metricError } = await supabaseAdmin
      .from('player_metrics')
      .upsert(metricRows, { onConflict: 'source_capture_id,metric_type_id' })
    if (metricError) throw metricError

    const now = new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('swing_captures')
      .update({
        exit_velocity_mph: exitVelocityMph,
        launch_angle_deg: launchAngleDeg,
        projected_distance_ft: projectedDistanceFt,
        confidence,
        status: 'confirmed',
        reviewed_by: actor.userId,
        reviewed_at: current.reviewed_at || now,
        confirmed_by: actor.userId,
        confirmed_at: now,
        analysis_error: null,
      })
      .eq('id', captureId)
      .eq('team_id', teamId!)
      .select('*')
      .single()

    if (error) throw error
    return NextResponse.json({ capture: data, syncedMetrics: 2 })
  } catch (error: unknown) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Swing captures PATCH error:', error)
    return NextResponse.json({ error: 'Could not update swing capture.' }, { status: 500 })
  }
}
