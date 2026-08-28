#!/usr/bin/env node
// Convert an existing SEO page into a structured resource — without writing a
// word of new content.
//
// WHY THIS IS A SCRIPT AND NOT A MIGRATION
//
// The pages live in the `seo_pages` table, and their content is prose written
// by a coach about practices he actually ran. Turning that into a schedule and
// a set of drill cards is an extraction problem, not an authoring one: every
// timing, drill name, cue and mistake in the output has to have come out of
// the article. There is no way to write that as a fixed SQL statement, and
// there is no version of this worth doing that invents the missing parts.
//
// So the flow is deliberately three steps with a human in the middle:
//
//   node scripts/seo-convert.mjs extract <slug>   → writes a proposal + backup
//   node scripts/seo-convert.mjs review  <slug>   → shows it, flags invention
//   node scripts/seo-convert.mjs apply   <slug>   → writes it to the page
//
// `extract` never writes to the database. `apply` never runs without a
// proposal that `review` has been able to check. And `extract` always saves
// the untouched original to seo-conversions/<slug>.backup.json first, so any
// conversion can be undone with `restore`.
//
// THE INVENTION CHECK
//
// `review` takes every string in the proposed block and looks for it in the
// source article. Anything it cannot find is printed as SUSPECT. This is a
// blunt instrument — a rephrased cue is flagged even when it is faithful, and
// a reordered sentence looks new — and that is the correct direction to be
// wrong in. The whole point is that a human reads the flagged lines before
// anything ships.
//
// CREDENTIALS — read this before wiring it up
//
// Two ways in, and they are not equivalent:
//
//   SEO_DATABASE_URL      preferred. A Postgres connection string for a role
//                         that can do nothing but SELECT and UPDATE
//                         seo_pages. See migrations/045_seo_editor_role.sql.
//
//   SUPABASE_SERVICE_ROLE_KEY   fallback. Bypasses RLS on every table in the
//                         project — it can read every coach's roster and
//                         delete anything. It works, and it is far more
//                         authority than this script needs.
//
// The narrow role exists because the blast radius of a leaked credential
// should match the job it was issued for. Worst case with SEO_DATABASE_URL is
// somebody editing marketing copy. Worst case with the service key is the
// whole database.
//
// Also needs: ANTHROPIC_API_KEY, and NEXT_PUBLIC_SUPABASE_URL when falling
// back to the service key.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import Anthropic from '@anthropic-ai/sdk'

const OUT_DIR = 'seo-conversions'
const MODEL = 'claude-opus-5'

const [, , command, slug, ...rest] = process.argv

function die(msg) {
  console.error(`\n${msg}\n`)
  process.exit(1)
}

function need(name) {
  const v = process.env[name]
  if (!v) die(`${name} is not set. This script talks to your live database and needs it.`)
  return v
}

/**
 * A tiny query surface over whichever credential is available.
 *
 * Only four operations are needed, so rather than pull in a query builder the
 * two backends implement the same four methods. The Postgres path is
 * preferred; the Supabase path is what runs when only the service key exists.
 */
function store() {
  const url = process.env.SEO_DATABASE_URL
  if (url) return pgStore(url)

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    die(
      'No database credential.\n' +
      '  Preferred: SEO_DATABASE_URL — a scoped role that can only touch seo_pages.\n' +
      '             Create it with migrations/045_seo_editor_role.sql.\n' +
      '  Fallback:  SUPABASE_SERVICE_ROLE_KEY (+ NEXT_PUBLIC_SUPABASE_URL), which\n' +
      '             can read and delete every table in the project.'
    )
  }
  console.log('Using SUPABASE_SERVICE_ROLE_KEY. A scoped SEO_DATABASE_URL would be safer — see migrations/045.')
  return supabaseStore()
}

