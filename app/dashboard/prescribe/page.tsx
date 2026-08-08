'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import {
  Target, Sparkles, Loader2, AlertCircle, Play, ClipboardList,
  Search, Eye, CalendarCheck, Dumbbell, ChevronRight,
} from 'lucide-react'
import { usePageView, useTracker } from '@/lib/tracking'
import { SupersedeConfirm, Superseding } from '@/components/SupersedeConfirm'
import { AnalysisProse } from '@/components/AnalysisProse'
import { splitSections, META_SENTINEL } from '@/lib/analysis'

interface Problem { slug: string; label: string; skill_category: string | null }

interface PrescribedDrill {
  id: string
  drill_name: string
  description?: string
  youtube_video_id?: string
  youtube_url?: string
  thumbnail_url?: string
  channel?: string
  skill_category?: string
  difficulty_level?: string
  equipment_needed?: string[]
  ai_coaching_notes?: string
  reps?: string | null
  frequency?: string | null
  success_marker?: string | null
}

interface Section { key: string; heading: string; body: string }

interface Prescription {
  diagnosis?: { slug: string; label: string } | null
  matchedProblems?: Problem[]
  analysis?: string
  sections?: Section[]
  drills: PrescribedDrill[]
  prescriptionId?: string | null
  message?: string
  needsMigration?: boolean
  error?: string
  streaming?: boolean
}

interface RosterPlayer { player_id: string; name: string; birth_year: number | null }

// Each section gets its own icon and treatment — the six-section shape IS the
// output contract, so it should be visually legible as six distinct answers.
const SECTION_META: Record<string, { icon: any; accent: string }> = {
  what_the_data_showed: { icon: Search, accent: 'text-slate-600' },
  the_one_thing: { icon: Target, accent: 'text-red-600' },
  this_week: { icon: CalendarCheck, accent: 'text-blue-600' },
  drills: { icon: Dumbbell, accent: 'text-green-600' },
  what_to_watch_next: { icon: Eye, accent: 'text-purple-600' },
  metrics: { icon: ClipboardList, accent: 'text-gray-600' },
}

