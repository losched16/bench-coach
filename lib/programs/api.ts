// Shared plumbing for the development-program routes.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authzResponse } from '../authz'
import { FEATURE_UNAVAILABLE, migrationHintFor } from '../migrationHints'
import { programsEnabled } from './flag'
import { StoreError, isMissingTables } from './store'

export const admin = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/** Null when the feature is on; a 404 when it is not (as if the route did not exist). */
export function flagOff(): NextResponse | null {
  return programsEnabled() ? null : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export function fail(error: unknown): NextResponse {
  const authz = authzResponse(error)
  if (authz) return NextResponse.json(authz.body, { status: authz.status })
  if (error instanceof StoreError) {
    const status = { not_found: 404, conflict: 409, invalid: 422, closed: 409, db: 500 }[error.code]
    if (error.code === 'db' && isMissingTables(error.detail)) {
      return NextResponse.json({ error: FEATURE_UNAVAILABLE, needsMigration: true }, { status: 503 })
    }
    return NextResponse.json({ error: error.message }, { status })
  }
  const hint = migrationHintFor(error as any)
  if (hint) return NextResponse.json({ error: hint.message, needsMigration: true }, { status: 503 })
  console.error('[programs] route error:', (error as any)?.message)
  return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
}

/** Checks that block saving. Everything else is shown to the coach as a warning. */
export const BLOCKING_CHECKS = new Set(['schema', 'skills_covered', 'timeline', 'safety', 'throwing_gate', 'unique_sessions', 'drill_ids'])
