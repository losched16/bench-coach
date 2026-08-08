'use client'

import { useEffect, useState } from 'react'
import type { Capability, Role } from '@/lib/authz'

// The caller's role on the current team, for hiding what they cannot do.
//
// This is presentation only. The routes and RLS are what actually stop a
// contributor from changing the roster; this stops them being shown the button
// and then refused, which reads as a bug rather than as a rule.
//
// It OPTIMISTICALLY assumes owner until the answer arrives. That is the right
// way round: the head coach is the overwhelmingly common case and must not
// watch buttons appear a beat late on every screen. A contributor sees a
// moment of controls they cannot use, and the server refuses them anyway.

export interface RoleState {
  role: Role
  loading: boolean
  can: (capability: Capability) => boolean
  label: string | null
}

const RANK: Record<Role, number> = { viewer: 0, contributor: 1, admin: 2, owner: 3 }
const NEEDS: Record<Capability, Role> = {
  read: 'viewer', ask: 'viewer', record: 'contributor',
  decide: 'admin', remember: 'admin', own: 'owner',
}

export function useRole(teamId: string | null | undefined): RoleState {
  const [role, setRole] = useState<Role>('owner')
  const [label, setLabel] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!teamId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/me?teamId=${teamId}`)
        const d = await res.json()
        if (cancelled) return
        if (res.ok && d.role) {
          setRole(d.role as Role)
          setLabel(d.label || null)
        }
      } catch {
        // Leaving it at owner is safe: the server is the thing that enforces.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [teamId])

  return {
    role,
    loading,
    label,
    can: (capability: Capability) => RANK[role] >= RANK[NEEDS[capability]],
  }
}
