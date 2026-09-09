// What is actually wrong with the drill library, counted rather than guessed.
//
// DIAGNOSE_DRILL_LIBRARY.sql answers the same questions in SQL, which is the
// right tool when you have a psql prompt. This is the version that runs from a
// terminal against the live anon-key API, so it can be run in CI, in a sandbox,
// or by anyone who has the app's own read credentials and no database console.
//
// Read-only. It writes nothing and takes no arguments.
//
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//     npx tsx scripts/audit-drill-library.ts
//
// The questions, in the order that matters:
//
//   1. Can every problem in the taxonomy be answered at all? A problem with
//      zero approved drills is a coach asking for help and being told nothing.
//      This is the one hard rule the library has: coverage beats quality.
//   2. Is a drill reachable? An unmapped drill can only be found by text
//      search — the weakest retrieval path — so it is nearly invisible.
//   3. Does a recommendation arrive usable? A drill whose video is a
//      twelve-minute compilation starting at 0:00 is a right answer delivered
//      badly, and it is the moment a recommendation stops feeling like one.

import { createClient } from '@supabase/supabase-js'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!URL || !KEY) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.')
  process.exit(1)
}

const sb = createClient(URL, KEY)

function bar(n: number, of: number, width = 28) {
  const filled = of === 0 ? 0 : Math.round((n / of) * width)
  return '█'.repeat(filled) + '·'.repeat(width - filled)
}

async function main() {
  const [{ data: drills, error: e1 }, { data: problems, error: e2 }, { data: maps, error: e3 }] =
    await Promise.all([
      sb.from('drill_resources')
        .select('id,drill_name,description,skill_category,youtube_video_id,youtube_start_seconds,min_coaches,throwing_load')
        .eq('status', 'approved'),
      sb.from('problem_taxonomy').select('slug,label,skill_category,aliases'),
      sb.from('drill_problem_map').select('drill_id,problem_slug,curated'),
    ])

  if (e1 || e2 || e3) {
    console.error('read failed:', e1?.message || e2?.message || e3?.message)
    process.exit(1)
  }

  const D = (drills || []) as any[]
  const P = (problems || []) as any[]
  const M = (maps || []) as any[]

  const approved = new Set(D.map(d => d.id))
  const liveMaps = M.filter(m => approved.has(m.drill_id))

  const perProblem = new Map<string, number>()
  const curatedPerProblem = new Map<string, number>()
  for (const m of liveMaps) {
    perProblem.set(m.problem_slug, (perProblem.get(m.problem_slug) || 0) + 1)
    if (m.curated) curatedPerProblem.set(m.problem_slug, (curatedPerProblem.get(m.problem_slug) || 0) + 1)
  }
  const mappedDrills = new Set(liveMaps.map(m => m.drill_id))

  const zero = P.filter(p => (perProblem.get(p.slug) || 0) === 0)
  const thin = P.filter(p => { const n = perProblem.get(p.slug) || 0; return n >= 1 && n <= 2 })
  const noCurated = P.filter(p => (perProblem.get(p.slug) || 0) > 0 && (curatedPerProblem.get(p.slug) || 0) === 0)

  const unmapped = D.filter(d => !mappedDrills.has(d.id))
  const thinDesc = D.filter(d => (d.description || '').length < 120)
  const noVideo = D.filter(d => !d.youtube_video_id)
  const withVideo = D.filter(d => d.youtube_video_id)
  const noStart = withVideo.filter(d => !d.youtube_start_seconds)

  const videoUse = new Map<string, string[]>()
  for (const d of withVideo) {
    const list = videoUse.get(d.youtube_video_id) || []
    list.push(d.drill_name)
    videoUse.set(d.youtube_video_id, list)
  }
  const sharedVideos = Array.from(videoUse.entries()).filter(([, names]) => names.length > 1)
  const drillsOnSharedVideo = sharedVideos.reduce((a, [, names]) => a + names.length, 0)
  // The case that actually hurts: a video shared by several drills AND opening
  // at 0:00, so the coach who tapped "Low Tee" lands on a compilation intro.
  const sharedAndUntimed = sharedVideos.reduce((a, [id, names]) => {
    const untimed = withVideo.filter(d => d.youtube_video_id === id && !d.youtube_start_seconds).length
    return a + (names.length > 1 ? untimed : 0)
  }, 0)

  const aliasCounts = P.map(p => (Array.isArray(p.aliases) ? p.aliases.length : 0))
  const noAliases = P.filter(p => !Array.isArray(p.aliases) || p.aliases.length === 0)
  const sortedAliases = [...aliasCounts].sort((a, b) => a - b)
  const medianAliases = sortedAliases.length ? sortedAliases[Math.floor(sortedAliases.length / 2)] : 0

  const line = (label: string, n: number, of: number) =>
    console.log(`  ${label.padEnd(34)}${String(n).padStart(4)} / ${String(of).padEnd(4)}  ${bar(n, of)}`)

  console.log('\n' + '='.repeat(74))
  console.log('DRILL LIBRARY AUDIT — read-only')
  console.log('='.repeat(74))

  console.log(`\nCAN EVERY PROBLEM BE ANSWERED?   (${P.length} problems in the taxonomy)`)
  line('ZERO approved drills', zero.length, P.length)
  line('only 1-2 drills', thin.length, P.length)
  line('no CURATED mapping (text-only)', noCurated.length, P.length)
  line('no aliases at all', noAliases.length, P.length)
  console.log(`  median aliases per problem        ${medianAliases}`)

  console.log(`\nIS EVERY DRILL REACHABLE?   (${D.length} approved drills)`)
  line('mapped to no problem', unmapped.length, D.length)
  line('description under 120 chars', thinDesc.length, D.length)

  console.log(`\nDOES THE RECOMMENDATION ARRIVE USABLE?`)
  line('no video at all', noVideo.length, D.length)
  line('video, no start timestamp', noStart.length, D.length)
  line('shares a video with another drill', drillsOnSharedVideo, D.length)
  line('SHARED **and** starts at 0:00', sharedAndUntimed, D.length)
  console.log(`  distinct videos                   ${videoUse.size} across ${withVideo.length} drills`)

  console.log(`\nCALIBRATION (056 columns)`)
  line('min_coaches / throwing_load set', D.filter(d => d.min_coaches != null).length, D.length)

  if (zero.length) {
    console.log(`\n${'─'.repeat(74)}\nPROBLEMS WITH ZERO DRILLS — a coach asks, the app says nothing`)
    zero.forEach(p => console.log(`  ${String(p.skill_category || '—').padEnd(22)} ${p.slug}`))
  }

  if (thin.length) {
    console.log(`\n${'─'.repeat(74)}\nTHIN COVERAGE (1-2 drills) — one retirement from being empty`)
    thin.slice(0, 30).forEach(p =>
      console.log(`  ${String(perProblem.get(p.slug)).padStart(2)}  ${String(p.skill_category || '—').padEnd(22)} ${p.slug}`))
    if (thin.length > 30) console.log(`  … and ${thin.length - 30} more`)
  }

  if (noAliases.length) {
    console.log(`\n${'─'.repeat(74)}\nNO ALIASES — only findable if the coach uses the label's own words`)
    noAliases.slice(0, 30).forEach(p =>
      console.log(`  ${String(p.skill_category || '—').padEnd(22)} ${p.slug} — ${p.label}`))
    if (noAliases.length > 30) console.log(`  … and ${noAliases.length - 30} more`)
  }

  console.log(`\n${'─'.repeat(74)}`)
  console.log('Nothing here writes to the database.\n')
}

main()
