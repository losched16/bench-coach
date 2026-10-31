import type { Metadata } from 'next'
import AcademyHeader from '@/components/academy/AcademyHeader'
import { currentUser, myCourses } from '@/lib/academy/server'
import { academyVisibleTo } from '@/lib/academy/flag'
import { notFound } from 'next/navigation'

// Purchased course content: never indexed, never cached by a shared cache.
export const metadata: Metadata = {
  title: { default: 'My courses | BenchCoach Academy', template: '%s | BenchCoach Academy' },
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  // Before launch /learn is for the owner. Once someone has bought a course they keep
  // access whatever the flag says: it stops sales, it does not lock customers out.
  if (!academyVisibleTo(user) && !(user && (await myCourses(user.id)).length > 0)) notFound()
  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <AcademyHeader signedIn={!!user} inCourse />
      {children}
    </div>
  )
}
