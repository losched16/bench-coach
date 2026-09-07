// Read migration 058's calibration table without a database.
//
// WHY THIS EXISTS
//
// The offline evaluator runs against scripts/fixtures/drill-library.json, which
// was captured from production before 058 and therefore has none of the new
// columns. Hand-copying forty rows of values into a second file would create
// two sources of truth that drift the first time one is edited — and the whole
// point of the calibration set is that every value is defensible, which stops
// being checkable the moment there are two versions of it.
//
// So the migration stays the only place the values are written, and this reads
// them back out. It is a PARSER, not a generator: it cannot change the SQL, and
// a shape it does not understand is an error rather than a silent zero rows.
// scripts/test-drill-intelligence.ts runs it and asserts the row count, so a
// migration edit that breaks the parse fails the suite instead of quietly
// giving the evaluator an empty overlay.

import { readFileSync } from 'fs'

const COLUMNS = [
  'drill_name', 'family_slug', 'variation_type', 'activity_format', 'practice_roles',
  'min_players', 'ideal_group_size', 'min_coaches', 'station_friendly',
  'rep_density', 'idle_time_risk', 'engagement_level', 'competition_style',
  'instruction_complexity', 'throwing_load', 'physical_intensity', 'mixed_skill_friendly',
]

/** Split a VALUES row on top-level commas — brackets and quotes do not count. */
function splitTop(s) {
  const out = []
  let depth = 0, quoted = false, cur = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === "'" && s[i + 1] === "'") { cur += "''"; i++; continue }
      if (ch === "'") quoted = false
      cur += ch
      continue
    }
    if (ch === "'") { quoted = true; cur += ch; continue }
    if (ch === '[' || ch === '(') depth++
    if (ch === ']' || ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function literal(tok) {
  if (tok === 'NULL') return null
  if (tok === 'true') return true
  if (tok === 'false') return false
  if (/^-?\d+$/.test(tok)) return Number(tok)
  if (tok.startsWith("'")) return tok.slice(1, -1).replace(/''/g, "'")
  const arr = tok.match(/^ARRAY\[(.*)\]$/s)
  if (arr) return splitTop(arr[1]).map(literal)
  throw new Error(`unrecognised SQL literal: ${tok}`)
}

export function parseCalibration(path = 'migrations/058_drill_calibration.sql') {
  const sql = readFileSync(path, 'utf8')
  const start = sql.indexOf(') AS (VALUES')
  const end = sql.indexOf('\nUPDATE public.drill_resources', start)
  if (start < 0 || end < 0) throw new Error('058: could not find the calibration VALUES block')

  const body = sql
    .slice(start + ') AS (VALUES'.length, end)
    .replace(/^\s*--.*$/gm, '')        // whole-line comments only; none appear inside a row
    .trim()
    .replace(/\)\s*$/, '')             // the closing paren of the CTE

  const rows = []
  // Rows are separated by "),\n(" at depth zero. Walking characters is more
  // robust than a regex here because descriptions contain both parens and commas.
  let depth = 0, cur = ''
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '(') { depth++; if (depth === 1) { cur = ''; continue } }
    if (ch === ')') { depth--; if (depth === 0) { rows.push(cur); continue } }
    if (depth >= 1) cur += ch
  }
  if (depth !== 0) throw new Error('058: unbalanced parentheses in the VALUES block')

  return rows.map(r => {
    const toks = splitTop(r)
    if (toks.length !== COLUMNS.length) {
      throw new Error(`058: row has ${toks.length} values, expected ${COLUMNS.length}: ${r.slice(0, 60)}…`)
    }
    return Object.fromEntries(COLUMNS.map((c, i) => [c, literal(toks[i])]))
  })
}

/**
 * The two original activities 058 INSERTs, read back the same way.
 *
 * They are not in the VALUES table because they do not exist yet — they are
 * created by this migration rather than updated by it — but the evaluator needs
 * them, because "Protect the Castle + Throw" is the only Advanced drill in the
 * library that reaches an eight-year-old and therefore the only row that can
 * demonstrate the age/difficulty split against real data.
 */
export function parseNewDrills(path = 'migrations/058_drill_calibration.sql') {
  const sql = readFileSync(path, 'utf8')
  const out = []
  const re = /INSERT INTO public\.drill_resources \(([\s\S]*?)\)\s*\nSELECT\n([\s\S]*?)\nFROM public\.drill_activity_families/g
  let m
  while ((m = re.exec(sql)) !== null) {
    const cols = splitTop(m[1].replace(/\s+/g, ' ')).map(c => c.trim())
    const toks = splitTop(m[2].trim())
    // The final column is filled by the join, not by a literal: `f.id` stands in
    // for activity_family_id. Substituting the slug keeps the overlay readable
    // and keeps the parser from having to understand the join.
    const vals = toks.map(t => (t === 'f.id' ? "'protect-the-castle'" : t))
    if (cols.length !== vals.length) {
      throw new Error(`058: INSERT has ${cols.length} columns and ${vals.length} values`)
    }
    const row = Object.fromEntries(cols.map((c, i) => [c, literal(vals[i])]))
    row.family_slug = row.activity_family_id
    delete row.activity_family_id
    out.push(row)
  }
  if (out.length !== 2) throw new Error(`058: expected 2 inserted drills, parsed ${out.length}`)
  return out
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = parseCalibration()
  const created = parseNewDrills()
  console.error(`${rows.length} calibration rows, ${created.length} new drills`)
  process.stdout.write(JSON.stringify({ calibration: rows, created }, null, 2) + '\n')
}
