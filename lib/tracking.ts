'use client'

import { useEffect, useRef, useCallback } from 'react'
import { createSupabaseComponentClient } from '@/lib/supabase'

let cachedUserId: string | null = null

async function getUserId(): Promise<string | null> {
  if (cachedUserId) return cachedUserId
  const supabase = createSupabaseComponentClient()
  const { data: { user } } = await supabase.auth.getUser()
  cachedUserId = user?.id || null
  return cachedUserId
}

// Fire-and-forget event tracking — never blocks UI
function sendEvent(eventName: string, eventType: string, pagePath?: string, metadata?: any) {
  getUserId().then(userId => {
    if (!userId) return
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, eventType, eventName, pagePath, metadata }),
    }).catch(() => {}) // silently ignore errors
  })
}

// Track a page view — call once per page component
export function usePageView(pageName: string) {
  const tracked = useRef(false)
  useEffect(() => {
    if (tracked.current) return
    tracked.current = true
    sendEvent(`page_view_${pageName}`, 'page_view', `/dashboard/${pageName}`)
  }, [pageName])
}

// Track a feature use — call on specific actions
export function useTracker() {
  const track = useCallback((eventName: string, metadata?: any) => {
    sendEvent(eventName, 'feature_use', undefined, metadata)
  }, [])

  return track
}
