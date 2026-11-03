import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight } from 'lucide-react'
import { currentUser, myCourses } from '@/lib/academy/server'

export const dynamic = 'force-dynamic'

export default async function MyCourses() {
  const user = await currentUser()
  if (!user) redirect('/auth/login?redirect=%2Flearn')
  const courses = await myCourses(user.id)
  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6 py-10">
      <h1 className="text-3xl font-bold text-slate-900">My courses</h1>
      {courses.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6" data-testid="no-courses">
          <p className="text-slate-700">You don&apos;t have any Academy courses yet.</p>
          <Link href="/academy" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-red-600 px-5 py-3 font-semibold text-white hover:bg-red-700">Browse courses <ArrowRight size={18} /></Link>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {courses.map(({ course, completed, total }) => (
            <li key={course.id}>
              <Link href={`/learn/${course.slug}`} className="block rounded-2xl border border-slate-200 bg-white p-6 shadow-sm hover:border-slate-300" data-testid="my-course">
                <h2 className="text-xl font-bold text-slate-900">{course.title}{course.subtitle ? `: ${course.subtitle}` : ''}</h2>
                <p className="mt-2 text-sm text-slate-600">{completed} of {total} lessons read</p>
                <div className="mt-2 h-2 rounded-full bg-slate-200"><div className="h-2 rounded-full bg-emerald-500" style={{ width: `${total ? Math.round(completed / total * 100) : 0}%` }} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
