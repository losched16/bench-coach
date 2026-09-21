'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Loader2, ChevronRight, X, Route as RouteIcon } from 'lucide-react'
import { useTracker } from '@/lib/tracking'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { loadPathways } from '@/lib/developmentPathways'
import { describeDuration, daysSince } from '@/lib/playerPathways'
import { ModuleHelp } from '@/components/help/ModuleHelp'
import { ProgramChoiceNote } from '@/components/ProgramChoiceNote'
import { developmentBlurb } from '@/lib/programChoice'

// The Development section of a player profile.
//
// "A coach doesn't want a report. They want a report for Charlie." Same here:
// this is not a pathways browser that happens to know a player, it is the
// answer to "what is this kid working on", and the primary action on every card
// is to open the plan and coach from it.
//
// It renders nothing that it has not been told. No progress bar percentage on a
// curriculum — a player on stage 3 of 10 is not 30% of the way to anything, and
// a bar would say they were. Stage 3 of 10 is the honest statement.

interface Props {
  playerId: string
  teamId: string | null
  playerName: string
  /** Enrolling and advancing are 'decide'. A contributor sees the plans, read-only. */
  canDecide: boolean
}

interface PathwayRow {
  id: string
  pathway_id: string
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
  pathway: { slug: string; name: string; skill_category: string | null; summary: string | null } | null
}

interface Option { slug: string; name: string; summary: string | null }

