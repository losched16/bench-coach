// The Drill Finder's rules, asserted.
//
//   npx tsx scripts/test-drill-finder.ts
//
// Pure — no database, no network. Everything here is a decision that could be
// wrong and that nobody would notice being wrong: which chips a card claims,
// what a media link promises, whether a search ranks the drill a coach named
// above one that merely mentions it, and whether a variation gets labelled as
// a relationship it does not have.
//
// The media assertions are the ones to keep. Production holds zero verified and
// zero timestamped media rows, so every honest label is currently produced by
// the same two branches — and the day somebody curates a timestamp, the branch
// that says "Jump to the drill" starts firing for real. These tests are what
// say it may only fire when the row is BOTH verified and stamped.

import {
  norm, squash, queryTokens, haystackTokens,
  purposeLine, contextChips, spaceBand,
  buildFinderIndex, problemsFor, matchDrill, searchDrills,
  relationLabel, familyMembers, RELATION_LABELS,
  describeMedia, applyFilters, EMPTY_FILTERS, activeFilterCount,
  ageFits, categoriesIn, rolesIn, roleLabel, detailSections,
} from '../lib/drillFinder'
import { sharedVideoCounts, sharedCountFor, PlayableMedia, DrillMedia } from '../lib/drillMedia'
import { environmentEligible, spaceEligible, equipmentEligible } from '../lib/drillEligibility'
import { DrillRecord } from '../lib/drills'

let passed = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail?: string) {
  if (cond) { passed++; return }
  failures.push(detail ? `${name}\n    ${detail}` : name)
}

const eq = (name: string, actual: unknown, expected: unknown) =>
  check(name, JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)

// ── fixtures ────────────────────────────────────────────────────────────────

const drill = (over: Partial<DrillRecord>): DrillRecord => ({
  id: over.id || 'id-' + Math.random().toString(36).slice(2),
  drill_name: 'Unnamed',
  ...over,
} as DrillRecord)

const TAXONOMY = [
  {
    slug: 'uppercutting', label: 'Uppercutting / bad swing plane', skill_category: 'Hitting',
    aliases: ['dropping the hands', 'dropping his hands', 'dumping the barrel', 'uppercut'],
  },
  {
    slug: 'fear-fly-balls', label: 'Fear of fly balls', skill_category: 'Fielding (Fly Balls)',
    aliases: ['fear of fly balls'],
  },
  {
    slug: 'two-strike-approach', label: 'Two-strike approach', skill_category: 'Hitting',
    aliases: ['panic with two strikes', 'same swing in all counts'],
  },
]

const MAPPINGS = [
  { drill_id: 'tee', problem_slug: 'uppercutting' },
  { drill_id: 'flies', problem_slug: 'fear-fly-balls' },
  { drill_id: 'twostrike', problem_slug: 'two-strike-approach' },
]

const IDX = buildFinderIndex(TAXONOMY, MAPPINGS)

const TEE = drill({
  id: 'tee',
  drill_name: 'High Tee Drill',
  skill_category: 'Hitting',
  description: 'The tee is set above the belt so the hitter has to stay on top of the ball. Ten swings, reset between each.',
  ai_coaching_notes: 'Barrel above the hands at launch. Finish high.',
  success_markers: ['Line drives to the middle', 'No contact with the tee'],
  equipment_needed: ['Batting tee', 'Baseballs'],
  regression_notes: 'Lower the tee to belt height.',
  progression_notes: 'Move the tee back in the stance.',
  est_duration_minutes: 10,
  difficulty_level: 'Beginner',
  min_age: 6, max_age: 12,
  indoor_outdoor: 'Both',
  space_required: 'Small',
  station_friendly: true,
  practice_roles: ['isolate'],
  activity_family_id: 'fam-high-tee',
  variation_type: 'base',
})

