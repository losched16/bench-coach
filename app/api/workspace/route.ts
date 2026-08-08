import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { tierOf, canAdd, Usage, LimitKind } from '@/lib/tiers'
import { guard } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// The gate in front of creating a team or a personal player.
//
// Server-side because a limit enforced only in the browser is a suggestion.
// The pages check first so the coach sees the reason before filling in a form
// — this is what makes it true.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function checkWorkspaceLimit(
  coachId: string,
  kind: LimitKind
): Promise<{ allowed: boolean; reason?: string; upgradeTo?: string }> {
  const { data: coach } = await supabaseAdmin
    .from('coaches')
    .select('id, is_subscribed, subscription_tier')
    .eq('id', coachId)
    .maybeSingle()

  if (!coach) return { allowed: false, reason: 'Coach profile not found.' }

  const { data: teams, error } = await supabaseAdmin
    .from('teams')
    .select('id, workspace_kind')
    .eq('coach_id', coachId)

  // A failed count must not stop someone creating a team. Getting billing
  // wrong in the customer's favour costs a little money; getting it wrong the
  // other way costs the customer.
  if (error) return { allowed: true }

  const usage: Usage = {
    teams: (teams || []).filter((t: any) => t.workspace_kind !== 'personal').length,
    personalPlayers: (teams || []).filter((t: any) => t.workspace_kind === 'personal').length,
  }

  return canAdd(tierOf(coach as any), kind, usage)
}

// ---------------------------------------------------------------------------
// POST { coachId, kind } — may I add one of these?
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'decide')
  if (denied) return denied

  try {
    const { coachId, kind } = await request.json()
    if (!coachId || (kind !== 'team' && kind !== 'personalPlayer')) {
      return NextResponse.json(
        { error: 'coachId and kind ("team" or "personalPlayer") are required' },
        { status: 400 }
      )
    }
    return NextResponse.json(await checkWorkspaceLimit(coachId, kind))
  } catch (error: any) {
    console.error('Workspace limit check error:', error)
    return NextResponse.json({ allowed: true, degraded: true })
  }
}
