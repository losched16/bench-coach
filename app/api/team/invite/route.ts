import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import crypto from 'crypto'

// Use service role for admin operations
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

// Generate a secure random token
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// GET - List invitations for a team
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

    // Get active invitations
    const { data: invitations, error } = await supabaseAdmin
      .from('team_invitations')
      .select('*')
      .eq('team_id', teamId)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching invitations:', error)
      return NextResponse.json({ error: 'Failed to fetch invitations' }, { status: 500 })
    }

    return NextResponse.json({ invitations })

  } catch (error: any) {
    console.error('Invitation GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST - Create a new invitation
export async function POST(request: NextRequest) {
  try {
    const { teamId, role, expiresInDays = 7, maxUses = 1, userId, coachId } = await request.json()

    if (!teamId || !role) {
      return NextResponse.json({ error: 'Missing teamId or role' }, { status: 400 })
    }

    if (!userId || !coachId) {
      return NextResponse.json({ error: 'Missing user credentials' }, { status: 400 })
    }

    if (!['viewer', 'contributor', 'admin'].includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    // Verify the coach exists and belongs to this user
    const { data: coach } = await supabaseAdmin
      .from('coaches')
      .select('id, user_id')
      .eq('id', coachId)
      .eq('user_id', userId)
      .single()

    if (!coach) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    // Verify user has permission to invite (owner or admin)
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('coach_id')
      .eq('id', teamId)
      .single()

    const isOwner = team?.coach_id === coachId

    if (!isOwner) {
      // Check if admin
      const { data: membership } = await supabaseAdmin
        .from('team_members')
        .select('role')
        .eq('team_id', teamId)
        .eq('user_id', userId)
        .single()

      if (membership?.role !== 'admin') {
        return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
      }
    }

    // Generate token and expiration
    const token = generateToken()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + expiresInDays)

    // Create invitation
    const { data: invitation, error } = await supabaseAdmin
      .from('team_invitations')
      .insert({
        team_id: teamId,
        role,
        token,
        invited_by: userId,
        expires_at: expiresAt.toISOString(),
        max_uses: maxUses,
      })
      .select()
      .single()

    if (error) {
      console.error('Error creating invitation:', error)
      return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
    }

    // Build invite URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const inviteUrl = `${baseUrl}/invite/${token}`

    return NextResponse.json({ 
      invitation,
      inviteUrl 
    })

  } catch (error: any) {
    console.error('Invitation POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// DELETE - Revoke an invitation
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const invitationId = searchParams.get('id')

    if (!invitationId) {
      return NextResponse.json({ error: 'Missing invitation id' }, { status: 400 })
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

    // Revoke the invitation
    const { error } = await supabaseAdmin
      .from('team_invitations')
      .update({ status: 'revoked' })
      .eq('id', invitationId)

    if (error) {
      console.error('Error revoking invitation:', error)
      return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 })
    }

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error('Invitation DELETE error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
