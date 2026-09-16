// Media attached to a drill — and the one thing every surface has to agree on:
// the activity is the product, the media supports it.
//
// WHAT THIS IS FOR
//
// A drill used to have exactly one video, spelled across five columns on the
// drill row itself. drill_media_resources (migration 062) makes that one-to-many
// so an activity can carry a second camera angle, a reel, a diagram or an
// article. This module is the only thing that reads either shape.
//
// THE ROLLOUT RULE
//
// The legacy youtube_* columns are still populated and still authoritative for
// any drill with no media rows. Every reader here falls back to them, so a
// database where the backfill has not run behaves exactly as it does today.
// The columns are NOT dropped; a migration whose failure mode is a coach's
// video link going dead is not one to run casually.
//
// WHAT THIS MODULE WILL NOT DO
//
// It will not invent a timestamp. 205 of the 208 curated drills carry a video
// and NONE carries a start time. Writing 0 for those would convert "nobody has
// said where in this video the drill is" into "this drill starts at the first
// frame", which for a twelve-minute compilation is a confident wrong answer.
// null stays null all the way to the surface, and the surface says nothing.

import { watchUrl, thumbnailUrl, videoIdFor, parseVideoId, VideoDrill } from './drillVideo'

export type MediaType = 'youtube' | 'instagram' | 'article' | 'illustration' | 'animation'
export type VerificationStatus = 'unverified' | 'verified' | 'rejected'

export interface DrillMedia {
  id?: string
  drill_id: string
  media_type: MediaType
  provider?: string | null
  external_id?: string | null
  url: string
  title?: string | null
  source_name?: string | null
  thumbnail_url?: string | null
  start_seconds?: number | null
  end_seconds?: number | null
  start_source?: string | null
  is_primary?: boolean | null
  verification_status?: VerificationStatus | null
  notes?: string | null
}

/** What a surface actually renders: a link, a label, and maybe a picture. */
export interface PlayableMedia {
  media_type: MediaType
  /** Ready to open. For YouTube this already carries the time parameter. */
  url: string
  title: string | null
  source_name: string | null
  thumbnail_url: string | null
  /** null means nobody has said. It is never 0-as-unknown. */
  start_seconds: number | null
  verification_status: VerificationStatus
  /** True when this came from the legacy youtube_* columns, not a media row. */
  legacy: boolean
}

// ── loading ─────────────────────────────────────────────────────────────────

/**
 * Media for many drills in one round trip, grouped by drill id.
 *
 * One query for the whole set rather than one per drill: retrieval already
 * loads the entire library and ranks it in memory, and a per-drill lookup here
 * would be the N+1 that shape exists to avoid.
 *
 * A database without migration 062 has no such table, and a missing table
 * should cost a coach an extra camera angle, not their practice plan. So the
 * error is swallowed and every drill comes back with no media — at which point
 * every caller falls through to the legacy columns and behaves as it does today.
 */
export async function loadMediaFor(
  supabase: any,
  drillIds: Array<string | null | undefined>
): Promise<Map<string, DrillMedia[]>> {
  const out = new Map<string, DrillMedia[]>()
  const ids = Array.from(new Set(drillIds.filter(Boolean).map(String)))
  if (ids.length === 0) return out

  try {
    const { data, error } = await supabase
      .from('drill_media_resources')
      .select('id, drill_id, media_type, provider, external_id, url, title, ' +
              'source_name, thumbnail_url, start_seconds, end_seconds, ' +
              'start_source, is_primary, verification_status, notes')
      .in('drill_id', ids)
    if (error) throw error

    for (const row of (data || []) as DrillMedia[]) {
      const list = out.get(row.drill_id) || []
      list.push(row)
      out.set(row.drill_id, list)
    }
  } catch {
    return out
  }

  return out
}

/**
 * Every media row, for a surface that has to know how videos are SHARED.
 *
 * 219 rows — smaller than one page of drills — so pulling the table is cheaper
 * than the alternative, which is asking per video how many drills it backs.
 *
 * Needed because "is this a compilation?" is not a property of one drill's
 * media row. It is a property of the table, and a surface that only loaded its
 * own rows would have to either guess or promise.
 */