function pgStore(connectionString) {
  // Supabase requires TLS but serves a cert this client will not chain to a
  // local root. The connection is still encrypted; only the CA check is
  // relaxed, which is the documented posture for their pooler.
  //
  // sslmode=disable in the URL turns it off entirely — that exists for a
  // local Postgres with no TLS at all, and should never appear in a string
  // pointing at Supabase.
  const noSsl = /[?&]sslmode=disable\b/.test(connectionString)
  const pool = new pg.Pool({
    connectionString,
    ssl: noSsl ? false : { rejectUnauthorized: false },
    max: 2,
  })
  return {
    async one(slug) {
      const { rows } = await pool.query('SELECT * FROM seo_pages WHERE slug = $1', [slug])
      return rows[0] || null
    },
    async all(columns) {
      const { rows } = await pool.query(`SELECT ${columns} FROM seo_pages`)
      return rows
    },
    async setContent(slug, content) {
      const { rowCount } = await pool.query(
        'UPDATE seo_pages SET content = $1 WHERE slug = $2',
        [JSON.stringify(content), slug]
      )
      if (rowCount !== 1) throw new Error(`expected to update 1 row, updated ${rowCount}`)
    },
    async close() { await pool.end() },
  }
}

function supabaseStore() {
  const client = createClient(need('NEXT_PUBLIC_SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'))
  return {
    async one(slug) {
      const { data } = await client.from('seo_pages').select('*').eq('slug', slug).single()
      return data || null
    },
    async all(columns) {
      const { data, error } = await client.from('seo_pages').select(columns)
      if (error) throw new Error(error.message)
      return data || []
    },
    async setContent(slug, content) {
      const { error } = await client.from('seo_pages').update({ content }).eq('slug', slug)
      if (error) throw new Error(error.message)
    },
    async close() {},
  }
}

// One connection for the whole run rather than one per query — `pilot` makes
// three or four calls per page and a pool per call would be silly.
let _store = null
function db() {
  if (!_store) _store = store()
  return _store
}

function paths(slug) {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  return {
    proposal: join(OUT_DIR, `${slug}.json`),
    backup: join(OUT_DIR, `${slug}.backup.json`),
  }
}

async function fetchPage(slug) {
  const page = await db().one(slug)
  if (!page) die(`No page with slug "${slug}".`)
  return page
}

/** Every word the article actually contains, for the invention check. */
function sourceText(page) {
  const parts = [page.title, page.meta_description, page.content?.intro || '']
  for (const s of page.content?.sections || []) {
    parts.push(s.heading, s.body)
    parts.push(...(s.list_items || []), ...(s.coaching_cues || []), ...(s.common_mistakes || []))
    if (s.cta) parts.push(s.cta.title || '', s.cta.body || '')
  }
  for (const f of page.schema_faq || []) parts.push(f.question, f.answer)
  return parts.join('\n')
}

