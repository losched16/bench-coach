// Writing a pitch count without losing a tap.
//
// A tap is read-then-write. Two taps in flight (a thumb is faster than a
// phone's network) both read the same count, so an unconditional write of
// count+1 from each lands on the same value and one pitch vanishes. Here the
// write is conditional on the count it was computed from; if another tap got
// there first, the count is re-read and the tap applied on top of it.

export type WriteResult =
  | { kind: 'ok'; row: any }
  | { kind: 'gone' }
  | { kind: 'busy' }
  | { kind: 'error'; error: any }

export async function writeSession(
  db: { from: (t: string) => any },
  sessionId: string,
  update: Record<string, any>,
  delta: number | undefined,
  startPitches: number | null | undefined,
  maxAttempts = 40,
): Promise<WriteResult> {
  let base = startPitches
  const u = { ...update }
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let q = db.from('pitch_count_sessions').update(u).eq('id', sessionId)
    // Only a relative tap needs the condition; an absolute number overwrites on purpose.
    if (typeof delta === 'number') q = base === null || base === undefined ? q.is('pitches', null) : q.eq('pitches', base)
    const r = await q.select('*').maybeSingle()
    if (r.error) return { kind: 'error', error: r.error }
    if (r.data) return { kind: 'ok', row: r.data }
    if (typeof delta !== 'number') return { kind: 'gone' }
    const again = await db.from('pitch_count_sessions').select('pitches').eq('id', sessionId).maybeSingle()
    if (again.error) return { kind: 'error', error: again.error }
    if (!again.data) return { kind: 'gone' }
    base = again.data.pitches
    u.pitches = Math.max(0, (base || 0) + delta)
  }
  return { kind: 'busy' }
}
