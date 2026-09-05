import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireSession, sessionClient } from '@/lib/authz'
import { getUserEntitlements } from '@/lib/leagueEntitlements'
import { getLeagueMemberships } from '@/lib/leagueAuthz'

// Never prerendered. Reads the session cookie to decide who is asking.
export const dynamic = 'force-dynamic'

// "What is my league situation?" — asked by three surfaces that would otherwise
// each answer it differently:
//
//   the nav       should a "League Admin" link exist for this person?
//   the dashboard whose league is providing this, so we can say so?
//   /subscribe    is this coach already covered, so we must not sell to them?
//
// One endpoint, because the third one is the dangerous one. A coach whose
// league pays being shown a checkout page is the single worst bug this feature
// can have, and it happens the moment two surfaces disagree about who is
// sponsored.
//
// Scoped entirely to the CALLER. There is no leagueId parameter and no way to
// ask about anybody else — requireSession() establishes who is asking and every
// answer is derived from that identity.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied

  try {
    const supabase = await sessionClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'You need to be signed in' }, { status: 401 })

    const [entitlements, memberships] = await Promise.all([
      getUserEntitlements(user.id),
      getLeagueMemberships(user.id),
    ])

    // Every league we need a name for: the ones they administer, and the ones
    // sponsoring them. Usually zero, occasionally one, never many.
    const ids = Array.from(new Set([
      ...memberships.map(m => m.leagueId),
      ...entitlements.leagues,
    ]))

    const { data: leagues } = ids.length
      ? await supabaseAdmin
          .from('leagues')
          .select('id, name, slug, logo_url, status')
          .in('id', ids)
      : { data: [] as any[] }

    const byId = new Map(((leagues || []) as any[]).map(l => [l.id, l]))

    return NextResponse.json({
      // Drives the nav link. Empty for the sponsored coaches, which is the
      // point: a league coach is not a commissioner and must not be shown
      // administration for the league that pays for them.
      admin: memberships.map(m => ({
        leagueId: m.leagueId,
        role: m.role,
        name: byId.get(m.leagueId)?.name || 'League',
        slug: byId.get(m.leagueId)?.slug || null,
        logoUrl: byId.get(m.leagueId)?.logo_url || null,
      })),
      // Drives the "Provided by …" badge, and the subscribe gate.
      sponsorship: {
        sponsored: entitlements.leagueSponsored,
        expiresAt: entitlements.expiresAt,
        teamIds: entitlements.sponsoredTeamIds,
        leagues: entitlements.leagues.map(id => ({
          id,
          name: byId.get(id)?.name || 'your league',
          logoUrl: byId.get(id)?.logo_url || null,
        })),
      },
      // Deliberately reports individual and sponsored access separately rather
      // than collapsing them into one "subscribed" boolean. A UI that only
      // knows "has access" cannot tell a coach who their access comes from,
      // and telling them is most of the product promise here.
      access: {
        source: entitlements.source,
        hasAccess: entitlements.hasAccess,
        teamFeatures: entitlements.teamFeatures,
        individualPaid: entitlements.individualPaid,
        leagueSponsored: entitlements.leagueSponsored,
        tier: entitlements.tier,
      },
    })
  } catch (error: any) {
    console.error('League me error:', error)
    // Degrades the way /api/entitlements does: never block the app on this
    // lookup. Reporting "no league" costs a badge and a nav link; reporting an
    // error costs the page.
    return NextResponse.json({
      admin: [],
      sponsorship: { sponsored: false, expiresAt: null, teamIds: [], leagues: [] },
      access: {
        source: 'none', hasAccess: false, teamFeatures: false,
        individualPaid: false, leagueSponsored: false, tier: 'free',
      },
      degraded: true,
    })
  }
}
