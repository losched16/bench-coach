import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse } from '@/lib/authz'
import { renderReportPdf, reportFilename } from '@/lib/playerReportPdf'
import { loadFullReport, buildContext } from '@/lib/playerReportStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// The PDF.
//
// GENERATED, NOT STORED
//
// There is no bucket, no signed URL and no file anywhere. The PDF is rendered
// from the report row on every request, and that is safe to do precisely
// because finalization froze everything it draws from: the context, the
// approved text, and the drill snapshots. Regenerating a 2026 report in 2027
// produces the same document.
//
// Storing them would buy nothing and cost the two things that matter most
// here. It would create a file about a child that has to be kept private by
// configuration rather than by construction — a bucket that is public by
// default, or a signed URL that outlives the session, is the exact failure
// this feature must not have. And it would introduce a second copy that can
// disagree with the report.
//
// THIS ROUTE IS THE AUTHORIZATION BOUNDARY
//
// It is the only way out of the app for this content, so it authorizes like
// every other route: report -> team -> the caller's role on that team. There
// is no token, no share link and no unauthenticated path. A coach on another
// team asking for this id gets a 404.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Rendering a two-page document is fast; the ceiling is for a report with a
// dozen drills on a cold function.
export const maxDuration = 60

export async function GET(
  request: NextRequest,
  { params }: { params: { reportId: string } }
) {
  try {
    await authorizeReport(params.reportId, 'read')

    const report = await loadFullReport(supabaseAdmin, params.reportId)
    if (!report) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    // A draft has no frozen context yet — it is still reading the team's
    // current names — so build one for the preview. The document itself says
    // DRAFT across the meta line, so nobody can mistake a preview for the
    // thing they sent.
    const context = report.context || await buildContext(supabaseAdmin, {
      teamId: report.team_id, playerId: report.player_id, coachId: report.coach_id,
    })

    const bytes = await renderReportPdf({ ...report, context })

    // `inline` so tapping the link on a phone opens the PDF viewer rather than
    // dropping a file into Downloads unseen. The coach shares it from there.
    const disposition = new URL(request.url).searchParams.get('download') === '1'
      ? 'attachment'
      : 'inline'

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${disposition}; filename="${reportFilename({ ...report, context })}"`,
        // A document about a child must not sit in a shared cache. private
        // and no-store rather than a max-age: the only copy that should exist
        // is the one the coach chose to save.
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Player report PDF error:', error)
    // The report is untouched — a failed render loses nothing, so say that
    // rather than leaving a coach wondering whether their work survived.
    return NextResponse.json(
      { error: 'Could not build the PDF. Your report is saved — try again in a moment.' },
      { status: 500 }
    )
  }
}
