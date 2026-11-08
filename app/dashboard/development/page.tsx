'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Loader2 } from 'lucide-react'
import { useTracker, usePageView } from '@/lib/tracking'
import { describeDuration, daysSince } from '@/lib/playerPathways'
import { developmentPlanLink } from '@/lib/programChoice'
import { programsEnabled } from '@/lib/programs/flag'
import ProgramsHub from '@/components/programs/ProgramsHub'

// Every Development Plan on the team, in one place.
//
// Plans are started and coached from a player's profile, and that stays the
// place to do both. This page exists so a coach can find them: before it, the
// only way in was Roster → player → Development tab, and the sidebar had no
// entry at all. Each row opens the same plan page the profile opens.
//
// Same honesty rule as the profile card: Stage N of M, never a percentage.

interface Row {
  id: string
  player_id: string
  pathway_version: number
  current_stage_key: string
  current_stage_number: number | null
  status: 'active' | 'paused' | 'completed'
  started_at: string
  stage_started_at: string
  completed_at: string | null
  stage_total: number
  sessions_total: number
  sessions_at_stage: number
  pathway: { slug: string; name: string } | null
  player: { id: string; name: string } | null
}

const GROUPS: Array<{ status: Row['status']; label: string }> = [
  { status: 'active', label: 'Active' },
  { status: 'paused', label: 'Paused' },
  { status: 'completed', label: 'Completed' },
]

function DevelopmentPlansContent() {
  usePageView('development')
  const router = useRouter()
  const track = useTracker()
  const teamId = useSearchParams().get('teamId')

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!teamId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setMessage(null)
    fetch(`/api/player-pathways?teamId=${encodeURIComponent(teamId)}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) setMessage(data.error || 'Could not load Development Plans.')
        else if (data.needsMigration) setMessage(data.migrationMessage || 'Development Plans are not available yet.')
        setRows(res.ok ? data.pathways || [] : [])
      })
      .catch(() => { if (!cancelled) setMessage('Could not load Development Plans.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [teamId])

  const open = (row: Row) => {
    track('player_pathway_opened', {
      pathway_slug: row.pathway?.slug || null,
      pathway_version: row.pathway_version,
      stage_number: row.current_stage_number,
      stage_key: row.current_stage_key,
      source_surface: 'team_list',
    })
    router.push(`/dashboard/roster/${row.player_id}/development/${row.id}?teamId=${teamId}`)
  }

  const start = developmentPlanLink(teamId)
  const hub = programsEnabled()
  const initialPlayerId = useSearchParams().get('playerId')

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">{hub ? 'Development' : 'Development Plans'}</h2>
        <p className="text-sm text-gray-600 mt-1">
          {hub
            ? 'Everything about helping a player improve, in one place.'
            : 'One player, stage by stage. Plans are started and coached from each player\u2019s profile.'}
        </p>
      </div>

      {hub && teamId && <ProgramsHub teamId={teamId} initialPlayerId={initialPlayerId} />}

      {hub && (
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Skill paths</h3>
          <p className="text-sm text-gray-600 mt-1">
            One skill, stage by stage, at the player&apos;s own pace. You decide when to move on. Started and coached from each player&apos;s profile.
          </p>
        </div>
      )}

      {!teamId ? (
        <p className="text-sm text-gray-600">Choose a team to see its Development Plans.</p>
      ) : loading ? (
        <div className="flex items-center gap-2 text-gray-500 text-sm">
          <Loader2 className="animate-spin" size={16} /> Loading…
        </div>
      ) : message ? (
        <p className="text-sm text-gray-600">{message}</p>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-6 text-center space-y-3">
          <p className="text-gray-700">{hub ? 'No skill paths on this team yet.' : 'No Development Plans on this team yet.'}</p>
          <Link href={start.href} className="inline-block text-sm font-medium text-blue-600 hover:underline">
            {hub ? 'Pick a player to start a skill path' : start.label}
          </Link>
        </div>
      ) : (
        GROUPS.map(g => {
          const list = rows.filter(r => r.status === g.status)
          if (list.length === 0) return null
          return (
            <section key={g.status} className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                {g.label} ({list.length})
              </h3>
              <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
                {list.map(row => (
                  <button key={row.id} onClick={() => open(row)}
                    className="w-full text-left p-4 hover:bg-gray-50 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 truncate">
                        {row.player?.name || 'Player'}
                        <span className="text-gray-500 font-normal"> · {row.pathway?.name || 'Development plan'}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {row.status !== 'completed' && (
                          <>
                            {row.current_stage_number
                              ? `Stage ${row.current_stage_number}${row.stage_total ? ` of ${row.stage_total}` : ''}`
                              : 'Stage not set'}
                            {' · '}
                          </>
                        )}
                        {row.sessions_total === 0
                          ? 'No sessions recorded yet'
                          : `${row.sessions_total} session${row.sessions_total === 1 ? '' : 's'} recorded`}
                        {' · '}
                        {row.status === 'completed' && row.completed_at
                          ? `Completed ${describeDuration(daysSince(row.completed_at))}`
                          : `Started ${describeDuration(daysSince(row.started_at))}`}
                      </p>
                    </div>
                    <ChevronRight className="text-gray-400 flex-shrink-0" size={20} />
                  </button>
                ))}
              </div>
            </section>
          )
        })
      )}
    </div>
  )
}

export default function DevelopmentPlansPage() {
  return (
    <Suspense fallback={null}>
      <DevelopmentPlansContent />
    </Suspense>
  )
}
