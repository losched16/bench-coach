import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireSession } from '@/lib/authz'
import { readResult, readReview } from '@/lib/swingPoc/store'
import { authorizeCapture, notEnabled, errorResponse } from '@/lib/swingPoc/access'
import { acceptedFindings, drillDiagnosis } from '@/lib/swingPoc/rules'
import { retrieveDrills } from '@/lib/drillRetrieval'
import { watchUrl } from '@/lib/drillVideo'

// Swing mechanics POC (internal, SWING_MECHANICS_POC=1). See docs/swing-mechanics-poc/.
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// POST — candidate drills for the findings the coach ACCEPTED, from the
// existing retrieval pipeline. Nothing is suggested for a finding the coach
// has not accepted, and no drill, link or timestamp is produced here: every
// item is a library row, and its video link is the one stored on that row.
// The "add to plan" block is a proposal for the coach to read; it writes
// nothing.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const off = notEnabled()
  if (off) return off
  const denied = await requireSession()
  if (denied) return denied
  try {
    const { meta, ownerCoachId } = await authorizeCapture(params.id, 'read')
    const [result, review] = await Promise.all([readResult(meta.id), readReview(meta.id)])
    const accepted = acceptedFindings(review, result)
    if (!accepted.length) {
      return NextResponse.json({
        drills: [], accepted: [],
        message: 'Accept or edit a finding first. Drills are only suggested for findings you agree with.',
      })
    }
    const diagnosis = drillDiagnosis(accepted)
    if (!diagnosis.slugs.length) {
      return NextResponse.json({ drills: [], accepted, message: 'None of the accepted findings is linked to the drill taxonomy yet.' })
    }
    const query = accepted.map(a => a.note || a.label).join('. ')
    const retrieval = await retrieveDrills({ supabase: supabaseAdmin, coachId: ownerCoachId, query, diagnosis, limit: 6 })
    const drills = retrieval.drills.map(d => ({
      id: d.id,
      drill_name: d.drill_name,
      description: d.description ?? null,
      skill_category: (d as any).skill_category ?? null,
      video_url: watchUrl(d as any),
    }))
    return NextResponse.json({
      accepted,
      diagnosis: { slugs: diagnosis.slugs },
      drills,
      proposal: {
        written: false,
        kind: 'player_priority',
        player_id: meta.player_id,
        team_id: meta.team_id,
        focus: accepted.map(a => a.note || a.label),
        drill_ids: drills.map(d => d.id),
        note: 'Proposal only. The POC does not create priorities or change development plans.',
      },
    })
  } catch (e) {
    return errorResponse(e)
  }
}
