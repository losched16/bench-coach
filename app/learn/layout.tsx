import type { Metadata } from 'next'
import AcademyHeader from '@/components/academy/AcademyHeader'
import { currentUser } from '@/lib/academy/server'

// Purchased course content: never indexed, never cached by a shared cache.
export const metadata: Metadata = {
  title: { default: 'My courses | BenchCoach Academy', template: '%s | BenchCoach Academy' },
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

export default async function LearnLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  return (
    <div className="min-h-screen bg-slate-50 print:bg-white">
      <AcademyHeader signedIn={!!user} inCourse />
      {children}
    </div>
  )
}
