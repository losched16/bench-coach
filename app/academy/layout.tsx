import type { Metadata } from 'next'
import AcademyHeader, { AcademyFooter } from '@/components/academy/AcademyHeader'
import { currentUser } from '@/lib/academy/server'
import { SITE_URL } from '@/lib/academy/catalog'
import { academyLaunched, academyVisibleTo } from '@/lib/academy/flag'
import { notFound } from 'next/navigation'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'BenchCoach Academy', template: '%s | BenchCoach Academy' },
  description: 'Written-first youth baseball courses for parents and volunteer coaches, from the creator of BenchCoach.',
}

export const dynamic = 'force-dynamic'

export default async function AcademyLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  // Not launched: the Academy does not exist for visitors. The owner can still preview it.
  if (!academyVisibleTo(user)) notFound()
  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {!academyLaunched() && (
        <div role="status" data-testid="academy-preview-banner" className="bg-amber-100 text-amber-900 text-sm text-center px-4 py-2">
          Owner preview. The Academy is not launched (ACADEMY_LAUNCH is off); visitors get a 404.
        </div>
      )}
      <AcademyHeader signedIn={!!user} />
      <main className="flex-1">{children}</main>
      <AcademyFooter />
    </div>
  )
}
