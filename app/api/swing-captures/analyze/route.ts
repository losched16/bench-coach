import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeTeam, authzResponse } from '@/lib/authz'
import {
  SWING_ANALYSIS_SCHEMA_VERSION,
  SwingAnalysisRequest,
  validateSwingAnalysisResult,
} from '@/lib/swingCapture'

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Computer vision does not belong inside a Vercel route. Video decoding and
// frame tracking are CPU-heavy, long-running work. This route is the narrow
// bridge to a purpose-built analyzer service; the rest of BenchCoach stays
// unaware of whether that service is Python/OpenCV today or native/on-device
// tomorrow.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const teamId = typeof body.teamId === 'string' ? body.teamId : null
    const captureId = typeof body.captureId === 'string' ? body.captureId : null
    await authorizeTeam(teamId, 'record')

    if (!captureId) {
      return NextResponse.json({ error: 'captureId required' }, { status: 400 })
    }

    const serviceUrl = process.env.SWING_ANALYSIS_URL?.replace(/\/$/, '')
    if (!serviceUrl) {
      return NextResponse.json({
        error: 'Automated swing analysis is not configured in this environment yet.',
        code: 'SWING_ANALYZER_NOT_CONFIGURED',
      }, { status: 503 })
    }

    const { data: capture, error: captureError } = await supabaseAdmin
      .from('swing_captures')
      .select('*')
      .eq('id', captureId)
      .eq('team_id', teamId!)
      .maybeSingle()

    if (captureError) throw captureError
    if (!capture) return NextResponse.json({ error: 'Swing capture not found.' }, { status: 404 })
    if (capture.status === 'confirmed') {
      return NextResponse.json({ error: 'Confirmed captures are not re-analyzed automatically.' }, { status: 409 })
    }

    const { data: signed, error: signedError } = await supabaseAdmin.storage
      .from(capture.storage_bucket)
      .createSignedUrl(capture.storage_path, 15 * 60)
    if (signedError || !signed?.signedUrl) {
      return NextResponse.json({ error: 'Could not open the private swing video.' }, { status: 500 })
    }

    await supabaseAdmin
      .from('swing_captures')
      .update({ status: 'processing', analysis_error: null })
      .eq('id', captureId)
      .eq('team_id', teamId!)

    const payload: SwingAnalysisRequest = {
      schemaVersion: SWING_ANALYSIS_SCHEMA_VERSION,
      captureId,
      videoUrl: signed.signedUrl,
      captureFps: capture.capture_fps,
      frameWidth: capture.frame_width,
      frameHeight: capture.frame_height,
      durationMs: capture.duration_ms,
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 55_000)

    let response: Response
    try {
      response = await fetch(`${serviceUrl}/v1/analyze-swing`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.SWING_ANALYSIS_API_KEY
            ? { Authorization: `Bearer ${process.env.SWING_ANALYSIS_API_KEY}` }
            : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const text = (await response.text()).slice(0, 500)
      throw new Error(`Analyzer failed (${response.status})${text ? `: ${text}` : ''}`)
    }

    const rawResult = await response.json()
    const validated = validateSwingAnalysisResult(rawResult)
    if (!validated.ok) throw new Error(validated.error)

    const result = validated.value
    const now = new Date().toISOString()
    const { data: updated, error: updateError } = await supabaseAdmin
      .from('swing_captures')
      .update({
        status: 'review',
        exit_velocity_mph: result.exitVelocityMph,
        launch_angle_deg: result.launchAngleDeg,
        projected_distance_ft: result.projectedDistanceFt,
        confidence: result.confidence,
        analysis_provider: result.provider,
        analysis_version: result.modelVersion,
        analysis_payload: result.diagnostics || {},
        analysis_error: null,
        analyzed_at: now,
      })
      .eq('id', captureId)
      .eq('team_id', teamId!)
      .select('*')
      .single()

    if (updateError) throw updateError

    return NextResponse.json({ capture: updated, requiresReview: true })
  } catch (error: unknown) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    const message = error instanceof Error ? error.message : 'Swing analysis failed.'
    console.error('Swing analysis error:', error)

    // Best-effort failure state. We intentionally do not trust a second body
    // read here to recover captureId; the caller can retry and the original
    // video remains registered even if this update is skipped.
    try {
      const clone = request.clone()
      const body = await clone.json()
      if (body?.captureId && body?.teamId) {
        await supabaseAdmin
          .from('swing_captures')
          .update({ status: 'failed', analysis_error: message.slice(0, 1000) })
          .eq('id', body.captureId)
          .eq('team_id', body.teamId)
      }
    } catch { /* response below is still the source of truth for this request */ }

    return NextResponse.json({ error: message }, { status: 502 })
  }
}
