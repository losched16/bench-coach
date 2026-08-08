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

export interface Entitlements {
  tier: Tier
  label: string
  teamFeatures: boolean
  ai: boolean
  loading: boolean
}

export function useEntitlements(coachId: string | null | undefined): Entitlements {
  const [state, setState] = useState<Omit<Entitlements, 'loading'>>({
    tier: 'team', label: 'Coach', teamFeatures: true, ai: true,
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