function PrescribeContent() {
  usePageView('prescribe')
  const track = useTracker()
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const supabase = createSupabaseComponentClient()

  const [problems, setProblems] = useState<Problem[]>([])
  const [needsMigration, setNeedsMigration] = useState(false)
  const [complaint, setComplaint] = useState('')
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [playerId, setPlayerId] = useState('')
  const [competitionLevel, setCompetitionLevel] = useState<'both' | 'rec' | 'travel'>('both')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Prescription | null>(null)
  // Set when a commit would replace the priority already running in this area.
  const [superseding, setSuperseding] = useState<
    { replacing: Superseding; focusAreaLabel: string; complaint: string } | null
  >(null)

  useEffect(() => {
    fetch('/api/prescribe')
      .then(r => r.json())
      .then(d => {
        if (d.needsMigration) setNeedsMigration(true)
        setProblems(d.problems || [])
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!teamId) return
    supabase
      .from('team_players')
      .select('player:players(id, name, birth_year)')
      .eq('team_id', teamId)
      .then(({ data }) => {
        const list: RosterPlayer[] = (data || [])
          .map((tp: any) => ({
            player_id: tp.player?.id,
            name: tp.player?.name || '',
            birth_year: tp.player?.birth_year ?? null,
          }))
          .filter((r: RosterPlayer) => r.player_id && r.name)
        setRoster(list)
        if (list.length === 1) setPlayerId(list[0].player_id)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  const selectedPlayer = roster.find(r => r.player_id === playerId)
  const playerAge = selectedPlayer?.birth_year
    ? new Date().getFullYear() - selectedPlayer.birth_year
    : undefined

  const submit = async (text?: string, confirmSupersede = false) => {
    const q = (text ?? complaint).trim()
    if (!q) return
    setComplaint(q)
    setLoading(true)
    setResult(null)
    setSuperseding(null)
    try {
      const res = await fetch('/api/prescribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complaint: q,
          teamId,
          playerId: playerId || undefined,
          playerAge,
          competitionLevel: competitionLevel === 'both' ? undefined : competitionLevel,
          confirmSupersede,
        }),
      })

      // There is already a priority in this area. The server checks before
      // running the analysis, so backing out here costs nothing.
      if (res.status === 409) {
        const data = await res.json()
        setSuperseding({ replacing: data.replacing, focusAreaLabel: data.focusAreaLabel || 'this area', complaint: q })
        return
      }

      // Migration / validation errors still come back as JSON
      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const data = await res.json()
        setResult(data)
        if (data.needsMigration) setNeedsMigration(true)
        return
      }

      if (!res.body) throw new Error('No response from the server')

      // Render the analysis as it is written rather than after it finishes —
      // a read takes 20-40 seconds and a spinner that long reads as broken.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const sentinelAt = buffer.indexOf(META_SENTINEL)
        const markdown = sentinelAt === -1 ? buffer : buffer.slice(0, sentinelAt)

        setResult(prev => ({
          ...(prev || { drills: [] }),
          sections: splitSections(markdown),
          streaming: sentinelAt === -1,
        }))

        if (sentinelAt !== -1) {
          const metaText = buffer.slice(sentinelAt + META_SENTINEL.length)
          try {
            const meta = JSON.parse(metaText)
            setResult(prev => ({
              ...(prev || { drills: [] }),
              ...meta,
              sections: splitSections(markdown),
              streaming: false,
            }))
            if (!meta.error) {
              track('prescription_generated', {
                matched_problems: (meta.matchedProblems || []).map((p: any) => p?.slug),
                drill_count: (meta.drills || []).length,
                had_player_context: !!playerId,
              })
            }
          } catch {
            // Metadata tail incomplete — the next chunk finishes it
          }
        }
      }
    } catch (e: any) {
      setResult(prev => prev?.sections?.length
        ? { ...prev, streaming: false }
        : { drills: [], error: e.message || 'Something went wrong' })
    } finally {
      setLoading(false)
    }
  }

  const quickPicks = problems.length
    ? problems.filter(p =>
        ['late-timing', 'casting', 'fear-of-ball', 'stepping-in-bucket', 'slow-transfer', 'inaccurate-throws', 'rushing-delivery', 'pulling-head']
          .includes(p.slug)
      )
    : []

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <Target className="text-red-600" size={26} />
          <h1 className="text-2xl font-bold text-gray-900">What to Work On</h1>
        </div>
        <p className="text-gray-600 mt-1">
          Describe what you&apos;re seeing in plain English. You&apos;ll get a read on what&apos;s actually going on,
          one priority, and how to know in three weeks whether it moved.
        </p>
      </div>

      {needsMigration && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="text-amber-600 flex-shrink-0" size={20} />
          <div className="text-sm text-amber-800">
            The prescription engine isn&apos;t set up yet. Apply the SQL files in{' '}
            <code className="bg-amber-100 px-1 rounded">/migrations</code> in your Supabase SQL editor, then refresh.
          </div>
        </div>
      )}

      {/* Input */}
      <div className="bg-white rounded-lg shadow p-4 space-y-4">
        <textarea
          value={complaint}
          onChange={(e) => setComplaint(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit() }}
          placeholder='e.g. "Charlie is late on faster pitching" or "she steps in the bucket and bails out"'
          rows={3}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
        />

        <div className="flex flex-wrap items-center gap-3 text-sm">
          {roster.length > 1 && (
            <div className="flex items-center gap-2">
              <label className="text-gray-600">Player</label>
              <select
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                className="px-2 py-1.5 border border-gray-300 rounded-lg"
              >
                <option value="">Whole team</option>
                {roster.map(r => (
                  <option key={r.player_id} value={r.player_id}>{r.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="text-gray-600">Level</label>
            <div className="flex rounded-lg border border-gray-300 overflow-hidden">
              {(['both', 'rec', 'travel'] as const).map(lvl => (
                <button
                  key={lvl}
                  onClick={() => setCompetitionLevel(lvl)}
                  className={`px-3 py-1.5 capitalize ${competitionLevel === lvl ? 'bg-red-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >
                  {lvl}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => submit()}
            disabled={loading || !complaint.trim()}
            className="ml-auto flex items-center gap-2 px-5 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Sparkles size={18} />}
            {loading ? 'Thinking…' : 'Get the read'}
          </button>
        </div>

        {/* What the answer is actually built from — tells the user why logging pays off */}
        {playerId && selectedPlayer && (
          <p className="text-xs text-gray-500">
            Using everything logged for {selectedPlayer.name}
            {playerAge ? ` (age ${playerAge})` : ''} — stats, your notes, lessons, and what we&apos;ve already tried.
          </p>
        )}

        {quickPicks.length > 0 && !result && (
          <div className="flex flex-wrap gap-2 pt-1">
            <span className="text-xs text-gray-500 self-center">Common:</span>
            {quickPicks.map(p => (
              <button
                key={p.slug}
                onClick={() => submit(p.label)}
                className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-full text-sm transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Empty state — the capture surface is what makes this specific */}
      {!result && !loading && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-900 flex items-start gap-2">
          <Sparkles size={16} className="flex-shrink-0 mt-0.5" />
          <span>
            The more you&apos;ve logged, the more specific this gets.{' '}
            <a href={`/dashboard/log?teamId=${teamId}`} className="underline font-medium">Log an entry</a>{' '}
            after a game or a lesson and the read here stops being generic.
          </span>
        </div>
      )}

      {superseding && (
        <SupersedeConfirm
          replacing={superseding.replacing}
          focusAreaLabel={superseding.focusAreaLabel}
          busy={loading}
          onConfirm={() => submit(superseding.complaint, true)}
          onCancel={() => setSuperseding(null)}
        />
      )}

      {loading && !result?.sections?.length && (
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <Loader2 className="animate-spin mx-auto text-red-600 mb-3" size={24} />
          <p className="text-gray-700 font-medium">Reading the evidence</p>
          <p className="text-sm text-gray-500 mt-1">
            Weighing what you&apos;ve seen against the stats, then picking one thing. Usually 15–30 seconds.
          </p>
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="space-y-5">
          {result.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{result.error}</div>
          )}

          {result.message && !result.drills?.length && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-amber-800 text-sm">
              {result.message}
            </div>
          )}

          {/* The analysis — six sections */}
          {result.sections && result.sections.length > 0 && (
            <div className="space-y-4">
              {result.sections.map((section, idx) => {
                const meta = SECTION_META[section.key] || { icon: ChevronRight, accent: 'text-gray-600' }
                const Icon = meta.icon
                const isPriority = section.key.startsWith('the_one_thing')
                return (
                  <div
                    key={section.key}
                    className={`bg-white rounded-lg shadow-sm border p-5 ${
                      isPriority ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={meta.accent} size={18} />
                      <h2 className="font-semibold text-gray-900">{section.heading}</h2>
                    </div>
                    <AnalysisProse body={section.body} />
                    {result.streaming && idx === result.sections!.length - 1 && (
                      <span className="inline-block w-2 h-4 bg-red-500 animate-pulse align-middle ml-0.5 rounded-sm" />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Drill cards with the videos */}
          {result.drills?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Play className="text-green-600" size={18} />
                <h2 className="font-semibold text-gray-900">Watch these</h2>
              </div>
              <div className="space-y-3">
                {result.drills.map(d => (
                  <div key={d.id} className="flex gap-3 p-3 bg-gray-50 rounded-lg">
                    {d.youtube_video_id && (
                      <a
                        href={d.youtube_url || `https://www.youtube.com/watch?v=${d.youtube_video_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-shrink-0 relative group"
                      >
                        <img
                          src={d.thumbnail_url || `https://img.youtube.com/vi/${d.youtube_video_id}/mqdefault.jpg`}
                          alt=""
                          className="w-32 h-[72px] object-cover rounded"
                        />
                        <span className="absolute inset-0 flex items-center justify-center">
                          <span className="w-8 h-8 rounded-full bg-black/60 group-hover:bg-red-600 flex items-center justify-center transition-colors">
                            <Play className="text-white ml-0.5" size={14} fill="white" />
                          </span>
                        </span>
                      </a>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-gray-900 text-sm">{d.drill_name}</div>
                      <div className="text-xs text-gray-500 mt-0.5">
                        {[d.skill_category, d.difficulty_level, d.channel].filter(Boolean).join(' · ')}
                      </div>
                      {(d.reps || d.frequency) && (
                        <div className="text-xs text-gray-600 mt-1">
                          {[d.reps, d.frequency].filter(Boolean).join(' · ')}
                        </div>
                      )}
                      {d.equipment_needed?.length ? (
                        <div className="text-xs text-gray-500 mt-1">
                          Needs: {d.equipment_needed.join(', ')}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Saved confirmation — the return visit is the whole point */}
          {result.prescriptionId && (
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-700 flex items-start gap-2">
              <CalendarCheck size={16} className="flex-shrink-0 mt-0.5 text-slate-500" />
              <span>
                Saved. We&apos;ll hold this priority for three weeks rather than changing it every time new data
                comes in — that&apos;s how long it actually takes to move something at this age. Log your home
                sessions against it and the{' '}
                <a href={`/dashboard?teamId=${teamId}`} className="underline font-medium">check-in</a>{' '}
                will tell you whether it worked.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function PrescribePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    }>
      <PrescribeContent />
    </Suspense>
  )
}
