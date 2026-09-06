import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeReport, authzResponse } from '@/lib/authz'
import {
  draftFromSources, improveFailureMessage,
  type ImproveKind, type DraftSourceItem,
} from '@/lib/playerReportAI'
import { describeClaudeFailure } from '@/lib/claudeClient'
import { buildContext } from '@/lib/playerReportStore'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// "Draft this section from what I've tracked."
//
// The coach has ticked some of the things they recorded during the season —
// notes, game entries, priorities and how they turned out, measurements — and
// asked for a first draft of one section built from those and nothing else.
//
// LIKE THE REWRITE, THIS WRITES NOTHING. It returns a suggestion. Only text
// the coach accepts goes through the normal draft save, as text they approved.
//
// The items arrive from the browser, but they are not trusted as facts — they
// are trusted as the coach's SELECTION. The picker got them from
// /api/player-reports/[id]/sources, which read them from the coach's own
// tables under the same authorization this route applies. What is capped here
// is size, not content: a coach cannot be harmed by their own notes, but a
// 40-item list with a pasted essay in each is a request that should not
// reach a model.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export const maxDuration = 60

const KINDS: ImproveKind[] = ['strengths', 'development', 'closing']
const MAX_ITEMS = 40
const MAX_ITEM_CHARS = 600

export async function POST(request: NextRequest) {
  let body: any = {}
  try { body = await request.json() } catch { /* refused below */ }

  try {
    const { report: row } = await authorizeReport(body?.reportId, 'decide')

    if (row.status !== 'draft') {
      return NextResponse.json(
        { error: 'This report has been finalized. Start a revision to draft new text.' },
        { status: 409 }
      )
    }

    const kind: ImproveKind = KINDS.includes(body?.kind) ? body.kind : 'strengths'

    const items: DraftSourceItem[] = (Array.isArray(body?.items) ? body.items : [])
      .slice(0, MAX_ITEMS)
      .map((it: any) => ({
        id: String(it?.id || ''),
        kind: String(it?.kind || 'note').slice(0, 20),
        date: typeof it?.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(it.date) ? it.date.slice(0, 10) : null,
        text: String(it?.text || '').slice(0, MAX_ITEM_CHARS),
      }))
      .filter((it: DraftSourceItem) => it.text.trim())

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Pick at least one thing to draft from.' },
        { status: 400 }
      )
    }

    // Name and age group from the database, never from the request.
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
    const firstName = (context?.player_name || '').trim().split(/\s+/)[0] || null

    const { suggestion } = await draftFromSources({
      kind,
      items,
      playerName: firstName,
      ageGroup: context?.age_group || null,
      focusLabel: typeof body?.focusLabel === 'string' ? body.focusLabel : null,
    })

    return NextResponse.json({
      suggestion,
      // Echoed so the UI's "show sources" lists exactly what the model saw.
      sources: items,
    })
  } catch (error: any) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })

    // 200 with a message: nothing is wrong with the coach's report. The
    // selected items are still on screen and can be added as notes instead.
    const upstream = describeClaudeFailure(error)
    return NextResponse.json({
      suggestion: null,
      message: upstream
        ? improveFailureMessage(error)
        : "BenchCoach couldn't draft this right now. You can add the selected items as notes and write from there.",
      retryable: upstream?.retryable !== false,
    })
  }
}
