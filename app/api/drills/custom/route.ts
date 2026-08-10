import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { migrationHintFor } from '@/lib/migrationHints'
import { callerCoachId, requireSession } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// A drill the coach wrote.
//
// Every coach who has been at this a while has a station they invented, or one
// they got from someone years ago, that is not on YouTube and never will be.
// Before this there was nowhere to put it — the library was a fixed catalogue,
// so their best drill was the one thing the app could not help them run.
//
// These land in drill_resources next to the curated ones, with
// created_by_coach_id set. That is deliberate: the practice builder, the
// prescription engine, swap and chat all read that table, so a coach's own
// drill becomes selectable everywhere without a single one of those surfaces
// learning about it. lib/drills.ts keeps it visible to them alone.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// A coach's drill is theirs. Ownership is checked against the session on every
// write — never against an id in the body.
async function ownsDrill(coachId: string, drillId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('drill_resources')
    .select('created_by_coach_id')
    .eq('id', drillId)
    .maybeSingle()
  return (data as any)?.created_by_coach_id === coachId
}

// Splits "bucket of balls, 4 cones" into an array, and tolerates a coach who
// used newlines instead. Empty in, empty out — not [''].
function toList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map(s => s.trim()).filter(Boolean)
  if (typeof value !== 'string') return []
  return value.split(/[,\n]/).map(s => s.trim()).filter(Boolean)
}

function fieldsFrom(body: any) {
  return {
    drill_name: String(body.drill_name || '').trim(),
    description: body.description ? String(body.description).trim() : null,
    skill_category: body.skill_category || null,
    difficulty_level: body.difficulty_level || null,
    // Where it sits in a progression, if they know. Optional — most coaches
    // will not fill this in, and a plan still works without it.
    progression_level: typeof body.progression_level === 'number' ? body.progression_level : null,
    equipment_needed: toList(body.equipment_needed),
    // The coach's own cues. Named ai_coaching_notes because that is the column
    // every surface already renders; nothing here was written by a model.
    ai_coaching_notes: body.coaching_notes ? String(body.coaching_notes).trim() : null,
    reps_guidance: body.reps_guidance ? String(body.reps_guidance).trim() : null,
    frequency_guidance: body.frequency_guidance ? String(body.frequency_guidance).trim() : null,
    success_markers: toList(body.success_markers),
    // A coach may well have a video — their own, or one they found. Optional,
    // because the whole point is the drills that do not have one.
    youtube_url: body.youtube_url ? String(body.youtube_url).trim() : null,
    youtube_video_id: body.youtube_video_id ? String(body.youtube_video_id).trim() : null,
  }
}

// POST — create one
export async function POST(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const coachId = await callerCoachId()
    if (!coachId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const fields = fieldsFrom(body)

    if (!fields.drill_name) {
      return NextResponse.json({ error: 'The drill needs a name.' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('drill_resources')
      .insert({
        ...fields,
        created_by_coach_id: coachId,
        // Curated drills carry a review status. A coach's own drill is not
        // pending anyone's approval, and 'approved' is what every read path
        // already lets through.
        status: 'approved',
      })
      .select('id, drill_name')
      .single()

    if (error) throw error

    // Starred on creation. Somebody typing out their own drill has already
    // told us it is one they use.
    if (data?.id) {
      await supabaseAdmin
        .from('drill_favorites')
        .upsert({ coach_id: coachId, drill_id: data.id }, { onConflict: 'coach_id,drill_id' })
        // A failed star must not fail the drill.
        .then(r => r, () => null)
    }

    return NextResponse.json({ drill: data })
  } catch (error: any) {
    console.error('Custom drill POST error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json({
      error: hint?.message || error.message || 'Could not save that drill.',
      needsMigration: !!hint,
    }, { status: 500 })
  }
}

// PATCH { drillId, ...fields } — edit one of your own
export async function PATCH(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const coachId = await callerCoachId()
    if (!coachId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const drillId = body.drillId
    if (!drillId) return NextResponse.json({ error: 'drillId required' }, { status: 400 })

    // 404, not 403: a coach editing a curated drill, or somebody else's, is
    // told it does not exist rather than that it exists and is off limits.
    if (!(await ownsDrill(coachId, drillId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const fields = fieldsFrom(body)
    if (!fields.drill_name) {
      return NextResponse.json({ error: 'The drill needs a name.' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('drill_resources')
      .update(fields)
      .eq('id', drillId)
      .eq('created_by_coach_id', coachId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Custom drill PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE ?drillId= — remove one of your own
export async function DELETE(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const coachId = await callerCoachId()
    if (!coachId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const drillId = searchParams.get('drillId')
    if (!drillId) return NextResponse.json({ error: 'drillId required' }, { status: 400 })

    if (!(await ownsDrill(coachId, drillId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Plans that already reference this drill keep their copy of the block —
    // practice_plans.content is JSON written at generation time, not a join.
    // A prescription referencing it by id will simply stop resolving that one,
    // which /api/prescribe/drills already handles by filtering out misses.
    const { error } = await supabaseAdmin
      .from('drill_resources')
      .delete()
      .eq('id', drillId)
      .eq('created_by_coach_id', coachId)

    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Custom drill DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
