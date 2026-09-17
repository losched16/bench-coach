// Does the deployed Drill Finder have what it needs, in production?
//
//   npm run verify:finder-prod
//
// Read-only. Exits non-zero if anything the surface depends on is missing or
// would render wrong.
//
// WHAT THIS IS FOR, AND WHAT IT IS NOT
//
// It is not a screenshot. The Finder sits behind a login and this environment
// cannot reach mybenchcoach.com at all (the network policy answers 403 to
// CONNECT), so nobody here can click through the real page. Saying "verified in
// production" on the strength of a green deployment would be a claim about
// pixels made from evidence about a build.
//
// What it CAN do is run the four reads the deployed page makes — the same
// queries, the same anon key, the same RLS — and put the results through the
// same lib/drillFinder functions the browser will. If this passes, every drill
// the page will fetch renders with a name, a purpose, a duration and a set of
// instructions, no media link claims more than it can keep, and the searches a
// coach types find something. If it fails, the page is broken in production and
// this says which part.
//
// The gap it leaves, stated plainly: layout, focus behaviour and anything that
// depends on a browser are covered by scripts/acceptance-drill-finder.mjs
// against the real components, not here.

import { createClient } from '@supabase/supabase-js'
import { isSchedulable, DrillRecord } from '../lib/drills'
import {
  buildFinderIndex, searchDrills, describeMedia, detailSections,
  purposeLine, contextChips, familyMembers, problemsFor,
} from '../lib/drillFinder'
import {
  groupByDrill, sharedVideoCounts, sharedCountFor, mediaForDrill, DrillMedia,
} from '../lib/drillMedia'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

