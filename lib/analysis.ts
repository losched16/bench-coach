// Parsing helpers for the written analysis. Kept out of the route so they can
// be unit-tested and reused by the check-in view, which re-reads a saved
// prescription's markdown.

export interface AnalysisSection {
  key: string
  heading: string
  body: string
}

const SECTION_HEADINGS = [
  'What the data showed',
  'The one thing',
  'This week',
  'Drills',
  'What to watch next',
  'Metrics',
] as const

export function splitSections(markdown: string): AnalysisSection[] {
  const sections: AnalysisSection[] = []
  // Split on H2s the model was asked to emit
  const parts = markdown.split(/^##\s+/m).filter(p => p.trim())
  for (const part of parts) {
    const nl = part.indexOf('\n')
    const heading = (nl === -1 ? part : part.slice(0, nl)).trim()
    const body = (nl === -1 ? '' : part.slice(nl + 1)).trim()
    if (!heading) continue
    const canonical = SECTION_HEADINGS.find(
      h => heading.toLowerCase().startsWith(h.toLowerCase())
    )
    sections.push({
      key: (canonical || heading).toLowerCase().replace(/[^a-z]+/g, '_'),
      heading: canonical || heading,
      body,
    })
  }
  return sections
}

// Age-sensitive problems still get a plan — the note shapes HOW we prescribe,
// not whether we do. A coach who asks for a fix wants a fix; an extreme
// uppercut at 7 compounds if ignored. But the method that works at 7 is not
// the method that works at 12, and this is where we say so.
//
// Returns the guidance when the player is younger than the age range where
// the standard approach applies. Null means prescribe normally.
export function ageGuidanceFor(
  problem: { do_not_coach_flag?: boolean | null; do_not_coach_note?: string | null; age_relevance?: string[] | null } | null,
  playerAge?: number
): string | null {
  if (!problem?.do_not_coach_flag || !problem.do_not_coach_note || !playerAge) return null
  const relevant = problem.age_relevance || []
  if (relevant.length === 0) return null
  const lowestStandard = relevant
    .map(a => parseInt(String(a).replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b)[0]
  if (typeof lowestStandard !== 'number') return null
  return Number(playerAge) < lowestStandard ? problem.do_not_coach_note : null
}

// ── Fallback drill relevance ───────────────────────────
// The problem taxonomy is an accelerator, not a gate. Plenty of real coaching
// questions ("how do I add velocity", "he's scared of the ball at the plate")
// are goals or descriptions rather than catalogued flaws, and the engine must
// still answer them. When taxonomy mapping comes up short we score the drill
// library directly against the coach's words.

const STOPWORDS = new Set([
  'the','a','an','and','or','but','is','are','was','were','be','been','being','to','of','in','on',
  'at','for','with','how','do','i','my','he','she','they','him','her','his','get','got','can','cant',
  "can't",'we','it','that','this','has','have','him','more','most','very','really','just','some','any',
  'about','from','when','what','why','need','needs','help','fix','work','working','better','improve',
])

function tokens(text: string): string[] {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t))
}

// Light stemming so "pitching"/"pitch" and "throwing"/"throw" collide
function stem(t: string): string {
  return t.replace(/(ing|ed|es|s)$/, '')
}

export interface ScorableDrill {
  drill_name?: string | null
  description?: string | null
  skill_category?: string | null
  mechanic_focus?: string[] | null
  common_flaws_fixed?: string[] | null
  ai_coaching_notes?: string | null
}

// Weighted so an explicit "fixes this flaw" tag counts for more than an
// incidental word in a description.
export function scoreDrillRelevance(complaint: string, drill: ScorableDrill): number {
  const want = new Set(tokens(complaint).map(stem))
  if (want.size === 0) return 0

  // skill_category is deliberately absent. It is already the filter, so
  // counting it again gives every drill in the category a free passing score
  // — which is how a changeup-grip video ended up recommended for a velocity
  // question: it matched the word "pitching" and nothing else.
  const substantive: Array<[string, number]> = [
    [(drill.common_flaws_fixed || []).join(' '), 4],
    [(drill.mechanic_focus || []).join(' '), 3],
    [drill.drill_name || '', 3],
  ]
  const supporting: Array<[string, number]> = [
    [drill.description || '', 1],
    [drill.ai_coaching_notes || '', 1],
  ]

  let score = 0
  let substantiveHits = 0
  const counted = new Set<string>()

  for (const [text, weight] of substantive) {
    for (const t of Array.from(new Set(tokens(text).map(stem)))) {
      if (!want.has(t) || counted.has(t)) continue
      counted.add(t)
      score += weight
      substantiveHits++
    }
  }
  for (const [text, weight] of supporting) {
    for (const t of Array.from(new Set(tokens(text).map(stem)))) {
      if (!want.has(t) || counted.has(t)) continue
      counted.add(t)
      score += weight
    }
  }

  // A hit in a description alone is not enough to prescribe something. The
  // drill has to claim it addresses this, or be named for it.
  return substantiveHits > 0 ? score : 0
}

