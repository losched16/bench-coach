'use client'

// A player's development reports, on their profile.
//
// This is the entry point for the whole feature, and it lives here rather than
// behind a top-level "Reports" nav item for a simple reason: a coach never
// wants "a report", they want "a report for Charlie". They are already looking
// at Charlie.
//
// The history matters as much as the button. A parent asking in March what the
// coach said in September is a real conversation, and the answer should be one
// tap away rather than a search through sent mail.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  FileText, Plus, Loader2, Download, ChevronRight, AlertCircle, Settings,
} from 'lucide-react'
import { reportTypeLabel, formatReportDate } from '@/lib/playerReports'
import { useTracker } from '@/lib/tracking'

interface ReportRow {
  id: string
  report_type: string
  status: 'draft' | 'final'
  report_date: string
  revision: number
  finalized_at: string | null
  updated_at: string
}

interface PlayerReportsProps {
  playerId: string
  teamId: string | null
  playerName: string
  /** False for a viewer or contributor: they may read reports, not write them. */
  canCreate?: boolean
}

export function PlayerReports({
  playerId, teamId, playerName, canCreate = true,
}: PlayerReportsProps) {
  const router = useRouter()
  const track = useTracker()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!teamId || !playerId) { setLoading(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/player-reports?teamId=${teamId}&playerId=${playerId}`)
        const data = await res.json()
        if (cancelled) return
        setReports(data.reports || [])
        // Migration 054 not applied yet. Say what to do rather than showing an
        // empty list that looks like data loss.
        if (data.needsMigration) setNotice(data.migrationMessage || null)
      } catch {
        if (!cancelled) setNotice('Could not load this player’s reports.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [teamId, playerId])

  const open = (id: string) =>
    router.push(`/dashboard/player-reports/${id}?teamId=${teamId}`)

  const create = async () => {
    if (!teamId || creating) return
    setCreating(true)
    setNotice(null)
    try {
      const res = await fetch('/api/player-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, playerId }),
      })
      const data = await res.json()
      if (!res.ok) { setNotice(data?.error || 'Could not start a report.'); return }
      track('player_report_started', { playerId, resumed: Boolean(data.resumed) })
      open(data.report.id)
    } catch {
      setNotice('Could not start a report — check your connection.')
    } finally {
      setCreating(false)
    }
  }

  const openDraft = reports.find(r => r.status === 'draft')

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Player Reports</h2>
          <p className="text-sm text-gray-500">
            A development report you can share with {playerName.split(' ')[0] || 'the player'}&apos;s family as a PDF.
          </p>
        </div>
        {canCreate && (
          <div className="flex items-center gap-2 flex-wrap">
          <Link
            href={`/dashboard/settings?teamId=${teamId}#report-branding`}
            className="inline-flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            <Settings size={16} aria-hidden />
            Report branding
          </Link>
          <button
            type="button"
            onClick={create}
            disabled={creating || !teamId}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 text-sm font-medium disabled:opacity-60"
          >
            {creating
              ? <Loader2 size={16} className="animate-spin" aria-hidden />
              : <Plus size={16} aria-hidden />}
            {openDraft ? 'Continue draft' : 'Create Player Report'}
          </button>
          </div>
        )}
      </div>

      {notice && (
        <div role="alert" className="flex gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
          <AlertCircle size={16} className="shrink-0 mt-0.5" aria-hidden />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 py-8">
          <Loader2 className="animate-spin" size={16} aria-hidden />
          Loading reports…
        </div>
      ) : reports.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 sm:p-12 text-center">
          <FileText className="mx-auto text-gray-300 mb-4" size={48} aria-hidden />
          <h3 className="font-semibold text-gray-900">No reports yet</h3>
          <p className="mt-1 text-sm text-gray-600 max-w-sm mx-auto">
            Say what they are doing well, what to work on next, and which drills help.
            BenchCoach turns it into a PDF you can send the family.
          </p>
        </div>
      ) : (
        <ul className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
          {reports.map(r => (
            <li key={r.id}>
              <div className="flex items-center gap-3 p-4">
                <button
                  type="button"
                  onClick={() => open(r.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <span className="block font-medium text-gray-900 text-sm">
                    {reportTypeLabel(r.report_type)}
                    {r.revision > 1 && (
                      <span className="ml-1.5 font-normal text-gray-500">
                        · Revision {r.revision}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-sm text-gray-500">
                    {formatReportDate(r.report_date)}
                    <span
                      className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${
                        r.status === 'final'
                          ? 'bg-green-100 text-green-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {r.status === 'final' ? 'Finalized' : 'Draft'}
                    </span>
                  </span>
                </button>

                {r.status === 'final' && (
                  <a
                    href={`/api/player-reports/${r.id}/pdf?download=1`}
                    className="shrink-0 p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                    aria-label={`Download the PDF of the ${reportTypeLabel(r.report_type).toLowerCase()} from ${formatReportDate(r.report_date)}`}
                    onClick={() => track('player_report_pdf_generated', { reportId: r.id })}
                  >
                    <Download size={18} aria-hidden />
                  </a>
                )}
                <ChevronRight size={18} className="shrink-0 text-gray-300" aria-hidden />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default PlayerReports
