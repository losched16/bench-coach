'use client'

import { useEffect, useState } from 'react'

// The caller's league context, for the two lightweight things the coach-facing
// app does with it: say who is providing BenchCoach, and show administrators a
// way into their league.
//
// Sibling of useRole and useEntitlements, and the same division of labour —
// this decides what to SHOW. The routes and RLS decide what is allowed, so a
// coach who types /league-admin is refused by the server regardless of what
// this returned.
//
// Unlike those two it starts PESSIMISTIC: no league, no admin link. They
// assume owner and team-features because those are the common case and a beat
// of missing navigation is worse than a beat of extra. Here the common case is
// the opposite — almost nobody is a commissioner — and flashing "League Admin"
// at every coach on every page load would be both wrong and alarming.

export interface LeagueIdentity {
  id: string
  name: string
  logoUrl: string | null
}

export interface LeagueAdminOf extends LeagueIdentity {
  leagueId: string
  role: string
  slug: string | null
}

export interface LeagueContext {
  // Leagues this person administers. Empty for a sponsored coach.
  admin: LeagueAdminOf[]
  sponsored: boolean
  // The leagues paying for them. Almost always exactly one.
  sponsors: LeagueIdentity[]
  sponsoredTeamIds: string[]
  expiresAt: string | null
  loading: boolean
}

const EMPTY: Omit<LeagueContext, 'loading'> = {
  admin: [], sponsored: false, sponsors: [], sponsoredTeamIds: [], expiresAt: null,
}

export function useLeague(enabled: boolean = true): LeagueContext {
  const [state, setState] = useState(EMPTY)
  const [loading, setLoading] = useState(enabled)

  useEffect(() => {
    if (!enabled) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/league/me')
        const d = await res.json()
        if (cancelled || !res.ok) return
        setState({
          admin: Array.isArray(d.admin) ? d.admin : [],
          sponsored: !!d.sponsorship?.sponsored,
          sponsors: Array.isArray(d.sponsorship?.leagues) ? d.sponsorship.leagues : [],
          sponsoredTeamIds: Array.isArray(d.sponsorship?.teamIds) ? d.sponsorship.teamIds : [],
          expiresAt: d.sponsorship?.expiresAt || null,
        })
      } catch {
        // Staying empty is safe: a coach sees no badge, an admin loses a link
        // they can still reach by URL. Neither breaks anything.
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [enabled])

  return { ...state, loading }
}
