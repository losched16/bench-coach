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

// A problem that is developmentally normal at this age gets reassurance, not
// a drill plan. Telling a parent "that's normal at 7, leave it alone" is an
// answer no free drill app gives them.
export function doNotCoachApplies(
  problem: { do_not_coach_flag?: boolean | null; age_relevance?: string[] | null } | null,
  playerAge?: number
): boolean {
  if (!problem?.do_not_coach_flag || !playerAge) return false
  const relevant = problem.age_relevance || []
  if (relevant.length === 0) return false
  // age_relevance lists the age groups where coaching it IS appropriate
  const ageNum = Number(playerAge)
  const lowestCoachable = relevant
    .map(a => parseInt(String(a).replace(/\D/g, ''), 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b)[0]
  return typeof lowestCoachable === 'number' && ageNum < lowestCoachable
}
