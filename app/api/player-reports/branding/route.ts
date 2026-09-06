import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guard } from '@/lib/authz'
import { cleanBranding, DEFAULT_BRANDING, BRANDING_LIMITS } from '@/lib/playerReports'
import { migrationHintFor } from '@/lib/migrationHints'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// The coach's letterhead on their player reports.
//
// PER COACH, OWNER ONLY
//
// Branding lives on the coach's own row (coaches.report_branding, migration
// 055) because a letterhead belongs to the person signing, not to one of
// their teams. Reading it is 'read' — an assistant sees the same masthead the
// owner does — but changing it is 'own', the same line as staff and billing.
// An admin assistant may write reports under the head coach's name; they do
// not get to decide what that name is.
//
// Nothing here touches a report. A finalized report carries the branding it
// was sent with, copied into player_reports.context at finalization; changing
// this setting affects drafts and future reports only.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// ---------------------------------------------------------------------------
// GET ?coachId=  — the saved letterhead, and the defaults it falls back to
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  const coachId = new URL(request.url).searchParams.get('coachId')

  const { data, error } = await supabaseAdmin
    .from('coaches')
    .select('report_branding')
    .eq('id', coachId as string)
    .maybeSingle()

  if (error) {
    // Migration 055 not applied yet. The settings card should say so rather
    // than show three empty boxes that cannot be saved.
    const hint = migrationHintFor(error)
    return NextResponse.json({
      branding: null,
      defaults: DEFAULT_BRANDING,
      limits: BRANDING_LIMITS,
      needsMigration: Boolean(hint),
      migrationMessage: hint?.message || null,
    })
  }

  return NextResponse.json({
    branding: cleanBranding((data as any)?.report_branding),
    defaults: DEFAULT_BRANDING,
    limits: BRANDING_LIMITS,
  })
}

// ---------------------------------------------------------------------------
// PUT { coachId, brandName?, headerLine?, footerText? }  — replace it
// ---------------------------------------------------------------------------
export async function PUT(request: NextRequest) {
  const denied = await guard(request, 'own')
  if (denied) return denied

  let body: any = {}
  try { body = await request.json() } catch { /* an empty body clears it */ }

  // Three slots, trimmed and capped; all empty is stored as NULL, which is
  // how "never set" reads, so clearing the fields restores the old report.
  const branding = cleanBranding(body)

  const { error } = await supabaseAdmin
    .from('coaches')
    .update({ report_branding: branding })
    .eq('id', String(body?.coachId || ''))

  if (error) {
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || 'Could not save the branding.' },
      { status: hint ? 503 : 500 }
    )
  }

  return NextResponse.json({ branding, defaults: DEFAULT_BRANDING })
}
