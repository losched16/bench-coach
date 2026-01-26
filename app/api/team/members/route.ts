import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Use service role for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// GET - List team members
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const teamId = searchParams.get('teamId')

    if (!teamId) {
      return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })
    }

    // Get current user
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get team
    const { data: team, error: teamError } = await supabaseAdmin
      .from('teams')
      .select('id, name, coach_id')
      .eq('id', teamId)
      .single()

    if (!team) {
      return NextResponse.json({ 
        error: 'Team not found',
        debug: { teamId, teamError: teamError?.message }
      }, { status: 404 })
    }

    // Get the coach/owner info
    const { data: ownerCoach, error: coachError } = await supabaseAdmin
      .from('coaches')
      .select('id, name, user_id')
      .eq('id', team.coach_id)
      .single()

    // Get team members
    const { data: members, error: membersError } = await supabaseAdmin
      .from('team_members')
      .select('id, role, joined_at, user_id')
      .eq('team_id', teamId)
      .order('joined_at', { ascending: true })

    // Get coach info for each member
    const membersWithInfo = await Promise.all(
      (members || []).map(async (member) => {
        const { data: coach } = await supabaseAdmin
          .from('coaches')
          .select('name')
          .eq('user_id', member.user_id)
          .single()

        return {
          ...member,
          name: coach?.name || 'Unknown',
        }
      })
    )

    // Determine current user's role
    let currentUserRole = null
    if (ownerCoach?.user_id === user.id) {
      currentUserRole = 'owner'
    } else {
      const userMember = members?.find(m => m.user_id === user.id)
      currentUserRole = userMember?.role || null
    }

    return NextResponse.json({
      team: {
        id: team.id,
        name: team.name,
      },
      owner: {
        id: ownerCoach?.id || null,
        name: ownerCoach?.name || null,
        user_id: ownerCoach?.user_id || null,
      },
      members: membersWithInfo,
      currentUserRole,
      // Debug info
      debug: {
        teamCoachId: team.coach_id,
        ownerCoachFound: !!ownerCoach,
        ownerCoachUserId: ownerCoach?.user_id || null,
        currentUserId: user.id,
        coachError: coachError?.message || null,
        membersError: membersError?.message || null,
      }
    })

  } catch (error: any) {
    console.error('Members GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// PATCH - Update a member's role
export async function PATCH(request: NextRequest) {
  try {
    const { memberId, role } = await request.json()

    if (!memberId || !role) {
      return NextResponse.json({ error: 'Missing memberId or role' }, { status: 400 })
    }

    if (!['viewer', 'contributor', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Get current user
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the member record
    const { data: member } = await supabaseAdmin
      .from('team_members')
      .select('team_id')
      .eq('id', memberId)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Verify user is owner or admin
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('coach:coaches(user_id)')
      .eq('id', member.team_id)
      .single()

    const coach = Array.isArray((team as any)?.coach) ? (team as any)?.coach[0] : (team as any)?.coach
    const isOwner = coach?.user_id === user.id

    if (!isOwner) {
      const { data: userMembership } = await supabaseAdmin
        .from('team_members')
        .select('role')
        .eq('team_id', member.team_id)
        .eq('user_id', user.id)
        .single()

      if (userMembership?.role !== 'admin') {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }
    }

    // Update role
    const { error } = await supabaseAdmin
      .from('team_members')
      .update({ role })
      .eq('id', memberId)

    if (error) {
      console.error('Error updating member:', error)
      return NextResponse.json({ error: 'Failed to update member' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Members PATCH error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE - Remove a team member
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const memberId = searchParams.get('id')

    if (!memberId) {
      return NextResponse.json({ error: 'Missing member id' }, { status: 400 })
    }

    // Get current user
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the member record
    const { data: member } = await supabaseAdmin
      .from('team_members')
      .select('team_id, user_id')
      .eq('id', memberId)
      .single()

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Check if user is removing themselves or has permission
    const isSelf = member.user_id === user.id

    if (!isSelf) {
      // Verify user is owner
      const { data: team } = await supabaseAdmin
        .from('teams')
        .select('coach:coaches(user_id)')
        .eq('id', member.team_id)
        .single()

      if (team?.coach?.user_id !== user.id) {
        return NextResponse.json({ error: 'Only team owner can remove members' }, { status: 403 })
      }
    }

    // Remove member
    const { error } = await supabaseAdmin
      .from('team_members')
      .delete()
      .eq('id', memberId)

    if (error) {
      console.error('Error removing member:', error)
      return NextResponse.json({ error: 'Failed to remove member' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Members DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