export async function loadAllMedia(supabase: any): Promise<DrillMedia[]> {
  try {
    const { data, error } = await supabase
      .from('drill_media_resources')
      .select('id, drill_id, media_type, provider, external_id, url, title, ' +
              'source_name, thumbnail_url, start_seconds, end_seconds, ' +
              'start_source, is_primary, verification_status, notes')
    if (error) throw error
    return (data || []) as DrillMedia[]
  } catch {
    // A missing table costs a coach an extra camera angle, not their library.
    return []
  }
}

/** Group loaded media rows by drill, the shape every renderer wants. */
export function groupByDrill(media: DrillMedia[] | null | undefined): Map<string, DrillMedia[]> {
  const out = new Map<string, DrillMedia[]>()
  for (const row of media || []) {
    const list = out.get(row.drill_id) || []
    list.push(row)
    out.set(row.drill_id, list)
  }
  return out
}

// ── choosing ────────────────────────────────────────────────────────────────

const TYPE_RANK: Record<string, number> = {
  youtube: 0, instagram: 1, animation: 2, illustration: 3, article: 4,
}

const VERIFY_RANK: Record<string, number> = { verified: 0, unverified: 1, rejected: 2 }

/**
 * Which media a surface shows when it shows one.
 *
 * Deterministic, and that word is doing work: this decides what a coach sees on
 * a printed practice sheet. If it depended on row order, the same plan printed
 * twice could carry two different links, and the coach would be right to stop
 * trusting the sheet.
 *
 * The order of preference:
 *   1. is_primary, because somebody chose it
 *   2. verified over unverified over rejected
 *   3. a moving demonstration over a still over an article
 *   4. the one with a timestamp, which lands on the drill rather than the top
 *   5. id, so a tie is still stable
 *
 * A rejected link is returned only when it is the only thing there. A drill
 * whose single video has been rejected is a drill with a known-bad link, and
 * showing it is worse than showing nothing.
 */
export function pickPrimary(media: DrillMedia[] | null | undefined): DrillMedia | null {
  const list = (media || []).filter(m => m && String(m.url || '').trim())
  if (list.length === 0) return null

  const usable = list.filter(m => m.verification_status !== 'rejected')
  if (usable.length === 0) return null

  return usable.slice().sort((a, b) =>
    Number(!!b.is_primary) - Number(!!a.is_primary) ||
    (VERIFY_RANK[String(a.verification_status || 'unverified')] ?? 1) -
    (VERIFY_RANK[String(b.verification_status || 'unverified')] ?? 1) ||
    (TYPE_RANK[String(a.media_type)] ?? 9) - (TYPE_RANK[String(b.media_type)] ?? 9) ||
    Number(b.start_seconds != null) - Number(a.start_seconds != null) ||
    String(a.id || '').localeCompare(String(b.id || ''))
  )[0]
}

// ── rendering ───────────────────────────────────────────────────────────────

/**
 * One media row turned into something a surface can put on screen.
 *
 * YouTube goes through lib/drillVideo.watchUrl rather than building a URL here,
 * so there is exactly one place in this codebase that knows how to stamp a time
 * parameter onto a YouTube link — and the rule that a URL with two `t=` values
 * silently honours the first stays learned once.
 *
 * Every other type is a URL somebody stored, used as stored. There is nothing
 * to normalize about an article link and inventing a transformation would only
 * be a way to break it.
 */
export function toPlayable(m: DrillMedia | null | undefined): PlayableMedia | null {
  if (!m || !String(m.url || '').trim()) return null

  const start = m.start_seconds == null ? null : Number(m.start_seconds)

  const url = m.media_type === 'youtube'
    ? watchUrl({
        youtube_video_id: m.external_id,
        youtube_url: m.url,
        // watchUrl treats 0 and null alike (it stamps no time for either), so
        // passing the raw value through cannot turn unknown into a claim.
        youtube_start_seconds: start,
      }) || m.url
    : m.url

  return {
    media_type: m.media_type,
    url,
    title: m.title ?? null,
    source_name: m.source_name ?? null,
    thumbnail_url: m.thumbnail_url ?? null,
    start_seconds: start,
    verification_status: (m.verification_status as VerificationStatus) || 'unverified',
    legacy: false,
  }
}

/**
 * The legacy youtube_* columns as a PlayableMedia, for a drill with no media
 * rows yet.
 *
 * This is what keeps Player Reports, the practice sheet and the drill library
 * rendering a working link on a database where the backfill has not run — and
 * on any coach-authored drill, which the backfill does not touch.
 */
