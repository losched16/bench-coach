'use client'

import { useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

// The Practice Library moved inside Practice Plans, where it belongs — the
// only thing it ever did was start a plan, which is a step in the builder
// rather than a destination of its own.
//
// This route survives as a redirect so bookmarks and any links out in the wild
// don't 404.

function TemplatesRedirect() {
  const router = useRouter()
  const teamId = useSearchParams().get('teamId')

  useEffect(() => {
    router.replace(`/dashboard/practice?teamId=${teamId || ''}&start=template`)
  }, [router, teamId])

  return (
    <div className="flex items-center justify-center py-20 text-gray-500 gap-2">
      <Loader2 className="animate-spin" size={20} />
      <span className="text-sm">Practice templates now live in Practice Plans — taking you there.</span>
    </div>
  )
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading…</div>}>
      <TemplatesRedirect />
    </Suspense>
  )
}
