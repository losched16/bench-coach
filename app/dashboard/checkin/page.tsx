'use client'

import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// Priorities moved to the dashboard. The dashboard was already rendering the
// same ActivePriority cards from the same data — two URLs for one screen, one
// of them called "Dashboard" and one called "Priorities".
//
// This stays as a redirect because the weekly digest email and every priority
// card link here, and those links outlive a refactor.

function Redirect() {
  const router = useRouter()
  const params = useSearchParams()

  useEffect(() => {
    const qs = params.toString()
    router.replace(qs ? `/dashboard?${qs}` : '/dashboard')
  }, [router, params])

  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-gray-400" size={32} />
    </div>
  )
}

export default function CheckinPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    }>
      <Redirect />
    </Suspense>
  )
}
