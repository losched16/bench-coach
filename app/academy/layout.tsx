import type { Metadata } from 'next'
import AcademyHeader, { AcademyFooter } from '@/components/academy/AcademyHeader'
import { currentUser } from '@/lib/academy/server'
import { SITE_URL } from '@/lib/academy/catalog'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'BenchCoach Academy', template: '%s | BenchCoach Academy' },
  description: 'Written-first youth baseball courses for parents and volunteer coaches, from the creator of BenchCoach.',
}

export default async function AcademyLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <AcademyHeader signedIn={!!user} />
      <main className="flex-1">{children}</main>
      <AcademyFooter />
    </div>
  )
}
