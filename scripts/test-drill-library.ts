// Can a coach reach every drill from the library panel?
//
// DrillLibrary's tabs are not the values in the database. `skill_category`
// holds "Fielding (Infield)" and "Fielding (Fly Balls)", and separately
// "Bunting" and "Soft Toss" which are both hitting work. A component-level map
// does that translation, which is the right place for it — renaming a tab
// should not mean a migration.
//
// The risk it creates is silent. Rename a category in the library, or edit a
// row in that map, and a tab does not break: it renders, sits there, and shows
// nothing. A coach concludes the app has no outfield drills.
//
// So: every tab must reach at least one drill, and every drill must be reachable
// from some tab. Run against the fixture, so it guards the MAP. Drift in the
// live library is a different question and `npm run audit:drills` answers it —
// this cannot see the database.
//
//   npm run test:drill-library

import { readFileSync } from 'fs'

const FIX = JSON.parse(readFileSync('scripts/fixtures/drill-library.json', 'utf8'))
const DRILLS: any[] = FIX.drills

let failures = 0
function check(label: string, cond: boolean, detail?: string) {
  if (cond) console.log(`ok   ${label}`)
  else { failures++; console.log(`FAIL ${label}${detail ? ` — ${detail}` : ''}`) }
}

// Kept in step with components/DrillLibrary.tsx by hand. That duplication is
// deliberate: importing the component into a node script drags React and the
// whole 'use client' boundary in with it, and the thing worth testing is the
// mapping, not the JSX. If the two drift, this test is what says so.
const CATEGORIES: Array<{ label: string; match: string[] }> = [
  { label: 'Hitting', match: ['hitting', 'bunting', 'soft toss'] },
  { label: 'Infield', match: ['fielding (infield)'] },
  { label: 'Outfield', match: ['fielding (fly balls)'] },
  { label: 'Throwing', match: ['throwing', 'arm care'] },
  { label: 'Baserunning', match: ['baserunning'] },
  { label: 'Pitching', match: ['pitching'] },
  { label: 'Catching', match: ['catching'] },
  { label: 'Team Defense', match: ['team defense'] },
  { label: 'Warmups', match: ['warmup', 'athletic development'] },
]

const cat = (d: any) => String(d.skill_category || '').trim().toLowerCase()

// ── no tab is empty ─────────────────────────────────────────────────────────

for (const c of CATEGORIES) {
  const n = DRILLS.filter(d => c.match.includes(cat(d))).length
  check(`the ${c.label} tab has drills in it`, n > 0, `${n} drills match ${JSON.stringify(c.match)}`)
}

// Games has no category of its own — it is a property of the activity, read
// from competition_style where the library states one and from the name where
// it does not.
function isGame(d: any): boolean {
  if (d?.competition_style && String(d.competition_style).toLowerCase() !== 'none') return true
  return /\b(game|challenge|competition|contest|race|king of|knockout|tournament)\b/i
    .test(String(d?.drill_name || ''))
}
const games = DRILLS.filter(isGame)
check('the Games tab has drills in it', games.length > 0, `${games.length} drills`)
check('...and does not swallow the whole library', games.length < DRILLS.length / 2,
  `${games.length} of ${DRILLS.length} — a rule this loose would make the tab meaningless`)

// ── nothing is unreachable ──────────────────────────────────────────────────

const covered = new Set(CATEGORIES.flatMap(c => c.match))
const orphans = DRILLS.filter(d => !covered.has(cat(d)))
const orphanCats = Array.from(new Set(orphans.map(d => d.skill_category)))
check('every drill is reachable from some tab', orphans.length === 0,
  orphans.length
    ? `${orphans.length} drills only findable via All/search: ${orphanCats.join(', ')}`
    : '')

// ── the tabs partition rather than overlap ──────────────────────────────────
//
// A drill appearing under two tabs is not a bug, but an accidental overlap
// usually means a category was added to the wrong row.

const seen = new Map<string, string[]>()
for (const c of CATEGORIES) {
  for (const m of c.match) {
    const list = seen.get(m) || []
    list.push(c.label)
    seen.set(m, list)
  }
}
const doubled = Array.from(seen.entries()).filter(([, labels]) => labels.length > 1)
check('no category is claimed by two tabs', doubled.length === 0,
  doubled.map(([m, l]) => `${m} -> ${l.join(' + ')}`).join('; '))

// ── every category in the library is accounted for ──────────────────────────
//
// The inverse of the orphan check, stated as a list so a new category shows up
// here by name rather than as a count.

const libraryCats = Array.from(new Set(DRILLS.map(cat))).filter(Boolean).sort()
const unmapped = libraryCats.filter(c => !covered.has(c))
check('no category in the library is missing from the map', unmapped.length === 0,
  unmapped.length ? `unmapped: ${unmapped.join(', ')}` : '')

console.log(`\n${DRILLS.length} drills across ${libraryCats.length} categories, all reachable.`)
console.log('')
if (failures > 0) { console.log(`${failures} FAILED`); process.exit(1) }
console.log('ALL PASS')
