'use client'

// /dashboard/practice/<id> — the address a plan is linked to from the
// dashboard and the plan cards.
//
// There is no separate page for one plan: a saved plan lives on the practice
// page, expanded in place, with its edit, print and swap controls around it.
// This address existed only in links, so it answered 404. Now it does the one
// thing the link meant: open the practice page with that plan expanded.
//
// The team id is carried across when the link had it. When it did not, the
// plan row is read (under the caller's own session, so RLS decides) to find
// the team, because the practice page loads nothing without one.

import { useEffect } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { createSupabaseComponentClient } from '@/lib/supabase'

export default function PracticePlanRedirect() {
  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const planId = String(params?.id || '')
  const teamIdFromLink = searchParams.get('teamId')

  useEffect(() => {
    if (!planId) { router.replace('/dashboard/practice'); return }
    let cancelled = false
    ;(async () => {
      let teamId = teamIdFromLink
      if (!teamId) {
        const supabase = createSupabaseComponentClient()
        const { data } = await supabase
          .from('practice_plans').select('team_id').eq('id', planId).maybeSingle()
        teamId = (data as any)?.team_id || null
      }
      if (cancelled) return
      const q = new URLSearchParams()
      if (teamId) q.set('teamId', teamId)
      q.set('plan', planId)
      router.replace(`/dashboard/practice?${q.toString()}`)
    })()
    return () => { cancelled = true }
  }, [planId, teamIdFromLink, router])

  return (
    <div className="flex items-center justify-center min-h-[40vh] text-gray-500">
      <Loader2 className="h-5 w-5 animate-spin mr-2" />
      Opening practice plan…
    </div>
  )
}
