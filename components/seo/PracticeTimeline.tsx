import { TimelineRow, rowTimeLabel, rowMinutes, totalMinutes, drillSlug } from '@/lib/seoResource'

// The practice, as a schedule.
//
// This is the thing the page is actually for, and it goes near the top. A
// coach who searched "8u baseball practice plan" wants to see the plan, not
// an introduction explaining that 8U is a formative age. The prose keeps its
// place further down; it just stops standing in the doorway.
//
// Two renderings of the same rows: a real <table> from `sm` up, and stacked
// cards below it. Not a scroll container — a five-column table squeezed into
// a 375px viewport is technically readable and practically useless, and the
// most likely place this page gets opened is a phone at a field. Both come
// from one array, so they cannot drift apart.

interface PracticeTimelineProps {
  timeline: TimelineRow[]
  /** Anchors rows to their drill sections when the page has them. */
  hasDrills?: boolean
}

export function PracticeTimeline({ timeline, hasDrills }: PracticeTimelineProps) {
  const total = totalMinutes(timeline)

  return (
    <section className="my-8" aria-labelledby="practice-timeline">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <h2 id="practice-timeline" className="text-2xl sm:text-3xl font-bold text-gray-900">
          The Practice
        </h2>
        {total !== null && (
          <span className="text-sm font-medium text-gray-500">{total} minutes total</span>
        )}
      </div>

      {/* Desktop and print: a table, because that is what this data is. */}
      <div className="hidden sm:block overflow-hidden rounded-xl border border-gray-200 print:border-black">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900 text-white print:bg-white print:text-black print:border-b-2 print:border-black">
              <th scope="col" className="py-3 px-4 text-xs font-bold uppercase tracking-wider w-24">Time</th>
              <th scope="col" className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Activity</th>
              <th scope="col" className="py-3 px-4 text-xs font-bold uppercase tracking-wider">Focus</th>
            </tr>
          </thead>
          <tbody>
            {timeline.map((row, i) => {
              const mins = rowMinutes(row)
              return (
                <tr
                  key={i}
                  className="border-t border-gray-200 print:border-gray-400 break-inside-avoid even:bg-slate-50 print:even:bg-white"
                >
                  <td className="py-3 px-4 font-mono text-sm font-semibold text-gray-900 whitespace-nowrap align-top">
                    {rowTimeLabel(row)}
                  </td>
                  <td className="py-3 px-4 align-top">
                    <span className="font-semibold text-gray-900">
                      {hasDrills && row.drill ? (
                        <a
                          href={`#drill-${drillSlug({ slug: row.drill, name: row.drill })}`}
                          className="text-red-700 hover:underline print:text-black print:no-underline"
                        >
                          {row.activity}
                        </a>
                      ) : (
                        row.activity
                      )}
                    </span>
                    {mins !== null && (
                      <span className="ml-2 text-xs text-gray-500 font-normal">{mins} min</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-gray-600 align-top">{row.focus || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Phone: the same rows as cards. Stacked rather than scrolled, so
          nothing important sits off the right edge of the screen. */}
      <ol className="sm:hidden space-y-3 list-none pl-0">
        {timeline.map((row, i) => {
          const mins = rowMinutes(row)
          return (
            <li key={i} className="rounded-xl border border-gray-200 p-4 bg-white">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className="font-mono text-sm font-bold text-red-700">{rowTimeLabel(row)}</span>
                {mins !== null && <span className="text-xs text-gray-500">{mins} min</span>}
              </div>
              <div className="font-semibold text-gray-900">
                {hasDrills && row.drill ? (
                  <a
                    href={`#drill-${drillSlug({ slug: row.drill, name: row.drill })}`}
                    className="text-red-700 underline"
                  >
                    {row.activity}
                  </a>
                ) : (
                  row.activity
                )}
              </div>
              {row.focus && <div className="text-sm text-gray-600 mt-1">{row.focus}</div>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
