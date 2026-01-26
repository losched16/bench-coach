import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use service role for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// GET - Get invitation details by token (public, for showing invite info)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const token = searchParams.get('token')

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    // Get invitation with team info
    const { data: invitation, error } = await supabaseAdmin
      .from('team_invitations')
      .select(`
        id,
        role,
        expires_at,
        max_uses,
        use_count,
        status,
        team:teams(
          id,
          name,
          age_group,
          coach:coaches(
            user_id
          )
        )
      `)
      .eq('token', token)
      .single()

    if (error || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
    }

    // Check if revoked
    if (invitation.status !== 'active') {
      return NextResponse.json({ error: 'Invitation is no longer valid' }, { status: 410 })
    }

    // Check if max uses reached
    if (invitation.max_uses && invitation.use_count >= invitation.max_uses) {
      return NextResponse.json({ error: 'Invitation has reached maximum uses' }, { status: 410 })
    }

    // Handle Supabase returning nested relations as arrays
    const team = Array.isArray(invitation.team) ? invitation.team[0] : invitation.team
    const coach = Array.isArray((team as any)?.coach) ? (team as any)?.coach[0] : (team as any)?.coach

    // Get owner name
    let ownerName = 'Coach'
    if (coach?.user_id) {
      const { data: ownerProfile } = await supabaseAdmin
        .from('coaches')
        .select('display_name')
        .eq('user_id', coach.user_id)
        .single()
      
      if (ownerProfile?.display_name) {
        ownerName = ownerProfile.display_name
      }
    }

    return NextResponse.json({
      invitation: {
        id: invitation.id,
        role: invitation.role,
        teamName: (team as any)?.name,
        teamAgeGroup: (team as any)?.age_group,
        ownerName,
      }
    })

  } catch (error: any) {
    console.error('Accept invite GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST - Accept an invitation
export async function POST(request: NextRequest) {
  try {
    const { token, userId } = await request.json()

    if (!token) {
      return NextResponse.json({ error: 'Missing token' }, { status: 400 })
    }

    if (!userId) {
      return NextResponse.json({ error: 'Must be logged in to accept invitation' }, { status: 401 })
    }

    // Verify the user exists
    const { data: userCheck } = await supabaseAdmin.auth.admin.getUserById(userId)
    if (!userCheck?.user) {
      return NextResponse.json({ error: 'Invalid user' }, { status: 401 })
    }

    // Get invitation
    const { data: invitation, error: inviteError } = await supabaseAdmin
      .from('team_invitations')
      .select('*, team:teams(id, name, coach_id)')
      .eq('token', token)
      .single()

    if (inviteError || !invitation) {
      return NextResponse.json({ error: 'Invitation not found' }, { status: 404 })
    }

    // Handle Supabase returning nested relations as arrays
    const team = Array.isArray(invitation.team) ? invitation.team[0] : invitation.team

    // Validate invitation
    if (new Date(invitation.expires_at) < new Date()) {
      return NextResponse.json({ error: 'Invitation has expired' }, { status: 410 })
    }

    if (invitation.status !== 'active') {
      return NextResponse.json({ error: 'Invitation is no longer valid' }, { status: 410 })
    }

    if (invitation.max_uses && invitation.use_count >= invitation.max_uses) {
      return NextResponse.json({ error: 'Invitation has reached maximum uses' }, { status: 410 })
    }

    // Get team owner's user_id separately
    const { data: ownerCoach } = await supabaseAdmin
      .from('coaches')
      .select('user_id')
      .eq('id', (team as any)?.coach_id)
      .single()

    // Check if user is the team owner (can't join own team)
    if (ownerCoach?.user_id === userId) {
      return NextResponse.json({ error: 'You are already the owner of this team' }, { status: 400 })
    }

    // Check if user is already a member
    const { data: existingMember } = await supabaseAdmin
      .from('team_members')
      .select('id')
      .eq('team_id', invitation.team_id)
      .eq('user_id', userId)
      .single()

    if (existingMember) {
      return NextResponse.json({ error: 'You are already a member of this team' }, { status: 400 })
    }

    // Add user as team member (coach record not required - uses user_id)
    const { error: memberError } = await supabaseAdmin
      .from('team_members')
      .insert({
        team_id: invitation.team_id,
        user_id: userId,
        role: invitation.role,
        invited_by: invitation.invited_by,
      })

    if (memberError) {
      console.error('Error adding team member:', memberError)
      return NextResponse.json({ error: 'Failed to join team' }, { status: 500 })
    }

    // Increment use count
    await supabaseAdmin
      .from('team_invitations')
      .update({ use_count: invitation.use_count + 1 })
      .eq('id', invitation.id)

    return NextResponse.json({
      success: true,
      teamId: invitation.team_id,
      teamName: (team as any)?.name,
      role: invitation.role,
    })

  } catch (error: any) {
    console.error('Accept invite POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}