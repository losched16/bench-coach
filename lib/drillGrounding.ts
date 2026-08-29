// Did the answer stay inside the library?
//
// The prompt tells the model to name only drills from the shortlist it was
// given. That instruction is worth having and it is not a control — nothing
// checked, and a fabricated video id renders as a dead embed while a
// fabricated drill name sends a coach searching for something that does not
// exist. Either one costs more trust than the answer earned.
//
// So the reply is read afterwards and compared against the candidates. What
// this finds is reported, and — for video links, where the damage is concrete
// and the fix is unambiguous — repaired.
//
// WHAT THIS DELIBERATELY DOES NOT DO
//
// It does not require every answer to contain a drill. Most good coaching
// answers do not: what to say to the kid, what to stop doing, what is normal
// at this age. Grounding is about library claims, not about forcing a
// recommendation.
//
// It also does not rewrite prose. A model that describes a legitimate
// technique ("have him hit off a high tee") is giving coaching advice, and
// that is allowed — the line is drawn at presenting something as a BenchCoach
// library drill, which in practice means a video link or a bolded name that
// does not exist.

export interface GroundingCandidate {
  id: string
  drill_name: string
  youtube_video_id?: string | null
  youtube_url?: string | null
}

export interface GroundingReport {
  ok: boolean
  /** YouTube ids in the reply that were not in the candidate set. */
  unknownVideoIds: string[]
  /** Bolded names that look like library drills but match no candidate. */
  unknownDrillNames: string[]
  /** Candidate drills the answer actually used. */
  citedDrillIds: string[]
}

// Eleven characters of the YouTube id alphabet, the standard shape.
const YT_IN_URL = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([A-Za-z0-9_-]{11})/g
// **Bolded Drill Name** — how the coach voice presents a drill.
const BOLDED = /\*\*([^*\n]{3,80})\*\*/g

function normalize(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Does this bolded phrase claim to be a library drill?
 *
 * Only phrases ending in a drill-ish noun are considered. The coach voice
 * bolds plenty of things that are not drills — **two hands**, **step toward
 * your target** — and treating those as fabricated library entries would flag
 * every good answer.
 */
const DRILLY = /\b(drill|progression|routine|circuit|series|work|toss|game)\b\s*$/i

export function checkGrounding(
  reply: string,
  candidates: GroundingCandidate[]
): GroundingReport {
  const text = String(reply || '')

  const knownVideos = new Set(
    candidates.map(c => c.youtube_video_id).filter(Boolean) as string[]
  )
  const knownNames = new Map(candidates.map(c => [normalize(c.drill_name), c.id]))

  const unknownVideoIds: string[] = []
  const citedDrillIds = new Set<string>()

  for (const m of Array.from(text.matchAll(YT_IN_URL))) {
    const id = m[1]
    if (knownVideos.has(id)) {
      const hit = candidates.find(c => c.youtube_video_id === id)
      if (hit) citedDrillIds.add(hit.id)
    } else if (!unknownVideoIds.includes(id)) {
      unknownVideoIds.push(id)
    }
  }

  const unknownDrillNames: string[] = []
  for (const m of Array.from(text.matchAll(BOLDED))) {
    const phrase = m[1].trim()
    if (!DRILLY.test(phrase)) continue
    const key = normalize(phrase)
    const exact = knownNames.get(key)
    if (exact) { citedDrillIds.add(exact); continue }
    // A candidate whose name contains the phrase, or vice versa — "High Tee"
    // for "High Tee Drill — Hitting Up in the Zone" is a citation, not an
    // invention.
    const loose = candidates.find(c => {
      const n = normalize(c.drill_name)
      return n.includes(key) || key.includes(n)
    })
    if (loose) { citedDrillIds.add(loose.id); continue }
    if (!unknownDrillNames.includes(phrase)) unknownDrillNames.push(phrase)
  }

  return {
    ok: unknownVideoIds.length === 0 && unknownDrillNames.length === 0,
    unknownVideoIds,
    unknownDrillNames,
    citedDrillIds: Array.from(citedDrillIds),
  }
}

/**
 * Remove links to videos that are not in the candidate set.
 *
 * Only the URL is stripped, and the sentence around it is left alone. The
 * surrounding advice is usually fine — the model has simply attached a video
 * it invented to a real coaching point, and a dead link is worse than no link.
 *
 * A bare markdown link becomes its own text; a naked URL disappears. Nothing
 * else is touched, because rewriting an answer to enforce a rule tends to
 * produce something worse than the problem it fixed.
 */
export function stripUngroundedVideos(reply: string, report: GroundingReport): string {
  if (report.unknownVideoIds.length === 0) return reply
  let out = reply
  for (const id of report.unknownVideoIds) {
    const url = new RegExp(
      `\\[([^\\]]*)\\]\\((?:https?:)?\\/\\/[^)\\s]*${id}[^)\\s]*\\)`, 'g'
    )
    out = out.replace(url, '$1')
    const naked = new RegExp(
      `\\s*\\(?(?:https?:)?\\/\\/[^\\s)]*${id}[^\\s)]*\\)?`, 'g'
    )
    out = out.replace(naked, '')
  }
  // Tidy the punctuation a removed link tends to leave behind.
  return out.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,;:])/g, '$1')
}
