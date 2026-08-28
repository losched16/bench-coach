// The structured half of an SEO page.
//
// These pages started as articles: a title, an intro, and a list of prose
// sections. That shape is fine for reading and useless for doing. A coach
// standing on a field with a phone does not want to read eight paragraphs to
// find out that the first fifteen minutes are throwing progressions — they
// want the timeline, the equipment list, and the drill they are about to run.
//
// So a page can now carry a `resource` block alongside its prose. The block
// holds the things that were always in the article but trapped in sentences:
// the schedule, the drills, the equipment, the metadata. The prose stays
// exactly where it is and renders underneath.
//
// EVERYTHING HERE IS OPTIONAL, and that is the whole design. A page without a
// resource block renders precisely as it did before this file existed. That
// matters more than it sounds: this system is going live on four pages out of
// roughly eighty, several of which already rank, and "the other seventy-six
// are untouched" needs to be a structural guarantee rather than a promise
// about how carefully the rollout was done.
//
// The same reasoning applies inside a block. A drill with no "harder
// variation" renders without one; it does not render an empty heading, and
// nothing here invents a value to fill a field. The source of truth is what
// the coach actually wrote.

export type ResourceKind =
  | 'practice-plan'
  | 'drill-library'
  | 'age-hub'
  | 'problem'

/**
 * One drill, in the shape the app can render, print, and eventually hand to
 * the practice generator.
 *
 * Deliberately close to `drill_resources` (the in-app drill library) without
 * being welded to it. The long-term goal is one drill existing once and
 * feeding the SEO page, the AI coach, and the practice builder alike — but a
 * drill written into an article years before that table existed should not
 * have to be migrated into it just to render as a card today.
 */
export interface SeoDrill {
  /** Anchor target and future join key. Slugified from the name when absent. */
  slug?: string
  name: string
  /** The problem this fixes, in the author's words. Drives the "Best For" column. */
  bestFor?: string
  duration?: string
  players?: string
  equipment?: string[]
  /** Free text — "balance", "swing path", "tracking". Groups the jump nav. */
  skill?: string
  setup?: string
  instructions?: string[]
  coachingCues?: string[]
  commonMistakes?: string[]
  easierVariation?: string
  harderVariation?: string
  relatedDrills?: string[]
}

/**
 * A row of the practice schedule.
 *
 * `from`/`to` are minutes from the start of practice, which is what makes the
 * timeline computable — durations, totals, and a check that the parts add up
 * to the whole. `time` is the label to print when the author wrote something
 * a range cannot express.
 */
export interface TimelineRow {
  from?: number
  to?: number
  time?: string
  activity: string
  focus?: string
  /** Links the row to a drill in the same page's `drills`. */
  drill?: string
}

/** Guidance for a specific roster size, when the source content supports it. */
export interface RosterVariant {
  players: string
  guidance: string
}

export interface ResourceBlock {
  kind: ResourceKind
  /** The metadata strip: Age, Practice Length, Players, Coaches, Skill Level. */
  meta?: Array<{ label: string; value: string }>
  objective?: string
  equipment?: string[]
  setup?: string[]
  timeline?: TimelineRow[]
  drills?: SeoDrill[]
  rosterVariants?: RosterVariant[]
  /** Observable symptoms, for a problem page. */
  symptoms?: string[]
}

const KINDS: ResourceKind[] = ['practice-plan', 'drill-library', 'age-hub', 'problem']

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t : undefined
}

function strList(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const out = v.map(str).filter((s): s is string => !!s)
  return out.length ? out : undefined
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : undefined
}

/**
 * URL-safe id for a drill, used as the anchor the jump nav targets.
 *
 * Derived from the name rather than required, so a page can be converted
 * without inventing identifiers — but stored `slug` always wins, because a
 * renamed drill must not silently break every link pointing at it.
 */
