'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createSupabaseComponentClient } from './supabase'

// The browser client is generated against the typed Database, which predates
// user_ui_prefs, so every call here goes through an untyped handle. Same
// reason lib/drills.ts takes `supabase: any`: regenerating the types is a
// separate chore and a preference read must not wait on it.
const untyped = (c: unknown) => c as any

// One person's interface state: dismissed help, onboarding progress.
//
// THE RULE THIS IS BUILT AROUND: A PREFERENCE FAILURE MUST NEVER BLOCK THE
// PRODUCT. If the table is missing, the network is down, or the read is slow, a
// coach still gets the page. The worst outcome of a total failure here is
// seeing a help card twice — which is a great deal better than a spinner where
// the practice planner should be.
//
// So every read and write below swallows its error, and the hook reports
// `ready` separately from `value`, so callers can avoid flashing a card at
// somebody who dismissed it last week.
//
// Stored against auth.uid(), not against a coach row. An invited assistant may
// have no coach row at all (see lib/authz.ts), and they are exactly the people
// this feature exists to help.
//
// NOT localStorage. Two accounts on one phone — a head coach and the assistant
// who borrowed it — must not inherit each other's dismissals, which is the
// thing localStorage cannot promise.

type PrefValue = Record<string, any>

interface UseUiPref {
  value: PrefValue | null
  /** The read has finished, one way or the other. */
  ready: boolean
  /** Merge keys in. Optimistic; a failed write is not surfaced to the coach. */
  set: (patch: PrefValue) => void
  /** Forget it entirely — "show me this again". */
  clear: () => void
}

export function useUiPref(key: string | null): UseUiPref {
  const supabase = createSupabaseComponentClient()
  const [value, setValue] = useState<PrefValue | null>(null)
  const [ready, setReady] = useState(false)
  const userId = useRef<string | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    if (!key) { setReady(true); return }
    let cancelled = false

    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { if (!cancelled) setReady(true); return }
        userId.current = user.id

        const { data, error } = await untyped(supabase)
          .from('user_ui_prefs')
          .select('value')
          .eq('user_id', user.id)
          .eq('key', key)
          .maybeSingle()
        if (error) throw error
        if (!cancelled) setValue((data as any)?.value ?? null)
      } catch {
        // Missing table, offline, anything. The caller gets ready=true and a
        // null value, which reads as "not dismissed" — the safe default,
        // because showing help twice beats hiding it forever.
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = useCallback((patch: PrefValue) => {
    if (!key) return
    // Optimistic. The coach sees the card close immediately; whether the write
    // lands is not something they should have to wait for or hear about.
    setValue(prev => ({ ...(prev || {}), ...patch }))
    ;(async () => {
      try {
        let uid = userId.current
        if (!uid) {
          const { data: { user } } = await supabase.auth.getUser()
          uid = user?.id ?? null
          userId.current = uid
        }
        if (!uid) return
        const next = { ...(value || {}), ...patch }
        await untyped(supabase).from('user_ui_prefs').upsert({
          user_id: uid, key, value: next, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,key' })
      } catch { /* see the note at the top of this file */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value])

  const clear = useCallback(() => {
    if (!key) return
    setValue(null)
    ;(async () => {
      try {
        const uid = userId.current
        if (!uid) return
        await untyped(supabase).from('user_ui_prefs').delete().eq('user_id', uid).eq('key', key)
      } catch { /* see above */ }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return { value, ready, set, clear }
}

/** The key a module's first-use card is remembered under. */
export function helpDismissKey(guideId: string): string {
  return `help.dismissed.${guideId}`
}

export const ONBOARDING_PREF_KEY = 'onboarding.first-practice'
