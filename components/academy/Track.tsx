'use client'
import { useEffect, useRef } from 'react'

/** Fire one Academy analytics event when mounted (see /api/academy/track). */
export function track(event: string, course?: string, lesson?: string) {
  try {
    fetch('/api/academy/track', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, course, lesson }), keepalive: true,
    }).catch(() => {})
  } catch { /* never block the page */ }
}

export default function Track({ event, course, lesson }: { event: string; course?: string; lesson?: string }) {
  const done = useRef(false)
  useEffect(() => {
    if (done.current) return
    done.current = true
    track(event, course, lesson)
  }, [event, course, lesson])
  return null
}