/** Strip tags and normalise whitespace/quotes so comparisons are about words. */
function normalize(s) {
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

const KIND_BY_CATEGORY = {
  'practice-plans': 'practice-plan',
  drills: 'drill-library',
  coaching: 'age-hub',
  problems: 'problem',
}

const EXTRACT_PROMPT = `You are restructuring an existing youth baseball coaching article into structured data.

THE ONE RULE: you are extracting, not writing. Every value you output must come from the article below. You may shorten and you may reformat. You may not add coaching advice, invent a drill, invent a timing, invent a cue, or fill a field because it looks empty.

If the article does not say how long a drill takes, omit "duration". If it never describes an easier variation, omit "easierVariation". A missing field is correct and expected. A field you made up is a defect that will be caught and will waste someone's afternoon.

Return ONLY a JSON object of this shape. Omit any key you cannot fill from the article:

{
  "kind": "<KIND>",
  "meta": [{"label": "Age", "value": "..."}],
  "objective": "one sentence, from the article",
  "equipment": ["..."],
  "setup": ["..."],
  "timeline": [{"from": 0, "to": 10, "activity": "...", "focus": "...", "drill": "<matching drill name, if any>"}],
  "drills": [{
    "name": "...", "bestFor": "...", "duration": "...", "players": "...",
    "equipment": ["..."], "skill": "...", "setup": "...",
    "instructions": ["..."], "coachingCues": ["..."], "commonMistakes": ["..."],
    "easierVariation": "...", "harderVariation": "..."
  }],
  "rosterVariants": [{"players": "9 players", "guidance": "..."}],
  "symptoms": ["..."]
}

Notes on specific fields:
- "timeline": from/to are MINUTES FROM THE START of practice, as integers. Use the article's real timings. If the article gives durations but not a running clock, add them up in the order the article presents them. If a block's timing is genuinely not stated, omit that row rather than guessing where it falls.
- "meta": only facts the article states — age range, practice length, player count, coaches needed. Do not add a "Skill Level" because most plans have one.
- "skill" on a drill: the category it belongs to, in the article's own words ("balance", "swing path", "tracking"). Omit if the article does not group its drills.
- "symptoms": only for a problem page — the observable things a coach would see.
- "equipment" and "players": NEVER INFER THESE. Only what the article names. A throwing drill obviously uses baseballs, and you must still omit "equipment" unless the article says so. This is the field most likely to tempt you and the one where a guess does the most damage: the equipment list becomes a checklist a coach packs a bag from, and a plausible-looking list that is missing the tee sends them to the field without it. An absent list makes them think it through. A confident wrong one does not.
- Keep the coach's phrasing. His cues are the reason people read this.

ARTICLE TITLE: <TITLE>

ARTICLE:
<ARTICLE>`

function articleForPrompt(page) {
  const out = [page.content?.intro || '']
  for (const s of page.content?.sections || []) {
    out.push(`\n## ${s.heading}\n${s.body}`)
    if (s.list_items?.length) out.push(s.list_items.map(i => `- ${i}`).join('\n'))
    if (s.coaching_cues?.length) out.push('Coaching cues:\n' + s.coaching_cues.map(i => `- ${i}`).join('\n'))
    if (s.common_mistakes?.length) out.push('Common mistakes:\n' + s.common_mistakes.map(i => `- ${i}`).join('\n'))
  }
  return out.join('\n').replace(/<[^>]+>/g, '').trim()
}

async function extract(slug) {
  const page = await fetchPage(slug)
  const { proposal, backup } = paths(slug)

  // The original, saved before anything else happens. The copy-preservation
  // rule is only as good as the ability to put it back.
  writeFileSync(backup, JSON.stringify(page, null, 2))
  console.log(`Backed up the current page to ${backup}`)

  const kind = KIND_BY_CATEGORY[page.category]
  if (!kind) die(`No resource kind for category "${page.category}".`)

  const anthropic = new Anthropic({ apiKey: need('ANTHROPIC_API_KEY'), maxRetries: 5 })

  const prompt = EXTRACT_PROMPT
    .replace('<KIND>', kind)
    .replace('<TITLE>', page.title)
    .replace('<ARTICLE>', articleForPrompt(page))

  console.log(`Reading "${page.title}" (${page.category}/${page.slug})...`)

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: prompt }],
  })

  // content[0] is a thinking block on this model — take the text blocks.
  const text = response.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim()

  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  let block
  try {
    block = JSON.parse(json)
  } catch (e) {
    writeFileSync(proposal + '.raw.txt', text)
    die(`The model did not return usable JSON. Raw output saved to ${proposal}.raw.txt`)
  }

  block.kind = kind
  writeFileSync(proposal, JSON.stringify(block, null, 2))
  console.log(`\nProposal written to ${proposal}`)
  console.log(`Next:  node scripts/seo-convert.mjs review ${slug}`)
}

/** Walk every string in the proposal, with a path, for reporting. */
function* strings(value, path = '') {
  if (typeof value === 'string') { yield [path, value]; return }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* strings(value[i], `${path}[${i}]`)
    return
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) yield* strings(v, path ? `${path}.${k}` : k)
  }
}

/**
 * Is this phrase in the article?
 *
 * Exact substring first. Failing that, a word-overlap score, so a cue that was
 * shortened from a sentence still passes while a cue nobody wrote does not.
 */
function foundInSource(phrase, source) {
  const p = normalize(phrase)
  if (p.length < 4) return true          // "Age", "60", "3" — labels, not content
  if (source.includes(p)) return true
  const words = p.split(' ').filter(w => w.length > 3)
  if (words.length === 0) return true
  const hits = words.filter(w => source.includes(w)).length
  return hits / words.length >= 0.8
}

// Keys whose values are ours rather than the author's — structural labels the
// prompt supplies, not coaching content.
const STRUCTURAL = /(^kind$|\.kind$|meta\[\d+\]\.label)/

/**
 * Everything worth knowing about a proposal, as data rather than console
 * output — so `review` can print it and `auto` can gate on it.
 *
 * Two independent signals, because they catch different failures:
 *   suspect — a phrase that is not in the article. Invented content.
 *   gaps    — a hole or an overlap in the practice clock. Misread structure.
 */
