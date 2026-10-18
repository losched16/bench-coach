// BenchCoach Academy — turn a course manuscript (Markdown) into structured
// lessons, without rewriting a word of it.
//
// The manuscript is the source of truth for instruction. This parser only
// SPLITS it: a paragraph that starts "**Drill A — Grip-reset rehearsals.**"
// becomes a drill block whose name and text are exactly the manuscript's. A
// test reassembles every block and requires it to match the source paragraph.
//
// What is deliberately NOT learner content:
//   * "Video to curate" lines — producer briefs, kept as `videoBrief`;
//   * Parts X–XIII (video curation, sales copy, product spec, internal notes).
//
// Pure: no I/O, no database. scripts/academy/import-course.ts does the I/O.

export type Block =
  | { type: 'h'; level: 2 | 3; text: string }
  | { type: 'p'; text: string }
  | { type: 'ol' | 'ul'; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'labeled'; kind: LabeledKind; label: string; text: string }
  | { type: 'look_for'; label: string; text: string; lookFor: string; mistakes: Array<{ mistake: string; response: string; responseLabel: string }> }
  | { type: 'drill'; label: string; name: string; text: string; equipment: string | null; success: string | null }
  | { type: 'safety'; label: string; text: string }

export type LabeledKind =
  | 'teaching' | 'teach' | 'cue' | 'coach_corner' | 'ready' | 'checkpoint' | 'note'

export interface ParsedModule {
  key: string
  position: number
  title: string
  subtitle: string | null
  outcome: string | null
}

export interface ParsedLesson {
  key: string
  kind: 'intro' | 'lesson' | 'resource'
  moduleKey: string | null
  position: number
  numberLabel: string | null
  title: string
  isPreview: boolean
  blocks: Block[]
  fieldTest: string | null
  videoBrief: string | null
  estMinutes: number
  sourceText: string
}

export interface EditorialFlag {
  lessonKey: string | null
  flag: string
  detail: string
}

export interface ParsedCourse {
  slug: string
  title: string
  subtitle: string
  modules: ParsedModule[]
  lessons: ParsedLesson[]
  flags: EditorialFlag[]
  safetyText: string | null
}

