// Look at what retrieval actually returns, for twenty real questions.
//
// The test suite asserts. This one shows — it prints the diagnosis, the
// filters, the candidate counts and the ranked drills with the reason each one
// placed where it did, so a human can read down the list and say "no, that
// third one is wrong" in a way no assertion is going to catch.
//
// Runs against scripts/fixtures/drill-library.json by default: the real 206
// drills, no database, no API key, no network, and therefore no way to change
// anything in production. Diagnosis uses the alias fallback.
//
//   npm run eval:drill-retrieval                    all twenty
//   npm run eval:drill-retrieval -- lunging         only matching prompts
//   npm run eval:drill-retrieval -- --verbose       full reasons per candidate
//   npm run eval:drill-retrieval -- --top 5         fewer per query
//
// With live credentials and NODE_USE_ENV_PROXY=1 it will use the real model
// for diagnosis instead of aliases:
//
//   npm run eval:drill-retrieval -- --live

import { readFileSync } from 'fs'
import { rankDrills, RetrievalConstraints } from '@/lib/drillRetrieval'
import { diagnoseByAlias, diagnose, ageCaveats, TaxonomyRow } from '@/lib/drillDiagnosis'
import { constraintsFromText, ageFromText } from '@/lib/drillConstraints'

const FIX = JSON.parse(readFileSync('scripts/fixtures/drill-library.json', 'utf8'))
const DRILLS: any[] = FIX.drills
const PROBLEMS: TaxonomyRow[] = FIX.problems
const MAPPINGS: any[] = FIX.mappings

