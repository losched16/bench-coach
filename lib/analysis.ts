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
