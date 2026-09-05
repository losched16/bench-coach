import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAdmin } from '@/lib/authz'
import { findUserIdByEmail } from '@/lib/leagueAuthz'

export const dynamic = 'force-dynamic'

// Provisioning a league. The product owner's tool, not a customer-facing one.
//
// This exists because the alternative is what the league layer was supposed to
// remove: onboarding a paying league by hand-writing INSERTs in the Supabase SQL
// editor. Three tables have to agree — the league, a licence that makes its
// coaches entitled, and a first administrator who can then do everything else —
// and getting any of them wrong produces a league whose commissioner logs in to
// "not found".
//
// Behind requireAdmin(), which checks a real signed-in session against
// ADMIN_EMAIL. Deliberately NOT part of /league-admin: a commissioner may run
// their league, but creating leagues and issuing licences is selling, and
// selling is not self-serve at this stage.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

// GET — the leagues that exist, so the owner can see what they have sold.
export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const { data: leagues } = await supabaseAdmin
    .from('leagues')
    .select('id, name, slug, status, city, state, created_at')
    .order('created_at', { ascending: false })

  const { data: licenses } = await supabaseAdmin
    .from('league_licenses')
    .select('league_id, status, plan, coach_limit, starts_at, ends_at')

  const byLeague = new Map<string, any[]>()
  for (const l of ((licenses || []) as any[])) {
    byLeague.set(l.league_id, [...(byLeague.get(l.league_id) || []), l])
  }

  return NextResponse.json({
    leagues: ((leagues || []) as any[]).map(l => ({ ...l, licenses: byLeague.get(l.id) || [] })),
  })
}

// POST — create a league, its first licence, and its owner, in one go.
export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  try {
    const {
      name, slug, city, state, governingBody, website, logoUrl, status,
      ownerEmail,
      license,
    } = await request.json()

    const trimmed = (name || '').trim()
    if (!trimmed) return NextResponse.json({ error: 'A league needs a name' }, { status: 400 })

    // The owner has to exist before the league does. Creating a league nobody
    // can administer is the failure this endpoint is meant to prevent, so it is
    // checked FIRST — before anything is written — rather than leaving a
    // half-provisioned league behind when the address turns out to be wrong.
    let ownerUserId: string | null = null
    if (ownerEmail) {
      ownerUserId = await findUserIdByEmail(ownerEmail)
      if (!ownerUserId) {
        return NextResponse.json({
          error: `No BenchCoach account for ${ownerEmail}. Ask them to sign up first, then create the league.`,
        }, { status: 404 })
      }
    }

    const { data: league, error } = await supabaseAdmin
      .from('leagues')
      .insert({
        name: trimmed,
        slug: (slug || slugify(trimmed)) || slugify(trimmed),
        city: city || null,
        state: state || null,
        governing_body: governingBody || null,
        website: website || null,
        logo_url: logoUrl || null,
        status: ['active', 'inactive', 'pilot'].includes(status) ? status : 'pilot',
      })
      .select('id, name, slug, status')
      .maybeSingle()

    if (error || !league) {
      // The slug is unique, and "a league with that name already exists" is a
      // far more useful thing to read than a constraint name.
      const duplicate = (error as any)?.code === '23505'
      return NextResponse.json({
        error: duplicate
          ? 'A league with that name or slug already exists.'
          : 'Could not create that league',
      }, { status: duplicate ? 409 : 500 })
    }

    const leagueId = (league as any).id

    if (ownerUserId) {
      await supabaseAdmin.from('league_members').insert({
        league_id: leagueId,
        user_id: ownerUserId,
        role: 'owner',
      })
    }

    // A league with no licence is a league whose coaches cannot accept their
    // invitations, so one is created by default — a trial, which grants access
    // exactly like 'active' and is what a pilot actually is.
    const lic = license || {}
    const { data: createdLicense } = await supabaseAdmin
      .from('league_licenses')
      .insert({
        league_id: leagueId,
        status: ['trial', 'active', 'expired', 'suspended', 'canceled'].includes(lic.status)
          ? lic.status : 'trial',
        plan: lic.plan || null,
        coach_limit: typeof lic.coachLimit === 'number' ? lic.coachLimit : null,
        starts_at: lic.startsAt || new Date().toISOString(),
        ends_at: lic.endsAt || null,
        stripe_customer_id: lic.stripeCustomerId || null,
        contract_reference: lic.contractReference || null,
      })
      .select('id, status, plan, coach_limit, starts_at, ends_at')
      .maybeSingle()

    return NextResponse.json({
      league,
      owner: ownerUserId ? { userId: ownerUserId, email: ownerEmail, role: 'owner' } : null,
      license: createdLicense,
    })
  } catch (error: any) {
    console.error('Create league error:', error)
    return NextResponse.json({ error: 'Could not create that league' }, { status: 500 })
  }
}