function analyze(slug) {
  const { proposal, backup } = paths(slug)
  if (!existsSync(proposal)) die(`No proposal at ${proposal}. Run extract first.`)
  if (!existsSync(backup)) die(`No backup at ${backup}. Run extract first.`)

  const block = JSON.parse(readFileSync(proposal, 'utf8'))
  const page = JSON.parse(readFileSync(backup, 'utf8'))
  const source = normalize(sourceText(page))

  const suspect = []
  for (const [path, value] of strings(block)) {
    if (STRUCTURAL.test(path)) continue
    if (!foundInSource(value, source)) suspect.push([path, value])
  }

  const gaps = []
  let last = null
  for (const row of block.timeline || []) {
    if (last !== null && row.from !== undefined && row.from !== last) {
      gaps.push(`previous block ended at ${last}, "${row.activity}" starts at ${row.from}`)
    }
    if (row.to !== undefined) last = row.to
  }

  const complete = (block.timeline || []).every(r => r.from !== undefined && r.to !== undefined)
  const total = complete && block.timeline?.length
    ? block.timeline[block.timeline.length - 1].to
    : null

  return { block, page, proposal, suspect, gaps, total, clean: suspect.length === 0 && gaps.length === 0 }
}

function printReview(a) {
  const { block, page, proposal, suspect, gaps, total } = a

  console.log(`\n=== ${page.title} ===`)
  console.log(`URL:  /${page.category}/${page.slug}   (unchanged)`)
  console.log(`Kind: ${block.kind}\n`)

  if (block.timeline?.length) {
    console.log('TIMELINE')
    let last = null
    for (const row of block.timeline) {
      const label = row.time || (row.to !== undefined ? `${row.from}-${row.to}` : `${row.from}+`)
      console.log(`  ${String(label).padEnd(10)} ${row.activity}${row.focus ? `  (${row.focus})` : ''}`)
      if (last !== null && row.from !== undefined && row.from !== last) {
        console.log(`     ^^ WARNING: previous block ended at ${last}, this one starts at ${row.from}`)
      }
      if (row.to !== undefined) last = row.to
    }
    if (total !== null) console.log(`  TOTAL: ${total} minutes`)
    console.log('')
  }

  if (block.drills?.length) {
    console.log(`DRILLS (${block.drills.length})`)
    for (const d of block.drills) {
      const fields = Object.keys(d).filter(k => k !== 'name').join(', ')
      console.log(`  ${d.name}\n     fields: ${fields || '(name only)'}`)
    }
    console.log('')
  }

  if (suspect.length === 0) {
    console.log('INVENTION CHECK: every phrase traces back to the article.\n')
  } else {
    console.log(`INVENTION CHECK: ${suspect.length} phrase(s) not found in the article.`)
    console.log('Read each one. A rephrasing is fine; a new coaching claim is not.\n')
    for (const [path, value] of suspect) {
      console.log(`  SUSPECT ${path}`)
      console.log(`          "${value}"\n`)
    }
    console.log(`Edit ${proposal} directly to fix anything wrong, then review again.\n`)
  }

  if (gaps.length) {
    console.log(`CLOCK: ${gaps.length} gap(s) in the practice timeline.`)
    gaps.forEach(g => console.log(`  ${g}`))
    console.log('')
  }
}

async function review(slug) {
  const a = analyze(slug)
  printReview(a)
  console.log(`If it is right:  node scripts/seo-convert.mjs apply ${slug}`)
}

