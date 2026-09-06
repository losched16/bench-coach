import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse } from '@/lib/authz'
import { improveWording, improveFailureMessage, type ImproveKind } from '@/lib/playerReportAI'
import { describeClaudeFailure } from '@/lib/claudeClient'
import { buildContext } from '@/lib/playerReportStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// "Improve wording with BenchCoach".
//
// THIS ROUTE WRITES NOTHING
//
// It reads the report only to learn the player's first name and age group, and
// returns a suggestion. Nothing reaches the database until the coach presses
// Use this — at which point it goes through the normal draft save, as text the
// coach approved, indistinguishable from text they typed.
//
// That is the whole design. A rewrite endpoint that saved its own output would
// make "AI assists, the coach approves" a slogan rather than a mechanism: the
// coach would be reviewing something already stored, and the difference
// between reviewing and rubber-stamping is whether saying nothing means no.
//
// FAILURE IS NOT AN ERROR HERE
//
// Every failure path returns 200 with the coach's own text untouched and a
// sentence saying the help is unavailable. A model outage must not look like
// the app losing work — that is the moment a coach stops trusting it with
// anything they cannot afford to retype.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 60

const KINDS: ImproveKind[] = ['strengths', 'development', 'closing']

export async function POST(request: NextRequest) {
  let body: any = {}
  try { body = await request.json() } catch { /* refused below */ }

  try {
    const { report: row } = await authorizeReport(body?.reportId, 'decide')

    // A finalized report is not edited, so there is nothing here to improve.
    if (row.status !== 'draft') {
      return NextResponse.json(
        { error: 'This report has been finalized. Start a revision to change the wording.' },
        { status: 409 }
      )
    }

    const kind: ImproveKind = KINDS.includes(body?.kind) ? body.kind : 'strengths'
    const text = String(body?.text || '')
    if (!text.trim()) {
      return NextResponse.json({ error: 'Write a few words first, then BenchCoach can help tidy them up.' }, { status: 400 })
    }

    // The name and age group come from the database, not from the request. A
    // caller cannot make the model write about a different child by sending a
    // different name.
    const { data: report } = await supabaseAdmin
      .from('player_reports')
      .select('team_id, player_id, coach_id')
      .eq('id', row.id)
      .maybeSingle()

    const context = report
      ? await buildContext(supabaseAdmin, {
          teamId: (report as any).team_id,
          playerId: (report as any).player_id,
          coachId: (report as any).coach_id,
        })
      : null

    // First name only: "Charlie has shown good progress" reads like a coach;
    // "Charlie Losch has shown good progress" reads like a form letter.
    const firstName = (context?.player_name || '').trim().split(/\s+/)[0] || null

    const { suggestion } = await improveWording({
      kind,
      text,
      playerName: firstName,
      ageGroup: context?.age_group || null,
      focusLabel: typeof body?.focusLabel === 'string' ? body.focusLabel : null,
    })

    return NextResponse.json({
      suggestion,
      // Echoed back so the client can be certain the Keep original button
      // restores exactly what was sent, even if the coach kept typing.
      original: text,
    })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    // 200, deliberately. There is nothing wrong with the coach's report and
    // nothing for them to fix — the wording help just is not available.
    const upstream = describeClaudeFailure(error)
    return NextResponse.json({
      suggestion: null,
      message: improveFailureMessage(error),
      retryable: upstream?.retryable !== false,
    })
  }
}
