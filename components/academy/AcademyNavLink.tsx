'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

// Whether Academy links should show. Starts false, so nothing flashes before the
// answer arrives and a failed request leaves the link hidden.
export function useAcademyOn(): boolean {
  const [on, setOn] = useState(false)
  useEffect(() => {
    let off = false
    fetch('/api/academy/status', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!off && d?.enabled === true) setOn(true) })
      .catch(() => {})
    return () => { off = true }
  }, [])
  return on
}

export default function AcademyNavLink({ className, as }: { className?: string; as?: 'li' }) {
  const on = useAcademyOn()
  if (!on) return null
  const link = <Link href="/academy" className={className}>Academy</Link>
  return as === 'li' ? <li>{link}</li> : link
}
