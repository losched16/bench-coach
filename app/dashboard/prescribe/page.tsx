'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Target, Sparkles, Loader2, CheckCircle2, RefreshCw, Dumbbell, AlertCircle } from 'lucide-react'

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
  why?: string | null
  reps?: string | null
  frequency?: string | null
  success_marker?: string | null
}

interface Prescription {
  diagnosis?: { slug: string; label: string } | null
  matchedProblems?: Problem[]
  summary?: string
  reassess?: string
  drills: PrescribedDrill[]
  message?: string
  needsMigration?: boolean
  error?: string
}

export default function PrescribePage() {
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')

  const [problems, setProblems] = useState<Problem[]>([])
  const [needsMigration, setNeedsMigration] = useState(false)
  const [complaint, setComplaint] = useState('')
  const [playerAge, setPlayerAge] = useState('')
  const [competitionLevel, setCompetitionLevel] = useState<'both' | 'rec' | 'travel'>('both')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Prescription | null>(null)

  useEffect(() => {
    fetch('/api/prescribe')
      .then(r => r.json())
      .then(d => {
        if (d.needsMigration) setNeedsMigration(true)
        setProblems(d.problems || [])
      })
      .catch(() => {})
  }, [])

  const submit = async (text?: string) => {
    const q = (text ?? complaint).trim()
    if (!q) return
    setComplaint(q)
    setLoading(true)
    setResult(null)
    try {
      const res = await fetch('/api/prescribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          complaint: q,
          teamId,
          playerAge: playerAge ? parseInt(playerAge) : undefined,
          competitionLevel: competitionLevel === 'both' ? undefined : competitionLevel,
        }),
      })
      const data = await res.json()
      setResult(data)
    } catch (e: any) {
      setResult({ drills: [], error: e.message || 'Something went wrong' })
    } finally {
      setLoading(false)
    }
  }

  // A few high-value quick-picks, drawn from the taxonomy when available.
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
          <h1 className="text-2xl font-bold text-gray-900">Fix a Problem</h1>
        </div>
        <p className="text-gray-600 mt-1">
          Describe what a player is struggling with in plain English. You'll get a short, sequenced drill plan — with reps and how to know it's working.
        </p>
      </div>

      {needsMigration && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <AlertCircle className="text-amber-600 flex-shrink-0" size={20} />
          <div className="text-sm text-amber-800">
            The prescription engine isn't set up yet. Apply the SQL files in <code className="bg-amber-100 px-1 rounded">/migrations</code> in your Supabase SQL editor, then refresh.
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

        {/* Optional context */}
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            <label className="text-gray-600">Age</label>
            <input
              type="number" min={4} max={18} value={playerAge}
              onChange={(e) => setPlayerAge(e.target.value)}
              placeholder="any"
              className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg"
            />
          </div>
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
            {loading ? 'Building plan…' : 'Get plan'}
          </button>
        </div>

        {/* Quick picks */}
        {quickPicks.length > 0 && (
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

      {/* Loading skeleton */}
      {loading && (
        <div className="text-center py-10 text-gray-500 flex items-center justify-center gap-2">
          <Loader2 className="animate-spin" size={18} /> Diagnosing and sequencing drills…
        </div>
      )}

      {/* Result */}
      {result && !loading && (
        <div className="space-y-5">
          {result.error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{result.error}</div>
          )}
          {result.message && !result.drills?.length && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-blue-800 text-sm">{result.message}</div>
          )}

          {result.diagnosis && (
            <div className="bg-white rounded-lg shadow p-5">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Diagnosis</div>
              <div className="text-lg font-semibold text-gray-900">{result.diagnosis.label}</div>
              {result.summary && <p className="text-gray-700 mt-2">{result.summary}</p>}
              {result.reassess && (
                <div className="mt-3 flex items-start gap-2 bg-blue-50 rounded-lg p-3">
                  <RefreshCw className="text-blue-600 flex-shrink-0 mt-0.5" size={16} />
                  <p className="text-sm text-blue-800"><span className="font-medium">Reassess:</span> {result.reassess}</p>
                </div>
              )}
            </div>
          )}

          {/* Sequenced drills */}
          {result.drills?.map((d, i) => (
            <div key={d.id} className="bg-white rounded-lg shadow overflow-hidden">
              <div className="flex items-center gap-2 px-5 pt-4">
                <span className="flex items-center justify-center w-7 h-7 rounded-full bg-red-600 text-white text-sm font-bold">{i + 1}</span>
                <h3 className="font-semibold text-gray-900">{d.drill_name}</h3>
                {d.difficulty_level && (
                  <span className="ml-auto text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600">{d.difficulty_level}</span>
                )}
              </div>

              {d.youtube_video_id && (
                <div className="aspect-video bg-black mt-3">
                  <iframe
                    src={`https://www.youtube.com/embed/${d.youtube_video_id}?rel=0`}
                    title={d.drill_name}
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              )}

              <div className="p-5 space-y-3">
                {d.why && (
                  <p className="text-gray-700"><span className="font-medium text-gray-900">Why:</span> {d.why}</p>
                )}
                <div className="flex flex-wrap gap-4 text-sm">
                  {d.reps && (
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <Dumbbell size={15} className="text-gray-400" /> {d.reps}
                    </div>
                  )}
                  {d.frequency && (
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <RefreshCw size={15} className="text-gray-400" /> {d.frequency}
                    </div>
                  )}
                </div>
                {d.success_marker && (
                  <div className="flex items-start gap-2 bg-green-50 rounded-lg p-3">
                    <CheckCircle2 className="text-green-600 flex-shrink-0 mt-0.5" size={16} />
                    <p className="text-sm text-green-800"><span className="font-medium">You'll know it's working when:</span> {d.success_marker}</p>
                  </div>
                )}
                {d.channel && <p className="text-xs text-gray-400">Video by {d.channel}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
