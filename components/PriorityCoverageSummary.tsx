'use client'

// Did BenchCoach honour the practice priorities? Answered in three seconds.
//
// One row per selected focus area: minutes of real reps a player gets, a bar
// against the fair share, and a word for the status. Minutes come from the
// plan itself (lib/priorityCoverage), never from the model's own opinion of
// the plan. When a rotation makes the minutes approximate, the summary says so
// rather than printing false precision.

import type { CoverageReport, CoverageStatus } from '@/lib/priorityCoverage'

const STATUS_LABEL: Record<CoverageStatus, string> = {
  strong: 'strong',
  adequate: 'covered',
  under_covered: 'light',
  missing: 'missing',
}

const STATUS_STYLE: Record<CoverageStatus, { bar: string; text: string }> = {
  strong: { bar: 'bg-green-500', text: 'text-green-700' },
  adequate: { bar: 'bg-blue-500', text: 'text-blue-700' },
  under_covered: { bar: 'bg-amber-500', text: 'text-amber-800' },
  missing: { bar: 'bg-red-500', text: 'text-red-700' },
}

export function PriorityCoverageSummary({ report, compact = false }: { report: CoverageReport | null | undefined; compact?: boolean }) {
  if (!report || !Array.isArray(report.priorities) || report.priorities.length === 0) return null
  const max = Math.max(1, ...report.priorities.map(p => p.exposure_minutes), report.fair_share_minutes || 0)
  return (
    <div className="bg-white rounded-lg border border-gray-200 px-4 py-3" data-testid="priority-coverage">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Priority coverage</p>
        <p className="text-[11px] text-gray-500">
          {report.approximate ? 'about ' : ''}minutes of reps per player
        </p>
      </div>
      <ul className={`mt-2 ${compact ? 'space-y-1' : 'space-y-1.5'}`}>
        {report.priorities.map(p => {
          const style = STATUS_STYLE[p.status] || STATUS_STYLE.adequate
          const width = Math.max(4, Math.round((p.exposure_minutes / max) * 100))
          return (
            <li key={p.priority} className="grid grid-cols-[minmax(72px,1fr)_minmax(0,3fr)_auto] items-center gap-2 text-sm">
              <span className="font-medium text-gray-900 truncate capitalize">{p.label}</span>
              <span className="h-2 rounded-full bg-gray-100 overflow-hidden">
                <span className={`block h-full rounded-full ${style.bar}`} style={{ width: `${width}%` }} />
              </span>
              <span className="whitespace-nowrap tabular-nums text-gray-700">
                {p.exposure_minutes} min
                <span className={`ml-1.5 text-[11px] ${style.text}`}>{STATUS_LABEL[p.status] || p.status}</span>
              </span>
            </li>
          )
        })}
      </ul>
      {!report.balanced && (
        <p className="mt-2 text-xs text-amber-800">
          {report.under_covered.length === 1
            ? `${labelOf(report, report.under_covered[0])} is light for a selected focus area.`
            : `${report.under_covered.map(k => labelOf(report, k)).join(' and ')} are light for selected focus areas.`}
        </p>
      )}
    </div>
  )
}

function labelOf(report: CoverageReport, key: string): string {
  return report.priorities.find(p => p.priority === key)?.label || key
}