const FLIES = drill({
  id: 'flies',
  drill_name: 'Soft Fly Progression',
  skill_category: 'Fielding (Fly Balls)',
  description: 'Tennis balls tossed underhand from ten feet, stepping back a pace at a time.',
  ai_coaching_notes: 'Two hands. Eyes up.',
  indoor_outdoor: 'Outdoor',
  space_required: 'Medium',
  throwing_load: 'high',
  competition_style: 'none',
  practice_roles: ['teach'],
})

const TWOSTRIKE = drill({
  id: 'twostrike',
  drill_name: 'Battle Round',
  skill_category: 'Hitting',
  description: 'Every hitter starts the at-bat down 0-2 and has to put the ball in play.',
  competition_style: 'head_to_head',
  practice_roles: ['competition'],
})

const HIGH_TEE_PROG = drill({
  id: 'tee-prog',
  drill_name: 'High Tee — Hitting Up in the Zone',
  skill_category: 'Hitting',
  activity_family_id: 'fam-high-tee',
  variation_type: 'progression',
})

const HIGH_TEE_UNLABELLED = drill({
  id: 'tee-unlabelled',
  drill_name: 'High Tee Something',
  activity_family_id: 'fam-high-tee',
  variation_type: null,
})

const LIBRARY = [TEE, FLIES, TWOSTRIKE, HIGH_TEE_PROG, HIGH_TEE_UNLABELLED]

// ── 1. text normalization ───────────────────────────────────────────────────

eq('norm strips punctuation', norm('Two-Strike, Approach!'), 'two strike approach')
eq('squash joins the words', squash('warm-up'), 'warmup')
check('squash makes warmup and warm up agree', squash('warm up') === squash('warmup'))
eq('queryTokens drops stopwords', queryTokens('afraid of the fly balls'), ['afraid', 'fly', 'balls'])
check('queryTokens keeps a stopword-only query',
  queryTokens('the drill').length > 0)
check('haystackTokens adds the singular', haystackTokens('fly balls').has('ball'))
check('haystackTokens leaves short words alone', !haystackTokens('is').has('i'))

// ── 2. purpose ──────────────────────────────────────────────────────────────

eq('purposeLine takes the first sentence',
  purposeLine({ description: 'The tee is set above the belt so the hitter has to stay on top of it. A second sentence nobody needs on a card.' }),
  'The tee is set above the belt so the hitter has to stay on top of it.')
check('purposeLine takes a second sentence when the first is thin',
  purposeLine({ description: 'Short. Then a longer follow-up sentence that carries the actual meaning.' })
    .indexOf('Then a longer') > 0)
eq('purposeLine on an empty description', purposeLine({ description: null }), '')
check('purposeLine breaks on a word, not mid-word', (() => {
  const long = 'A '.repeat(200)
  const out = purposeLine({ description: long }, 40)
  return out.length <= 41 && out.charAt(out.length - 1) === '…'
})())

// ── 3. context chips ────────────────────────────────────────────────────────

const teeChips = contextChips(TEE).map(c => c.label)
check('station_friendly true earns the chip', teeChips.indexOf('Station-friendly') >= 0)
check('indoor_outdoor Both earns "Works indoors"', teeChips.indexOf('Works indoors') >= 0)
check('Small space earns the chip', teeChips.indexOf('Small space') >= 0)
check('a null station_friendly earns NOTHING',
  contextChips(FLIES).map(c => c.label).indexOf('Station-friendly') < 0)
check('station_friendly false earns nothing either',
  contextChips(drill({ station_friendly: false })).length === 0)
check('competition_style "none" is not a competitive chip',
  contextChips(FLIES).map(c => c.label).indexOf('Competitive') < 0)
check('a real competition_style does earn it',
  contextChips(TWOSTRIKE).map(c => c.label).indexOf('Competitive') >= 0)
check('throwing_load high earns the warning chip',
  contextChips(FLIES).map(c => c.label).indexOf('High throwing load') >= 0)
