// BenchCoach Academy — import a course manuscript.
//
//   npm run academy:import -- --manuscript ~/private/benchcoach_academy_swing_course.md \
//        [--slug build-a-better-baseball-swing] [--out .academy-content] [--bump-version]
//
// Writes, into a git-ignored folder:
//   <slug>.seed.sql      idempotent SQL to paste into the Supabase SQL editor
//                        (after migration 080). Contains the paid lesson text —
//                        keep it private.
//   <slug>.report.md     what was imported, and the editorial review list.
//
// It never connects to a database and never publishes: the course is created
// as 'draft' and stays unpurchasable until you set its price and status.

import { readFileSync, writeFileSync, mkdirSync, chmodSync } from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { parseManuscript, blockSource } from '../../lib/academy/manuscript'
import { courseCopy } from '../../lib/academy/catalog'
import { seedSql } from '../../lib/academy/seed'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

const manuscript = arg('manuscript')
const slug = arg('slug') || 'build-a-better-baseball-swing'
const outDir = path.resolve(arg('out') || '.academy-content')
if (!manuscript) { console.error('usage: academy:import -- --manuscript <file.md> [--slug s] [--out dir]'); process.exit(2) }
const copy = courseCopy(slug)
if (!copy) { console.error(`no catalog entry for ${slug} (lib/academy/catalog.ts)`); process.exit(2) }

// The output holds paid text: refuse a folder git would commit.
mkdirSync(outDir, { recursive: true, mode: 0o700 })
try {
  execFileSync('git', ['check-ignore', '-q', path.join(outDir, 'x.sql')])
} catch {
  if (outDir.startsWith(process.cwd())) { console.error(`refusing to write course text to a folder git would track: ${outDir}`); process.exit(2) }
}

const md = readFileSync(manuscript, 'utf8')
const course = parseManuscript(md, { slug, previewLessonKey: copy.previewLessonKey })
const lessons = course.lessons.filter(l => l.kind === 'lesson')

// Verbatim check: every block must reassemble to its manuscript paragraph.
let rebuilt = 0, mismatched = 0
for (const l of course.lessons) for (const b of l.blocks) {
  if (b.type === 'h') continue
  rebuilt++
  if (!md.includes(blockSource(b))) mismatched++
}

const sql = seedSql(course, copy, { bumpVersion: process.argv.includes('--bump-version') })
const sqlPath = path.join(outDir, `${slug}.seed.sql`)
writeFileSync(sqlPath, sql, { mode: 0o600 })
chmodSync(sqlPath, 0o600)

const report = [
  `# Import report — ${course.title}: ${course.subtitle}`,
  '',
  `Modules: ${course.modules.length} · lessons: ${lessons.length} · intro pages: ${course.lessons.filter(l => l.kind === 'intro').length} · resources: ${course.lessons.filter(l => l.kind === 'resource').length}`,
  `Free preview: ${course.lessons.find(l => l.isPreview)?.numberLabel ?? 'NOT FOUND'} · verbatim check: ${rebuilt - mismatched}/${rebuilt} blocks match the manuscript exactly`,
  '',
  '## Editorial review list',
  '',
  ...course.flags.map(f => `- [ ] ${f.lessonKey ? `**${f.lessonKey}** ` : ''}\`${f.flag}\` — ${f.detail}`),
  '',
  '## Video briefs (internal; never shown to learners)',
  '',
  ...lessons.map(l => `- ${l.numberLabel} ${l.title}: ${l.videoBrief ?? '**(no brief in manuscript)**'}`),
  '',
].join('\n')
const reportPath = path.join(outDir, `${slug}.report.md`)
writeFileSync(reportPath, report, { mode: 0o600 })

console.log(JSON.stringify({
  modules: course.modules.length, lessons: lessons.length, pages: course.lessons.length,
  verbatim: `${rebuilt - mismatched}/${rebuilt}`, flags: course.flags.length, sql: sqlPath, report: reportPath,
}, null, 1))
process.exit(mismatched ? 1 : 0)
