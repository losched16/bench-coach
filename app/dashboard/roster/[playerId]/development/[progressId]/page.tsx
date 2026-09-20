'use client'

import { useCallback, useEffect, useMemo, useState, Suspense } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Loader2, Check, ChevronRight, ChevronLeft, ChevronDown, ChevronUp,
  CheckCircle2, Gauge, ClipboardList, Dumbbell, X, CalendarPlus,
  AlertTriangle, Play, ExternalLink, Map as MapIcon, StickyNote, Eye,
} from 'lucide-react'
import { DrillVideo } from '@/components/DrillVideo'
import { usePageView, useTracker } from '@/lib/tracking'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { useRole } from '@/lib/useRole'
import type { PathwayStage } from '@/lib/developmentPathways'
import {
  PlayerPathwayProgress, PlayerPathwayEvent, coachDecisions, sessionCounts,
  checkedSignals, describeEvent, describeDuration, daysSince,
  summariseSpeedMeasurements, formatChange, MeasurementSummary, staleStageMessage,
  planOutline, practiceRange, PlanOutline, OutlineStage, notesForStage,
} from '@/lib/playerPathways'
import type { MetricType, MetricReading } from '@/lib/metrics'
import { formatValue } from '@/lib/metrics'

// One player, one pathway, one stage.
//
// The page answers two questions in this order, because that is the order a
// coach asks them: what should I work on with this kid today, and is he ready
// for the next thing. Everything on the page is one of those two.
//
// It does not decide anything. The mastery checkboxes record what the coach
// observed; they do not unlock the advance button, and nothing counts sessions
// and advances on the coach's behalf. The brief's principle is that AI assists
// and the coach decides, and the smallest version of honouring that is to make
// the button the only thing that moves a player.

const ROLE_LABEL: Record<string, string> = {
  primary: 'Teach it',
  regression: 'If they are not there yet',
  reinforcement: 'Reps',
  progression: 'Once it holds',
  assessment: 'Check it',
  game_application: 'Into a game',
}

const ROLE_CHIP: Record<string, string> = {
  primary: 'bg-red-100 text-red-700',
  regression: 'bg-amber-100 text-amber-800',
  reinforcement: 'bg-blue-100 text-blue-700',
  progression: 'bg-purple-100 text-purple-700',
  assessment: 'bg-green-100 text-green-700',
  game_application: 'bg-gray-200 text-gray-700',
}

interface Detail {
  progress: PlayerPathwayProgress & {
    pathway: { slug: string; name: string; skill_category: string | null; version?: number } | null
  }
  player: { id: string; name: string } | null
  events: PlayerPathwayEvent[]
  pathway: {
    slug: string
    name: string
    skill_category: string | null
    stages: PathwayStage[]
    drillCounts?: Record<string, number>
  } | null
  drillPool: Record<string, StageDrill>
  stageDrills: Record<string, Array<{ id: string; role: string; step: string; rationale: string }>>
  stageMissing: boolean
}

interface StageDrill {
  id: string
  drill_name: string
  est_duration_minutes: number | null
  equipment_needed: string[] | null
  space_required: string | null
  indoor_outdoor: string | null
  requires_partner: boolean | null
  min_players: number | null
  ideal_group_size: number | null
  age_range: string | null
  difficulty_level: string | null
  reps_guidance: string | null
  description: string | null
  ai_coaching_notes: string | null
  regression_notes: string | null
  progression_notes: string | null
  success_markers: string[] | null
  common_flaws_fixed: string[] | null
  safety_notes: string | null
  media: Array<{
    media_type: string
    url: string
    title: string | null
    source_name: string | null
    thumbnail_url: string | null
    start_seconds: number | null
    verification_status: string
    presentation: { label: string; note: string | null }
    shared_with: number
  }>
}

function DevelopmentPlanContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const track = useTracker()
  const supabase = createSupabaseComponentClient()

  const playerId = params.playerId as string
  const progressId = params.progressId as string
  const teamId = searchParams.get('teamId')
  const { can } = useRole(teamId)
  const canDecide = can('decide')
  const canRecord = can('record')

  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [coachId, setCoachId] = useState<string | null>(null)
  const [types, setTypes] = useState<MetricType[]>([])
  const [readings, setReadings] = useState<MetricReading[]>([])

  // THE STAGE BEING LOOKED AT, WHICH IS NOT ALWAYS THE STAGE HE IS ON.
  //
  // The plan is a course. A coach can open stage 7 while the player stands on
  // stage 3, read the whole thing, and decide from that whether to move him.
  // Null means "wherever he actually is", so the page lands on his stage and
  // follows him when he moves.
  const [viewingKey, setViewingKey] = useState<string | null>(null)

  const [showSession, setShowSession] = useState(false)
  const [showNote, setShowNote] = useState(false)
  const [showAssessment, setShowAssessment] = useState(false)
  const [confirm, setConfirm] = useState<null | { kind: 'advance' | 'regress' | 'complete' | 'jump'; toStageKey?: string; label: string; body: string }>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/player-pathways/${progressId}`)
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Could not load this plan'); return }
      setDetail(data)
      setError(null)
    } catch {
      setError('Could not load this plan')
    } finally {
      setLoading(false)
    }
  }, [progressId])

  useEffect(() => { load() }, [load])

  // Measurements come from the existing metrics system, unchanged.
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: coach } = await supabase.from('coaches').select('id').eq('user_id', user.id).single()
      const id = (coach as any)?.id
      if (!id) return
      setCoachId(id)
      try {
        const res = await fetch(`/api/metrics?coachId=${id}&playerId=${playerId}&teamId=${teamId || ''}`)
        const d = await res.json()
        setTypes(d.types || [])
        setReadings(d.readings || [])
      } catch { /* measurements are a section, not the page */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId, teamId])

  const loaded = useMemo(() => {
    if (!detail?.pathway) return null
    return {
      pathway: { id: detail.progress.pathway_id, slug: detail.pathway.slug, name: detail.pathway.name,
        skill_category: detail.pathway.skill_category, status: 'published' } as any,
      stages: detail.pathway.stages,
      linksByStage: new Map(),
      problemsByStage: new Map(),
    }
  }, [detail])

  // The stage on screen. Defaults to where the player is, and falls back there
  // if a viewed key stops resolving — a coach browsing stage 9 when the pathway
  // is re-curated should land somewhere real, not on an empty page.
  const currentKey = detail?.progress.current_stage_key ?? null
  const stage = useMemo(() => {
    const stages = detail?.pathway?.stages || []
    return stages.find(s => s.stage_key === (viewingKey ?? currentKey))
      || stages.find(s => s.stage_key === currentKey)
      || null
  }, [detail, viewingKey, currentKey])

  const viewedKey = stage?.stage_key ?? null
  const isViewingCurrent = viewedKey != null && viewedKey === currentKey
  const allStages = detail?.pathway?.stages || []
  const idx = allStages.findIndex(s => s.stage_key === viewedKey)
  const currentStage = allStages.find(s => s.stage_key === currentKey) || null
  const currentStageNumber = currentStage?.stage_number ?? null

  const decisions = useMemo(
    () => coachDecisions(loaded, detail?.progress || null),
    [loaded, detail])

  const sessions = useMemo(
    () => sessionCounts(detail?.events, detail?.progress.current_stage_key),
    [detail])

  // Observations belong to the stage being looked at. A coach reading ahead who
  // ticks "he can already do this" on stage 6 means stage 6, and filing it
  // against stage 3 because that is where he officially stands would put it
  // where nobody looks for it.
  const checked = useMemo(
    () => checkedSignals(detail?.events, viewedKey),
    [detail, viewedKey])

  const stageNotes = useMemo(
    () => notesForStage(detail?.events, viewedKey),
    [detail, viewedKey])

  // Sessions logged at the stage being READ, which is not the same number as
  // sessions at the stage he is on once a coach starts browsing.
  const viewedSessions = useMemo(
    () => sessionCounts(detail?.events, viewedKey).atCurrentStage,
    [detail, viewedKey])

  const viewedDrills = useMemo<Array<StageDrill & { role: string; rationale: string; step: string }>>(() => {
    if (!detail || !viewedKey) return []
    return (detail.stageDrills?.[viewedKey] || [])
      .map(ref => {
        const full = detail.drillPool?.[ref.id]
        return full ? { ...full, role: ref.role, rationale: ref.rationale, step: ref.step } : null
      })
      .filter(Boolean) as Array<StageDrill & { role: string; rationale: string; step: string }>
  }, [detail, viewedKey])

  const speed = useMemo<MeasurementSummary[]>(
    () => summariseSpeedMeasurements(types, readings),
    [types, readings])

  const outline = useMemo(
    () => planOutline(
      loaded, detail?.progress || null, detail?.events,
      detail?.pathway?.drillCounts
        ? new Map(Object.entries(detail.pathway.drillCounts))
        : null),
    [loaded, detail])

  const stageName = useCallback(
    (key: string | null) => detail?.pathway?.stages.find(s => s.stage_key === key)?.name || 'a stage',
    [detail])

  const act = async (kind: string, payload: Record<string, any> = {}) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/player-pathways/${progressId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, ...payload }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'That did not work'); return false }
      setError(null)
      await load()
      return true
    } catch {
      setError('That did not work')
      return false
    } finally {
      setBusy(false)
    }
  }

  const move = async (kind: 'advance' | 'regress' | 'complete' | 'jump', toStageKey?: string) => {
    const target = kind === 'advance' ? decisions.advance : kind === 'regress' ? decisions.regress : null
    const landing = kind === 'jump'
      ? allStages.find(s => s.stage_key === toStageKey) || null
      : target?.stage || null
    const ok = await act(kind, kind === 'jump'
      ? { toStageKey }
      : target ? { toStageKey: target.stage.stage_key } : {})
    if (ok) {
      const forward = (landing?.stage_number ?? 0) >= (currentStageNumber ?? 0)
      track(
        kind === 'complete' ? 'player_pathway_completed'
          : kind === 'advance' || (kind === 'jump' && forward)
            ? 'player_pathway_stage_advanced'
            : 'player_pathway_stage_regressed',
        {
          pathway_slug: detail?.pathway?.slug || null,
          pathway_version: detail?.progress.pathway_version ?? null,
          stage_number: landing?.stage_number ?? detail?.progress.current_stage_number ?? null,
          stage_key: landing?.stage_key ?? detail?.progress.current_stage_key ?? null,
          // Distinguishes a deliberate jump from a one-step move, so the
          // question "do coaches use the sequence" stays answerable.
          via: kind === 'jump' ? 'jump' : 'step',
          source_surface: 'development_plan',
        })
      // Follow the player rather than stranding the reader on the old stage.
      setViewingKey(null)
    }
    setConfirm(null)
  }

  const toggleSignal = async (signal: string) => {
    if (!canRecord || !stage) return
    const next = new Set(checked)
    if (next.has(signal)) next.delete(signal); else next.add(signal)
    await act('mastery', { signals: Array.from(next), stageKey: viewedKey })
  }

  if (loading) {
    return <div className="flex items-center text-gray-600"><Loader2 className="animate-spin mr-2" size={18} /> Loading...</div>
  }
  if (error && !detail) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 mb-4">{error}</p>
        <button onClick={() => router.push(`/dashboard/roster/${playerId}?teamId=${teamId}`)}
          className="text-red-600 hover:text-red-700">Back to the player</button>
      </div>
    )
  }
  if (!detail) return null

  const playerName = detail.player?.name || 'this player'
  const total = detail.pathway?.stages.length || 0
  const isCompleted = detail.progress.status === 'completed'

  return (
    <div className="space-y-6 pb-12">
      {/* header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => router.push(`/dashboard/roster/${playerId}?teamId=${teamId}`)}
          aria-label="Back to player"
          className="p-2 hover:bg-gray-100 rounded-lg flex-shrink-0"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 truncate">{playerName}</h1>
          <p className="text-gray-500">{detail.pathway?.name || 'Development plan'}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {/* A stage that no longer exists. Told plainly rather than papered over. */}
      {detail.stageMissing && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-4 py-3 text-sm">
          {staleStageMessage(detail.pathway?.name || 'this plan')}
        </div>
      )}

      {isCompleted && (
        <div className="bg-green-50 border border-green-200 text-green-900 rounded-lg px-4 py-3 text-sm flex items-center gap-2">
          <CheckCircle2 size={18} />
          <span>
            Completed {describeDuration(daysSince(detail.progress.completed_at))}. Everything
            recorded here is kept. Start the plan again from {playerName}&apos;s profile to run it back.
          </span>
        </div>
      )}

      {stage && (
        <>
          {/* the stage */}
          <div className="bg-white rounded-lg shadow p-6">
            {/* Stepping through the plan. Nothing is locked — a coach may read
                any stage at any time, which is the whole point of the change
                from a gated curriculum to a course. */}
            <div className="flex items-center justify-between gap-2 mb-3">
              <button
                onClick={() => { const p = allStages[idx - 1]; if (p) setViewingKey(p.stage_key) }}
                disabled={idx <= 0}
                className="p-2 -ml-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Previous stage"
              >
                <ChevronLeft size={18} />
              </button>
              <p className="text-sm font-medium text-red-600">
                Stage {stage.stage_number}{total ? ` of ${total}` : ''}
              </p>
              <button
                onClick={() => { const n = allStages[idx + 1]; if (n) setViewingKey(n.stage_key) }}
                disabled={idx < 0 || idx >= allStages.length - 1}
                className="p-2 -mr-2 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:hover:bg-transparent"
                aria-label="Next stage"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <h2 className="text-xl font-bold text-gray-900">{stage.name}</h2>

            {/* Looking somewhere other than where he is. Said plainly, with the
                way back, so nobody mistakes browsing for progress. */}
            {!isViewingCurrent && (
              <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2.5 text-sm text-blue-900">
                <p>
                  You are reading {currentStageNumber != null && stage.stage_number > currentStageNumber
                    ? 'ahead' : 'back over'}. {playerName} is on{' '}
                  <strong>Stage {currentStageNumber ?? '?'}{currentStage ? ` — ${currentStage.name}` : ''}</strong>.
                </p>
                <div className="flex flex-wrap gap-3 mt-2">
                  <button
                    onClick={() => setViewingKey(null)}
                    className="font-medium underline underline-offset-2"
                  >
                    Back to his stage
                  </button>
                  {canDecide && !isCompleted && (
                    <button
                      onClick={() => setConfirm({
                        kind: 'jump',
                        toStageKey: stage.stage_key,
                        label: `Work on Stage ${stage.stage_number} instead`,
                        body: `${playerName} moves to Stage ${stage.stage_number} — ${stage.name}. ` +
                          `${stage.objective} This is recorded the same way as any other move, ` +
                          `and his history is kept.`,
                      })}
                      className="font-medium underline underline-offset-2"
                    >
                      Work on this stage instead
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="mt-4 space-y-4">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Working on</p>
                <p className="text-gray-800 mt-1">{stage.objective}</p>
              </div>
              {stage.why_it_matters && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Why it matters</p>
                  <p className="text-gray-700 mt-1 leading-relaxed">{stage.why_it_matters}</p>
                </div>
              )}
              {stage.coaching_emphasis && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                  <p className="text-sm text-gray-700 leading-relaxed">{stage.coaching_emphasis}</p>
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500 mt-5 pt-4 border-t border-gray-100">
              {isViewingCurrent && (
                <>On this stage since {describeDuration(daysSince(detail.progress.stage_started_at))}{' · '}</>
              )}
              {viewedSessions === 0
                ? 'No sessions recorded at this stage'
                : `${viewedSessions} session${viewedSessions === 1 ? '' : 's'} at this stage`}
              {' · '}
              {sessions.total} across the plan
            </p>
          </div>

          {/* what good looks like */}
          {stage.mastery_signals?.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2 mb-1">
                <ClipboardList size={18} className="text-green-600" />
                What good looks like
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                What you have seen, not a checklist that unlocks anything. Advancing stays your call.
              </p>
              <div className="space-y-2">
                {stage.mastery_signals.map(sig => {
                  const on = checked.has(sig)
                  return (
                    <button
                      key={sig}
                      onClick={() => toggleSignal(sig)}
                      disabled={!canRecord || busy || isCompleted}
                      aria-pressed={on}
                      className={`w-full flex items-start gap-3 text-left p-3 rounded-lg border transition-colors ${
                        on ? 'border-green-300 bg-green-50' : 'border-gray-200'
                      } ${canRecord && !isCompleted ? 'hover:border-green-300' : 'cursor-default'}`}
                    >
                      <span className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 ${
                        on ? 'bg-green-600 border-green-600' : 'border-gray-300'
                      }`}>
                        {on && <Check size={14} className="text-white" />}
                      </span>
                      <span className="text-gray-800 text-sm leading-snug">{sig}</span>
                    </button>
                  )
                })}
              </div>
              {stage.common_failure_modes?.length > 0 && (
                <div className="mt-5 pt-4 border-t border-gray-100">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    What it looks like when it is going wrong
                  </p>
                  <ul className="space-y-1">
                    {stage.common_failure_modes.map(f => (
                      <li key={f} className="text-sm text-gray-600 flex gap-2">
                        <span className="text-gray-300">—</span><span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* drills */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Dumbbell size={18} className="text-red-600" />
                Drills for this stage
              </h3>
              {teamId && detail.pathway && (
                <button
                  onClick={() => {
                    track('player_pathway_added_to_practice', {
                      pathway_slug: detail.pathway!.slug,
                      pathway_version: detail.progress.pathway_version,
                      stage_number: stage.stage_number,
                      stage_key: stage.stage_key,
                      source_surface: 'development_plan',
                    })
                    router.push(
                      `/dashboard/practice?teamId=${teamId}` +
                      `&pathway=${encodeURIComponent(detail.pathway!.slug)}` +
                      `&stage=${stage.stage_number}`)
                  }}
                  className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                >
                  <CalendarPlus size={16} /> Add to practice
                </button>
              )}
            </div>

            {viewedDrills.length === 0 ? (
              <p className="p-6 text-sm text-gray-600">
                No drills are attached to this stage yet. The written guidance above still
                describes what to work on.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {viewedDrills.map(d => (
                  <DrillCard key={`${d.id}-${d.role}`} drill={d} />
                ))}
              </div>
            )}
          </div>

          {/* notes on this stage */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <StickyNote size={18} className="text-yellow-600" />
                Notes on this stage
                {stageNotes.length > 0 && (
                  <span className="text-sm font-normal text-gray-500">({stageNotes.length})</span>
                )}
              </h3>
              {canRecord && !isCompleted && (
                <button
                  onClick={() => setShowNote(true)}
                  className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                >
                  Add a note
                </button>
              )}
            </div>
            {stageNotes.length === 0 ? (
              <p className="p-6 text-sm text-gray-600">
                Nothing written down for {stage.name} yet. Notes here stay with this
                stage, so what you saw last time is in front of you when you come back to it.
              </p>
            ) : (
              <div className="divide-y divide-gray-100">
                {stageNotes.map(n => (
                  <div key={n.id} className="px-6 py-3">
                    <p className="text-sm text-gray-800 whitespace-pre-wrap">{n.note}</p>
                    <p className="text-xs text-gray-500 mt-1">{n.occurred_on}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* the whole plan */}
          {outline && (
            <PlanMap
              outline={outline}
              viewedKey={viewedKey}
              onSelect={key => {
                setViewingKey(key)
                if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
            />
          )}

          {/* measurements */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-6 border-b border-gray-200 flex items-center justify-between gap-3 flex-wrap">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <Gauge size={18} className="text-blue-600" />
                Measurements
              </h3>
              {canRecord && coachId && (
                <button
                  onClick={() => setShowAssessment(true)}
                  className="px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
                >
                  Record assessment
                </button>
              )}
            </div>
            <Measurements summaries={speed} />
          </div>

          {/* the decision — about the stage he is ON, so only shown there.
              While browsing another stage the banner above offers the move
              that actually makes sense: put him on the stage being read. */}
          {!isCompleted && isViewingCurrent && (
            <div className="bg-white rounded-lg shadow p-6">
              <h3 className="font-semibold text-gray-900 mb-1">Is he ready for the next thing?</h3>
              <p className="text-sm text-gray-500 mb-4">
                Your call. The measurements and the signals above inform it; they do not make it.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                {canRecord && (
                  <button
                    onClick={() => setShowSession(true)}
                    disabled={busy}
                    className="flex-1 px-4 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium disabled:opacity-50"
                  >
                    Record today&apos;s work
                  </button>
                )}

                {canDecide && decisions.advance && (
                  <button
                    onClick={() => setConfirm({
                      kind: 'advance',
                      label: decisions.advance!.label,
                      body: `${playerName} moves to Stage ${decisions.advance!.stage.stage_number} — ` +
                        `${decisions.advance!.stage.name}. ${decisions.advance!.stage.objective}`,
                    })}
                    disabled={busy}
                    className="flex-1 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {decisions.advance.label} <ChevronRight size={18} />
                  </button>
                )}

                {canDecide && decisions.canComplete && (
                  <button
                    onClick={() => setConfirm({
                      kind: 'complete',
                      label: 'Complete pathway',
                      body: `This is the final stage, so completing it closes the plan. ` +
                        `${playerName}'s history is kept and you can start the plan again later.`,
                    })}
                    disabled={busy}
                    className="flex-1 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 size={18} /> Complete pathway
                  </button>
                )}
              </div>

              {canDecide && decisions.regress && (
                <button
                  onClick={() => setConfirm({
                    kind: 'regress',
                    label: decisions.regress!.label,
                    body: `${playerName} goes back to Stage ${decisions.regress!.stage.stage_number} — ` +
                      `${decisions.regress!.stage.name}. Going back is a normal coaching decision, ` +
                      `and it is recorded the same way as advancing.`,
                  })}
                  disabled={busy}
                  className="mt-3 w-full sm:w-auto px-4 py-2 text-gray-600 hover:text-gray-900 text-sm flex items-center justify-center gap-1"
                >
                  <ChevronLeft size={16} /> {decisions.regress.label}
                </button>
              )}

              {!canDecide && (
                <p className="text-xs text-gray-400 mt-3">
                  Advancing and going back are the head coach&apos;s to decide.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {/* history */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h3 className="font-semibold text-gray-900">History</h3>
        </div>
        {detail.events.length === 0 ? (
          <p className="p-6 text-sm text-gray-600">Nothing recorded yet.</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {detail.events.map(e => (
              <div key={e.id} className="px-6 py-3">
                <p className="text-sm text-gray-800">{describeEvent(e, stageName)}</p>
                <p className="text-xs text-gray-500 mt-0.5">{e.occurred_on}</p>
                {e.note && <p className="text-sm text-gray-600 mt-1 italic">{e.note}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title={confirm.label}
          body={confirm.body}
          busy={busy}
          onCancel={() => setConfirm(null)}
          onConfirm={() => move(confirm.kind, confirm.toStageKey)}
        />
      )}

      {showSession && stage && (
        <SessionDialog
          stageName={stage.name}
          drills={viewedDrills}
          busy={busy}
          onCancel={() => setShowSession(false)}
          onSave={async (payload) => {
            const ok = await act('session', { ...payload, stageKey: viewedKey })
            if (ok) {
              track('player_pathway_session_logged', {
                pathway_slug: detail.pathway?.slug || null,
                pathway_version: detail.progress.pathway_version,
                stage_number: stage.stage_number,
                stage_key: stage.stage_key,
                source_surface: 'development_plan',
              })
              setShowSession(false)
            }
          }}
        />
      )}

      {showNote && stage && (
        <NoteDialog
          stageName={stage.name}
          busy={busy}
          onCancel={() => setShowNote(false)}
          onSave={async (payload) => {
            const ok = await act('note', { ...payload, stageKey: viewedKey })
            if (ok) {
              track('player_pathway_note_added', {
                pathway_slug: detail.pathway?.slug || null,
                pathway_version: detail.progress.pathway_version,
                stage_number: stage.stage_number,
                stage_key: stage.stage_key,
                source_surface: 'development_plan',
              })
              setShowNote(false)
            }
          }}
        />
      )}

      {showAssessment && coachId && (
        <AssessmentDialog
          summaries={speed}
          onCancel={() => setShowAssessment(false)}
          onSaved={async (slugs) => {
            for (const s of slugs) {
              track('player_measurement_recorded', {
                measurement_type: s,
                pathway_slug: detail.pathway?.slug || null,
                stage_number: stage?.stage_number ?? null,
                source_surface: 'development_plan',
              })
            }
            setShowAssessment(false)
            const res = await fetch(`/api/metrics?coachId=${coachId}&playerId=${playerId}&teamId=${teamId || ''}`)
            const d = await res.json()
            setTypes(d.types || [])
            setReadings(d.readings || [])
          }}
          coachId={coachId}
          playerId={playerId}
          teamId={teamId}
        />
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────

/**
 * The whole pathway, so a coach can see what is coming.
 *
 * ESTIMATES ARE IN PRACTICES AND NEVER IN DATES. The curriculum says "3-5
 * practices"; nothing in this product records how often a team practises, so
 * converting that to weeks would be inventing a cadence and converting it to a
 * date would be inventing a schedule — on a layer whose entire position is that
 * a coach advances a player when they are ready and not on a timer.
 *
 * Where there is history, history wins. A stage already run reports the
 * sessions actually logged and the day they moved on, because those are facts
 * and the estimate is a guess. The ranges only describe the road ahead.
 */
function PlanMap({
  outline, viewedKey, onSelect,
}: {
  outline: PlanOutline
  viewedKey: string | null
  onSelect: (stageKey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const current = outline.stages[outline.currentIndex]

  // Collapsed, it answers "where am I and what is next" in one line. That is
  // the question most of the time; the full map is for planning a month.
  const next = outline.stages[outline.currentIndex + 1]

  return (
    <div className="bg-white rounded-lg shadow">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full p-6 text-left flex items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <MapIcon size={18} className="text-gray-500" />
            The whole plan
          </h3>
          <p className="text-sm text-gray-600 mt-1">
            {outline.isCompleted
              ? `All ${outline.total} stages complete · ${outline.sessionsSoFar} sessions recorded`
              : next
                ? `Stage ${outline.currentIndex + 1} of ${outline.total} · next up is ${next.stage.name}`
                : `Stage ${outline.currentIndex + 1} of ${outline.total} · this is the last one`}
          </p>
          {!outline.isCompleted && outline.remainingMax > 0 && (
            <p className="text-xs text-gray-500 mt-1">
              Roughly {outline.remainingMin}–{outline.remainingMax} more practices from here,
              if he moves through one stage at a time.
            </p>
          )}
        </div>
        <span className="flex-shrink-0 text-gray-400 mt-0.5">
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>

      {open && (
        <div className="border-t border-gray-100">
          <ol className="divide-y divide-gray-50">
            {outline.stages.map((o, i) => (
              <PlanMapStage
                key={o.stage.stage_key}
                outline={o}
                index={i}
                isViewed={o.stage.stage_key === viewedKey}
                onSelect={onSelect}
              />
            ))}
          </ol>

          <div className="px-6 py-4 bg-gray-50 border-t border-gray-100">
            <p className="text-xs text-gray-600 leading-relaxed">
              <strong className="text-gray-800">
                About {outline.totalMin}–{outline.totalMax} practices end to end.
              </strong>{' '}
              That is a range because it is one. The numbers are what a stage
              usually takes, not a schedule — you advance him when he shows you
              the signals, however many practices that turns out to be. Nothing
              here moves on its own.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function PlanMapStage({
  outline: o, index, isViewed, onSelect,
}: {
  outline: OutlineStage
  index: number
  isViewed: boolean
  onSelect: (stageKey: string) => void
}) {
  const [open, setOpen] = useState(false)
  const est = practiceRange(o.practicesMin, o.practicesMax)

  const dot =
    o.state === 'current'
      ? <span className="w-6 h-6 rounded-full bg-red-600 text-white text-xs font-bold flex items-center justify-center">{index + 1}</span>
      : o.state === 'visited'
        ? <span className="w-6 h-6 rounded-full bg-green-100 text-green-700 flex items-center justify-center"><Check size={14} /></span>
        : <span className="w-6 h-6 rounded-full border border-gray-300 text-gray-400 text-xs flex items-center justify-center">{index + 1}</span>

  return (
    <li className={o.state === 'current' ? 'bg-red-50/40' : ''}>
      <div className={`w-full px-6 py-3 flex items-start gap-3 hover:bg-gray-50 ${
        isViewed ? 'ring-1 ring-inset ring-red-200' : ''}`}>
      <button
        onClick={() => onSelect(o.stage.stage_key)}
        className="flex-1 text-left flex items-start gap-3 min-w-0"
      >
        <span className="flex-shrink-0 mt-0.5">{dot}</span>
        <span className="min-w-0 flex-1">
          <span className={`block font-medium ${
            o.state === 'ahead' ? 'text-gray-600' : 'text-gray-900'}`}>
            {o.stage.name}
          </span>
          <span className="block text-xs text-gray-500 mt-0.5">
            {/* Facts for the past, estimates only for the future. */}
            {o.state === 'visited' && (
              <>
                {o.sessions === 0 ? 'No sessions recorded' :
                  `${o.sessions} session${o.sessions === 1 ? '' : 's'}`}
                {o.leftOn ? ` · moved on ${o.leftOn}` : ''}
              </>
            )}
            {o.state === 'current' && (
              <>
                {o.sessions === 0 ? 'No sessions here yet' :
                  `${o.sessions} session${o.sessions === 1 ? '' : 's'} here`}
                {est ? ` · usually ${est}` : ''}
              </>
            )}
            {o.state === 'ahead' && (
              <>
                {est || 'No estimate'}
                {o.drillCount != null ? ` · ${o.drillCount} drill${o.drillCount === 1 ? '' : 's'}` : ''}
              </>
            )}
            {o.notes > 0 ? ` · ${o.notes} note${o.notes === 1 ? '' : 's'}` : ''}
          </span>
        </span>
      </button>
      <button
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-label={open ? 'Hide stage detail' : 'Show stage detail'}
        className="flex-shrink-0 text-gray-400 mt-0.5 p-1 rounded hover:bg-gray-100"
      >
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>
      </div>

      {open && (
        <div className="px-6 pb-4 pl-[3.75rem] space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Working on</p>
            <p className="text-sm text-gray-700 mt-0.5">{o.stage.objective}</p>
          </div>
          {o.stage.mastery_signals?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                What good looks like
              </p>
              <ul className="space-y-1">
                {o.stage.mastery_signals.map(s => (
                  <li key={s} className="text-sm text-gray-600 flex gap-2">
                    <span className="text-gray-300">—</span><span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * One drill, collapsed to what a coach scanning needs and expandable to what a
 * coach RUNNING it needs.
 *
 * Collapsed by default, because this stage can hold six drills and six full
 * instruction blocks is a wall of text nobody reads at a field. Open one and it
 * is the whole drill: how to run it, what to say, what good looks like, what to
 * do if it is too hard or too easy, and the video if one exists.
 *
 * Every field here was already being fetched by the API and thrown away. The
 * library has had these instructions since Phase 2C — all 226 curated rows
 * carry them — and this page was rendering a one-line rationale on top of them.
 */
type ViewDrill = StageDrill & { role: string; rationale: string; step: string }

function DrillCard({ drill: d }: { drill: ViewDrill }) {
  const [open, setOpen] = useState(false)

  const meta = [
    d.reps_guidance,
    d.est_duration_minutes ? `${d.est_duration_minutes} min` : null,
    d.space_required,
    d.requires_partner ? 'Needs a partner' : null,
    d.equipment_needed?.length ? d.equipment_needed.join(', ') : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className="p-4">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full text-left group"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-gray-900 group-hover:text-red-700">
                {d.drill_name}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${
                ROLE_CHIP[d.role] || 'bg-gray-100 text-gray-600'}`}>
                {ROLE_LABEL[d.role] || d.role}
              </span>
            </div>
            <p className="text-sm text-gray-600 mt-1 leading-snug">{d.rationale}</p>
            {meta && <p className="text-xs text-gray-500 mt-2">{meta}</p>}
          </div>
          <span className="flex-shrink-0 text-gray-400 mt-0.5">
            {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
          </span>
        </div>
        {!open && (
          <span className="text-xs text-red-600 mt-2 inline-block">
            How to run it{d.media.length > 0 ? ' · video' : ''}
          </span>
        )}
      </button>

      {open && (
        <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
          {d.description && (
            <Section title="How to run it">
              <p className="whitespace-pre-wrap leading-relaxed">{d.description}</p>
            </Section>
          )}

          {d.ai_coaching_notes && (
            <Section title="Coaching it">
              <p className="whitespace-pre-wrap leading-relaxed">{d.ai_coaching_notes}</p>
            </Section>
          )}

          {(d.reps_guidance || d.est_duration_minutes) && (
            <Section title="How much">
              <p>
                {d.reps_guidance}
                {d.reps_guidance && d.est_duration_minutes ? ' · ' : ''}
                {d.est_duration_minutes ? `about ${d.est_duration_minutes} minutes` : ''}
              </p>
            </Section>
          )}

          {d.success_markers?.length ? (
            <Section title="What good looks like">
              <ul className="space-y-1">
                {d.success_markers.map(s => (
                  <li key={s} className="flex gap-2">
                    <Check size={15} className="text-green-600 flex-shrink-0 mt-0.5" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {d.common_flaws_fixed?.length ? (
            <Section title="What usually goes wrong">
              <ul className="space-y-1">
                {d.common_flaws_fixed.map(s => (
                  <li key={s} className="flex gap-2">
                    <span className="text-gray-300">—</span><span>{s}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {(d.regression_notes || d.progression_notes) && (
            <div className="grid sm:grid-cols-2 gap-4">
              {d.regression_notes && (
                <Section title="If they are not there yet">
                  <p className="leading-relaxed">{d.regression_notes}</p>
                </Section>
              )}
              {d.progression_notes && (
                <Section title="Once it holds">
                  <p className="leading-relaxed">{d.progression_notes}</p>
                </Section>
              )}
            </div>
          )}

          {d.safety_notes && (
            <div className="flex gap-2 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
              <p className="leading-relaxed">{d.safety_notes}</p>
            </div>
          )}

          <DrillMediaLinks drill={d} />
        </div>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{title}</p>
      <div className="text-sm text-gray-700">{children}</div>
    </div>
  )
}

/**
 * The video, when there is one — and an honest sentence when there is not.
 *
 * NOTHING HERE DECIDES WHAT A VIDEO IS. The label comes from describeMedia on
 * the server, which is the same function the Drill Finder uses, and it is
 * careful in a way that matters: a video shared across several drills with no
 * timestamp is offered as "Source video — covers N drills from this library,
 * this one is somewhere inside it", never as "watch this drill". A coach who
 * taps that link and lands at 0:00 of a twelve-minute compilation was told
 * that would happen.
 *
 * Only verified media carries a timestamp in its label, because having a number
 * and somebody having checked it are different things.
 */
function DrillMediaLinks({ drill: d }: { drill: ViewDrill }) {
  const primary = d.media[0]
  const rest = d.media.slice(1)

  if (!primary) {
    return (
      <p className="text-sm text-gray-500 border-t border-gray-100 pt-3">
        No video for this one yet. The instructions above are written to be run
        without one.
      </p>
    )
  }

  return (
    <div className="border-t border-gray-100 pt-4 space-y-3">
      {primary.media_type === 'youtube' ? (
        <DrillVideo
          drillName={d.drill_name}
          youtubeUrl={primary.url}
          thumbnailUrl={primary.thumbnail_url || undefined}
          channel={primary.source_name || undefined}
          startSeconds={primary.start_seconds ?? undefined}
          compact
        />
      ) : (
        <MediaLink media={primary} />
      )}

      <p className="text-xs text-gray-500">
        <span className="font-medium text-gray-700">{primary.presentation.label}</span>
        {primary.presentation.note ? ` · ${primary.presentation.note}` : ''}
        {primary.verification_status !== 'verified' && (
          <span className="block mt-0.5">
            Not checked by us against this drill yet — read the instructions above first.
          </span>
        )}
      </p>

      {rest.map(m => <MediaLink key={m.url} media={m} />)}
    </div>
  )
}

function MediaLink({ media: m }: { media: StageDrill['media'][number] }) {
  return (
    <a
      href={m.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 text-sm text-red-600 hover:text-red-700"
    >
      <Play size={14} className="flex-shrink-0" />
      <span>{m.presentation.label}</span>
      {m.presentation.note && <span className="text-gray-500 text-xs">· {m.presentation.note}</span>}
      <ExternalLink size={13} className="flex-shrink-0 text-gray-400" />
    </a>
  )
}

function Measurements({ summaries }: { summaries: MeasurementSummary[] }) {
  const any = summaries.some(s => s.latest !== null)
  if (!any) {
    return (
      <p className="p-6 text-sm text-gray-600">
        No measurements recorded yet. A baseline taken now is what makes a retest later
        mean anything.
      </p>
    )
  }
  return (
    <div className="divide-y divide-gray-100">
      {summaries.map(s => {
        if (!s.latest) {
          return (
            <div key={s.type.slug} className="px-6 py-3 flex items-center justify-between">
              <span className="text-sm text-gray-700">{s.type.label}</span>
              <span className="text-sm text-gray-400">Not recorded</span>
            </div>
          )
        }
        return (
          <div key={s.type.slug} className="px-6 py-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-sm font-medium text-gray-900">{s.type.label}</span>
              {/* The number keeps its real sign. The colour says which way is
                  better for THIS metric; neither says the player improved. */}
              {s.change !== null && s.change !== 0 && (
                <span className={`text-sm font-medium ${
                  s.towardBetter ? 'text-green-700' : 'text-gray-600'}`}>
                  {formatChange(s)}
                </span>
              )}
            </div>
            <div className="flex gap-6 mt-1 text-sm text-gray-600">
              <span>Baseline <strong className="text-gray-900 font-medium">
                {formatValue(s.baseline!.value, s.type)}</strong>
                <span className="text-xs text-gray-400 ml-1">{s.baseline!.measured_on}</span>
              </span>
              {s.previous && (
                <span>Previous <strong className="text-gray-900 font-medium">
                  {formatValue(s.previous.value, s.type)}</strong></span>
              )}
              <span>Latest <strong className="text-gray-900 font-medium">
                {formatValue(s.latest.value, s.type)}</strong>
                <span className="text-xs text-gray-400 ml-1">{s.latest.measured_on}</span>
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Shell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[85vh] flex flex-col">
        <div className="p-5 border-b border-gray-200 flex items-center justify-between gap-2">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} aria-label="Close"
            className="p-2 -mr-2 text-gray-400 hover:text-gray-600 rounded-lg">
            <X size={20} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  )
}

function ConfirmDialog({
  title, body, busy, onCancel, onConfirm,
}: { title: string; body: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Shell title={title} onClose={onCancel}>
      <p className="text-gray-700 leading-relaxed">{body}</p>
      <div className="flex gap-3 mt-6">
        <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          Keep working
        </button>
        <button onClick={onConfirm} disabled={busy}
          className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Saving...' : 'Confirm'}
        </button>
      </div>
    </Shell>
  )
}

function SessionDialog({
  stageName, drills, busy, onCancel, onSave,
}: {
  stageName: string
  drills: Array<{ id: string; drill_name: string }>
  busy: boolean
  onCancel: () => void
  onSave: (payload: Record<string, any>) => void
}) {
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10))

  return (
    <Shell title="Record today's work" onClose={onCancel}>
      <p className="text-sm text-gray-600 mb-4">{stageName}</p>

      <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
      <input type="date" value={on} onChange={e => setOn(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4" />

      <label className="block text-sm font-medium text-gray-700 mb-1">
        Roughly how long? <span className="font-normal text-gray-400">Optional</span>
      </label>
      <input type="number" inputMode="numeric" min={1} max={480} value={minutes}
        onChange={e => setMinutes(e.target.value)} placeholder="minutes"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4" />

      {drills.length > 0 && (
        <>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            What did you run? <span className="font-normal text-gray-400">Optional</span>
          </label>
          <div className="space-y-1 mb-4">
            {drills.map(d => {
              const sel = picked.has(d.id)
              return (
                <button key={d.id} type="button"
                  onClick={() => setPicked(p => {
                    const n = new Set(p); n.has(d.id) ? n.delete(d.id) : n.add(d.id); return n
                  })}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm ${
                    sel ? 'border-red-300 bg-red-50 text-gray-900' : 'border-gray-200 text-gray-700'}`}>
                  {d.drill_name}
                </button>
              )
            })}
          </div>
        </>
      )}

      <label className="block text-sm font-medium text-gray-700 mb-1">
        Note <span className="font-normal text-gray-400">Optional</span>
      </label>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        placeholder="How did it go?" />

      <div className="flex gap-3 mt-6">
        <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button
          disabled={busy}
          onClick={() => onSave({
            minutes: minutes ? Number(minutes) : undefined,
            drillIds: Array.from(picked),
            note: note.trim() || undefined,
            occurredOn: on,
          })}
          className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Shell>
  )
}

function NoteDialog({
  stageName, busy, onCancel, onSave,
}: {
  stageName: string
  busy: boolean
  onCancel: () => void
  onSave: (payload: Record<string, any>) => void
}) {
  const [note, setNote] = useState('')
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10))

  return (
    <Shell title="Add a note" onClose={onCancel}>
      <p className="text-sm text-gray-600 mb-4">{stageName}</p>

      <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
      <input type="date" value={on} onChange={e => setOn(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4" />

      <label className="block text-sm font-medium text-gray-700 mb-1">What did you see?</label>
      <textarea value={note} onChange={e => setNote(e.target.value)} rows={5} autoFocus
        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
        placeholder="Anything worth remembering next time you run this stage." />
      <p className="text-xs text-gray-500 mt-1">
        Stays with this stage. Only your coaching staff can see it.
      </p>

      <div className="flex gap-3 mt-6">
        <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button
          disabled={busy || !note.trim()}
          onClick={() => onSave({ note: note.trim(), occurredOn: on })}
          className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
          {busy ? 'Saving...' : 'Save note'}
        </button>
      </div>
    </Shell>
  )
}

function AssessmentDialog({
  summaries, coachId, playerId, teamId, onCancel, onSaved,
}: {
  summaries: MeasurementSummary[]
  coachId: string
  playerId: string
  teamId: string | null
  onCancel: () => void
  onSaved: (slugs: string[]) => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [on, setOn] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const save = async () => {
    const entries = summaries
      .map(s => ({ s, raw: values[s.type.slug] }))
      .filter(e => e.raw !== undefined && e.raw !== '' && !isNaN(Number(e.raw)))
    if (entries.length === 0) { setErr('Enter at least one measurement.'); return }

    setSaving(true)
    setErr(null)
    const saved: string[] = []
    try {
      // One POST per metric, through the EXISTING metrics route. Nothing about
      // measurement storage is new in this phase.
      for (const e of entries) {
        const res = await fetch('/api/metrics', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            coachId, playerId, teamId: teamId || undefined,
            metricTypeId: e.s.type.id, measuredOn: on, values: [Number(e.raw)],
          }),
        })
        if (res.ok) saved.push(e.s.type.slug)
      }
      if (saved.length === 0) { setErr('Could not save those measurements.'); return }
      onSaved(saved)
    } catch {
      setErr('Could not save those measurements.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Shell title="Record assessment" onClose={onCancel}>
      <p className="text-sm text-gray-600 mb-4">
        Take these fresh and warmed up, the same way every time. Leave anything blank
        that you did not measure today.
      </p>

      <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
      <input type="date" value={on} onChange={e => setOn(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-4" />

      <div className="space-y-3">
        {summaries.map(s => (
          <div key={s.type.slug}>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {s.type.label}
              {s.type.unit && <span className="font-normal text-gray-400"> ({s.type.unit})</span>}
            </label>
            <input
              type="number" inputMode="decimal" step="any"
              value={values[s.type.slug] ?? ''}
              onChange={e => setValues(v => ({ ...v, [s.type.slug]: e.target.value }))}
              placeholder={s.latest ? `last: ${s.latest.value}` : ''}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg"
            />
            {s.type.hint && <p className="text-xs text-gray-500 mt-1">{s.type.hint}</p>}
          </div>
        ))}
      </div>

      {err && <p className="text-sm text-red-600 mt-4">{err}</p>}

      <div className="flex gap-3 mt-6">
        <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
          Cancel
        </button>
        <button onClick={save} disabled={saving}
          className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Shell>
  )
}

export default function DevelopmentPlanPage() {
  usePageView('player_development_plan')
  return (
    <Suspense fallback={<div className="text-gray-600">Loading...</div>}>
      <DevelopmentPlanContent />
    </Suspense>
  )
}
