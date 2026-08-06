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

  const fields: Array<[string, number]> = [
    [(drill.common_flaws_fixed || []).join(' '), 4],
    [(drill.mechanic_focus || []).join(' '), 3],
    [drill.drill_name || '', 3],
    [drill.skill_category || '', 2],
    [drill.description || '', 1],
    [drill.ai_coaching_notes || '', 1],
  ]

  let score = 0
  const counted = new Set<string>()
  for (const [text, weight] of fields) {
    for (const t of Array.from(new Set(tokens(text).map(stem)))) {
      if (!want.has(t)) continue
      // Each distinct term contributes once at its best weight
      const key = t
      if (counted.has(key)) continue
      counted.add(key)
      score += weight
    }
  }
  return score
}
