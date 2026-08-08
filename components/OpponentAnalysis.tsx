'use client'

import { useEffect, useState, useCallback } from 'react'
import { Loader2, Sparkles, RefreshCw, FileText, AlertCircle, Clock } from 'lucide-react'
import { AnalysisProse } from '@/components/AnalysisProse'
import { splitSections } from '@/lib/analysis'
import { SCOUT_META_SENTINEL } from '@/lib/scouting'

// The standing read on one opponent.
//
// Capture was never the problem — the module took box scores, recaps and notes
// happily and then left the coach holding a pile. This is the page they
// actually want: how this team plays, who can pitch, what to do about it,
// rewritten whenever new evidence lands.
//
// Stored rather than generated on view, for two reasons. It gets opened in a
// dugout on tournament wifi, and keeping the previous version is what lets us
// answer "what's different since last time" — which is the more useful
// question once you've played someone twice.

interface Analysis {
  id: string
  markdown: string
  headline: string | null
  whats_changed: string | null
  entry_count: number
  total_pa: number
  generated_at: string
}

const SECTION_ACCENT: Record<string, string> = {
  how_they_play: 'text-slate-600',
  their_pitching: 'text-blue-600',
  watch_for: 'text-amber-600',
  how_to_beat_them: 'text-red-600',
  what_s_changed: 'text-green-600',
}

export function OpponentAnalysis({
  coachId,
  opponentTeamId,
  opponentName,
  entryCount,
}: {
  coachId: string | null
  opponentTeamId: string
  opponentName: string
  entryCount: number
}) {
  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [stale, setStale] = useState(false)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [running, setRunning] = useState(false)
  const [streamed, setStreamed] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Set when the report displayed but did not persist. Different from an error:
  // what is on screen is good, it just will not be here tomorrow.
  const [unsaved, setUnsaved] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    if (!coachId) return
    try {
      const res = await fetch(`/api/scouting/analysis?coachId=${coachId}&opponentTeamId=${opponentTeamId}`)
      const data = await res.json()
      if (data.needsMigration) setNeedsMigration(true)
      setAnalysis(data.analysis)
      setStale(data.stale)

      // A written report stays OPEN — including when you come back to it a
      // week later. It used to collapse to its headline on every load, on the
      // theory that a repeat visit had already been read. Two things were wrong
      // with that: load() also runs the moment generation finishes, so the
      // report you were reading folded itself up mid-sentence; and a report you
      // asked for should be there when you return, not one tap away behind a
      // link that looks like it needs regenerating.
      //
      // Collapsing is still available — it is just the coach's choice now,
      // never something that happens to them.
      setExpanded(true)
    } catch {
      // panel just stays empty
    } finally {
      setLoading(false)
    }
  }, [coachId, opponentTeamId])

  useEffect(() => { load() }, [load])

  const generate = async () => {
    if (!coachId) return
    setRunning(true)
    setError(null)
    setUnsaved(null)
    setStreamed('')
    setExpanded(true)
    try {
      const res = await fetch('/api/scouting/analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coachId, opponentTeamId }),
      })

      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const data = await res.json()
        setError(data.error || 'Could not write the report.')
        setStreamed(null)
        return
      }
      if (!res.body) throw new Error('No response from the server')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const at = buffer.indexOf(SCOUT_META_SENTINEL)
        setStreamed(at === -1 ? buffer : buffer.slice(0, at))

        if (at !== -1) {
          try {
            const meta = JSON.parse(buffer.slice(at + SCOUT_META_SENTINEL.length))
            if (meta.error) setError(meta.error)
            // No id means the row never landed, whatever the reason.
            if (meta.saveError) setUnsaved(meta.saveError)
            else if (meta.id === null && !meta.error) {
              setUnsaved("This report is on screen but didn't save, so it won't be here when you come back. Try Update again.")
            }
          } catch { /* tail incomplete */ }
        }
      }
      // Hand over to the saved copy only once there IS one. Clearing the
      // streamed text first meant that if the save had failed, the report the
      // coach had just watched arrive vanished with nothing in its place — and
      // nothing said why.
      await load()
    } catch (e: any) {
      setError(e.message || 'Something went wrong')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="animate-spin" size={16} /> Loading the report…
      </div>
    )
  }

  if (needsMigration) {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        Run <code className="bg-amber-100 px-1 rounded">migrations/017_scouting_analysis.sql</code> in your
        Supabase SQL editor to turn scouting entries into a standing report.
      </div>
    )
  }

  const markdown = streamed ?? analysis?.markdown ?? ''
  const sections = markdown ? splitSections(markdown) : []

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="text-slate-600" size={18} />
            <h3 className="font-semibold text-gray-900">Scouting report</h3>
            {stale && analysis && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                New evidence since this
              </span>
            )}
          </div>
          {analysis && (
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1.5">
              <Clock size={12} />
              Written {new Date(analysis.generated_at).toLocaleDateString()} from {analysis.entry_count}{' '}
              {analysis.entry_count === 1 ? 'entry' : 'entries'}
              {analysis.total_pa > 0 ? ` · ${analysis.total_pa} plate appearances` : ''}
            </p>
          )}
        </div>

        <button
          onClick={generate}
          disabled={running || entryCount === 0}
          className={`flex-shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors disabled:opacity-50 ${
            stale || !analysis
              ? 'bg-slate-900 text-white hover:bg-slate-800'
              : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
          }`}
        >
          {running ? <Loader2 className="animate-spin" size={16} />
            : analysis ? <RefreshCw size={16} />
            : <Sparkles size={16} />}
          {running ? 'Writing…' : analysis ? 'Update' : 'Write the report'}
        </button>
      </div>

      {entryCount === 0 && !analysis && (
        <p className="text-sm text-gray-600">
          Nothing logged for {opponentName} yet. Add a box score, recap or note and we&apos;ll turn it into
          one page you can read before first pitch.
        </p>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-3">{error}</div>
      )}

      {unsaved && !running && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-900 mb-3">
          {unsaved}
        </div>
      )}

      {/* What's different since last time is the most useful line on the page
          once you've played someone twice — so it isn't buried at the bottom. */}
      {!running && analysis?.whats_changed && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 mb-3">
          <div className="text-xs font-semibold text-green-800 uppercase tracking-wide mb-1">
            What&apos;s changed
          </div>
          <p className="text-sm text-green-900 leading-relaxed">{analysis.whats_changed}</p>
        </div>
      )}

      {!expanded && analysis?.headline && (
        <button onClick={() => setExpanded(true)} className="text-left w-full">
          <p className="text-[15px] text-gray-800 leading-relaxed">{analysis.headline}</p>
          <span className="text-sm text-red-600 hover:text-red-700 mt-1 inline-block">Read the full report</span>
        </button>
      )}

      {expanded && sections.length > 0 && (
        <div className="space-y-4">
          {sections.map((section, idx) => (
            <div key={section.key}>
              <h4 className={`font-semibold text-sm mb-1.5 ${SECTION_ACCENT[section.key] || 'text-gray-700'}`}>
                {section.heading}
              </h4>
              <AnalysisProse body={section.body} />
              {running && idx === sections.length - 1 && (
                <span className="inline-block w-2 h-4 bg-slate-500 animate-pulse align-middle ml-0.5 rounded-sm" />
              )}
            </div>
          ))}
          {analysis && (
            <button
              onClick={() => setExpanded(false)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Collapse
            </button>
          )}
        </div>
      )}

      {running && sections.length === 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-600 py-4">
          <Loader2 className="animate-spin" size={16} />
          Reading everything you&apos;ve logged on {opponentName}…
        </div>
      )}
    </div>
  )
}
