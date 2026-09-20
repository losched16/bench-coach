'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
//
// ── THE FOUR WAYS A HOOK LIKE THIS GOES WRONG, AND WHAT STOPS EACH ─────────
//
// RLS proves one ACCOUNT cannot read another's rows. It proves nothing about
// what this hook holds in memory when the account, the key, or the order of
// two responses changes underneath it. All four are handled here, in code,
// and covered by scripts/test-ui-pref.ts.
//
// 1. THE ACCOUNT CHANGES WHILE MOUNTED. A coach signs out and an assistant
//    signs in on the same borrowed phone without a reload. Without the auth
//    subscription below, the assistant inherits the head coach's dismissals
//    from React state — the exact leak the table's RLS was chosen to prevent,
//    reintroduced above the database. On any change of user id the snapshot is
//    dropped and re-read.
//
// 2. THE KEY CHANGES. One `ModuleHelp` unmounting and another mounting can
//    reuse the hook instance with a new guide's key. The old guide's value must
//    not answer for the new one, so the snapshot is stamped with the key it was
//    read for and anything else reads as not-ready. No flash of the wrong card.
//
// 3. A STALE READ LANDS LAST. Key or account changes mid-flight and the first
//    request answers second. Every read carries a sequence number and a late
//    one is dropped.
//
// 4. TWO PATCHES IN THE SAME TICK. Dismiss and record-progress fire together;
//    both merge onto the value React last rendered, and the second silently
//    drops the first. Merges come off a ref updated synchronously, and writes
//    are serialised per key, so both survive in the order they were made.
//
// And one that is not a bug but reads like one: TWO COMPONENTS, ONE KEY. The
// dashboard can show the checklist and a Help Center control for the same
// preference. Without the small subscriber registry below, dismissing in one
// leaves the other showing until a reload.

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

// ── cross-consumer sync ────────────────────────────────────────────────────
//
// Scoped by account AND key, so a value published under one account can never
// be delivered to a consumer that has since switched to another.

type Listener = (v: PrefValue | null) => void
const listeners = new Map<string, Set<Listener>>()

function subscribe(scope: string, fn: Listener): () => void {
  let set = listeners.get(scope)
  if (!set) { set = new Set(); listeners.set(scope, set) }
  set.add(fn)
  return () => {
    const s = listeners.get(scope)
    if (!s) return
    s.delete(fn)
    if (s.size === 0) listeners.delete(scope)
  }
}

function publish(scope: string, v: PrefValue | null, except: Listener): void {
  const set = listeners.get(scope)
  if (!set) return
  for (const fn of Array.from(set)) {
    if (fn !== except) fn(v)
  }
}

// One promise chain per scope. Two patches in the same tick reach the server in
// the order the coach made them, rather than racing.
const writeQueues = new Map<string, Promise<unknown>>()

function enqueue(scope: string, job: () => Promise<unknown>): void {
  const prev = writeQueues.get(scope) || Promise.resolve()
  const next = prev.then(job, job).catch(() => {
    // see the rule at the top of this file
  })
  writeQueues.set(scope, next)
  next.finally(() => {
    if (writeQueues.get(scope) === next) writeQueues.delete(scope)
  })
}

/** Exported for tests only — the registry has to be empty between cases. */
export function __resetUiPrefRegistries(): void {
  listeners.clear()
  writeQueues.clear()
}

/** Exported for tests only. */
export function __uiPrefListenerCount(scope: string): number {
  return listeners.get(scope)?.size ?? 0
}

// ── the hook ───────────────────────────────────────────────────────────────

interface Snapshot {
  /** What this value was read for. Anything else is somebody else's answer. */
  key: string | null
  userId: string | null
  value: PrefValue | null
  ready: boolean
}

const EMPTY: Snapshot = { key: null, userId: null, value: null, ready: false }