export function drillSlug(d: Pick<SeoDrill, 'slug' | 'name'>): string {
  const raw = d.slug || d.name || ''
  return raw
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function readDrill(raw: any): SeoDrill | null {
  const name = str(raw?.name)
  if (!name) return null
  return {
    slug: str(raw.slug),
    name,
    bestFor: str(raw.bestFor),
    duration: str(raw.duration),
    players: str(raw.players),
    equipment: strList(raw.equipment),
    skill: str(raw.skill),
    setup: str(raw.setup),
    instructions: strList(raw.instructions),
    coachingCues: strList(raw.coachingCues),
    commonMistakes: strList(raw.commonMistakes),
    easierVariation: str(raw.easierVariation),
    harderVariation: str(raw.harderVariation),
    relatedDrills: strList(raw.relatedDrills),
  }
}

function readRow(raw: any): TimelineRow | null {
  const activity = str(raw?.activity)
  if (!activity) return null
  return {
    from: num(raw.from),
    to: num(raw.to),
    time: str(raw.time),
    activity,
    focus: str(raw.focus),
    drill: str(raw.drill),
  }
}

/**
 * Pull a usable resource block out of a page's stored content, or null.
 *
 * Everything is validated on the way through and anything malformed is
 * dropped rather than rendered. A half-written block should degrade to the
 * article it was, not to a page of empty headings — these URLs are ranking,
 * and a broken render costs more than a missing feature.
 */
export function readResource(content: any): ResourceBlock | null {
  const raw = content?.resource
  if (!raw || typeof raw !== 'object') return null
  if (!KINDS.includes(raw.kind)) return null

  const meta = Array.isArray(raw.meta)
    ? raw.meta
        .map((m: any) => {
          const label = str(m?.label)
          const value = str(m?.value)
          return label && value ? { label, value } : null
        })
        .filter(Boolean) as Array<{ label: string; value: string }>
    : undefined

  const timeline = Array.isArray(raw.timeline)
    ? (raw.timeline.map(readRow).filter(Boolean) as TimelineRow[])
    : undefined

  const drills = Array.isArray(raw.drills)
    ? (raw.drills.map(readDrill).filter(Boolean) as SeoDrill[])
    : undefined

  const rosterVariants = Array.isArray(raw.rosterVariants)
    ? (raw.rosterVariants
        .map((v: any) => {
          const players = str(v?.players)
          const guidance = str(v?.guidance)
          return players && guidance ? { players, guidance } : null
        })
        .filter(Boolean) as RosterVariant[])
    : undefined

  const block: ResourceBlock = {
    kind: raw.kind,
    meta: meta?.length ? meta : undefined,
    objective: str(raw.objective),
    equipment: strList(raw.equipment),
    setup: strList(raw.setup),
    timeline: timeline?.length ? timeline : undefined,
    drills: drills?.length ? drills : undefined,
    rosterVariants: rosterVariants?.length ? rosterVariants : undefined,
    symptoms: strList(raw.symptoms),
  }

  // A block that carries nothing is not a block. Returning null here is what
  // keeps `{"resource": {"kind": "practice-plan"}}` from rendering a header
  // over an empty page.
  const hasContent =
    block.meta || block.objective || block.equipment || block.setup ||
    block.timeline || block.drills || block.rosterVariants || block.symptoms
  return hasContent ? block : null
}

/** "0–10" / "10–25", or the author's own label when they wrote one. */
export function rowTimeLabel(row: TimelineRow): string {
  if (row.time) return row.time
  if (row.from === undefined) return ''
  if (row.to === undefined) return `${row.from}+`
  return `${row.from}–${row.to}`
}

/** Minutes a row occupies, when it can be known. */
export function rowMinutes(row: TimelineRow): number | null {
  if (row.from === undefined || row.to === undefined) return null
  const d = row.to - row.from
  return d > 0 ? d : null
}

/**
 * Total scheduled minutes, or null when the rows are not all computable.
 *
 * Null rather than a partial sum on purpose: "45 minutes" printed under a
 * 60-minute practice plan because two rows were free-text is worse than
 * printing nothing.
 */
export function totalMinutes(timeline?: TimelineRow[]): number | null {
  if (!timeline?.length) return null
  let sum = 0
  for (const row of timeline) {
    const m = rowMinutes(row)
    if (m === null) return null
    sum += m
  }
  return sum || null
}

/**
 * Every distinct piece of equipment the drills call for.
 *
 * Folded case-insensitively so "Baseballs" and "baseballs" are one line on
 * the checklist. An explicit `equipment` list on the block wins outright —
 * that is the author saying what to bring, and it may well include something
 * no single drill mentions.
 */
export function equipmentChecklist(block: ResourceBlock): string[] {
  if (block.equipment?.length) return block.equipment
  const seen = new Map<string, string>()
  for (const d of block.drills || []) {
    for (const item of d.equipment || []) {
      const key = item.toLowerCase().trim()
      if (!seen.has(key)) seen.set(key, item)
    }
  }
  return Array.from(seen.values())
}

/**
 * The skill groupings present in this page's drills, in first-appearance
 * order, for the jump navigation.
 *
 * Only categories that genuinely have drills under them — the nav is built
 * from the data, so it cannot advertise a section the page does not have.
 */
export function drillCategories(drills?: SeoDrill[]): Array<{ skill: string; drills: SeoDrill[] }> {
  if (!drills?.length) return []
  const groups = new Map<string, { skill: string; drills: SeoDrill[] }>()
  for (const d of drills) {
    const skill = d.skill?.trim()
    if (!skill) continue
    const key = skill.toLowerCase()
    if (!groups.has(key)) groups.set(key, { skill, drills: [] })
    groups.get(key)!.drills.push(d)
  }
  return Array.from(groups.values())
}

/** True when the drill has enough detail to be worth a full section. */
export function isDetailed(d: SeoDrill): boolean {
  return !!(
    d.setup ||
    d.instructions?.length ||
    d.coachingCues?.length ||
    d.commonMistakes?.length ||
    d.easierVariation ||
    d.harderVariation
  )
}

export function resourceHref(category: string, slug: string): string {
  return `/${category}/${slug}`
}

export const SITE_ORIGIN = 'https://www.mybenchcoach.com'