async function apply(slug) {
  const { proposal, backup } = paths(slug)
  if (!existsSync(proposal)) die(`No proposal at ${proposal}. Run extract first.`)
  const block = JSON.parse(readFileSync(proposal, 'utf8'))

  const page = await fetchPage(slug)

  // The article is carried across verbatim. This adds a key; it does not
  // rewrite, reorder or drop a single section.
  const content = { ...page.content, resource: block }

  // Preservation is guaranteed by construction above — `content` spreads the
  // live `page.content` and adds one key, so the article cannot change no
  // matter what the proposal contains. Asserting that here would be
  // comparing a value with itself.
  //
  // The failure that IS reachable: the article was edited between `extract`
  // and `apply`. The proposal's phrases were checked against prose that no
  // longer exists, so the invention check that cleared it is void — it may
  // now describe a drill the page stopped mentioning. Rare by hand, much less
  // rare once this runs unattended.
  if (existsSync(backup)) {
    const atExtract = JSON.parse(readFileSync(backup, 'utf8'))
    if (JSON.stringify(atExtract.content?.sections) !== JSON.stringify(page.content?.sections)) {
      die(
        `REFUSING TO WRITE: the article changed since this proposal was extracted.\n` +
        `  Everything that vouched for it was checked against the old text.\n` +
        `  Re-run:  node scripts/seo-convert.mjs auto ${slug}`
      )
    }
  }

  await db().setContent(slug, content)

  const sections = content.sections?.length ?? 0
  console.log(`Applied to /${page.category}/${page.slug} — ${sections} sections, unchanged.`)
  console.log(`Undo:  node scripts/seo-convert.mjs restore ${slug}`)
}

async function restore(slug) {
  const { backup } = paths(slug)
  if (!existsSync(backup)) die(`No backup at ${backup}.`)
  const page = JSON.parse(readFileSync(backup, 'utf8'))

  await db().setContent(slug, page.content)
  console.log(`Restored /${page.category}/${page.slug} to its state at extract time.`)
}

async function list() {
  const data = (await db().all('slug, category, type, title, age_group, is_published, hub_slug, content'))
    .sort((a, b) => (a.category || '').localeCompare(b.category || ''))

  console.log(`\n${data.length} pages\n`)
  for (const p of data) {
    const converted = p.content?.resource ? ' [structured]' : ''
    const pub = p.is_published ? '' : ' (unpublished)'
    console.log(`  /${p.category}/${p.slug}${converted}${pub}`)
    console.log(`     ${p.title}`)
    if (p.hub_slug) console.log(`     hub: ${p.hub_slug}`)
  }
  console.log('')
}

/**
 * Everything about the page set that could keep a URL out of the index.
 *
 * Written against "11 URLs crawled — currently not indexed" in Search
 * Console. Google does not say which eleven or why, but the usual causes are
 * mechanical and visible from here: a page nothing links to, a page thin
 * enough to look like a stub, two pages saying the same thing, or a canonical
 * pointing somewhere unexpected.
 *
 * Reports only. Nothing here changes a row.
 */