export function useUiPref(key: string | null): UseUiPref {
  const supabase = useMemo(() => createSupabaseComponentClient(), [])
  const [snap, setSnap] = useState<Snapshot>(EMPTY)

  // The account this hook is currently reading for. Written only by the read
  // and the auth subscription, never by a write.
  const userId = useRef<string | null>(null)
  // Latest known value, updated synchronously so same-tick merges compound.
  const latest = useRef<PrefValue | null>(null)
  // Bumped on every key change, account change and unmount.
  const seq = useRef(0)
  const keyRef = useRef<string | null>(key)
  keyRef.current = key

  // A snapshot read for a different key or account does not answer for this
  // one. Computing it here rather than clearing state in an effect means there
  // is no render in which the previous guide's dismissal is visible.
  const fresh = snap.key === key && snap.userId === userId.current
  const value = key === null ? null : (fresh ? snap.value : null)
  const ready = key === null ? true : (fresh ? snap.ready : false)
  latest.current = value

  const read = useCallback(async () => {
    const mine = ++seq.current
    const k = keyRef.current
    if (!k) { userId.current = null; return }

    let uid: string | null = null
    try {
      const { data: { user } } = await supabase.auth.getUser()
      uid = user?.id ?? null
    } catch {
      uid = null
    }
    if (mine !== seq.current) return
    userId.current = uid

    if (!uid) {
      // Signed out. Ready, with nothing — a card shows, which is the safe
      // direction. It is never somebody else's state.
      latest.current = null
      setSnap({ key: k, userId: null, value: null, ready: true })
      return
    }

    let v: PrefValue | null = null
    try {
      const { data, error } = await untyped(supabase)
        .from('user_ui_prefs')
        .select('value')
        .eq('user_id', uid)
        .eq('key', k)
        .maybeSingle()
      // PostgREST reports failure in `error` far more often than it throws, so
      // this branch is the one that actually runs when the table is missing.
      if (error) throw error
      v = (data as any)?.value ?? null
    } catch {
      // Missing table, offline, anything. The caller gets ready=true and a
      // null value, which reads as "not dismissed" — the safe default,
      // because showing help twice beats hiding it forever.
      v = null
    }
    if (mine !== seq.current) return
    latest.current = v
    setSnap({ key: k, userId: uid, value: v, ready: true })
  }, [supabase])

  // Read on mount and on every key change.
  useEffect(() => {
    read()
    return () => { seq.current++ }
  }, [key, read])

  // An account change invalidates everything held here.
  useEffect(() => {
    let sub: { unsubscribe: () => void } | null = null
    try {
      const r = supabase.auth.onAuthStateChange((_event: string, session: any) => {
        const next = session?.user?.id ?? null
        if (next === userId.current) return
        // Drop the old account's state before anything can render with it.
        seq.current++
        userId.current = next
        latest.current = null
        setSnap(EMPTY)
        read()
      })
      sub = r?.data?.subscription ?? null
    } catch {
      // No auth events available (a test double, an old client). The hook still
      // works; it just will not notice a switch without a reload.
    }
    return () => { try { sub?.unsubscribe() } catch { /* nothing to undo */ } }
  }, [supabase, read])

  // Another consumer of the same preference changed it.
  useEffect(() => {
    if (!key) return
    const uid = userId.current
    if (!uid) return
    const scope = `${uid}::${key}`
    const onPeer: Listener = v => {
      latest.current = v
      setSnap({ key, userId: uid, value: v, ready: true })
    }
    return subscribe(scope, onPeer)
    // snap.userId is in the list so the subscription re-binds once the read
    // resolves an account, not only when the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, snap.userId])

  const set = useCallback((patch: PrefValue) => {
    const k = keyRef.current
    if (!k) return
    // Merge off the ref, not off React state. Two patches in one tick both see
    // the first one's result, so neither is lost.
    const next = { ...(latest.current || {}), ...patch }
    latest.current = next

    // Optimistic. The coach sees the card close immediately; whether the write
    // lands is not something they should have to wait for or hear about.
    const uid = userId.current
    setSnap({ key: k, userId: uid, value: next, ready: true })

    const notify: Listener = () => {}
    if (uid) publish(`${uid}::${k}`, next, notify)

    enqueue(`${uid || 'anon'}::${k}`, async () => {
      let writeAs = userId.current
      if (!writeAs) {
        try {
          const { data: { user } } = await supabase.auth.getUser()
          writeAs = user?.id ?? null
        } catch { writeAs = null }
      }
      if (!writeAs) return
      // The account may have changed between the click and the write. Writing
      // the old account's value under the new account's id would be a leak.
      if (uid && writeAs !== uid) return
      const { error } = await untyped(supabase).from('user_ui_prefs').upsert({
        user_id: writeAs, key: k, value: latest.current ?? next,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,key' })
      if (error) throw error
    })
  }, [supabase])

  const clear = useCallback(() => {
    const k = keyRef.current
    if (!k) return
    const uid = userId.current
    latest.current = null
    setSnap({ key: k, userId: uid, value: null, ready: true })
    if (uid) publish(`${uid}::${k}`, null, () => {})

    enqueue(`${uid || 'anon'}::${k}`, async () => {
      const writeAs = userId.current
      if (!writeAs) return
      if (uid && writeAs !== uid) return
      const { error } = await untyped(supabase)
        .from('user_ui_prefs').delete().eq('user_id', writeAs).eq('key', k)
      if (error) throw error
    })
  }, [supabase])

  return { value, ready, set, clear }
}

/** The key a module's first-use card is remembered under. */
export function helpDismissKey(guideId: string): string {
  return `help.dismissed.${guideId}`
}

export const ONBOARDING_PREF_KEY = 'onboarding.first-practice'