// Marks the end of the streamed markdown and the start of the JSON tail
// (drills, prescription id). Shared so the client splits on the same token.
export const META_SENTINEL = '\n<<<BENCHCOACH_META>>>'

// ---------------------------------------------------------------------------
// Copying a report out of the app
// ---------------------------------------------------------------------------
//
// A scouting report gets shared. It goes in a team doc, an email to the other
// coaches, a note the manager reads on Friday. Copying the rendered page picks
// up Tailwind classes, a streaming cursor and a Collapse button; copying the
// raw markdown pastes literal ** and # into Google Docs.
//
// So the report is converted to plain semantic HTML — h1/h2, p, ul/ol, strong
// — which is exactly what Docs, Word and Gmail read off the clipboard and
// re-style as their own headings and lists. No classes, no inline CSS: the
// destination document should win on appearance, and it will.
//
// The block rules deliberately mirror components/AnalysisProse.tsx. If those
// two disagree, the paste stops looking like the screen, which is the one
// thing this has to get right.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** **bold** — the only inline mark the analysis prompt produces. */
function inlineToHtml(text: string): string {
  return escapeHtml(text).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

/** One section's body: paragraphs, bullets and numbered lists. */
export function bodyToHtml(body: string): string {
  const out: string[] = []
  let buffer: string[] = []
  let mode: 'p' | 'ul' | 'ol' | null = null

  const flush = () => {
    if (!buffer.length || !mode) { buffer = []; mode = null; return }
    if (mode === 'p') {
      out.push(...buffer.map(t => `<p>${inlineToHtml(t)}</p>`))
    } else {
      const tag = mode
      out.push(
        `<${tag}>` + buffer.map(t => `<li>${inlineToHtml(t)}</li>`).join('') + `</${tag}>`
      )
    }
    buffer = []
    mode = null
  }

  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line) { flush(); continue }
    const bullet = line.match(/^[-*]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    if (bullet) {
      if (mode !== 'ul') flush()
      mode = 'ul'
      buffer.push(bullet[1])
    } else if (numbered) {
      if (mode !== 'ol') flush()
      mode = 'ol'
      buffer.push(numbered[1])
    } else {
      if (mode !== 'p') flush()
      mode = 'p'
      // Wrapped lines are one paragraph, same as on screen.
      if (buffer.length) buffer[buffer.length - 1] += ' ' + line
      else buffer.push(line)
    }
  }
  flush()
  return out.join('')
}

export interface ReportMeta {
  title: string
  /** e.g. "Written 11 Aug 2026 from 6 entries · 84 plate appearances" */
  subtitle?: string | null
  /** The one-line summary, when the report has one. */
  headline?: string | null
  whatsChanged?: string | null
}

/**
 * The whole report as pasteable HTML.
 *
 * Ordered the way somebody reads it in a document: title, provenance, the
 * headline, then the sections. The provenance line matters most here of
 * anywhere — once this is in a Google Doc it has left the app, and a reader
 * three weeks later has no other way to know how old it is or how much was
 * behind it.
 */
export function reportToHtml(markdown: string, meta: ReportMeta): string {
  const parts: string[] = [`<h1>${escapeHtml(meta.title)}</h1>`]
  if (meta.subtitle) parts.push(`<p><em>${escapeHtml(meta.subtitle)}</em></p>`)
  if (meta.headline) parts.push(`<p><strong>${inlineToHtml(meta.headline)}</strong></p>`)
  if (meta.whatsChanged) {
    parts.push(`<h2>What&rsquo;s changed</h2><p>${inlineToHtml(meta.whatsChanged)}</p>`)
  }
  for (const section of splitSections(markdown)) {
    parts.push(`<h2>${escapeHtml(section.heading)}</h2>`)
    const body = bodyToHtml(section.body)
    if (body) parts.push(body)
  }
  return parts.join('\n')
}

/**
 * The same report as plain text, for anywhere that cannot take HTML.
 *
 * Not the raw markdown: ** and ## are noise in a text box. Headings become
 * their own lines and bullets stay bullets, which is what somebody pasting
 * into a text message or a scoreboard app actually wants.
 */
export function reportToPlainText(markdown: string, meta: ReportMeta): string {
  const lines: string[] = [meta.title]
  if (meta.subtitle) lines.push(meta.subtitle)
  lines.push('')
  if (meta.headline) { lines.push(meta.headline.replace(/\*\*/g, '')); lines.push('') }
  if (meta.whatsChanged) {
    lines.push("WHAT'S CHANGED", meta.whatsChanged.replace(/\*\*/g, ''), '')
  }
  for (const section of splitSections(markdown)) {
    lines.push(section.heading.toUpperCase())
    for (const raw of section.body.split('\n')) {
      const line = raw.trim()
      if (!line) { lines.push(''); continue }
      lines.push(line.replace(/^[-*]\s+/, '• ').replace(/\*\*/g, ''))
    }
    lines.push('')
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