export function legacyPlayable(drill: VideoDrill | null | undefined): PlayableMedia | null {
  const url = watchUrl(drill)
  if (!url) return null

  const raw = drill?.youtube_start_seconds
  return {
    media_type: 'youtube',
    url,
    title: null,
    source_name: (drill as any)?.channel ?? null,
    thumbnail_url: thumbnailUrl(drill) ?? null,
    // 0 in this column means the same as absent — no curation has happened —
    // and the whole library sits at null today. Reporting 0 would let a surface
    // print "starts at 0:00" as though somebody had checked.
    start_seconds: raw == null || Number(raw) <= 0 ? null : Number(raw),
    verification_status: 'unverified',
    legacy: true,
  }
}

/**
 * Everything a surface can offer for one drill, best first, legacy included
 * only when there is nothing else.
 *
 * The legacy fallback is skipped when media rows exist AND one of them already
 * points at the same video, which is what the backfill produces — otherwise
 * every backfilled drill would show its one video twice.
 */
export function mediaForDrill(
  drill: VideoDrill & { id?: string },
  media: DrillMedia[] | null | undefined
): PlayableMedia[] {
  const rows = (media || []).filter(m => m.verification_status !== 'rejected')

  // Computed once. Whatever pickPrimary chooses leads the list, so "the first
  // item" and "the primary" cannot disagree — and the rest fall in behind it by
  // the same type order.
  const primary = pickPrimary(rows)

  const playable = rows
    .slice()
    .sort((a, b) =>
      Number(!!primary && b === primary) - Number(!!primary && a === primary) ||
      (TYPE_RANK[String(a.media_type)] ?? 9) - (TYPE_RANK[String(b.media_type)] ?? 9) ||
      String(a.id || '').localeCompare(String(b.id || ''))
    )
    .map(toPlayable)
    .filter((p): p is PlayableMedia => p !== null)

  const legacy = legacyPlayable(drill)
  if (!legacy) return playable

  const legacyId = videoIdFor(drill)
  const alreadyThere = rows.some(m =>
    (legacyId && m.external_id === legacyId) || m.url === drill?.youtube_url
  )

  return alreadyThere ? playable : [...playable, legacy]
}

/** The single link a surface shows when it has room for one. */
export function primaryMediaFor(
  drill: VideoDrill & { id?: string },
  media: DrillMedia[] | null | undefined
): PlayableMedia | null {
  return mediaForDrill(drill, media)[0] ?? null
}

/**
 * How many drills each video backs, keyed the way pickPrimary keys them.
 *
 * This is the number that decides whether a surface may say "watch this drill".
 * 69 of the 154 schedulable activities point at a video that also backs another
 * drill — those are compilations, and with no timestamp a coach who taps one
 * lands at 0:00 of something covering ten drills. A surface cannot tell that
 * from the media row alone; it needs the whole table.
 *
 * Counted across EVERY row, not just the schedulable ones. A video shared with
 * a demoted teaching-content row is exactly as much of a compilation as one
 * shared with an activity — the demotion changed what we offer, not what is in
 * the video.
 */
export function sharedVideoCounts(media: DrillMedia[] | null | undefined): Map<string, number> {
  const drillsPerVideo = new Map<string, Set<string>>()
  for (const m of media || []) {
    const key = m.external_id || m.url
    if (!key) continue
    const set = drillsPerVideo.get(key) || new Set<string>()
    set.add(m.drill_id)
    drillsPerVideo.set(key, set)
  }

  const out = new Map<string, number>()
  drillsPerVideo.forEach((set, key) => out.set(key, set.size))
  return out
}

/**
 * How many drills the video behind this playable backs, including this one.
 *
 * Falls back to 1 — "nothing says otherwise" — rather than to 0, because the
 * caller uses this to decide how cautious to be, and an unknown video is not
 * evidence of a single-drill resource.
 */
export function sharedCountFor(
  m: PlayableMedia | null | undefined,
  counts: Map<string, number> | null | undefined
): number {
  if (!m || !counts) return 1
  // watchUrl may have stamped a time parameter on, so match on the id first.
  const id = m.media_type === 'youtube' ? parseVideoId(m.url) : null
  return (id && counts.get(id)) || counts.get(m.url) || 1
}

/** A drill with no media at all is a valid drill. Two of the 208 are exactly that. */
export function hasAnyMedia(
  drill: VideoDrill & { id?: string },
  media: DrillMedia[] | null | undefined
): boolean {
  return mediaForDrill(drill, media).length > 0
}