check('Outdoor alone says nothing about indoors',
  contextChips(FLIES).map(c => c.label).indexOf('Works indoors') < 0)
check('a competitive drill does not get the role chip twice',
  contextChips(TWOSTRIKE).filter(c => c.label === 'Competitive').length === 1)

eq('spaceBand normalizes case', spaceBand('Full Field'), 'large')
eq('spaceBand normalizes the other spelling', spaceBand('Full field'), 'large')
eq('spaceBand handles medium-large', spaceBand('Medium-large'), 'large')
eq('spaceBand on nonsense', spaceBand('somewhere'), null)

// ── 4. search ───────────────────────────────────────────────────────────────

const tier = (q: string, d: DrillRecord) => {
  const m = matchDrill(d, q, IDX)
  return m ? m.tier : null
}

eq('a drill name is tier 1', tier('high tee', TEE), 1)
eq('a partial name is tier 1', tier('tee', TEE), 1)
eq('a mapped problem alias is tier 2', tier('dropping hands', TEE), 2)
eq('a problem label is tier 2', tier('two strike', TWOSTRIKE), 2)
eq('hyphen and space agree on the problem', tier('two-strike', TWOSTRIKE), 2)
eq('the description is tier 3', tier('above the belt', TEE), 3)
eq('the skill category is tier 3', tier('hitting', TEE), 3)
eq('a coaching cue is tier 4', tier('finish high', TEE), 4)
eq('a success marker is tier 5', tier('line drives', TEE), 5)
eq('equipment is tier 5', tier('batting tee', TEE), 5)
eq('nothing matches nothing', tier('kayaking', TEE), null)

// The one the audit found. "afraid" is not in the taxonomy — it says "fear" —
// so this must NOT claim a match, and must still put the drill on screen.
const afraid = matchDrill(FLIES, 'afraid of fly balls', IDX)
check('a partial problem match still surfaces the drill', afraid !== null)
eq('a partial problem match is tier 5', afraid && afraid.tier, 5)
check('a partial match is not sold as the answer',
  !!afraid && afraid.tier > 2)

check('a strong problem match names the problem',
  matchDrill(TEE, 'dropping hands', IDX)?.via?.slug === 'uppercutting')

// Regression, found by running the search against production rather than
// against fixtures. Pooling a problem's aliases into one bag let words from two
// unrelated aliases combine: `one-hand-catching` has "dropping glove" AND
// "poor hand positioning", so "dropping hands" matched it as confidently as it
// matched the swing flaw, and a catching drill was offered to a coach asking
// about a swing. A single alias now has to carry the whole query.
const CATCHING = drill({ id: 'catching', drill_name: 'Two Hands Catching' })
const SPLIT_IDX = buildFinderIndex(
  TAXONOMY.concat([{
    slug: 'one-hand-catching', label: 'One-handed / stabs at the ball', skill_category: 'Catching',
    aliases: ['dropping glove', 'poor hand positioning'],
  }]),
  MAPPINGS.concat([{ drill_id: 'catching', problem_slug: 'one-hand-catching' }])
)
eq('words from two different aliases do not combine into a match',
  matchDrill(CATCHING, 'dropping hands', SPLIT_IDX)?.tier ?? null, null)
eq('a single alias still carries the whole query',
  matchDrill(CATCHING, 'dropping glove', SPLIT_IDX)?.tier ?? null, 2)

// Ranking, end to end.
const ranked = searchDrills(LIBRARY, 'tee', IDX)
check('name matches come first', ranked.length > 0 && ranked[0].tier === 1)
check('search never returns a drill twice',
  new Set(ranked.map(r => r.drill.id)).size === ranked.length)
check('an empty query returns everything',
  searchDrills(LIBRARY, '', IDX).length === LIBRARY.length)
check('a whitespace query returns everything',
  searchDrills(LIBRARY, '   ', IDX).length === LIBRARY.length)

