'use client'

import { useEffect, useState } from 'react'
import type { Tier } from '@/lib/tiers'

// What the workspace owner's plan includes.
//
// Sibling of useRole, and the same division of labour: this decides what to
// SHOW, the routes decide what to allow. A Personal subscriber who reached a
// Coach-only route by typing the URL is refused by the server regardless.
//
// It assumes team features until the answer arrives, for the same reason
// useRole assumes owner: most workspaces are Coach, and making the whole
// navigation appear a beat late on every page load is worse than a Personal
// subscriber briefly seeing a menu item that then disappears.

export interface Workspace {
  id: string
  name: string
  kind: 'team' | 'personal'
}

export interface Entitlements {
  tier: Tier
  label: string
  teamFeatures: boolean
  ai: boolean
  // Every workspace this coach owns. Carried here because the screens that
  // need a team are exactly the screens that have to offer one.
  workspaces: Workspace[]
  loading: boolean
}

export function useEntitlements(coachId: string | null | undefined): Entitlements {
  const [state, setState] = useState<Omit<Entitlements, 'loading'>>({
    tier: 'team', label: 'Coach', teamFeatures: true, ai: true, workspaces: [],
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!coachId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/entitlements?coachId=${coachId}`)
        const d = await res.json()
        if (cancelled || !res.ok) return
        setState({
          tier: d.tier || 'team',
          label: d.label || 'Coach',
          teamFeatures: d.teamFeatures !== false,
          ai: d.ai !== false,
          workspaces: Array.isArray(d.workspaces) ? d.workspaces : [],
        })
      } catch {
        // Leaving it permissive is safe: the server is what enforces.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [coachId])

  return { ...state, loading }
}
