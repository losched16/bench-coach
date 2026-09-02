// Task 6 — find CANDIDATE BenchCoach drills for a set of terms.
//
// Candidate retrieval only. This says "here are library drills that mention
// these words" and nothing more. Whether an Instagram reel is a duplicate of
// one of them, a variation, or something new is a judgement about mechanics
// that a term match cannot make and does not try to. No embeddings: the
// library is 206 rows, and a reviewer needs to see WHY a candidate surfaced,
// which a term hit shows and a cosine distance does not.
//
//   node scripts/pilot/search-drills.mjs split grip swing
//   node scripts/pilot/search-drills.mjs "open 45"
//   node scripts/pilot/search-drills.mjs --age 10 --category hitting tee
//   node scripts/pilot/search-drills.mjs --json jump back
//
// Reads pilot/reference/drills.json. Run export-reference.mjs first.

import { join } from 'path'
import { readJson, P } from './lib.mjs'

const FIELDS = [
  ['drill_name', 5],
  ['common_flaws_fixed', 3],
  ['mechanic_focus', 3],
  ['primary_skill', 2],
  ['secondary_skill', 2],
  ['tags', 2],
  ['description', 1],
  ['ai_coaching_notes', 1],
  ['skill_category', 1],
]

const norm = s => String(s ?? '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
const asText = v => Array.isArray(v) ? v.join(' ') : String(v ?? '')

export function searchDrills(drills, terms, opts = {}) {
  const words = terms.map(norm).filter(Boolean)
  if (words.length === 0) return []
  const phrase = words.join(' ')

  const out = []
  for (const d of drills) {
    if (opts.category && norm(d.skill_category) !== norm(opts.category) &&
        !norm(d.skill_category).includes(norm(opts.category))) continue
    if (opts.age != null) {
      const lo = d.min_age ?? 0, hi = d.max_age ?? 99
      if (opts.age < lo || opts.age > hi) continue
    }

    let score = 0
    const hits = []
    for (const [field, weight] of FIELDS) {
      const text = norm(asText(d[field]))
      if (!text) continue
      // Whole phrase in one field is the strongest signal a term match has.
      if (phrase.length > 3 && text.includes(phrase)) { score += weight * 4; hits.push(`${field}:"${phrase}"`) }
      for (const w of words) {
        if (w.length < 3) continue
        if (new RegExp(`\\b${w}`).test(text)) { score += weight; hits.push(`${field}:${w}`) }
      }
    }
    if (score > 0) out.push({ drill: d, score, hits: Array.from(new Set(hits)) })
  }
  return out.sort((a, b) => b.score - a.score || String(a.drill.drill_name).localeCompare(String(b.drill.drill_name)))
}

if (process.argv[1] && process.argv[1].endsWith('search-drills.mjs')) {
  const argv = process.argv.slice(2)
  const opts = {}
  const terms = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--age') opts.age = Number(argv[++i])
    else if (argv[i] === '--category') opts.category = argv[++i]
    else if (argv[i] === '--json') opts.json = true
    else if (argv[i] === '--top') opts.top = Number(argv[++i])
    else terms.push(argv[i])
  }
  if (terms.length === 0) {
    console.error('usage: node scripts/pilot/search-drills.mjs [--age N] [--category X] [--top N] [--json] <terms...>')
    process.exit(1)
  }

  const ref = readJson(join(P.reference, 'drills.json'))
  const results = searchDrills(ref.rows, terms, opts).slice(0, opts.top ?? 12)

  if (opts.json) {
    console.log(JSON.stringify(results.map(r => ({
      id: r.drill.id, drill_name: r.drill.drill_name, skill_category: r.drill.skill_category,
      min_age: r.drill.min_age, max_age: r.drill.max_age, score: r.score, hits: r.hits,
    })), null, 2))
    process.exit(0)
  }

  console.log(`Candidates for "${terms.join(' ')}"${opts.age ? ` age ${opts.age}` : ''}${opts.category ? ` category ${opts.category}` : ''} — ${results.length} shown, ${ref.count} in reference\n`)
  if (results.length === 0) { console.log('  (no term matches — this says nothing about whether the drill is new)'); process.exit(0) }
  for (const r of results) {
    const d = r.drill
    console.log(`  ${String(r.score).padStart(3)}  ${d.drill_name.slice(0, 50).padEnd(52)} ${String(d.skill_category).slice(0, 20).padEnd(22)} ages ${d.min_age ?? '?'}-${d.max_age ?? '?'}`)
    console.log(`       ${d.id}`)
    console.log(`       hits: ${r.hits.join(', ')}`)
  }
  console.log('\nCandidate retrieval only. Whether any of these is the same drill is a judgement for the review layer.')
}
