import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { loadShell } from '@/lib/academy/shell'
import { getAllBodies } from '@/lib/academy/server'
import CourseNav from '@/components/academy/CourseNav'
import PrintButton from '@/components/academy/PrintButton'
import { Inline } from '@/components/academy/LessonBlocks'

// Printable progress checklist: each lesson's own "Ready to move on when"
// line, with the course's three stages (Introduced / Practicing / Consistent
// in context). Nothing here is new instruction — it is the lessons' criteria
// gathered on paper for the field.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Progress checklist', robots: { index: false, follow: false } }

const STAGES = ['Introduced', 'Practicing', 'Consistent in context']

export default async function Checklist({ params }: { params: { slug: string } }) {
  const s = await loadShell(params.slug, `/learn/${params.slug}/checklist`)
  if (s.access === 'none') redirect(`/academy/${s.course.slug}?access=required`)
  const { course, outline, nav } = s
  const bodies = await getAllBodies(course, s.access === 'owner_preview' ? 'owner' : 'session')
  const rows = outline.lessons.filter(l => l.kind === 'lesson').map(l => {
    const ready = (bodies[l.lesson_key]?.blocks || []).find((b: any) => b.type === 'labeled' && (b.kind === 'ready' || b.kind === 'checkpoint')) as any
    return { l, ready: ready?.text as string | undefined, mod: outline.modules.find(m => m.module_key === l.module_key) }
  })
  return (
    <div className="mx-auto max-w-7xl lg:px-6 lg:py-8 lg:flex lg:gap-10">
      <CourseNav slug={course.slug} current="checklist" {...nav} />
      <main className="flex-1 min-w-0 px-4 sm:px-6 lg:px-0 py-6 lg:py-0">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-red-700 print:text-black">{course.title}</p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900">Progress checklist</h1>
            </div>
            <PrintButton label="Print checklist" />
          </div>
          <p className="mt-3 text-slate-700">Player: ____________________ &nbsp; Age: ______ &nbsp; Bats: ____ &nbsp; Started: __________</p>
          <p className="mt-2 text-sm text-slate-600">Tick a stage when you see it at practice, not when a lesson is read. Move on when the player shows the skill without constant reminders.</p>
          <div className="mt-6 space-y-6" data-testid="checklist">
            {outline.modules.map(m => (
              <section key={m.module_key} className="break-inside-avoid">
                <h2 className="text-lg font-bold text-slate-900">Module {m.position} · {m.title}</h2>
                <ul className="mt-2 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                  {rows.filter(r => r.mod?.module_key === m.module_key).map(({ l, ready }) => (
                    <li key={l.lesson_key} className="p-4 break-inside-avoid">
                      <p className="font-semibold text-slate-900">{l.number_label} {l.title}</p>
                      {ready && <p className="mt-1 text-sm text-slate-700"><span className="font-medium">Ready to move on when:</span> <Inline text={ready} /></p>}
                      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700">
                        {STAGES.map(st => <span key={st} className="inline-flex items-center gap-1.5"><span className="inline-block h-4 w-4 rounded border border-slate-400" aria-hidden />{st}</span>)}
                        <span className="text-slate-400">Date/notes: ______________</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