async function doctor() {
  const data = await db().all(
    'slug, category, type, title, meta_description, canonical, hub_slug, related_slugs, age_group, is_published, content'
  )

  const published = data.filter(p => p.is_published)
  const bySlug = new Map(data.map(p => [p.slug, p]))
  const problems = []
  const notes = []

  // Anything a spoke points at that is not a live hub is a broken rung in the
  // hierarchy — the breadcrumb and the "back to guide" banner both go
  // nowhere.
  for (const p of published) {
    if (p.type !== 'spoke' || !p.hub_slug) continue
    const hub = bySlug.get(p.hub_slug)
    if (!hub) problems.push(`${p.slug}: hub_slug "${p.hub_slug}" does not exist`)
    else if (!hub.is_published) problems.push(`${p.slug}: hub "${p.hub_slug}" is unpublished`)
  }

  // A related_slugs entry that does not resolve renders nothing at all —
  // silently, which is how it survives.
  for (const p of published) {
    for (const rel of p.related_slugs || []) {
      const target = bySlug.get(rel)
      if (!target) problems.push(`${p.slug}: related_slugs -> "${rel}" does not exist`)
      else if (!target.is_published) problems.push(`${p.slug}: related_slugs -> "${rel}" is unpublished`)
    }
  }

  // Orphans. A page no hub claims and nothing links to is reachable only from
  // the sitemap, and that is the profile of a URL that gets crawled and left.
  const linked = new Set()
  for (const p of published) {
    for (const rel of p.related_slugs || []) linked.add(rel)
    if (p.hub_slug) linked.add(p.hub_slug)
  }
  for (const p of published) {
    if (p.type === 'hub') continue
    const hasHub = !!p.hub_slug && bySlug.get(p.hub_slug)?.is_published
    if (!hasHub && !linked.has(p.slug)) {
      problems.push(`${p.slug}: orphan — no hub, and no other page links to it`)
    }
  }

  // Duplicate titles and descriptions read as duplicate pages.
  const seenTitle = new Map()
  const seenDesc = new Map()
  for (const p of published) {
    const t = (p.title || '').trim().toLowerCase()
    const d = (p.meta_description || '').trim().toLowerCase()
    if (t) { if (seenTitle.has(t)) problems.push(`${p.slug}: same title as ${seenTitle.get(t)}`); else seenTitle.set(t, p.slug) }
    if (d) { if (seenDesc.has(d)) problems.push(`${p.slug}: same meta description as ${seenDesc.get(d)}`); else seenDesc.set(d, p.slug) }
  }

  for (const p of published) {
    if (!p.meta_description) problems.push(`${p.slug}: no meta description`)
    else if (p.meta_description.length > 160) notes.push(`${p.slug}: meta description is ${p.meta_description.length} chars (truncates around 160)`)

    // A canonical that does not point at this page is telling Google to index
    // something else. Occasionally deliberate; always worth seeing.
    const expected = `https://www.mybenchcoach.com/${p.category}/${p.slug}`
    if (p.canonical && p.canonical !== expected) {
      problems.push(`${p.slug}: canonical points at ${p.canonical}, not ${expected}`)
    }

    const words = JSON.stringify(p.content || {}).split(/\s+/).length
    if (words < 300) notes.push(`${p.slug}: ~${words} words — thin enough that Google may skip it`)
  }

  console.log(`\n${data.length} pages, ${published.length} published, ${data.length - published.length} unpublished`)
  const structured = published.filter(p => p.content?.resource).length
  console.log(`${structured} carry a structured resource block\n`)

  if (problems.length === 0) console.log('No indexation problems found.\n')
  else {
    console.log(`PROBLEMS (${problems.length})`)
    problems.forEach(p => console.log(`  ${p}`))
    console.log('')
  }
  if (notes.length) {
    console.log(`WORTH A LOOK (${notes.length})`)
    notes.forEach(n => console.log(`  ${n}`))
    console.log('')
  }
}

/**
 * extract → review → apply, in one command, stopping when it should.
 *
 * The three-step flow exists so a human sees the extraction before it goes
 * live. That is right when the extraction is questionable and pure overhead
 * when it is clean — and "clean" is a thing the machine can determine: every
 * phrase traced back to the article, and no holes in the practice clock.
 *
 * So the gate stays, and it stays automatic. A clean proposal applies. A
 * proposal with a single SUSPECT line or one gap in the timeline stops, prints
 * why, and leaves the file on disk to be edited and re-run. The safety rail is
 * not that a human looks at everything; it is that a human looks at everything
 * the checks could not vouch for.
 *
 * --force applies anyway. That is for the case where you have read the
 * flagged lines and they are fine — a rephrasing rather than an invention —
 * not for getting past the check in a hurry.
 */
async function auto(slug, opts = {}) {
  console.log(`\n──────── ${slug} ────────`)
  await extract(slug)

  const a = analyze(slug)
  printReview(a)

  if (!a.clean && !opts.force) {
    console.log(`HELD BACK. Nothing was written to the page.`)
    console.log(`  Read the flagged lines, edit ${a.proposal} if needed, then:`)
    console.log(`    node scripts/seo-convert.mjs apply ${slug}`)
    return { slug, applied: false, suspect: a.suspect.length, gaps: a.gaps.length }
  }

  if (!a.clean) console.log('Applying anyway (--force).')
  await apply(slug)
  return { slug, applied: true, suspect: a.suspect.length, gaps: a.gaps.length }
}

/**
 * The whole 8U cluster, in dependency order.
 *
 * Practice plan first because it is the flagship and the one whose extraction
 * is most likely to need a human eye; the hub last, since what it renders
 * depends on the spokes existing rather than on its own block.
 *
 * Discovered from the database rather than hardcoded, so this works for 10U
 * the day there is a 10U hub.
 */
