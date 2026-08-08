'use client'

import { useEffect, useState } from 'react'
import { CalendarDays, Loader2, RefreshCw, AlertCircle } from 'lucide-react'
import { AnalysisProse } from './AnalysisProse'
import { splitSections } from '@/lib/analysis'

// The three-week plan for one player.
//
// Generated once and kept, because the point is that a parent opens it on
// Tuesday and again on Saturday. Regenerating on every view would give them a
// different plan each time they looked, which is the fastest way to stop
// following one.

interface Props {
  prescriptionId: string
  coachId: string
  subjectName: string
}

export function DevelopmentPlan({ prescriptionId, coachId, subjectName }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/development-plan?prescriptionId=${prescriptionId}&coachId=${coachId}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        setMarkdown(d.plan?.markdown || null)
        setGeneratedAt(d.plan?.generated_at || null)
        if (d.needsMigration) setMigrationMessage(d.migrationMessage || 'Run the migrations in /migrations.')
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [prescriptionId, coachId])

  const generate = async () => {
    setRunning(true)
    setError(null)
    setMarkdown('')
    try {
      const res = await fetch('/api/development-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prescriptionId, coachId }),
      })

      const contentType = res.headers.get('content-type') || ''
      if (contentType.includes('application/json')) {
        const data = await res.json()
        throw new Error(data.error || 'Could not write the plan.')
      }
      if (!res.body) throw new Error('No response from the server')

      // Streamed for the same reason as everything else here: it takes 30-60
      // seconds and a spinner that long reads as broken.
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        setMarkdown(buffer)
      }
      setGeneratedAt(new Date().toISOString())
    } catch (e: any) {
      setError(e.message || 'Could not write the plan.')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
        <Loader2 className="animate-spin" size={15} /> Checking for a plan…
      </div>
    )
  }

  if (migrationMessage) {
    return (
      <div className="flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
        <p>{migrationMessage}</p>
      </div>
    )
  }

  if (!markdown) {
    return (
      <div>
        <button
          onClick={generate}
          disabled={running}
          className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 disabled:opacity-50"
        >
          {running ? <Loader2 className="animate-spin" size={15} /> : <CalendarDays size={15} />}
          {running ? 'Writing the plan…' : `Build ${subjectName}'s development plan`}
        </button>
        <p className="text-xs text-gray-500 mt-2">
          Three weeks of sessions built around this priority and the drills you kept — how long, how
          many, and how to tell it&apos;s working. Ends when the check-in comes due.
        </p>
        {error && <p className="text-sm text-red-700 mt-2">{error}</p>}
      </div>
    )
  }

  const sections = splitSections(markdown)

  return (
    <div className="space-y-3">
      {sections.length > 0 ? (
        sections.map((sec, i) => (
          <div key={`${sec.key}-${i}`} className="bg-gray-50 rounded-lg p-4">
            <h5 className="font-semibold text-gray-900 text-sm mb-2">{sec.heading}</h5>
            <AnalysisProse body={sec.body} />
          </div>
        ))
      ) : (
        <div className="bg-gray-50 rounded-lg p-4">
          <AnalysisProse body={markdown} />
        </div>
      )}

      {error && <p className="text-sm text-red-700">{error}</p>}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={generate}
          disabled={running}
          className="text-sm text-gray-600 hover:text-gray-900 inline-flex items-center gap-1.5 disabled:opacity-50"
        >
          {running ? <Loader2 className="animate-spin" size={13} /> : <RefreshCw size={13} />}
          {running ? 'Rewriting…' : 'Rewrite it'}
        </button>
        {generatedAt && !running && (
          <span className="text-xs text-gray-400">
            Written {new Date(generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>
    </div>
  )
}