const LABELS: Array<[RegExp, LabeledKind]> = [
  [/^\*\*What you are teaching\.\*\*\s*/, 'teaching'],
  [/^\*\*Teach it\.\*\*\s*/, 'teach'],
  [/^\*\*Player cue:\*\*\s*/, 'cue'],
  [/^\*\*Coach's corner:\*\*\s*/, 'coach_corner'],
  [/^\*\*Ready to move on when:\*\*\s*/, 'ready'],
  [/^\*\*Course completion checkpoint:\*\*\s*/, 'checkpoint'],
]

const stripBold = (s: string) => s.replace(/^\*\*|\*\*$/g, '').replace(/[.:]$/, '')

/** Paragraphs, keeping tables and lists as single units. */
export function paragraphs(md: string): string[] {
  return md.replace(/\r\n/g, '\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
}

function wordCount(s: string): number {
  return (s.match(/[A-Za-z0-9’'–-]+/g) || []).length
}

/** One paragraph of lesson or resource text → one block. */
export function toBlock(para: string): Block | { type: 'video_brief'; text: string } | { type: 'field_test'; text: string } | null {
  if (/^-{3,}$/.test(para)) return null
  if (/^\*\*Video to curate:\*\*/.test(para)) return { type: 'video_brief', text: para.replace(/^\*\*Video to curate:\*\*\s*/, '') }
  if (/^\*\*MODULE \d+ FIELD TEST:\*\*/.test(para)) return { type: 'field_test', text: para.replace(/^\*\*MODULE \d+ FIELD TEST:\*\*\s*/, '') }
  const h = /^(#{2,3})\s+(.*)$/.exec(para)
  if (h && !para.includes('\n')) return { type: 'h', level: h[1].length as 2 | 3, text: h[2] }
  if (para.startsWith('|')) {
    const lines = para.split('\n').filter(l => l.trim().startsWith('|'))
    const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim())
    const body = lines.filter((_, i) => i !== 1 || !/^\|?[\s:|-]+\|?$/.test(lines[1]))
    return { type: 'table', header: cells(body[0]), rows: body.slice(1).map(cells) }
  }
  if (/^\d+\.\s/.test(para)) return { type: 'ol', items: para.split('\n').map(l => l.replace(/^\d+\.\s+/, '').trim()) }
  if (/^[-*]\s/.test(para) && !/^\*\*/.test(para)) return { type: 'ul', items: para.split('\n').map(l => l.replace(/^[-*]\s+/, '').trim()) }
  if (/^\*\*Safety:\*\*/.test(para)) return { type: 'safety', label: 'Safety', text: para.replace(/^\*\*Safety:\*\*\s*/, '') }
  for (const [re, kind] of LABELS) {
    const m = re.exec(para)
    if (m) return { type: 'labeled', kind, label: stripBold(m[0].trim()), text: para.slice(m[0].length) }
  }
  const drill = /^\*\*(Drill [A-Z]) — ([^*]+?)\.\*\*\s*/.exec(para)
  if (drill) {
    const text = para.slice(drill[0].length)
    const equipment = /^Equipment:\s*(.+?)\.(?:\s|$)/.exec(text)
    const success = /\*\*Success:\*\*\s*(.*)$/.exec(text)
    return { type: 'drill', label: drill[1], name: drill[2], text, equipment: equipment ? equipment[1] : null, success: success ? success[1] : null }
  }
  const look = /^\*\*Look for:\*\*\s*/.exec(para)
  if (look) {
    const text = para.slice(look[0].length)
    const parts = text.split(/\s*\*\*Common mistake:\*\*\s*/)
    const mistakes = parts.slice(1).map(seg => {
      const r = /\s*\*\*(Coach response|Response):\*\*\s*/.exec(seg)
      return r
        ? { mistake: seg.slice(0, r.index), response: seg.slice(r.index + r[0].length), responseLabel: r[1] }
        : { mistake: seg, response: '', responseLabel: 'Response' }
    })
    return { type: 'look_for', label: 'Look for', text, lookFor: parts[0], mistakes }
  }
  return { type: 'p', text: para }
}

/** Rebuild the manuscript paragraph from a block (for the verbatim test). */
export function blockSource(b: Block): string {
  switch (b.type) {
    case 'h': return `${'#'.repeat(b.level)} ${b.text}`
    case 'p': return b.text
    case 'ol': return b.items.map((t, i) => `${i + 1}. ${t}`).join('\n')
    case 'ul': return b.items.map(t => `- ${t}`).join('\n')
    case 'table': return [`| ${b.header.join(' | ')} |`, `|${b.header.map(() => '---').join('|')}|`, ...b.rows.map(r => `| ${r.join(' | ')} |`)].join('\n')
    case 'safety': return `**Safety:** ${b.text}`
    case 'labeled': {
      const punct = b.kind === 'teaching' || b.kind === 'teach' ? '.' : ':'
      return `**${b.label}${punct}** ${b.text}`
    }
    case 'look_for': return `**Look for:** ${b.text}`
    case 'drill': return `**${b.label} — ${b.name}.** ${b.text}`
  }
}

const SMALL = new Set(['a', 'an', 'and', 'the', 'of', 'to', 'in', 'on', 'for', 'at', 'by', 'or'])
/** "TIMING, DECISIONS AND GAME TRANSFER" → "Timing, Decisions and Game Transfer". Case only. */
export function titleCase(s: string): string {
  return s.toLowerCase().split(' ').map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ')
}

function slugKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

interface Section { level: number; heading: string; body: string[] }

/** Split by #/##/### headings, keeping each heading's paragraphs. */
function sections(md: string): Section[] {
  const out: Section[] = []
  let cur: Section = { level: 0, heading: '', body: [] }
  for (const para of paragraphs(md)) {
    const lines = para.split('\n')
    // A paragraph can open with several heading lines (e.g. "# PART II" + "## Grip...").
    let rest = [...lines]
    while (rest.length && /^#{1,3}\s/.test(rest[0])) {
      out.push(cur)
      const m = /^(#{1,3})\s+(.*)$/.exec(rest[0])!
      cur = { level: m[1].length, heading: m[2].trim(), body: [] }
      rest = rest.slice(1)
    }
    if (rest.length) cur.body.push(rest.join('\n'))
  }
  out.push(cur)
  return out.filter(s => s.heading || s.body.length)
}

const EXCLUDED_PART = /^PART (X|XI|XII|XIII) —/

export interface ParseOptions {
  slug: string
  previewLessonKey: string
}

export function parseManuscript(md: string, opts: ParseOptions): ParsedCourse {
  const secs = sections(md)
  const titleLines = secs.filter(s => s.level === 1).map(s => s.heading)
  // "# BENCHCOACH ACADEMY" then "# Build a Better Baseball Swing: From Grip to Game Day"
  const full = titleLines.find(t => /:/.test(t) && !/^PART /.test(t)) || titleLines[1] || 'Course'
  const [title, subtitle = ''] = full.split(/:\s*/, 2)

  const modules: ParsedModule[] = []
  const lessons: ParsedLesson[] = []
  const flags: EditorialFlag[] = []
  let safetyText: string | null = null

  let part = ''
  let moduleKey: string | null = null
  let pendingModule: ParsedModule | null = null
  let current: ParsedLesson | null = null
  let position = 0
  let resourceGroup: ParsedLesson | null = null

  const startLesson = (l: Omit<ParsedLesson, 'position' | 'blocks' | 'fieldTest' | 'videoBrief' | 'estMinutes' | 'sourceText' | 'isPreview'>) => {
    current = { ...l, position: ++position, blocks: [], fieldTest: null, videoBrief: null, estMinutes: 1, sourceText: '', isPreview: l.key === opts.previewLessonKey }
    lessons.push(current)
    return current
  }
  const addBody = (lesson: ParsedLesson, body: string[]) => {
    for (const para of body) {
      const b = toBlock(para)
      if (!b) continue
      if (b.type === 'video_brief') { lesson.videoBrief = b.text; continue }
      if (b.type === 'field_test') {
        // Belongs to the module; shown at the end of its last lesson.
        lesson.fieldTest = b.text
        continue
      }
      lesson.blocks.push(b)
      lesson.sourceText += (lesson.sourceText ? '\n\n' : '') + para
      if (b.type === 'safety') safetyText = b.text
    }
  }

  for (const s of secs) {
    if (s.level === 1) {
      part = s.heading
      current = null
      resourceGroup = null
      if (/^PART [IVX]+ — MODULE (\d+):/.test(part)) {
        const n = Number(/MODULE (\d+)/.exec(part)![1])
        moduleKey = `module-${n}`
        pendingModule = { key: moduleKey, position: n, title: titleCase(part.replace(/^PART [IVX]+ — MODULE \d+:\s*/, '')), subtitle: null, outcome: null }
        modules.push(pendingModule)
      } else {
        moduleKey = null
        pendingModule = null
      }
      // The troubleshooting guide is a table directly under its PART heading.
      if (/^PART IX —/.test(part)) {
        const l = startLesson({ key: 'troubleshooting', kind: 'resource', moduleKey: null, numberLabel: null, title: 'Coaching troubleshooting guide' })
        addBody(l, s.body)
      }
      continue
    }
    if (EXCLUDED_PART.test(part) || !part.startsWith('PART ')) continue

    if (/^PART I —/.test(part) && s.level === 2) {
      const key = /^Welcome/.test(s.heading) ? 'welcome'
        : /^How to use/.test(s.heading) ? 'how-to-use'
        : /^Starting assessment/.test(s.heading) ? 'starting-assessment'
        : slugKey(s.heading)
      const l = startLesson({ key, kind: 'intro', moduleKey: null, numberLabel: null, title: s.heading })
      addBody(l, s.body)
      continue
    }

    if (pendingModule && s.level === 2) {
      // "## Grip, stance and posture" + "**Module outcome:** ..."
      pendingModule.subtitle = s.heading
      for (const para of s.body) {
        const m = /^\*\*Module outcome:\*\*\s*([\s\S]*)$/.exec(para)
        if (m) pendingModule.outcome = m[1]
      }
      continue
    }
    if (moduleKey && s.level === 3) {
      const m = /^Lesson (\d+)\.(\d+) — (.*)$/.exec(s.heading)
      if (!m) { flags.push({ lessonKey: null, flag: 'unrecognised_heading', detail: s.heading }); continue }
      const l = startLesson({ key: `${m[1]}-${m[2]}`, kind: 'lesson', moduleKey, numberLabel: `${m[1]}.${m[2]}`, title: m[3] })
      addBody(l, s.body)
      continue
    }

    // Resources: Part VIII (four-week program, session card) and IX (troubleshooting).
    if (/^PART VIII —/.test(part)) {
      if (s.level === 2 && /^One-page session card/.test(s.heading)) {
        const l = startLesson({ key: 'session-card', kind: 'resource', moduleKey: null, numberLabel: null, title: s.heading })
        addBody(l, s.body)
        resourceGroup = null
        continue
      }
      if (!resourceGroup) {
        resourceGroup = startLesson({ key: 'four-week-program', kind: 'resource', moduleKey: null, numberLabel: null, title: 'Four-week development program' })
      }
      resourceGroup.blocks.push({ type: 'h', level: s.level === 2 ? 2 : 3, text: s.heading })
      addBody(resourceGroup, s.body)
      continue
    }
    if (/^PART IX —/.test(part)) {
      const l = lessons.find(x => x.key === 'troubleshooting')!
      l.blocks.push({ type: 'h', level: s.level === 2 ? 2 : 3, text: s.heading })
      addBody(l, s.body)
      continue
    }
  }

  // Field tests sit at the end of each module; attach to its last lesson.
  for (const m of modules) {
    const inModule = lessons.filter(l => l.moduleKey === m.key)
    const withTest = inModule.find(l => l.fieldTest)
    const last = inModule[inModule.length - 1]
    if (withTest && last && withTest !== last) { last.fieldTest = withTest.fieldTest; withTest.fieldTest = null }
    if (!inModule.length) flags.push({ lessonKey: null, flag: 'empty_module', detail: m.title })
    if (!inModule.some(l => l.fieldTest)) flags.push({ lessonKey: last?.key || null, flag: 'missing_field_test', detail: `${m.title} has no field test` })
  }

  for (const l of lessons) {
    const words = l.blocks.reduce((n, b) => n + wordCount(JSON.stringify(b)), 0) + wordCount(l.fieldTest || '')
    l.estMinutes = Math.max(1, Math.min(120, Math.round(words / 200)))
    if (l.kind === 'lesson') {
      if (!l.videoBrief) flags.push({ lessonKey: l.key, flag: 'missing_video_brief', detail: `Lesson ${l.numberLabel} has no "Video to curate" brief.` })
      flags.push({ lessonKey: l.key, flag: 'video_not_approved', detail: `No approved demonstration video for lesson ${l.numberLabel}; learners see the written lesson only.` })
      const drills = l.blocks.filter(b => b.type === 'drill').length
      if (drills === 0) flags.push({ lessonKey: l.key, flag: 'no_drills', detail: `Lesson ${l.numberLabel} has no drills.` })
      for (const kind of ['teaching', 'teach', 'cue', 'coach_corner', 'ready'] as LabeledKind[]) {
        if (!l.blocks.some(b => b.type === 'labeled' && b.kind === kind)) flags.push({ lessonKey: l.key, flag: `missing_${kind}`, detail: `Lesson ${l.numberLabel} has no ${kind.replace('_', ' ')} section.` })
      }
      if (!l.blocks.some(b => b.type === 'look_for')) flags.push({ lessonKey: l.key, flag: 'missing_look_for', detail: `Lesson ${l.numberLabel} has no "Look for" section.` })
    }
  }
  if (!lessons.some(l => l.isPreview)) flags.push({ lessonKey: opts.previewLessonKey, flag: 'preview_missing', detail: 'The free-preview lesson was not found.' })

  return { slug: opts.slug, title: title.trim(), subtitle: subtitle.trim(), modules, lessons, flags, safetyText }
}
