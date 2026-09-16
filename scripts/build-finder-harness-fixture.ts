// The fixture the Drill Finder harness runs on.
//
//   npm run fixture:finder-harness
//
// Read-only against production. Writes scripts/fixtures/drill-finder-harness.json.
//
// WHY IT IS GENERATED RATHER THAN WRITTEN
//
// A hand-written fixture is a fixture of what I believe the data looks like.
// Phase 2C spent most of its effort on the gap between that and the truth —
// `indoor_outdoor` holds no value "Indoor", `space_required` is spelled two
// ways, `station_friendly` is null on two thirds of the library. A harness that
// never sees those shapes cannot catch the UI mishandling them.
//
// So this picks real rows, and picks them to cover the cases the acceptance run
// has to exercise: a drill with no media at all, one backed by a shared
// compilation video, one with a video of its own, a full activity family, and
// at least one row with each of the practice-intelligence columns both set and
// null. The picker prints what it found so a run that quietly stopped covering
// a case is visible rather than silent.

import { createClient } from '@supabase/supabase-js'
import { writeFileSync, mkdirSync } from 'fs'
import { isSchedulable } from '../lib/drills'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const OUT = 'scripts/fixtures/drill-finder-harness.json'

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const { data: all } = await sb.from('drill_resources').select('*').is('created_by_coach_id', null)
  const { data: media } = await sb.from('drill_media_resources').select('*')
  const { data: tax } = await sb.from('problem_taxonomy').select('slug, label, aliases, skill_category')
  const { data: map } = await sb.from('drill_problem_map').select('drill_id, problem_slug')
  if (!all) { console.error('Read failed.'); process.exit(1) }

  const schedulable = (all as any[]).filter(d => isSchedulable(d))

  const mediaByDrill = new Map<string, any[]>()
  for (const m of (media || []) as any[]) {
    mediaByDrill.set(m.drill_id, (mediaByDrill.get(m.drill_id) || []).concat([m]))
  }
  const drillsPerVideo = new Map<string, Set<string>>()
  for (const m of (media || []) as any[]) {
    const k = m.external_id || m.url
    drillsPerVideo.set(k, (drillsPerVideo.get(k) || new Set()).add(m.drill_id))
  }
  const sharedCount = (d: any) => {
    const mine = mediaByDrill.get(d.id) || []
    const p = mine.find(m => m.is_primary) || mine[0]
    if (!p) return 0
    return drillsPerVideo.get(p.external_id || p.url)?.size || 1
  }

  const picked = new Map<string, any>()
  const why: string[] = []
  const take = (label: string, d: any | undefined) => {
    if (!d) { why.push(`MISSING  ${label}`); return }
    if (!picked.has(d.id)) picked.set(d.id, d)
    why.push(`${String(d.drill_name).slice(0, 44).padEnd(46)} ${label}`)
  }

  take('no media at all', schedulable.find(d => (mediaByDrill.get(d.id) || []).length === 0))
  take('backed by a shared compilation', schedulable.find(d => sharedCount(d) > 3))
  take('its own video, unshared', schedulable.find(d => sharedCount(d) === 1))
  take('station_friendly true', schedulable.find(d => d.station_friendly === true))
  take('station_friendly null', schedulable.find(d => d.station_friendly == null))
  take('a real competition_style', schedulable.find(d => d.competition_style && d.competition_style !== 'none'))
  take('high throwing load', schedulable.find(d => d.throwing_load === 'high'))
  take('small space', schedulable.find(d => String(d.space_required).toLowerCase() === 'small'))
  take('needs a full field', schedulable.find(d => /full/i.test(String(d.space_required))))
  take('has safety notes', schedulable.find(d => d.safety_notes))
  take('the one row with no problem mapping',
    schedulable.find(d => !(map || []).some((m: any) => m.drill_id === d.id)))

  // A whole family, so the Variations row has something real to label.
  const familyCounts = new Map<string, any[]>()
  for (const d of schedulable) {
    if (d.activity_family_id) {
      familyCounts.set(d.activity_family_id, (familyCounts.get(d.activity_family_id) || []).concat([d]))
    }
  }
  const biggest = Array.from(familyCounts.values()).sort((a, b) => b.length - a.length)[0] || []
  for (const d of biggest) take(`family member (${d.variation_type})`, d)

  // Enough ordinary rows that the grid is a grid.
  for (const d of schedulable.slice(0, 40)) {
    if (picked.size >= 24) break
    if (!picked.has(d.id)) picked.set(d.id, d)
  }

  const drills = Array.from(picked.values())
  const ids = new Set(drills.map(d => d.id))

  const fixture = {
    generated_note:
      'Generated from production by scripts/build-finder-harness-fixture.ts. ' +
      'Real rows, chosen to cover the cases the acceptance run has to exercise. ' +
      'Do not hand-edit — regenerate.',
    drills,
    // Every media row, not just these drills': the share counts that decide
    // whether a video may be called "this drill" are a property of the whole
    // table, and trimming it would make a compilation look unique.
    media: media || [],
    taxonomy: tax || [],
    mappings: (map || []).filter((m: any) => ids.has(m.drill_id)),
  }

  mkdirSync('scripts/fixtures', { recursive: true })
  writeFileSync(OUT, JSON.stringify(fixture, null, 2) + '\n')

  console.log(why.join('\n'))
  console.log(`\n${drills.length} drills · ${fixture.media.length} media rows · ` +
    `${fixture.taxonomy.length} problems · ${fixture.mappings.length} mappings`)
  console.log(OUT)
}

main().catch(e => { console.error(e); process.exit(1) })