// Ties are stable, or a coach watches the list reshuffle under them.
const a = searchDrills(LIBRARY, 'hitting', IDX).map(r => r.drill.id)
const b = searchDrills(LIBRARY.slice().reverse(), 'hitting', IDX).map(r => r.drill.id)
eq('ranking does not depend on input order', a, b)

// THE ONE THAT MATTERS FOR 2D.4: the channel must not be searchable.
const branded = drill({
  id: 'branded',
  drill_name: 'Wall Ball',
  channel: 'Baseball Rebellion',
  thumbnail_url: 'https://img.youtube.com/vi/xyz/hqdefault.jpg',
  youtube_url: 'https://www.youtube.com/watch?v=abcdefghijk',
})
eq('the channel is not searchable at all', tier('rebellion', branded), null)
eq('the video url is not searchable either', tier('youtube', branded), null)

// ── 5. family relationships ─────────────────────────────────────────────────

eq('base is labelled', relationLabel('base'), 'The base drill')
eq('regression reads as Easier', relationLabel('regression'), 'Easier')
eq('space_variant is labelled', relationLabel('space_variant'), 'Space variation')
eq('an unknown variation type is not labelled', relationLabel('competitive_variant'), null)
check('only the five values production holds are labelled',
  Object.keys(RELATION_LABELS).sort().join(',') ===
  'advanced,base,progression,regression,space_variant')

const rels = familyMembers(TEE, LIBRARY)
eq('a family member is found', rels.map(r => r.drill.id), ['tee-prog'])
check('an unlabelled sibling is left out',
  rels.every(r => r.drill.id !== 'tee-unlabelled'))
check('a drill with no family has no relatives', familyMembers(FLIES, LIBRARY).length === 0)
check('a shared skill is not a relationship',
  familyMembers(TWOSTRIKE, LIBRARY).length === 0)
check('a drill is never its own relative',
  familyMembers(TEE, LIBRARY).every(r => r.drill.id !== TEE.id))

// ── 6. media, described honestly ────────────────────────────────────────────

const playable = (over: Partial<PlayableMedia>): PlayableMedia => ({
  media_type: 'youtube',
  url: 'https://www.youtube.com/watch?v=abcdefghijk',
  title: null, source_name: 'Some Channel', thumbnail_url: null,
  start_seconds: null, verification_status: 'unverified', legacy: false,
  ...over,
})

eq('an unverified single video is a supporting video',
  describeMedia(playable({}), 1).label, 'Supporting video')
eq('a shared video is a source video',
  describeMedia(playable({}), 10).label, 'Source video')
check('a shared video says how many drills it covers',
  (describeMedia(playable({}), 10).note || '').indexOf('10 drills') >= 0)

// The gate. A timestamp alone is NOT permission to promise a jump.
eq('a timestamp without verification promises nothing',
  describeMedia(playable({ start_seconds: 252 }), 1).label, 'Supporting video')
eq('verification without a timestamp promises nothing',
  describeMedia(playable({ verification_status: 'verified' }), 1).label, 'Watch this drill')
eq('verified AND stamped may promise a jump',
  describeMedia(playable({ verification_status: 'verified', start_seconds: 252 }), 1).label,
  'Jump to the drill (4:12)')
check('nothing else may ever say "jump"',
  [
    describeMedia(playable({}), 1),
    describeMedia(playable({}), 5),
    describeMedia(playable({ start_seconds: 90 }), 5),
    describeMedia(playable({ verification_status: 'verified' }), 5),
  ].every(m => m.label.toLowerCase().indexOf('jump') < 0))
check('an unverified video is never called "this drill"',
  [describeMedia(playable({}), 1), describeMedia(playable({}), 4)]
    .every(m => m.label.toLowerCase().indexOf('this drill') < 0))
eq('an article is an article',
  describeMedia(playable({ media_type: 'article' }), 1).label, 'Read the article')

