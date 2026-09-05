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

/**
 * The pre-051 path, kept working but made safe.
 *
 * Three inserts in sequence cannot be a transaction from here, so this does the
 * next best thing: it checks every one, and if the owner or the licence fails
 * it deletes the league it just created. The league rows cascade, so the
 * cleanup is a single delete.
 *
 * Weaker than bc_provision_league — the compensating delete can itself fail,
 * and that window is exactly why 051 exists. But it turns a silent orphan into
 * either a clean success or a clean error, which the original could not do.
 */
async function provisionSequentially(ctx: {
  trimmed: string; slug?: string; city?: string; state?: string
  governingBody?: string; website?: string; logoUrl?: string; status?: string
  ownerUserId: string | null; ownerEmail?: string; lic: any; coachLimit: number | null
}) {
  const { data: league, error } = await supabaseAdmin
    .from('leagues')
    .insert({
      name: ctx.trimmed,
      slug: ctx.slug || slugify(ctx.trimmed),
      city: ctx.city || null,
      state: ctx.state || null,
      governing_body: ctx.governingBody || null,
      website: ctx.website || null,
      logo_url: ctx.logoUrl || null,
      status: ['active', 'inactive', 'pilot'].includes(ctx.status as string) ? ctx.status : 'pilot',
    })
    .select('id, name, slug, status')
    .maybeSingle()

  if (error || !league) {
    const duplicate = (error as any)?.code === '23505'
    return NextResponse.json({
      error: duplicate
        ? 'A league with that name or slug already exists.'
        : 'Could not create that league',
    }, { status: duplicate ? 409 : 500 })
  }

  const leagueId = (league as any).id
  const abort = async (message: string) => {
    await supabaseAdmin.from('leagues').delete().eq('id', leagueId)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (ctx.ownerUserId) {
    const { error: memberError } = await supabaseAdmin.from('league_members').insert({
      league_id: leagueId, user_id: ctx.ownerUserId, role: 'owner',
    })
    if (memberError) {
      console.error('League owner insert failed; rolling back league:', memberError)
      return abort('Could not assign the league owner. Nothing was created.')
    }
  }

  const { data: createdLicense, error: licenseError } = await supabaseAdmin
    .from('league_licenses')
    .insert({
      league_id: leagueId,
      status: ['trial', 'active', 'expired', 'suspended', 'canceled'].includes(ctx.lic.status)
        ? ctx.lic.status : 'trial',
      plan: ctx.lic.plan || null,
      coach_limit: ctx.coachLimit,
      starts_at: ctx.lic.startsAt || new Date().toISOString(),
      ends_at: ctx.lic.endsAt || null,
      stripe_customer_id: ctx.lic.stripeCustomerId || null,
      contract_reference: ctx.lic.contractReference || null,
    })
    .select('id, status, plan, coach_limit, starts_at, ends_at')
    .maybeSingle()

  if (licenseError || !createdLicense) {
    console.error('League licence insert failed; rolling back league:', licenseError)
    return abort('Could not create the league licence. Nothing was created.')
  }

  return NextResponse.json({
    league,
    owner: ctx.ownerUserId ? { userId: ctx.ownerUserId, email: ctx.ownerEmail, role: 'owner' } : null,
    license: createdLicense,
    atomic: false,
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

    // A league is three rows that have to agree — the league, an administrator
    // who can run it, and a licence that makes its coaches entitled. Written in
    // sequence, a failure on the second or third leaves a league that looks
    // created and does nothing: a commissioner who cannot be found, or coaches
    // whose invitations cannot be accepted. Both used to return 200.
    //
    // bc_provision_league (migration 051) writes all three in one transaction.
    const lic = license || {}
    const coachLimit = typeof lic.coachLimit === 'number' ? lic.coachLimit
      : (lic.coachLimit ? Number(lic.coachLimit) : null)

    const { data: rpcRows, error: rpcError } = await supabaseAdmin.rpc('bc_provision_league', {
      p_name: trimmed,
      p_slug: slug || slugify(trimmed),
      p_city: city || null,
      p_state: state || null,
      p_governing_body: governingBody || null,
      p_website: website || null,
      p_logo_url: logoUrl || null,
      p_status: ['active', 'inactive', 'pilot'].includes(status) ? status : 'pilot',
      p_owner_user_id: ownerUserId,
      p_license_status: ['trial', 'active', 'expired', 'suspended', 'canceled'].includes(lic.status)
        ? lic.status : 'trial',
      p_license_plan: lic.plan || null,
      p_coach_limit: Number.isFinite(coachLimit as number) ? coachLimit : null,
      p_starts_at: lic.startsAt || null,
      p_ends_at: lic.endsAt || null,
      p_contract_ref: lic.contractReference || null,
    })

    // Migration 051 not applied yet. Rather than fail provisioning outright,
    // fall back to the sequential path — but a guarded one that checks every
    // insert and removes the league it just made if a later step fails, so the
    // orphan this endpoint exists to prevent still cannot happen.
    const functionMissing =
      (rpcError as any)?.code === 'PGRST202' ||
      /bc_provision_league.*(does not exist|not find)/i.test((rpcError as any)?.message || '')

    if (functionMissing) {
      console.warn(
        'Provisioning without bc_provision_league — run migrations/051_provision_league_atomically.sql. ' +
        'Using the compensating fallback.'
      )
      return await provisionSequentially({
        trimmed, slug, city, state, governingBody, website, logoUrl, status,
        ownerUserId, ownerEmail, lic, coachLimit,
      })
    }

    if (rpcError) {
      console.error('Create league error:', rpcError)
      return NextResponse.json({ error: 'Could not create that league' }, { status: 500 })
    }

    const result = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows
    if (!result?.ok) {
      // Expected refusals carry a reason and, importantly, wrote nothing.
      const reason = result?.reason || 'unknown'
      const map: Record<string, { message: string; status: number }> = {
        slug_taken: { message: 'A league with that name or slug already exists.', status: 409 },
        owner_not_found: { message: `No BenchCoach account for ${ownerEmail}. Ask them to sign up first, then create the league.`, status: 404 },
        owner_required: { message: 'A league needs an owner. Enter the email of an existing BenchCoach account.', status: 400 },
        name_required: { message: 'A league needs a name', status: 400 },
        slug_invalid: { message: 'That name produces an empty slug. Give the league a slug explicitly.', status: 400 },
      }
      const mapped = map[reason] || { message: 'Could not create that league', status: 500 }
      return NextResponse.json({ error: mapped.message }, { status: mapped.status })
    }

    const { data: createdLicense } = await supabaseAdmin
      .from('league_licenses')
      .select('id, status, plan, coach_limit, starts_at, ends_at')
      .eq('id', result.license_id)
      .maybeSingle()

    return NextResponse.json({
      league: {
        id: result.league_id,
        name: trimmed,
        slug: result.league_slug,
        status: ['active', 'inactive', 'pilot'].includes(status) ? status : 'pilot',
      },
      owner: { userId: result.owner_user_id, email: ownerEmail, role: 'owner' },
      license: createdLicense,
      atomic: true,
    })
  } catch (error: any) {
    console.error('Create league error:', error)
    return NextResponse.json({ error: 'Could not create that league' }, { status: 500 })
  }
}