const argv = process.argv.slice(2)
const flag = (n: string) => argv.includes(n)
const opt = (n: string, d: number) => {
  const i = argv.indexOf(n)
  return i !== -1 && argv[i + 1] ? Number(argv[i + 1]) : d
}
const VERBOSE = flag('--verbose')
const LIVE = flag('--live')
const TOP = opt('--top', 6)
const filterTerm = argv.filter(a => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--top').join(' ').trim()

// Twenty questions a coach would actually type. Deliberately mixed: named
// flaws that should hit the taxonomy squarely, goals that should not match
// anything and must still return something useful, questions with constraints
// buried in ordinary phrasing, and a couple that probably have no good answer
// in the library at all — those are worth seeing too.
const PROMPTS: Array<{ q: string; why: string }> = [
  { q: 'My 8-year-old keeps dropping his back shoulder when he swings.', why: 'named flaw + age in the sentence' },
  { q: 'My hitter is lunging forward.', why: 'the most-mapped problem in the library' },
  { q: 'My shortstop has a slow transfer.', why: 'fielding, not hitting — proves the diagnosis discriminates' },
  { q: 'My 8-year-old is scared of fly balls.', why: 'a thin problem — only one mapped drill' },
  { q: 'How do I help my pitcher throw harder?', why: 'A GOAL, not a flaw. Must not force a match' },
  { q: 'Need an indoor throwing drill for an 8-year-old.', why: 'environment + age constraint' },
  { q: 'What can we work on in the backyard with a glove and baseballs?', why: 'space + equipment inventory' },
  { q: 'My player keeps stepping in the bucket.', why: 'verbatim taxonomy phrase' },
  { q: 'He casts his hands away from his body.', why: 'casting — 7 drills claim it' },
  { q: 'My catcher can not block balls in the dirt.', why: 'catching, a smaller category' },
  { q: 'The kids throw sidearm and it looks awful.', why: 'throwing mechanics' },
  { q: 'My son is afraid of getting hit by the pitch.', why: 'fear — check the age caveat fires' },
  { q: 'We have no field time this week, just a gym.', why: 'environment only, no flaw at all' },
  { q: 'How do I teach a 7-year-old to slide?', why: 'baserunning + a young age bound' },
  { q: 'My outfielders take terrible routes to the ball.', why: 'fly balls' },
  { q: 'He has a really long swing path.', why: 'long swing — appears as a flaw string' },
  { q: 'What should we do for arm care before games?', why: 'arm care, 5 drills only' },
  { q: 'I am on my own with one kid and a bucket of balls.', why: 'alone + equipment' },
  { q: 'How do I get my team to stop making errors?', why: 'vague. Expect a weak result — that is the point' },
  { q: 'What is a good drill for bunting?', why: 'category-only, no flaw' },
]

function bar(label: string) {
  console.log('\n' + '='.repeat(78))
  console.log(label)
  console.log('='.repeat(78))
}

async function run(q: string, why: string) {
  const dx = LIVE ? await diagnose(q, PROBLEMS) : { ...diagnoseByAlias(q, PROBLEMS), via: 'aliases' as const }
  const constraints: RetrievalConstraints = {
    ...constraintsFromText(q),
    playerAge: ageFromText(q),
  }
  const mapRows = MAPPINGS.filter(m => dx.slugs.includes(m.problem_slug))
  const { scored, debug } = rankDrills(DRILLS, mapRows, {
    query: q, slugs: dx.slugs, categories: dx.categories, constraints, limit: TOP,
  })

  bar(`"${q}"`)
  console.log(`why this prompt: ${why}`)
  console.log(`diagnosis  : ${dx.slugs.length ? dx.slugs.join(', ') : '(no taxonomy match — goal or unrecognised)'}  [via ${dx.via}]`)
  console.log(`categories : ${dx.categories.join(', ') || '(none)'}`)
  console.log(`path       : ${debug.retrievalPath}`)
  console.log(`constraints: ${JSON.stringify(
    Object.fromEntries(Object.entries(constraints).filter(([, v]) => v != null && v !== undefined))
  )}`)
  console.log(`filters    : applied [${debug.filtersApplied.join(', ') || '—'}]  skipped [${debug.filtersSkipped.join(', ') || '—'}]`)
  console.log(`pool       : ${debug.candidateCountBeforeFilters} in library -> ${debug.candidateCountAfterFilters} eligible -> ${debug.returned} returned`)
  // rankDrills is the pure half and does not read the taxonomy, so the age
  // caveats are resolved here the same way retrieveDrills does it.
  for (const c of ageCaveats(dx.slugs, PROBLEMS)) {
    console.log(`age note   : "${c.label}" — ${c.note}`)
  }

  if (scored.length === 0) {
    console.log('\n  (nothing scored above zero — chat would answer from general knowledge)')
    return
  }

  console.log('')
  scored.forEach((s, i) => {
    const d = s.drill
    console.log(
      `  ${String(i + 1).padStart(2)}. ${String(s.reason.score.toFixed(1)).padStart(6)}  ` +
      `${d.drill_name.slice(0, 52).padEnd(52)} ${String(d.skill_category || '').slice(0, 20)}`
    )
    console.log(
      `      why: ${s.reason.primary}` +
      (s.reason.matchedProblems.length ? ` (${s.reason.matchedProblems.join(', ')}${s.reason.curated ? ', CURATED' : ''})` : '') +
      (s.reason.textScore ? ` · text ${s.reason.textScore}` : '') +
      ` · ages ${d.min_age ?? '?'}-${d.max_age ?? '?'} · ${d.difficulty_level || '?'}` +
      ` · ${d.indoor_outdoor || '?'} · ${d.space_required || '?'} space`
    )
    if (VERBOSE) {
      console.log(`      notes: ${s.reason.notes.join(' | ') || '—'}`)
      if (d.common_flaws_fixed?.length) console.log(`      fixes: ${d.common_flaws_fixed.slice(0, 5).join(', ')}`)
      if (d.equipment_needed?.length) console.log(`      needs: ${d.equipment_needed.join(', ')}`)
    }
  })
}

async function main() {
  const chosen = filterTerm
    ? PROMPTS.filter(p => p.q.toLowerCase().includes(filterTerm.toLowerCase()))
    : PROMPTS

  console.log(`Drill retrieval evaluation — ${DRILLS.length} drills, ${PROBLEMS.length} problems, ${MAPPINGS.length} mappings`)
  console.log(`Source: scripts/fixtures/drill-library.json (production slice, read-only)`)
  console.log(`Diagnosis: ${LIVE ? 'LIVE model' : 'alias fallback (no API key needed)'}`)
  if (filterTerm) console.log(`Filtered to prompts matching "${filterTerm}" — ${chosen.length} of ${PROMPTS.length}`)
  if (chosen.length === 0) { console.log('\nNo prompt matched.'); return }

  for (const p of chosen) await run(p.q, p.why)

  bar('READ THIS OUTPUT LIKE SO')
  console.log(`
A good result has the diagnosis naming the problem you would have named, and
the top two or three drills being ones you would actually run.

Worth flagging when you see it:
  - a drill ranked on 'text' alone sitting above a curated taxonomy match
  - a category that is obviously wrong for the question
  - "0 eligible" after filters — a constraint is too aggressive
  - the same generic compilation video ranking for everything
  - a goal-style question returning nothing at all

WITHOUT --live THIS UNDERSTATES QUALITY, sometimes badly. The alias fallback
only matches literal substrings of a taxonomy label or alias, so a question
phrased in words nobody wrote into the aliases column diagnoses to nothing and
drops to the text path — which is the weakest path and the one that mixes
categories. "My 8-year-old keeps dropping his back shoulder" is the clearest
example: no alias contains that phrase, so it text-matches on "shoulder" and
pulls in a pitching drill. Given the slug a live model would supply
(uppercutting), the same query returns curated Tee Work and Low Tee instead.

So read a bad result here twice: once as "retrieval is wrong", and once as
"the aliases do not cover how a coach says this". The second is a data fix,
and it is usually the answer.

Nothing here writes to the database.`)
}

main().catch(e => { console.error(e); process.exit(1) })
