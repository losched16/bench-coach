'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Zap, ChevronRight } from 'lucide-react'

// A small entry on the player's Development tab. It renders nothing unless the
// program API answers, so with the launch flag off it does not exist.
export function SpeedProgramCard({ playerId, teamId }: { playerId: string; teamId: string | null }) {
  const [state, setState] = useState<'hidden' | 'none' | { level: string; week: number; status: string }>('hidden')

  useEffect(() => {
    if (!teamId) return
    let off = false
    fetch(`/api/speed-program?teamId=${teamId}&playerId=${playerId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (off || !d) return
        const live = (d.programs || []).find((p: any) => p.status !== 'completed')
        setState(live ? { level: live.level, week: live.current_week, status: live.status } : 'none')
      })
      .catch(() => {})
    return () => { off = true }
  }, [playerId, teamId])

  if (state === 'hidden' || !teamId) return null
  return (
    <Link href={`/dashboard/roster/${playerId}/speed-program?teamId=${teamId}`} data-testid="speed-program-card"
      className="flex items-center justify-between gap-3 bg-white rounded-lg shadow p-4 hover:bg-gray-50">
      <span className="flex items-center gap-3 min-w-0">
        <Zap size={20} className="text-red-600 shrink-0" />
        <span className="min-w-0">
          <span className="block font-medium text-gray-900">Speed, Agility &amp; Explosiveness</span>
          <span className="block text-sm text-gray-600">
            {state === 'none' ? 'A four-week, coach-led program. Not assigned yet.' : `${state.level[0].toUpperCase()}${state.level.slice(1)} · week ${state.week} of 4${state.status === 'paused' ? ' · paused' : ''}`}
          </span>
        </span>
      </span>
      <ChevronRight size={18} className="text-gray-400 shrink-0" />
    </Link>
  )
}