// Shared counts, from the media table.
const MEDIA: DrillMedia[] = [
  { drill_id: 'a', media_type: 'youtube', external_id: 'SHARED12345', url: 'https://youtu.be/SHARED12345' },
  { drill_id: 'b', media_type: 'youtube', external_id: 'SHARED12345', url: 'https://youtu.be/SHARED12345' },
  { drill_id: 'c', media_type: 'youtube', external_id: 'ALONE123456', url: 'https://youtu.be/ALONE123456' },
]
const counts = sharedVideoCounts(MEDIA)
eq('a shared video counts its drills', counts.get('SHARED12345'), 2)
eq('a single-drill video counts one', counts.get('ALONE123456'), 1)
check('the same drill listed twice is still one drill',
  sharedVideoCounts(MEDIA.concat([MEDIA[0]])).get('SHARED12345') === 2)
eq('sharedCountFor reads through a timestamped watch url',
  sharedCountFor(playable({ url: 'https://www.youtube.com/watch?v=SHARED12345&t=90s' }), counts), 2)
eq('an unknown video is assumed to be its own',
  sharedCountFor(playable({ url: 'https://www.youtube.com/watch?v=UNKNOWN1234' }), counts), 1)

// ── 7. filters ──────────────────────────────────────────────────────────────

const ELIG = { environmentEligible, spaceEligible, equipmentEligible }
const filt = (over: Partial<typeof EMPTY_FILTERS>) =>
  applyFilters(LIBRARY, { ...EMPTY_FILTERS, ...over }, new Set<string>(), ELIG)

eq('no filters keep everything', filt({}).length, LIBRARY.length)
eq('category narrows', filt({ category: 'Fielding (Fly Balls)' }).map(d => d.id), ['flies'])
eq('difficulty narrows', filt({ difficulty: 'Beginner' }).map(d => d.id), ['tee'])
check('a duration cap keeps a drill with no duration',
  filt({ maxMinutes: 5 }).some(d => d.id === 'twostrike'))
check('a duration cap drops a longer drill',
  !filt({ maxMinutes: 5 }).some(d => d.id === 'tee'))
eq('indoor excludes outdoor-only', filt({ environment: 'indoor' }).map(d => d.id).indexOf('flies'), -1)
check('indoor keeps a Both drill', filt({ environment: 'indoor' }).some(d => d.id === 'tee'))
check('small space excludes a medium drill',
  !filt({ space: 'small' }).some(d => d.id === 'flies'))
check('station-only is the known-true set, not the not-false set',
  filt({ stationOnly: true }).map(d => d.id).join(',') === 'tee')
check('competitive-only excludes competition_style none',
  !filt({ competitiveOnly: true }).some(d => d.id === 'flies'))
eq('competitive-only keeps a real one', filt({ competitiveOnly: true }).map(d => d.id), ['twostrike'])
eq('a role narrows', filt({ role: 'isolate' }).map(d => d.id), ['tee'])
check('equipment a coach does not have excludes the drill',
  !applyFilters(LIBRARY, { ...EMPTY_FILTERS, equipment: ['Gloves'] }, new Set(), ELIG)
    .some(d => d.id === 'tee'))
check('equipment a coach does have keeps it',
  applyFilters(LIBRARY, { ...EMPTY_FILTERS, equipment: ['Tee', 'Baseballs'] }, new Set(), ELIG)
    .some(d => d.id === 'tee'))
eq('favorites-only with no favorites is empty',
  filt({ favoritesOnly: true }).length, 0)
eq('favorites-only finds the starred one',
  applyFilters(LIBRARY, { ...EMPTY_FILTERS, favoritesOnly: true }, new Set(['flies']), ELIG)
    .map(d => d.id), ['flies'])

eq('no filters count as zero', activeFilterCount(EMPTY_FILTERS), 0)
eq('each filter counts once',
  activeFilterCount({ ...EMPTY_FILTERS, category: 'Hitting', stationOnly: true }), 2)