export function PlayerDevelopment({ playerId, teamId, playerName, canDecide }: Props) {
  const router = useRouter()
  const track = useTracker()
  const supabase = createSupabaseComponentClient()

  const [rows, setRows] = useState<PathwayRow[]>([])
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [picking, setPicking] = useState(false)
  const [options, setOptions] = useState<Option[]>([])
  const [optionsState, setOptionsState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [starting, setStarting] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!teamId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/player-pathways?teamId=${teamId}&playerId=${playerId}`)
      const data = await res.json()
      if (data.needsMigration) {
        setNeedsMigration(data.migrationMessage || 'Development plans are not set up yet.')
        setRows([])
      } else if (!res.ok) {
        setError(data.error || 'Could not load development plans')
      } else {
        setNeedsMigration(null)
        setRows(data.pathways || [])
      }
    } catch {
      setError('Could not load development plans')
    } finally {
      setLoading(false)
    }
  }, [teamId, playerId])

  useEffect(() => { load() }, [load])

  const openPicker = async () => {
    setPicking(true)
    if (optionsState === 'ready' || optionsState === 'loading') return
    setOptionsState('loading')
    try {
      const list = await loadPathways(supabase)
      setOptions(list.map(p => ({ slug: p.slug, name: p.name, summary: p.summary || null })))
      setOptionsState('ready')
    } catch {
      setOptionsState('error')
    }
  }

  const start = async (slug: string) => {
    if (!teamId) return
    setStarting(slug)
    try {
      const res = await fetch('/api/player-pathways', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, playerId, pathwaySlug: slug }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not start that plan'); return }

      // No player id, no name, no team. The slug is published content.
      track('player_pathway_started', { pathway_slug: slug, source_surface: 'player_profile' })
      setPicking(false)
      router.push(`/dashboard/roster/${playerId}/development/${data.progressId}?teamId=${teamId}`)
    } catch {
      setError('Could not start that plan')
    } finally {
      setStarting(null)
    }
  }

  const alreadyLive = new Set(
    rows.filter(r => r.status !== 'completed').map(r => r.pathway?.slug).filter(Boolean) as string[])

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-8 flex items-center justify-center text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} /> Loading development plans...
      </div>
    )
  }

  if (needsMigration) {
    return (
      <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm">
        {needsMigration}
      </div>
    )
  }

  const active = rows.filter(r => r.status !== 'completed')
  const done = rows.filter(r => r.status === 'completed')

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* suppressCard because the empty state below already explains what a
          development plan is, in better words than a generic card would. Only
          the "How to use this" button shows, so the two do not stack. */}
      <ModuleHelp
        module="player-development"
        ctx={{ teamId, playerId }}
        hasTeam={!!teamId}
        can={(c) => (c === 'decide' ? canDecide : true)}
        suppressCard={active.length === 0}
      />

      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200 flex items-center justify-between">
          <h4 className="font-semibold text-gray-900 flex items-center space-x-2">
            <RouteIcon size={18} className="text-red-600" />
            <span>Development Plans</span>
            {active.length > 0 && (
              <span className="text-sm font-normal text-gray-500">({active.length})</span>
            )}
          </h4>
          {canDecide && (
            <button
              onClick={openPicker}
              className="flex items-center space-x-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm"
            >
              <Plus size={16} /><span>Start Development Plan</span>
            </button>
          )}
        </div>

        {active.length === 0 ? (
          <div className="p-12 text-center">
            <RouteIcon className="mx-auto text-gray-300 mb-4" size={48} />
            <p className="text-gray-600 mb-1">No development plan yet</p>
            {/* The old text said a plan "follows a curated teaching sequence,
                one stage at a time" — true, and equally true of a playbook as
                far as a coach could tell. What separates them is that the next
                stage waits on the coach's judgement, so that is what this
                says now, with {playerName} kept. */}
            <p className="text-sm text-gray-500 mb-4 max-w-md mx-auto">
              {developmentBlurb(playerName)}
            </p>
            {canDecide ? (
              <button onClick={openPicker} className="text-red-600 hover:text-red-700 font-medium">
                Start their first plan
              </button>
            ) : (
              <p className="text-xs text-gray-400">Ask the head coach to start one.</p>
            )}
            {/* The cross-link belongs on the empty state rather than beside the
                header button: a coach who already has a plan running is not
                choosing between the two any more. */}
            <ProgramChoiceNote
              variant="development"
              teamId={teamId}
              playerId={playerId}
              canCrossLink={canDecide}
              compact
              className="mt-5 pt-4 border-t border-gray-100 text-left max-w-md mx-auto"
            />
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {active.map(r => (
              <PlanCard key={r.id} row={r} playerId={playerId} teamId={teamId} track={track} />
            ))}
          </div>
        )}
      </div>

      {done.length > 0 && (
        <div className="bg-white rounded-lg shadow">
          <div className="p-6 border-b border-gray-200">
            <h4 className="font-semibold text-gray-900">Completed</h4>
          </div>
          <div className="divide-y divide-gray-100">
            {done.map(r => (
              <PlanCard key={r.id} row={r} playerId={playerId} teamId={teamId} track={track} />
            ))}
          </div>
        </div>
      )}

      {picking && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] flex flex-col">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between">
              <div className="min-w-0">
                <h3 className="text-lg font-bold text-gray-900">
                  What is {playerName} working on?
                </h3>
                {/* At the moment of choosing, say what they are choosing: a
                    stage sequence they advance, not a fixed session list. */}
                <p className="text-xs text-gray-500 mt-0.5">
                  Each plan is a sequence of stages. You decide when to move on.
                </p>
              </div>
              <button
                onClick={() => setPicking(false)}
                aria-label="Close"
                className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="overflow-y-auto p-2">
              {optionsState === 'loading' && (
                <div className="p-8 text-center text-gray-500 flex items-center justify-center">
                  <Loader2 className="animate-spin mr-2" size={18} /> Loading...
                </div>
              )}
              {optionsState === 'error' && (
                <div className="p-6 text-center">
                  <p className="text-gray-600 mb-3">Could not load the plans.</p>
                  <button onClick={openPicker} className="text-red-600 hover:text-red-700 font-medium">
                    Try again
                  </button>
                </div>
              )}
              {optionsState === 'ready' && options.length === 0 && (
                <div className="p-8 text-center text-gray-500">
                  No development plans are published yet.
                </div>
              )}
              {optionsState === 'ready' && options.map(o => {
                const live = alreadyLive.has(o.slug)
                return (
                  <button
                    key={o.slug}
                    disabled={live || starting !== null}
                    onClick={() => start(o.slug)}
                    className={`w-full text-left p-4 rounded-lg mb-1 border transition-colors ${
                      live
                        ? 'border-gray-100 bg-gray-50 cursor-default'
                        : 'border-gray-200 hover:border-red-300 hover:bg-red-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-gray-900">{o.name}</span>
                      {live
                        ? <span className="text-xs text-gray-500">Already started</span>
                        : starting === o.slug
                          ? <Loader2 className="animate-spin text-gray-400" size={16} />
                          : <ChevronRight className="text-gray-400" size={18} />}
                    </div>
                    {o.summary && (
                      <p className="text-sm text-gray-600 mt-1 leading-snug">{o.summary}</p>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanCard({
  row, playerId, teamId, track,
}: {
  row: PathwayRow
  playerId: string
  teamId: string | null
  track: (n: string, m?: Record<string, any>) => void
}) {
  const router = useRouter()
  const name = row.pathway?.name || 'Development plan'
  const open = () => {
    track('player_pathway_opened', {
      pathway_slug: row.pathway?.slug || null,
      pathway_version: row.pathway_version,
      stage_number: row.current_stage_number,
      stage_key: row.current_stage_key,
      source_surface: 'player_profile',
    })
    router.push(`/dashboard/roster/${playerId}/development/${row.id}?teamId=${teamId}`)
  }

  return (
    <button onClick={open} className="w-full text-left p-4 hover:bg-gray-50 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900">{name}</span>
          {row.status === 'paused' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Paused</span>
          )}
          {row.status === 'completed' && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Complete</span>
          )}
        </div>

        {row.status !== 'completed' && (
          <p className="text-sm text-gray-600 mt-0.5">
            {/* Stage N of M, never a percentage. A curriculum is not a loading bar. */}
            {row.current_stage_number
              ? `Stage ${row.current_stage_number}${row.stage_total ? ` of ${row.stage_total}` : ''}`
              : 'Stage not set'}
          </p>
        )}

        <p className="text-xs text-gray-500 mt-1">
          {row.sessions_total === 0
            ? 'No sessions recorded yet'
            : `${row.sessions_total} session${row.sessions_total === 1 ? '' : 's'} recorded`}
          {row.status !== 'completed' && row.sessions_at_stage > 0 &&
            ` · ${row.sessions_at_stage} at this stage`}
          {' · '}
          {row.status === 'completed' && row.completed_at
            ? `Completed ${describeDuration(daysSince(row.completed_at))}`
            : `Started ${describeDuration(daysSince(row.started_at))}`}
        </p>
      </div>
      <ChevronRight className="text-gray-400 flex-shrink-0" size={20} />
    </button>
  )
}
