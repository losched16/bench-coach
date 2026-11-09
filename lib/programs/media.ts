// Videos for program drills, taken from the drill library and nowhere else.
//
//   * A library drill shows its own video, looked up BY ID at read time (never
//     copied into a program), so a repaired or replaced library link flows
//     through, and a drill with no video simply has none.
//   * A built-in exercise (warm-ups, strength, balance, shadow work) is not in
//     the library. Where the library has a clearly related video — same skill
//     area, strong name overlap — it is offered as "related", labelled as such.
//     Warm-ups, cool-downs and anything to do with throwing readiness are never
//     matched: a loosely related arm video is not worth the risk.
//
// No URL is ever generated here: every field comes from a drill_resources row.

import { scoreDrillRelevance } from '../analysis'
import { DRILL_FIELDS, schedulableDrills, visibleDrills, type DrillRecord } from '../drills'
import { hasVideo } from '../drillVideo'
import { EXERCISE_BY_KEY } from './exercises'
import { SKILLS } from './skills'
import type { ProgramDraft, SkillKey } from './types'

const MEDIA_FIELDS = 'id, drill_name, youtube_video_id, youtube_url, youtube_start_seconds, thumbnail_url, channel'
/** Name-overlap score a library drill needs before it counts as related. */
export const RELATED_MIN_SCORE = 6

export interface MediaRow {
  id: string; drill_name: string; youtube_video_id?: string | null; youtube_url?: string | null
  youtube_start_seconds?: number | null; thumbnail_url?: string | null; channel?: string | null
}
export interface MediaResult {
  /** drill id → video fields, for library drills and for related matches. */
  drillMedia: Record<string, MediaRow>
  /** exercise key → the library drill whose video is offered as related. */
  related: Record<string, { drillId: string; name: string }>
}

export interface BuiltinRef { key: string; name: string; skill: SkillKey }

/** Built-in exercises a related video may be offered for. */
export function matchable(rows: Array<{ exerciseKey: string | null; name: string; skill: SkillKey | string | null }>): BuiltinRef[] {
  const seen = new Map<string, BuiltinRef>()
  for (const r of rows) {
    const ex = r.exerciseKey ? EXERCISE_BY_KEY[r.exerciseKey] : null
    if (!ex || ex.kind === 'warmup' || ex.kind === 'cooldown' || ex.kind === 'throwing') continue
    if (!seen.has(ex.key)) seen.set(ex.key, { key: ex.key, name: ex.name, skill: ex.skill })
  }
  return Array.from(seen.values())
}

/** Pure: the best related library video for each built-in exercise, or none. */
export function matchRelatedVideos(builtins: BuiltinRef[], pool: DrillRecord[]): Record<string, DrillRecord> {
  const out: Record<string, DrillRecord> = {}
  const withVideo = pool.filter(d => hasVideo(d as any))
  for (const b of builtins) {
    const def = SKILLS[b.skill]
    let best: { d: DrillRecord; score: number } | null = null
    for (const d of withVideo) {
      if (!def.categoryPattern.test(String(d.skill_category || d.primary_skill || ''))) continue
      const score = scoreDrillRelevance(b.name, d as any)
      if (score < RELATED_MIN_SCORE) continue
      if (!best || score > best.score || (score === best.score && String(d.id) < String(best.d.id))) best = { d, score }
    }
    if (best) out[b.key] = best.d
  }
  return out
}

export function drillRows(draftOrSessions: Pick<ProgramDraft, 'sessions'> | { sessions: Array<{ blocks: Array<{ drills: any[] }> }> }) {
  return (draftOrSessions.sessions as any[]).flatMap(s => s.blocks.flatMap((b: any) => b.drills)) as Array<{ drillId: string | null; exerciseKey: string | null; name: string; skill: any }>
}

export async function resolveMedia(
  db: any, coachId: string, rows: Array<{ drillId: string | null; exerciseKey: string | null; name: string; skill: any }>,
): Promise<MediaResult> {
  const ids = Array.from(new Set(rows.map(r => r.drillId).filter((x): x is string => !!x)))
  const drillMedia: Record<string, MediaRow> = {}
  if (ids.length) {
    // visibleDrills, not a bare read: a coach's private drill resolves only for their own team.
    const { data } = await visibleDrills(db, coachId, MEDIA_FIELDS).in('id', ids)
    for (const d of (data || []) as MediaRow[]) drillMedia[d.id] = d
  }
  const related: MediaResult['related'] = {}
  const builtins = matchable(rows)
  if (builtins.length) {
    const { data } = await schedulableDrills(db, coachId, DRILL_FIELDS).limit(500)
    const matches = matchRelatedVideos(builtins, (data || []) as DrillRecord[])
    for (const [key, d] of Object.entries(matches)) {
      related[key] = { drillId: d.id, name: d.drill_name }
      drillMedia[d.id] = {
        id: d.id, drill_name: d.drill_name, youtube_video_id: d.youtube_video_id, youtube_url: d.youtube_url,
        youtube_start_seconds: d.youtube_start_seconds, thumbnail_url: d.thumbnail_url, channel: d.channel,
      }
    }
  }
  return { drillMedia, related }
}
