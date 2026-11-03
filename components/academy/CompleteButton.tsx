'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Circle, Loader2 } from 'lucide-react'
import { track } from './Track'

// "Mark lesson complete" — reading progress, not skill mastery. Also records
// that the lesson was opened (once per visit).
export default function CompleteButton({ slug, lesson, completed, isFirstOpen, completesModule, completesCourse }: {
  slug: string; lesson: string; completed: boolean; isFirstOpen: boolean; completesModule: boolean; completesCourse: boolean
}) {
  const router = useRouter()
  const [done, setDone] = useState(completed)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const opened = useRef(false)

  const send = (action: 'open' | 'complete' | 'incomplete') =>
    fetch('/api/academy/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course: slug, lesson, action }) })

  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void send('open')
    if (isFirstOpen) track('first_lesson_started', slug, lesson)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => setDone(completed), [completed])

  const toggle = async () => {
    setBusy(true); setError(null)
    const next = !done
    const r = await send(next ? 'complete' : 'incomplete').catch(() => null)
    if (!r || !r.ok) { setError('Could not save. Check your connection and try again.'); setBusy(false); return }
    setDone(next); setBusy(false)
    if (next) {
      track('lesson_completed', slug, lesson)
      if (completesModule) track('module_completed', slug, lesson)
      if (completesCourse) track('course_completed', slug, lesson)
    }
    router.refresh()
  }

  return (
    <div>
      <button onClick={toggle} disabled={busy} aria-pressed={done} data-testid="complete"
        className={`inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg px-6 py-3 font-semibold transition-colors ${done
          ? 'border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
          : 'bg-[#0f172a] text-white hover:bg-slate-800'}`}>
        {busy ? <Loader2 className="animate-spin" size={18} /> : done ? <Check size={18} /> : <Circle size={18} />}
        {done ? 'Lesson complete' : 'Mark lesson complete'}
      </button>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  )
}