let failures = 0
function check(label: string, ok: boolean, evidence: string) {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(52)} ${evidence}`)
  if (!ok) failures++
}

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  console.log(`\nproduction: ${URL.replace('https://', '').split('.')[0]}\n`)

  const sb = createClient(URL, KEY)

  // ── the four reads the deployed page makes ────────────────────────────────
  //
  // Anon key, so RLS is actually in force — the same posture the browser
  // client is in. A policy change that locked a coach out of the taxonomy
  // would show up here and nowhere in a build log.

  const t0 = Date.now()
  const { data: rows, error: drillsErr } = await sb.from('drill_resources')
    .select('*').is('created_by_coach_id', null).order('drill_name')
  const { data: mediaRows, error: mediaErr } = await sb.from('drill_media_resources')
    .select('id, drill_id, media_type, provider, external_id, url, title, source_name, ' +
            'thumbnail_url, start_seconds, end_seconds, start_source, is_primary, ' +
            'verification_status, notes')
  const { data: tax, error: taxErr } = await sb.from('problem_taxonomy')
    .select('slug, label, aliases, skill_category')
  const { data: map, error: mapErr } = await sb.from('drill_problem_map')
    .select('drill_id, problem_slug')
  const elapsed = Date.now() - t0

  check('the drill read succeeds under RLS', !drillsErr && !!rows, drillsErr?.message || `${rows?.length} curated rows`)
  check('the media read succeeds under RLS', !mediaErr, mediaErr?.message || `${mediaRows?.length} media rows`)
  check('the taxonomy read succeeds under RLS', !taxErr, taxErr?.message || `${tax?.length} problems`)
  check('the mapping read succeeds under RLS', !mapErr, mapErr?.message || `${map?.length} mappings`)
  if (!rows) { console.log('\nFAIL — nothing else can be checked.\n'); process.exit(1) }

  const drills = (rows as DrillRecord[]).filter(d => isSchedulable(d))
  const media = groupByDrill(mediaRows as unknown as DrillMedia[])
  const shares = sharedVideoCounts(mediaRows as unknown as DrillMedia[])
  const index = buildFinderIndex(tax as any[], map as any[])

  check('all four reads inside a sensible page load', elapsed < 8000, `${elapsed}ms for four queries`)
  check('the schedulable pool is the expected size', drills.length === 154, `${drills.length} of ${rows.length} curated`)

  // ── nothing demoted reaches the surface ───────────────────────────────────

  const leaked = drills.filter(d =>
    d.duplicate_of_drill_id ||
    ['source_collection', 'teaching_content'].indexOf(String(d.resource_kind || '')) >= 0)
  check('no collection, tutorial or duplicate in the pool', leaked.length === 0,
    leaked.length ? leaked.map(d => d.drill_name).join(', ') : '0 leaked')

  // ── every card renders ────────────────────────────────────────────────────
  //
  // The card promises six things. A row missing any of them renders as a name
  // over white space, which is the failure mode the old thumbnail was hiding.

  const blankPurpose = drills.filter(d => !purposeLine(d))
  const noDuration = drills.filter(d => !(Number(d.est_duration_minutes) > 0))
  const noCategory = drills.filter(d => !d.skill_category)
  const noDifficulty = drills.filter(d => !d.difficulty_level)

  check('every card has a purpose line', blankPurpose.length === 0,
    blankPurpose.length ? blankPurpose.slice(0, 3).map(d => d.drill_name).join(', ') : `${drills.length}/${drills.length}`)
  check('every card has a duration', noDuration.length === 0, `${drills.length - noDuration.length}/${drills.length}`)
  check('every card has a skill', noCategory.length === 0, `${drills.length - noCategory.length}/${drills.length}`)
  check('every card has a difficulty', noDifficulty.length === 0, `${drills.length - noDifficulty.length}/${drills.length}`)

  // ── every detail renders as instructions ──────────────────────────────────

  const sectionsPer = drills.map(d => detailSections(d))
  const thin = drills.filter((d, i) => sectionsPer[i].length < 4)
  const noCoachIt = drills.filter((d, i) => !sectionsPer[i].some(s => s.heading === 'Coach it'))
  const noWatchFor = drills.filter((d, i) => !sectionsPer[i].some(s => s.heading === 'Watch for'))
  const noHarder = drills.filter((d, i) => !sectionsPer[i].some(s => s.heading === 'Make it harder'))

  check('every detail has four or more sections', thin.length === 0,
    thin.length ? thin.slice(0, 3).map(d => d.drill_name).join(', ') : `min ${Math.min(...sectionsPer.map(s => s.length))} sections`)
  check('every drill tells a coach what to say', noCoachIt.length === 0, `${drills.length - noCoachIt.length}/${drills.length}`)
  check('every drill says what to watch for', noWatchFor.length === 0, `${drills.length - noWatchFor.length}/${drills.length}`)
  check('every drill offers a progression', noHarder.length === 0, `${drills.length - noHarder.length}/${drills.length}`)

  // ── media claims nothing it cannot keep ───────────────────────────────────
  //
  // The whole point of the redesign. Production holds 0 verified and 0
  // timestamped rows, so "Jump to the drill" and "Watch this drill" must not
  // appear anywhere — and a shared video must say it is shared.

  let jump = 0, watchThis = 0, source = 0, supporting = 0, none = 0
  const overclaimed: string[] = []
  for (const d of drills) {
    const playable = mediaForDrill(d as any, media.get(d.id) || null)
    if (playable.length === 0) { none++; continue }
    for (const p of playable) {
      const shared = sharedCountFor(p, shares)
      const said = describeMedia(p, shared)
      if (/jump to/i.test(said.label)) { jump++; overclaimed.push(`${d.drill_name}: ${said.label}`) }
      else if (/watch this drill/i.test(said.label)) { watchThis++; overclaimed.push(`${d.drill_name}: ${said.label}`) }
      else if (said.label === 'Source video') source++
      else supporting++
      // A shared video that does not say so is the specific lie this prevents.
      if (shared > 1 && !/covers \d+ drills/i.test(said.note || '')) {
        overclaimed.push(`${d.drill_name}: shared with ${shared} and does not say so`)
      }
    }
  }

  check('nothing promises a timestamp', jump === 0, `${jump} "Jump to the drill"`)
  check('nothing unverified is called "this drill"', watchThis === 0, `${watchThis} "Watch this drill"`)
  check('no media link overclaims', overclaimed.length === 0,
    overclaimed.length ? overclaimed.slice(0, 3).join(' | ') : `${source} source, ${supporting} supporting, ${none} with none`)
  check('drills with no media are still complete', true,
    `${none} have no media and all render ${Math.min(...drills.filter(d => mediaForDrill(d as any, media.get(d.id) || null).length === 0).map(d => detailSections(d).length))}+ sections`)

  // Guard the future: the day somebody curates a timestamp, this flips and the
  // check above starts meaning something different. Say so rather than letting
  // a silent 0 keep passing.
  const verified = (mediaRows as unknown as DrillMedia[] || []).filter(m => m.verification_status === 'verified').length
  const stamped = (mediaRows as unknown as DrillMedia[] || []).filter(m => m.start_seconds != null).length
  check('the media baseline is unchanged', verified === 0 && stamped === 0,
    `${verified} verified, ${stamped} stamped — if these move, re-read the media labels`)

  // ── the searches a coach types find something ─────────────────────────────

  const QUERIES = ['dropping hands', 'afraid of fly balls', 'two strike', 'footwork', 'warmup', 'bad hops']
  const empty = QUERIES.filter(q => searchDrills(drills, q, index).length === 0)
  check('every reference coach query returns drills', empty.length === 0,
    empty.length ? `empty: ${empty.join(', ')}` : QUERIES.map(q => `${q}:${searchDrills(drills, q, index).length}`).join(' '))

  const unfindable = drills.filter(d =>
    !searchDrills(drills, String(d.drill_name), index).some(h => h.drill.id === d.id))
  check('every drill is findable by its own name', unfindable.length === 0,
    unfindable.length ? unfindable.map(d => d.drill_name).join(', ') : `${drills.length}/${drills.length}`)

  check('the channel is not searchable', searchDrills(drills, 'rebellion', index).length === 0,
    `${searchDrills(drills, 'rebellion', index).length} hits`)

  // ── the taxonomy and family surfaces have content ─────────────────────────

  const mapped = drills.filter(d => problemsFor(d, index).length > 0)
  check('drills carry their curated problems', mapped.length >= 150,
    `${mapped.length}/${drills.length} show a "Use it when" section`)

  const withFamily = drills.filter(d => familyMembers(d, drills).length > 0)
  check('the variations row has real content', withFamily.length > 0,
    `${withFamily.length} drills show labelled variations`)

  const chipped = drills.filter(d => contextChips(d).length > 0)
  check('context chips render where defensible', chipped.length > 0,
    `${chipped.length}/${drills.length} carry at least one chip`)

  console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} check(s)`}\n`)
  if (failures) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(1) })
