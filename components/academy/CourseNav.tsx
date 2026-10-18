'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Circle, List, X, Printer, BookOpen } from 'lucide-react'

export interface NavLesson { key: string; title: string; number: string | null; kind: 'intro' | 'lesson' | 'resource'; moduleKey: string | null; done: boolean }
export interface NavModule { key: string; title: string; position: number }

function NavList({ slug, modules, lessons, current, onNavigate }: {
  slug: string; modules: NavModule[]; lessons: NavLesson[]; current: string | null; onNavigate?: () => void
}) {
  const item = (l: NavLesson) => {
    const active = l.key === current
    return (
      <li key={l.key}>
        <Link href={`/learn/${slug}/${l.key}`} onClick={onNavigate} aria-current={active ? 'page' : undefined}
          className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? 'bg-red-50 text-red-800 font-semibold' : 'text-slate-700 hover:bg-slate-100'}`}>
          {l.kind === 'lesson'
            ? (l.done ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" aria-label="completed" /> : <Circle size={16} className="mt-0.5 shrink-0 text-slate-300" aria-label="not completed" />)
            : <BookOpen size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden />}
          <span>{l.number ? <span className="tabular-nums text-slate-500 mr-1">{l.number}</span> : null}{l.title}</span>
        </Link>
      </li>
    )
  }
  return (
    <nav aria-label="Course contents" className="space-y-5 text-sm">
      <div>
        <Link href={`/learn/${slug}`} onClick={onNavigate} className={`block rounded-lg px-2 py-1.5 font-semibold ${current === null ? 'bg-red-50 text-red-800' : 'text-slate-900 hover:bg-slate-100'}`}>Course overview</Link>
      </div>
      <div>
        <h3 className="px-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Start here</h3>
        <ul className="space-y-0.5">{lessons.filter(l => l.kind === 'intro').map(item)}</ul>
      </div>
      {modules.map(m => (
        <div key={m.key}>
          <h3 className="px-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Module {m.position} · {m.title}</h3>
          <ul className="space-y-0.5">{lessons.filter(l => l.moduleKey === m.key).map(item)}</ul>
        </div>
      ))}
      <div>
        <h3 className="px-2 text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Practice resources</h3>
        <ul className="space-y-0.5">
          {lessons.filter(l => l.kind === 'resource').map(item)}
          <li>
            <Link href={`/learn/${slug}/checklist`} onClick={onNavigate} aria-current={current === 'checklist' ? 'page' : undefined}
              className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${current === 'checklist' ? 'bg-red-50 text-red-800 font-semibold' : 'text-slate-700 hover:bg-slate-100'}`}>
              <Printer size={16} className="mt-0.5 shrink-0 text-slate-400" aria-hidden /> Printable progress checklist
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  )
}

export default function CourseNav(props: { slug: string; modules: NavModule[]; lessons: NavLesson[]; current: string | null; completed: number; total: number }) {
  const [open, setOpen] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; openRef.current?.focus() }
  }, [open])
  const pct = props.total ? Math.round((props.completed / props.total) * 100) : 0
  const bar = (
    <div className="px-2">
      <div className="flex justify-between text-xs text-slate-600 mb-1"><span>{props.completed} of {props.total} lessons read</span><span>{pct}%</span></div>
      <div className="h-2 rounded-full bg-slate-200" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Lessons read">
        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
  return (
    <>
      {/* Phone / tablet: a bar with the drawer button. */}
      <div className="lg:hidden print:hidden sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur px-4 py-2 flex items-center gap-3">
        <button ref={openRef} onClick={() => setOpen(true)} aria-expanded={open} aria-controls="course-drawer" data-testid="drawer-open"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-800">
          <List size={16} /> Contents
        </button>
        <div className="flex-1 min-w-0">{bar}</div>
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-label="Course contents" id="course-drawer">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[86%] max-w-sm overflow-y-auto bg-white p-4 shadow-xl" data-testid="drawer">
            <div className="flex items-center justify-between mb-4">
              <span className="font-semibold text-slate-900">Course contents</span>
              <button ref={closeRef} onClick={() => setOpen(false)} aria-label="Close contents" className="rounded-lg p-2 hover:bg-slate-100"><X size={18} /></button>
            </div>
            <div className="mb-4">{bar}</div>
            <NavList {...props} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      {/* Desktop: a sticky sidebar. */}
      <aside className="hidden lg:block print:hidden w-72 shrink-0">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto pr-2 space-y-4 pb-8">
          {bar}
          <NavList {...props} />
        </div>
      </aside>
    </>
  )
}
