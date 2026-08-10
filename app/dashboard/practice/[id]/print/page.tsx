'use client'

// The practice, on one sheet of paper.
//
// Everything here is already on the plan page. The difference is what a coach
// can use: on the field they are holding a bucket, it is 5:40, and a parent is
// asking where their kid should stand. Fifteen fields per block is the right
// answer on Sunday night and the wrong one on Tuesday.
//
// So this is the clipboard: the one goal, the running order against a clock,
// three things to say all night, and what to put in the car. Deliberately
// black on white, deliberately no video, deliberately fits a page. It reads as
// a document rather than a screen because half its life is spent as paper.
//
// Nothing here fetches anything the plan page does not already have — the sheet
// is derived, so it cannot disagree with the app about what the practice is.

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Printer, ArrowLeft, Loader2 } from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import {
  readPlan, equipmentChecklist, scheduleRows, plannedMinutes,
  fallbackCoachingPoints,
} from '@/lib/practicePlan'

export default function PracticeSheetPage() {
  const params = useParams()
  const router = useRouter()
  const supabase = createSupabaseComponentClient()
  const planId = String(params?.id || '')

  const [plan, setPlan] = useState<any>(null)
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error: e } = await supabase
          .from('practice_plans')
          .select('*, teams(name, age_group)')
          .eq('id', planId)
          .single()
        if (e) throw e
        if (cancelled) return
        // The server client is untyped, so the join arrives as `never`.
        const row = data as any
        setPlan(row)
        setTeamName(
          [row?.teams?.name, row?.teams?.age_group].filter(Boolean).join(' · ')
        )
      } catch (err: any) {
        // A plan on somebody else's team is filtered out by RLS and arrives as
        // "no rows", not as a permission error — so say the thing that is
        // actually true from here rather than inventing a reason.
        if (!cancelled) setError(err?.message || 'That practice plan could not be loaded.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [planId, supabase])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-gray-500">
        <Loader2 className="animate-spin mr-2" size={18} />
        Loading the practice sheet…
      </div>
    )
  }

  if (error || !plan) {
    return (
      <div className="max-w-xl mx-auto py-16 text-center">
        <p className="text-gray-900 font-medium">{error || 'Practice plan not found.'}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-sm text-blue-600 hover:text-blue-700"
        >
          Go back
        </button>
      </div>
    )
  }

  const content = readPlan(plan.content)
  const rows = scheduleRows(content.blocks, content.start_time)
  const equipment = equipmentChecklist(content.blocks)
  const points = content.coaching_points.length
    ? content.coaching_points
    : fallbackCoachingPoints(content.blocks)
  const focus: string[] = plan.focus || plan.focus_areas || []
  const total = plannedMinutes(content.blocks)
  const dated = plan.scheduled_for || plan.created_at

  return (
    <div className="pb-16">
      {/* Screen-only controls. The whole point of the page is what comes out of
          the printer, so none of this is allowed near it. */}
      <div className="print:hidden flex items-center justify-between gap-3 mb-6">
        <Link
          href="/dashboard/practice"
          className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} />
          Back to practice plans
        </Link>
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <Printer size={16} />
          Print / Save as PDF
        </button>
      </div>

      <PrintStyles />

      <article className="sheet mx-auto bg-white text-black border border-gray-300 print:border-0 rounded-lg print:rounded-none p-6 sm:p-8 print:p-0 max-w-[8.5in]">
        {/* Masthead */}
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-600">
              BenchCoach · Practice Plan
            </p>
            <h1 className="text-2xl font-black leading-tight mt-0.5">{plan.title}</h1>
            {teamName && <p className="text-sm text-gray-700 mt-0.5">{teamName}</p>}
          </div>
          <dl className="text-right text-xs shrink-0 space-y-0.5">
            <div><dt className="inline font-bold uppercase tracking-wider text-gray-600">Date </dt>
              <dd className="inline">{formatDate(dated)}</dd></div>
            <div><dt className="inline font-bold uppercase tracking-wider text-gray-600">Length </dt>
              <dd className="inline">{total || plan.duration_minutes} min</dd></div>
            {content.start_time && (
              <div><dt className="inline font-bold uppercase tracking-wider text-gray-600">Start </dt>
                <dd className="inline">{rows[0]?.from}</dd></div>
            )}
          </dl>
        </header>

        {/* Today's #1 goal. Top of the sheet because it is the one thing a coach
            should be able to answer if you stop them halfway through. */}
        {content.objective && (
          <section className="mt-4 border-2 border-black rounded p-3">
            <h2 className="text-[10px] font-black uppercase tracking-[0.15em]">
              Today&rsquo;s #1 goal
            </h2>
            <p className="text-base font-semibold leading-snug mt-1">{content.objective}</p>
          </section>
        )}

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-5 gap-4 print:grid-cols-5">
          {/* Left rail */}
          <div className="sm:col-span-2 print:col-span-2 space-y-4">
            {focus.length > 0 && (
              <Box title="Skills to emphasize">
                <ul className="space-y-1">
                  {focus.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-[13px]">
                      <Tick />
                      <span className="capitalize">{f}</span>
                    </li>
                  ))}
                </ul>
              </Box>
            )}

            {points.length > 0 && (
              <Box title="Coaching points">
                <ol className="space-y-1.5">
                  {points.map((p, i) => (
                    <li key={i} className="flex gap-2 text-[13px] leading-snug">
                      <span className="font-black shrink-0">{i + 1}.</span>
                      <span>{p}</span>
                    </li>
                  ))}
                </ol>
              </Box>
            )}

            {equipment.length > 0 && (
              <Box title="Equipment checklist">
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {equipment.map((item) => (
                    <li key={item} className="flex items-start gap-1.5 text-[12px] leading-snug">
                      <Tick />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </Box>
            )}
          </div>

          {/* The running order */}
          <div className="sm:col-span-3 print:col-span-3">
            <Box title="Practice schedule" tight>
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b-2 border-black">
                    <th className="text-left font-black uppercase text-[10px] tracking-wider py-1 w-[74px]">
                      Time
                    </th>
                    <th className="text-left font-black uppercase text-[10px] tracking-wider py-1">
                      Activity
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.index} className="border-b border-gray-300 align-top">
                      <td className="py-1.5 pr-2 tabular-nums whitespace-nowrap font-semibold">
                        {r.from}–{r.to}
                      </td>
                      <td className="py-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-semibold">{r.title}</span>
                          <span className="text-[11px] text-gray-600 shrink-0">{r.minutes} min</span>
                        </div>
                        {r.description && (
                          <p className="text-[11.5px] text-gray-700 leading-snug mt-0.5">
                            {r.description}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </div>
        </div>

        {/* How to run it, and what is about to go wrong. Below the fold on
            purpose — a coach reads these once in the car, not mid-practice. */}
        {(content.coach_notes || content.flags.length > 0) && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 print:grid-cols-2 gap-4 break-inside-avoid">
            {content.coach_notes && (
              <Box title="How to run this">
                <p className="text-[12.5px] leading-snug whitespace-pre-line">{content.coach_notes}</p>
              </Box>
            )}
            {content.flags.length > 0 && (
              <Box title="Before you start">
                <ul className="space-y-1.5">
                  {content.flags.map((f, i) => (
                    <li key={i} className="text-[12.5px] leading-snug flex gap-1.5">
                      <span className="font-black shrink-0">!</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </Box>
            )}
          </div>
        )}

        {/* Block detail. One page per practice is the goal, so this starts on a
            new sheet — a coach who wants the step-by-step wants all of it, and
            a coach who does not can print page 1 alone. */}
        {content.blocks.some(hasDetail) && (
          <section className="mt-6 print:break-before-page">
            <h2 className="text-[10px] font-black uppercase tracking-[0.15em] border-b-2 border-black pb-1">
              Drill detail
            </h2>
            <div className="divide-y divide-gray-300">
              {content.blocks.map((b, i) =>
                hasDetail(b) ? (
                  <div key={i} className="py-3 break-inside-avoid">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-bold text-[14px]">
                        {i + 1}. {b.title}
                      </h3>
                      <span className="text-[11px] text-gray-600 shrink-0">{b.minutes} min</span>
                    </div>

                    {b.setup && (
                      <p className="text-[12px] leading-snug mt-1">
                        <Label>Set up</Label> {b.setup}
                      </p>
                    )}
                    {b.detailed_instructions && (
                      <div className="text-[12px] leading-snug mt-1 whitespace-pre-line">
                        <Label>Run it</Label> {b.detailed_instructions}
                      </div>
                    )}
                    {(b.coaching_cues?.length ?? 0) > 0 && (
                      <p className="text-[12px] leading-snug mt-1">
                        <Label>Say</Label>{' '}
                        {(b.coaching_cues ?? []).map((c: string) => `“${c}”`).join('  ·  ')}
                      </p>
                    )}
                    {b.watch_for && (
                      <p className="text-[12px] leading-snug mt-1">
                        <Label>Watch for</Label> {b.watch_for}
                      </p>
                    )}
                    {(b.common_mistakes?.length ?? 0) > 0 && (
                      <ul className="text-[12px] leading-snug mt-1 space-y-0.5">
                        {b.common_mistakes.map((m: string, n: number) => (
                          <li key={n} className="flex gap-1.5">
                            <span className="shrink-0">—</span><span>{m}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : null
              )}
            </div>
          </section>
        )}

        <footer className="mt-6 pt-2 border-t border-gray-300 flex items-center justify-between text-[10px] text-gray-600">
          <span>{plan.title} · {teamName}</span>
          <span>Made with BenchCoach</span>
        </footer>
      </article>
    </div>
  )
}

// A block with nothing but a title and a duration adds a heading and no
// information — the schedule table already said that. Only blocks carrying
// something worth reading get a detail entry.
function hasDetail(b: any): boolean {
  return Boolean(
    b?.setup || b?.detailed_instructions || b?.watch_for ||
    b?.coaching_cues?.length || b?.common_mistakes?.length
  )
}

function Box({ title, children, tight }: {
  title: string; children: React.ReactNode; tight?: boolean
}) {
  return (
    <section className="border border-black rounded break-inside-avoid">
      <h2 className="text-[10px] font-black uppercase tracking-[0.13em] bg-black text-white px-2 py-1 rounded-t-[3px] print:rounded-none">
        {title}
      </h2>
      <div className={tight ? 'px-2 py-1.5' : 'p-2.5'}>{children}</div>
    </section>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-black uppercase text-[9.5px] tracking-wider mr-1">{children}</span>
  )
}

// An empty box, not a checkmark: the coach ticks it as they load the car.
function Tick() {
  return <span className="mt-[3px] w-[10px] h-[10px] border border-black shrink-0 inline-block" />
}

function formatDate(value?: string | null): string {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  })
}

// Print rules that Tailwind's print: variant cannot express: the page box
// itself, and forcing backgrounds to survive the printer's default of dropping
// them (the section headings are white-on-black and become invisible without
// it).
function PrintStyles() {
  return (
    <style>{`
      @media print {
        @page { size: letter portrait; margin: 0.5in; }
        html, body { background: #fff !important; }
        .sheet, .sheet * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .sheet { font-size: 11.5px; }
        .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
        .print\\:break-before-page { break-before: page; page-break-before: always; }
        a[href]:after { content: none !important; }
      }
    `}</style>
  )
}
