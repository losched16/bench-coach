import { NextRequest, NextResponse } from 'next/server'
import { authorizeTeam, authzResponse, can } from '@/lib/authz'
import type { Capability, Role } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

// What am I allowed to do on this team?
//
// The routes and RLS already refuse what a role may not do. This exists so the
// UI does not OFFER it — a contributor who taps "Save lineup" and gets a
// refusal has been told the app is broken, even though the refusal was correct.
//
// Deliberately derived from the same can() the server enforces with, rather
// than a second list of rules kept in the browser. A permission model that
// exists twice is a permission model that will disagree with itself.

const CAPABILITIES: Capability[] = ['read', 'ask', 'record', 'decide', 'remember', 'own']

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')

  try {
    const actor = await authorizeTeam(teamId, 'read')
    const capabilities = Object.fromEntries(
      CAPABILITIES.map(c => [c, can(actor.role as Role, c)])
    )
    return NextResponse.json({
      role: actor.role,
      can: capabilities,
      // Shown once at the top of the dashboard so an invited coach knows where
      // they stand before they go looking for a button that isn't there.
      label: LABELS[actor.role as Role],
    })
  } catch (error) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    return NextResponse.json({ error: 'Could not check your access' }, { status: 500 })
  }
}

const LABELS: Record<Role, string> = {
  owner: 'Head coach',
  admin: 'Admin — everything except staff and billing',
  contributor: 'Contributor — you can keep the book, log what happens, and ask CoachAI',
  viewer: 'Viewer — read-only, but you can still ask CoachAI',
}
