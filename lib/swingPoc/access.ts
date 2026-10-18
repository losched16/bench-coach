// Swing mechanics POC — who may touch a capture (server only).
//
// A capture's team and player come from its stored meta, never from the
// request, and are run through the app's ordinary player authorization
// (lib/authz.ts authorizePlayer → resolvePlayerScope). So a coach on another
// team, or a capture id guessed from a URL, gets the same 404 as a capture
// that does not exist.

import { NextResponse } from 'next/server'
import { authorizePlayer, authzResponse, type Capability } from '@/lib/authz'
import { readMeta, StoreError, type CaptureMeta } from './store'
import { swingPocEnabled } from './rules'

export function notEnabled(): NextResponse | null {
  // 404, not 403: with the flag off the feature does not exist.
  return swingPocEnabled() ? null : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function authorizeCapture(id: string, capability: Capability): Promise<{ meta: CaptureMeta; userId: string; ownerCoachId: string }> {
  const meta = await readMeta(id)
  const actor = await authorizePlayer(meta.player_id, { teamId: meta.team_id, capability })
  return { meta, userId: actor.userId, ownerCoachId: actor.ownerCoachId }
}

export function errorResponse(error: unknown): NextResponse {
  const authz = authzResponse(error)
  if (authz) return NextResponse.json(authz.body, { status: authz.status })
  if (error instanceof StoreError) return NextResponse.json({ error: error.message }, { status: error.status })
  // No video, frame or child detail in logs — just the message.
  console.error('swing-poc error:', (error as any)?.message || error)
  return NextResponse.json({ error: 'Something went wrong with this capture.' }, { status: 500 })
}
