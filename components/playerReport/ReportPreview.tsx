'use client'

// The report as the family will read it.
//
// Built from renderSections() — the same function the PDF uses — so the coach
// cannot approve one document and send another. In particular "hide empty
// sections" is decided once, there, rather than twice with slightly different
// conditions in two renderers.
//
// The links are shown as "Watch drill", not as URLs, for the same reason they
// are in the PDF: a 60-character YouTube link printed across a paragraph is
// how a document stops looking like a document.

import { ExternalLink } from 'lucide-react'
import {
  renderSections, contextLine, formatReportDate, reportTypeLabel,
  type FullReport,
} from '@/lib/playerReports'

export function ReportPreview({ report }: { report: FullReport }) {
  const sections = renderSections(report)
  const ctx = report.context

  return (
    <article className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <header className="px-5 sm:px-8 pt-6 pb-5 border-b-2 border-red-600">
        <p className="text-[11px] font-bold tracking-widest text-red-600">BENCHCOACH</p>
        <h1 className="mt-3 text-2xl sm:text-3xl font-bold text-gray-900">
          {ctx?.player_name || 'Player'}
        </h1>
        {contextLine(ctx) && (
          <p className="mt-1 text-gray-500">{contextLine(ctx)}</p>
        )}
        <p className="mt-2 text-sm text-gray-500">
          {[
            reportTypeLabel(report.report_type),
            formatReportDate(report.report_date),
            ctx?.coach_name ? `Coach ${ctx.coach_name}` : null,
            report.revision > 1 ? `Revision ${report.revision}` : null,
          ].filter(Boolean).join('  ·  ')}
        </p>
        {report.status === 'draft' && (
          <p className="mt-3 inline-block text-xs font-semibold px-2 py-1 rounded bg-amber-100 text-amber-800">
            Draft — not finalized
          </p>
        )}
      </header>

      {sections.length === 0 ? (
        <div className="px-5 sm:px-8 py-10 text-center text-gray-500">
          <p>There is nothing in this report yet.</p>
          <p className="mt-1 text-sm">
            Add a strength, a development area, or a closing comment and it will appear here.
          </p>
        </div>
      ) : (
        <div className="px-5 sm:px-8 py-6 space-y-7">
          {sections.map(section => (
            <section key={section.heading}>
              <h2 className="text-xs font-bold tracking-wider text-red-600 uppercase">
                {section.heading}
              </h2>

              {section.body && (
                <p className="mt-2 text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap">
                  {section.body}
                </p>
              )}

              {section.priorities && (
                <ol className="mt-3 space-y-4">
                  {section.priorities.map((p, i) => (
                    <li key={`${p.label}-${i}`}>
                      <h3 className="font-semibold text-gray-900">{i + 1}. {p.label}</h3>
                      {p.body && (
                        <p className="mt-1 ml-4 text-[15px] leading-relaxed text-gray-800 whitespace-pre-wrap">
                          {p.body}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )}

              {section.drills && (
                <ul className="mt-3 space-y-4">
                  {section.drills.map((d, i) => (
                    <li key={`${d.name}-${i}`}>
                      <h3 className="font-semibold text-gray-900">{d.name}</h3>
                      {d.reason && (
                        <p className="mt-0.5 ml-4 text-sm italic text-gray-500">
                          Why this one: {d.reason}
                        </p>
                      )}
                      {d.description && (
                        <p className="mt-1 ml-4 text-[15px] leading-relaxed text-gray-800">
                          {d.description}
                        </p>
                      )}
                      {d.dosage && (
                        <p className="mt-1 ml-4 text-sm text-gray-500">{d.dosage}</p>
                      )}
                      {d.link && (
                        <a
                          href={d.link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 ml-4 inline-flex items-center gap-1 text-sm font-medium text-red-600 hover:text-red-700 underline"
                        >
                          {d.link.label}
                          <ExternalLink size={13} aria-hidden />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      <footer className="px-5 sm:px-8 py-3 border-t border-gray-200 text-xs text-gray-400">
        Player Development Report powered by BenchCoach
      </footer>
    </article>
  )
}

export default ReportPreview
