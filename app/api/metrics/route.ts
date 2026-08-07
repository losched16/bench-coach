import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { challengeValue, MetricType, MetricReading } from '@/lib/metrics'

// Measurements: the types a coach tracks, and the readings themselves.
//
// Types are coach-scoped with system presets available to everyone, because
// "let a parent define their own category" is the actual request — a family
// tracking something nobody thought of is the normal case, not the edge one.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ---------------------------------------------------------------------------
// GET
//   ?coachId=                 → the metric types available to this coach
//   ?coachId=&playerId=       → types plus every reading for that player
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const playerId = searchParams.get('playerId')

  if (!coachId) return NextResponse.json({ error: 'coachId required' }, { status: 400 })

  try {
    const { data: types, error: typeErr } = await supabaseAdmin
      .from('metric_types')
      .select('*')
      .or(`coach_id.is.null,coach_id.eq.${coachId}`)
      .eq('archived', false)
      .order('sort_order')
      .order('label')

    if (typeErr) throw typeErr

    if (!playerId) {
      return NextResponse.json({ types: types || [], readings: [] })
    }

    const { data: readings, error: readErr } = await supabaseAdmin
      .from('player_metrics')
      .select('id, metric_type_id, metric, value, unit, attempts, successes, measured_on, note')
      .eq('player_id', playerId)
      .eq('coach_id', coachId)
      .order('measured_on', { ascending: true })
      .limit(1000)

    if (readErr) throw readErr

    return NextResponse.json({ types: types || [], readings: readings || [] })
  } catch (error: any) {
    console.error('Metrics GET error:', error)
    // Table not created yet — the player page must still render
    return NextResponse.json({ types: [], readings: [], needsMigration: true })
  }
}

// ---------------------------------------------------------------------------
// POST — log readings, or create a metric type
//   { coachId, kind: 'type', label, unit?, shape?, direction?, defaultAttempts? }
//   { coachId, playerId, teamId?, metricTypeId, measuredOn, values[], note? }
//   { coachId, playerId, teamId?, metricTypeId, measuredOn, successes, attempts }
//
// `values` is an array because a session is ten swings, not one. Storing them
// as separate rows is what lets the UI show best AND average honestly rather
// than making the coach pick one at capture time.
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { coachId, kind } = body

    if (!coachId) return NextResponse.json({ error: 'coachId required' }, { status: 400 })

    // --- create a custom type ---
    if (kind === 'type') {
      const { label, unit, shape, direction, defaultAttempts, hint } = body
      if (!label?.trim()) {
        return NextResponse.json({ error: 'A name is required' }, { status: 400 })
      }

      const slug = String(label).trim().toLowerCase()
        .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || `metric_${Date.now()}`

      const { data, error } = await supabaseAdmin
        .from('metric_types')
        .insert({
          coach_id: coachId,
          slug,
          label: String(label).trim(),
          unit: unit?.trim() || null,
          shape: shape === 'challenge' ? 'challenge' : 'measurement',
          // The one field people get wrong and the one that breaks every
          // trend read if it's wrong, so it's explicit at creation.
          direction: direction === 'lower' ? 'lower' : 'higher',
          default_attempts: shape === 'challenge' ? (defaultAttempts || 10) : null,
          hint: hint?.trim() || null,
          sort_order: 500,
        })
        .select('*')
        .single()

      if (error) {
        if (String(error.message).includes('duplicate')) {
          return NextResponse.json({ error: 'You already track something with that name.' }, { status: 400 })
        }
        throw error
      }
      return NextResponse.json({ type: data })
    }

    // --- log readings ---
    const { playerId, teamId, metricTypeId, measuredOn, values, successes, attempts, note } = body

    if (!playerId || !metricTypeId || !measuredOn) {
      return NextResponse.json(
        { error: 'playerId, metricTypeId and measuredOn are required' },
        { status: 400 }
      )
    }

    const { data: type } = await supabaseAdmin
      .from('metric_types').select('*').eq('id', metricTypeId).maybeSingle()

    if (!type) return NextResponse.json({ error: 'Unknown metric type' }, { status: 400 })
    const t = type as MetricType

    let rows: any[] = []

    if (t.shape === 'challenge') {
      const a = Number(attempts)
      const s = Number(successes)
      if (!a || a <= 0 || isNaN(s) || s < 0 || s > a) {
        return NextResponse.json(
          { error: 'Enter how many attempts and how many were successful.' },
          { status: 400 }
        )
      }
      rows = [{
        coach_id: coachId,
        player_id: playerId,
        team_id: teamId || null,
        metric_type_id: t.id,
        metric: t.slug,
        value: challengeValue(s, a),
        unit: '%',
        attempts: a,
        successes: s,
        measured_on: measuredOn,
        note: note?.trim() || null,
      }]
    } else {
      const nums = (Array.isArray(values) ? values : [values])
        .map((v: any) => Number(v))
        .filter((v: number) => !isNaN(v))
      if (nums.length === 0) {
        return NextResponse.json({ error: 'Enter at least one number.' }, { status: 400 })
      }
      rows = nums.map((v: number) => ({
        coach_id: coachId,
        player_id: playerId,
        team_id: teamId || null,
        metric_type_id: t.id,
        metric: t.slug,
        value: v,
        unit: t.unit,
        attempts: null,
        successes: null,
        measured_on: measuredOn,
        note: note?.trim() || null,
      }))
    }

    const { data, error } = await supabaseAdmin
      .from('player_metrics')
      .insert(rows)
      .select('id, metric_type_id, metric, value, unit, attempts, successes, measured_on, note')

    if (error) throw error
    return NextResponse.json({ readings: data || [], count: rows.length })
  } catch (error: any) {
    console.error('Metrics POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove a reading (mistyped), or archive a custom type
//   ?coachId=&readingId=   |   ?coachId=&typeId=
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const readingId = searchParams.get('readingId')
  const typeId = searchParams.get('typeId')

  if (!coachId || (!readingId && !typeId)) {
    return NextResponse.json({ error: 'coachId and readingId or typeId required' }, { status: 400 })
  }

  try {
    if (readingId) {
      const { error } = await supabaseAdmin
        .from('player_metrics').delete().eq('id', readingId).eq('coach_id', coachId)
      if (error) throw error
    } else {
      // Archived, not deleted — readings already logged against it stay
      // readable, and the history is the point of the feature.
      const { error } = await supabaseAdmin
        .from('metric_types').update({ archived: true }).eq('id', typeId).eq('coach_id', coachId)
      if (error) throw error
    }
    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
