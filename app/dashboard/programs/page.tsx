'use client'

// The list moved into Development. This address stays valid for old links.

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function Redirect() {
  const router = useRouter()
  const sp = useSearchParams()
  useEffect(() => { router.replace(`/dashboard/development?${sp.toString()}`) }, [router, sp])
  return <p className="p-4 text-sm text-gray-600">Opening Development…</p>
}
export default function ProgramsRedirect() { return <Suspense fallback={null}><Redirect /></Suspense> }
