// Deterministic regression test: two simultaneous pitch taps must both count.
//
//   npm run test:pitch-count-concurrency
//
// No timers and no real concurrency. The in-memory table below yields at every
// await, and the requests are started together, so the interleaving is the same
// on every run: every request reads the count BEFORE any of them writes. That
// is exactly the situation a fast thumb creates on a slow connection.

import { writeSession } from '../lib/pitchCountWrite'

let failures = 0
function check(label: string, cond: boolean, detail = '') {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

// A one-table stand-in with just the calls the writer makes.
function fakeDb(initial: { id: string; pitches: number | null }, opts: { alwaysConflict?: boolean } = {}) {
  const row = { ...initial }
  const tick = () => Promise.resolve().then(() => Promise.resolve())
  const db = {
    row,
    writes: 0,
    from(_t: string) {
      return {
        update(u: Record<string, any>) {
          const conds: Array<(r: any) => boolean> = []
          const q: any = {
            eq(col: string, v: any) { conds.push(r => r[col] === v); return q },
            is(col: string, v: any) { conds.push(r => r[col] === v); return q },
            select() { return q },
            async maybeSingle() {
              await tick()
              if (opts.alwaysConflict || !conds.every(c => c(row))) return { data: null, error: null }
              Object.assign(row, u); db.writes++
              return { data: { ...row }, error: null }
            },
          }
          return q
        },
        select() {
          const q: any = {
            eq() { return q },
            async maybeSingle() { await tick(); return { data: { pitches: row.pitches }, error: null } },
          }
          return q
        },
      }
    },
  }
  return db
}

// What the route did before the fix, kept here so the test proves it would fail on it:
// compute count+1 from the value read earlier, then write it unconditionally.
async function naiveTap(db: ReturnType<typeof fakeDb>, readCount: number) {
  await Promise.resolve()
  db.row.pitches = readCount + 1
}

async function main() {
  // 1. the bug, reproduced: two requests both read 5
  {
    const db = fakeDb({ id: 's1', pitches: 5 })
    const a = db.row.pitches!, b = db.row.pitches!         // both read before either writes
    await Promise.all([naiveTap(db, a), naiveTap(db, b)])
    check('REPRODUCTION: the old read-then-write loses a tap (5 + 2 taps = 6, not 7)', db.row.pitches === 6, String(db.row.pitches))
  }

  // 2. the fix: the same interleaving, through the real writer
  {
    const db = fakeDb({ id: 's1', pitches: 5 })
    const [ra, rb] = await Promise.all([
      writeSession(db, 's1', { pitches: 6 }, 1, 5),   // both computed 5 + 1 from the same read
      writeSession(db, 's1', { pitches: 6 }, 1, 5),
    ])
    check('two simultaneous taps: both succeed', ra.kind === 'ok' && rb.kind === 'ok')
    check('...and the count is 7, neither lost', db.row.pitches === 7, String(db.row.pitches))
    check('...each tap wrote exactly once', db.writes === 2, String(db.writes))
  }

  // 3. many at once, all from the same stale read
  {
    const N = 12
    const db = fakeDb({ id: 's1', pitches: 0 })
    const results = await Promise.all(Array.from({ length: N }, () => writeSession(db, 's1', { pitches: 1 }, 1, 0)))
    check(`${N} simultaneous taps from one stale read: every one succeeds`, results.every(r => r.kind === 'ok'))
    check(`...and the count is exactly ${N}`, db.row.pitches === N, String(db.row.pitches))
    const seen = results.map(r => (r as any).row.pitches).sort((x, y) => x - y)
    check('...each request is told a different running total (1..N)', seen.every((v, i) => v === i + 1), seen.join(','))
  }

  // 4. a mix of up and down taps
  {
    const db = fakeDb({ id: 's1', pitches: 10 })
    await Promise.all([
      writeSession(db, 's1', { pitches: 11 }, 1, 10), writeSession(db, 's1', { pitches: 9 }, -1, 10),
      writeSession(db, 's1', { pitches: 11 }, 1, 10), writeSession(db, 's1', { pitches: 11 }, 1, 10),
    ])
    check('three taps up and one correction down, all from the same read: 10 + 3 - 1 = 12', db.row.pitches === 12, String(db.row.pitches))
  }

  // 5. edges
  {
    const db = fakeDb({ id: 's1', pitches: 0 })
    await writeSession(db, 's1', { pitches: 0 }, -1, 0)
    check('a correction below zero stays at zero', db.row.pitches === 0)
  }
  {
    const db = fakeDb({ id: 's1', pitches: null })
    const r = await Promise.all([writeSession(db, 's1', { pitches: 1 }, 1, null), writeSession(db, 's1', { pitches: 1 }, 1, null)])
    check('a session whose count is null still counts both taps', r.every(x => x.kind === 'ok') && db.row.pitches === 2, String(db.row.pitches))
  }
  {
    const db = fakeDb({ id: 's1', pitches: 5 })
    const r = await writeSession(db, 's1', { pitches: 40 }, undefined, 5)
    check('an absolute count (no delta) still just overwrites', r.kind === 'ok' && db.row.pitches === 40)
  }
  {
    const db = fakeDb({ id: 's1', pitches: 3 }, { alwaysConflict: true })
    const r = await writeSession(db, 's1', { pitches: 4 }, 1, 3, 5)
    check('if it can never win, it reports "busy" instead of pretending or throwing', r.kind === 'busy')
    check('...and wrote nothing', db.writes === 0 && db.row.pitches === 3)
  }

  console.log('')
  if (failures) { console.log(`${failures} FAILED`); process.exit(1) }
  console.log('ALL PASS')
}
main().catch(e => { console.error(e); process.exit(1) })