check('an age inside the band fits', ageFits(TEE, '8U'))
check('an age outside the band does not', !ageFits(drill({ min_age: 11, max_age: 12 }), '8U'))
check('an unknown age band keeps the drill', ageFits(drill({}), '8U'))
check('All keeps everything', ageFits(drill({ min_age: 11, max_age: 12 }), 'All'))

// Filters come from the data, not from a list somebody copied.
check('categories are derived from the rows',
  categoriesIn(LIBRARY).indexOf('Fielding (Fly Balls)') >= 0)
check('a new category would appear automatically',
  categoriesIn(LIBRARY.concat([drill({ skill_category: 'Zzz New Skill' })]))
    .indexOf('Zzz New Skill') >= 0)
check('roles are derived too', rolesIn(LIBRARY).indexOf('isolate') >= 0)
eq('roles read as English', roleLabel('game_application'), 'Game application')
eq('an unmapped role falls back to itself', roleLabel('mystery'), 'mystery')

// ── 8. detail sections ──────────────────────────────────────────────────────

const sections = detailSections(TEE)
const headings = sections.map(s => s.heading)
check('the detail leads with why', headings[0] === 'Why use it')
check('setup comes before how it works',
  headings.indexOf('Setup') < headings.indexOf('How it works'))
check('coaching cues come after how it works',
  headings.indexOf('Coach it') > headings.indexOf('How it works'))
check('watch-for comes after coach-it',
  headings.indexOf('Watch for') > headings.indexOf('Coach it'))
check('easier comes before harder',
  headings.indexOf('Make it easier') < headings.indexOf('Make it harder'))
check('no media section is generated here',
  headings.every(h => h.toLowerCase().indexOf('video') < 0 && h.toLowerCase().indexOf('media') < 0))
check('an absent safety note produces no heading',
  headings.indexOf('Safety') < 0)
check('a present safety note does',
  detailSections(drill({ safety_notes: 'Mind the bat.' })).map(s => s.heading).indexOf('Safety') >= 0)
check('an empty drill produces no empty sections',
  detailSections(drill({})).length === 0)
check('every section has something in it',
  sections.every(s => (s.body && s.body.trim().length > 0) || (s.items && s.items.length > 0)))
check('the purpose is not repeated verbatim in how-it-works', (() => {
  const why = sections.find(s => s.heading === 'Why use it')
  const how = sections.find(s => s.heading === 'How it works')
  return !why || !how || how.body !== why.body
})())

// ── 9. what the finder must never show ──────────────────────────────────────
//
// These duplicate scripts/test-schedulable.ts on purpose. That file proves the
// query excludes them; this one proves the surface that renders them has no
// second path in — a search that reached past the pool it was handed would be
// a way to surface a demoted row without the query ever being wrong.

const HIDDEN = [
  drill({ id: 'coll', drill_name: 'High Tee Compilation', resource_kind: 'source_collection' }),
  drill({ id: 'teach', drill_name: 'High Tee Explained', resource_kind: 'teaching_content' }),
  drill({ id: 'dupe', drill_name: 'High Tee Copy', duplicate_of_drill_id: 'tee' }),
]
check('search only ever sees the pool it is given',
  searchDrills(LIBRARY, 'high tee', IDX).every(r => HIDDEN.every(h => h.id !== r.drill.id)))
check('filters only ever see the pool they are given',
  filt({}).every(d => HIDDEN.every(h => h.id !== d.id)))
check('family members only come from the pool',
  familyMembers(TEE, LIBRARY).every(r => HIDDEN.every(h => h.id !== r.drill.id)))

// ── report ──────────────────────────────────────────────────────────────────

console.log(`\n${passed} passed, ${failures.length} failed\n`)
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f}`)
  console.log('')
  process.exit(1)
}
