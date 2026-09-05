import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guardLeague, findUserIdByEmail, isLeagueRole, requireLeagueRole } from '@/lib/leagueAuthz'
import { sessionClient } from '@/lib/authz'

export const dynamic = 'force-dynamic'

// Who else runs this league.
//
// Gated on 'administer' rather than 'manage', because adding a league
// administrator is privilege escalation: an admin who could appoint admins
// could appoint themselves owner. Only the owner and commissioner reach this.
//
// Note what a row here does and does not do. It grants league administration
// and adoption reporting. It grants nothing on any team's data — league
// membership appears in no team policy and in no team authorization path — so
// appointing a commissioner does not hand them a single roster, note or
// conversation.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const denied = await guardLeague(request, 'view')
  if (denied) return denied

  const leagueId = new URL(request.url).searchParams.get('leagueId')!

  const { data: members } = await supabaseAdmin
    .from('league_members')
    .select('id, user_id, role, created_at')
    .eq('league_id', leagueId)
    .order('created_at')

  const rows = (members || []) as any[]

  // A name, so the list is readable. From `coaches`, which is where a display
  // name already lives — not from auth.users, because reading the auth table to
  // decorate a list is more access than this needs and an administrator who has
  // never coached simply has no name to show.
  const { data: named } = rows.length
    ? await supabaseAdmin
        .from('coaches')
        .select('user_id, display_name')
        .in('user_id', rows.map(m => m.user_id))
    : { data: [] as any[] }

  const nameByUser = new Map(((named || []) as any[]).map(c => [c.user_id, c.display_name]))

  const supabase = await sessionClient()
  const { data: { user } } = await supabase.auth.getUser()

  return NextResponse.json({
    members: rows.map(m => ({
      id: m.id,
      role: m.role,
      name: nameByUser.get(m.user_id) || null,
      isYou: m.user_id === user?.id,
      createdAt: m.created_at,
    })),
  })
}

export async function POST(request: NextRequest) {
  const denied = await guardLeague(request, 'administer')
  if (denied) return denied

  try {
    const { leagueId, email, role } = await request.json()

    if (!isLeagueRole(role)) {
      return NextResponse.json({ error: 'Pick a valid league role' }, { status: 400 })
    }

    const address = (email || '').trim()
    if (!address) return NextResponse.json({ error: 'Enter their email address' }, { status: 400 })

    const userId = await findUserIdByEmail(address)
    if (!userId) {
      return NextResponse.json({
        error: `No BenchCoach account for ${address}. Ask them to sign up first, then add them here.`,
      }, { status: 404 })
    }

    // Upsert onto the (league_id, user_id) unique constraint from migration
    // 050: changing somebody's role is an update to the row the commissioner is
    // looking at, never a second row. Two rows would mean two answers to "what
    // may they do", and bc_league_role() takes whichever it finds first.
    const { data: existing } = await supabaseAdmin
      .from('league_members')
      .select('id, role')
      .eq('league_id', leagueId)
      .eq('user_id', userId)
      .maybeSingle()

    const { data: member, error } = existing
      ? await supabaseAdmin
          .from('league_members').update({ role }).eq('id', (existing as any).id)
          .select('id, user_id, role').maybeSingle()
      : await supabaseAdmin
          .from('league_members').insert({ league_id: leagueId, user_id: userId, role })
          .select('id, user_id, role').maybeSingle()

    if (error) {
      console.error('Add league member failed:', error)
      return NextResponse.json({ error: 'Could not add that administrator' }, { status: 500 })
    }

    return NextResponse.json({ member, email: address })
  } catch (error: any) {
    console.error('League member POST error:', error)
    return NextResponse.json({ error: 'Could not add that administrator' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await guardLeague(request, 'administer')
  if (denied) return denied

  try {
    const url = new URL(request.url)
    const leagueId = url.searchParams.get('leagueId')!
    const id = url.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing member id' }, { status: 400 })

    const actor = await requireLeagueRole(leagueId, 'administer')

    const { data: target } = await supabaseAdmin
      .from('league_members')
      .select('id, user_id, role')
      .eq('id', id)
      .eq('league_id', leagueId)
      .maybeSingle()

    if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // A league that nobody administers is a support ticket nobody can resolve
    // from inside the product, so the last owner cannot be removed — not even
    // by themselves, which is the likeliest way it would happen.
    if ((target as any).role === 'owner') {
      const { count } = await supabaseAdmin
        .from('league_members')
        .select('id', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('role', 'owner')

      if ((count || 0) <= 1) {
        return NextResponse.json({
          error: 'This is the league’s only owner. Make somebody else an owner first.',
        }, { status: 409 })
      }
    }

    // Removing yourself is allowed once somebody else can still administer,
    // but it is worth being deliberate about — a commissioner handing over and
    // stepping back is a real thing that happens between seasons.
    void actor

    const { error } = await supabaseAdmin.from('league_members').delete().eq('id', id).eq('league_id', leagueId)
    if (error) {
      console.error('Remove league member failed:', error)
      return NextResponse.json({ error: 'Could not remove that administrator' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('League member DELETE error:', error)
    return NextResponse.json({ error: 'Could not remove that administrator' }, { status: 500 })
  }
}