async function pilot(ageOrHub, opts = {}) {
  const age = (ageOrHub || '8U').toUpperCase()

  const data = (await db().all('slug, category, type, age_group, hub_slug, is_published'))
    .filter(p => p.is_published)

  const inCluster = data.filter(p => (p.age_group || '').toUpperCase() === age)
  const hubSlugs = new Set(inCluster.map(p => p.hub_slug).filter(Boolean))
  // The hub itself may not carry the age tag — it is identified by the spokes
  // that point at it.
  const hubs = data.filter(p => p.type === 'hub' && (hubSlugs.has(p.slug) || (p.age_group || '').toUpperCase() === age))

  const ORDER = { 'practice-plans': 0, drills: 1, problems: 2, coaching: 3 }
  const spokes = inCluster
    .filter(p => p.type !== 'hub')
    .sort((a, b) => (ORDER[a.category] ?? 9) - (ORDER[b.category] ?? 9))

  const queue = [...spokes, ...hubs.filter(h => !spokes.some(s => s.slug === h.slug))]
  if (queue.length === 0) die(`No published ${age} pages found.`)

  console.log(`\n${age} cluster: ${queue.length} pages`)
  queue.forEach(p => console.log(`  /${p.category}/${p.slug}`))

  const results = []
  for (const p of queue) {
    try {
      results.push(await auto(p.slug, opts))
    } catch (e) {
      console.log(`\nERROR on ${p.slug}: ${e?.message || e}`)
      results.push({ slug: p.slug, applied: false, error: true })
    }
  }

  const applied = results.filter(r => r.applied)
  const held = results.filter(r => !r.applied)

  console.log(`\n════════ ${age} SUMMARY ════════`)
  console.log(`Applied:    ${applied.length}`)
  applied.forEach(r => console.log(`  ${r.slug}`))
  if (held.length) {
    console.log(`Held back:  ${held.length}`)
    held.forEach(r => console.log(
      `  ${r.slug}${r.error ? '  (error)' : `  ${r.suspect} suspect, ${r.gaps} clock gap(s)`}`
    ))
    console.log(`\nEach held page has a proposal in ${OUT_DIR}/ — edit it, then apply.`)
  }
  console.log(`\nPages revalidate hourly. Redeploy to see them immediately.`)
}

const COMMANDS = { extract, review, apply, restore, list, doctor, auto, pilot }

async function main() {
  const fn = COMMANDS[command]
  const force = rest.includes('--force') || slug === '--force'
  if (!fn) {
    console.log(`
BenchCoach SEO conversion

  node scripts/seo-convert.mjs list
      Every page, and which ones already carry a resource block.

  node scripts/seo-convert.mjs extract <slug>
      Backs up the page, then extracts a structured block from its own prose.
      Writes a proposal file. Does NOT touch the page.

  node scripts/seo-convert.mjs review <slug>
      Prints the proposal and flags any phrase that is not in the article.

  node scripts/seo-convert.mjs apply <slug>
      Adds the block to the page. The article is carried across untouched.

  node scripts/seo-convert.mjs restore <slug>
      Puts the page back the way extract found it.

  node scripts/seo-convert.mjs doctor
      Broken hub links, orphans, duplicate titles, odd canonicals, thin pages.
      Reports only — changes nothing.

  node scripts/seo-convert.mjs auto <slug> [--force]
      extract + review + apply in one go. Applies only if every phrase traces
      back to the article and the practice clock has no holes. Otherwise it
      stops and tells you what to look at.

  node scripts/seo-convert.mjs pilot [8U] [--force]
      The same, across a whole age group's cluster, in a sensible order.
      Prints a summary of what went live and what is waiting on you.
`)
    process.exit(command ? 1 : 0)
  }
  // `pilot` takes an age group and defaults to 8U; `list` and `doctor` take
  // nothing. Everything else needs a slug.
  const NO_SLUG = [list, doctor]
  const OPTIONAL_SLUG = [pilot]
  if (!NO_SLUG.includes(fn) && !OPTIONAL_SLUG.includes(fn) && (!slug || slug.startsWith('--'))) {
    die(`${command} needs a slug.`)
  }
  await fn(slug && !slug.startsWith('--') ? slug : undefined, { force })
}

main()
  .then(async () => { if (_store) await _store.close() })
  .catch(async e => {
    // Closed before dying, or a pg pool keeps the process alive past the
    // error message and the script looks hung rather than failed.
    if (_store) await _store.close().catch(() => {})
    die(e?.message || String(e))
  })
