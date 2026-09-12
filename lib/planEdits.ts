// Editing a practice, as operations on PlanBlock[].
//
// WHY THESE ARE HERE AND NOT IN THE COMPONENT
//
// The builder has to reorder, duplicate, delete, retime, replace and group
// blocks, and every one of those is a rule about the plan rather than about the
// screen. Written inline they become nine `setBlocks(blocks.map(...))` calls
// that each get the edge cases slightly differently — and the edge cases are
// where practices break: a station parent whose minutes stop matching its
// rotation, a replace that silently changes a block's length, a move that
// renumbers everything except the times beside it.
//
// Every function here is pure and returns a new array. Nothing mutates, so a
// caller can always keep the previous version for undo, and nothing does I/O.
//
// THE ONE PIECE OF REAL ARITHMETIC
//
// A station group's `minutes` is ELAPSED time, not the sum of its stations.
// Three stations of eight minutes is a 24-minute block on the clock plus the
// seams between rotations, and every kid does all three. Modelled as three
// sequential blocks it reads as 72 and the scheduler throws two away. That rule
// lives in stationElapsedMinutes and everything that touches a station group
// goes through it.

import { PlanBlock, isStationGroup } from './practicePlan'

/** A block is addressed by its index; a station by its parent's index and its own. */
export type BlockRef = { block: number; station?: number }

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

const inRange = (blocks: PlanBlock[], i: number) =>
  Number.isInteger(i) && i >= 0 && i < (blocks?.length || 0)

/**
 * Elapsed minutes for a rotation of N stations at M minutes each.
 *
 * Every group visits every station, so the practice spends one rotation per
 * station — not the sum of the stations — plus a minute of changeover between
 * them. This is the number that goes on the parent block and on the clock.
 */
export function stationElapsedMinutes(rotationMinutes: number, stationCount: number): number {
  const rot = Math.max(0, Math.round(Number(rotationMinutes) || 0))
  const n = Math.max(0, Math.round(Number(stationCount) || 0))
  if (rot === 0 || n === 0) return 0
  return rot * n + Math.max(0, n - 1)
}

/** The rotation length implied by an elapsed budget across N stations. */
export function rotationFromElapsed(elapsedMinutes: number, stationCount: number): number {
  const n = Math.max(1, Math.round(Number(stationCount) || 0))
  const usable = Math.max(0, (Number(elapsedMinutes) || 0) - Math.max(0, n - 1))
  return Math.max(1, Math.floor(usable / n))
}

/** Total elapsed minutes the plan asks for. */
export function totalMinutes(blocks: PlanBlock[]): number {
  return (blocks || []).reduce((sum, b) => sum + (Number(b?.minutes) || 0), 0)
}

/**
 * Move a block, keeping every other block's relative order.
 *
 * Out-of-range indices return the array untouched rather than throwing: a drag
 * that ends outside the list is a cancelled drag, not an error.
 */
export function moveBlock(blocks: PlanBlock[], from: number, to: number): PlanBlock[] {
  if (!inRange(blocks, from)) return blocks
  const target = Math.max(0, Math.min(blocks.length - 1, Math.round(to)))
  if (target === from) return blocks
  const next = [...blocks]
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

/**
 * Copy a block in directly after itself.
 *
 * Deep-copied, so editing the copy cannot reach back into the original — a
 * shallow copy shares the stations array and the cues, and a coach who
 * duplicated a rotation to vary it would find both changing together.
 */
export function duplicateBlock(blocks: PlanBlock[], i: number): PlanBlock[] {
  if (!inRange(blocks, i)) return blocks
  const copy = clone(blocks[i])
  return [...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)]
}

export function removeBlock(blocks: PlanBlock[], i: number): PlanBlock[] {
  if (!inRange(blocks, i)) return blocks
  return blocks.filter((_, n) => n !== i)
}

/**
 * Set a block's elapsed minutes.
 *
 * On a station group the rotation is re-derived so the parent and its children
 * keep telling the same story. Stretching a 24-minute rotation to 30 without
 * this leaves three stations still claiming eight minutes each, and the printed
 * sheet and the clock disagree in front of a coach holding it.
 */
export function setBlockMinutes(blocks: PlanBlock[], i: number, minutes: number): PlanBlock[] {
  if (!inRange(blocks, i)) return blocks
  const mins = Math.max(1, Math.round(Number(minutes) || 0))
  const b = blocks[i]

  if (!isStationGroup(b)) {
    return blocks.map((x, n) => n === i ? { ...x, minutes: mins } : x)
  }

  const stations = b.stations as PlanBlock[]
  const rotation = rotationFromElapsed(mins, stations.length)
  return blocks.map((x, n) => n === i ? {
    ...x,
    minutes: mins,
    rotation_minutes: rotation,
    stations: stations.map(s => ({ ...s, minutes: rotation })),
  } : x)
}

/**
 * Put a different activity in this slot.
 *
 * Position is preserved by construction. Duration is preserved by default
 * because the coach built a clock around this slot, not around this drill —
 * swapping a drill should not silently move everything after it. A replacement
 * that genuinely needs different time can say so with keepMinutes: false.
 */
export function replaceBlock(
  blocks: PlanBlock[],
  i: number,
  next: PlanBlock,
  opts: { keepMinutes?: boolean } = {}
): PlanBlock[] {
  if (!inRange(blocks, i)) return blocks
  const keep = opts.keepMinutes !== false
  const current = blocks[i]
  const replacement: PlanBlock = {
    ...clone(next),
    minutes: keep ? (Number(current.minutes) || Number(next.minutes) || 10) : (Number(next.minutes) || 10),
  }
  return blocks.map((x, n) => n === i ? replacement : x)
}

/**
 * Swap one station inside a rotation, leaving the other stations alone.
 *
 * The child keeps the rotation's minutes rather than the replacement's: a
 * station's length is a property of the rotation it sits in, not of the drill
 * standing at it.
 */
export function replaceStation(
  blocks: PlanBlock[],
  i: number,
  stationIndex: number,
  next: PlanBlock
): PlanBlock[] {
  if (!inRange(blocks, i)) return blocks
  const parent = blocks[i]
  if (!isStationGroup(parent)) return blocks
  const stations = parent.stations as PlanBlock[]
  if (!inRange(stations, stationIndex)) return blocks

  const rotation = Number(parent.rotation_minutes) || Number(stations[stationIndex]?.minutes) || 0
  const replacement: PlanBlock = { ...clone(next), minutes: rotation || Number(next.minutes) || 0 }

  return blocks.map((x, n) => n === i ? {
    ...x,
    stations: stations.map((s, si) => si === stationIndex ? replacement : s),
  } : x)
}

/** Insert a block, defaulting to the end. */
export function insertBlock(blocks: PlanBlock[], block: PlanBlock, at?: number): PlanBlock[] {
  const list = blocks || []
  const pos = at == null ? list.length : Math.max(0, Math.min(list.length, Math.round(at)))
  return [...list.slice(0, pos), clone(block), ...list.slice(pos)]
}

/** A timeline block built from a drill-library row. */
export function blockFromDrill(drill: any, minutes = 10): PlanBlock {
  return {
    type: 'drill',
    title: drill?.drill_name || 'Drill',
    drill_name: drill?.drill_name || undefined,
    minutes: Math.max(1, Math.round(Number(minutes) || 10)),
    description: drill?.description || '',
    equipment: Array.isArray(drill?.equipment_needed) ? drill.equipment_needed : [],
    coaching_cues: drill?.ai_coaching_notes ? [drill.ai_coaching_notes] : [],
    ...(drill?.youtube_video_id ? { youtube_video_id: drill.youtube_video_id } : {}),
    ...(drill?.channel ? { youtube_channel: drill.channel } : {}),
    ...(drill?.youtube_start_seconds ? { youtube_start_seconds: drill.youtube_start_seconds } : {}),
  }
}

/** A block a coach wrote themselves. */
export function customActivityBlock(input: {
  title?: string; minutes?: number; type?: string; description?: string
}): PlanBlock {
  return {
    type: input.type || 'drill',
    title: (input.title || '').trim() || 'Untitled activity',
    minutes: Math.max(1, Math.round(Number(input.minutes) || 10)),
    description: (input.description || '').trim(),
  }
}

/**
 * Turn activities into one rotation.
 *
 * Deliberately explicit — never inferred from two blocks being dragged near
 * each other. A station group changes what the plan CLAIMS about the practice:
 * that the squad splits, that every group sees every station, and that the
 * elapsed time is one rotation rather than the sum. Creating that by accident
 * would silently rewrite the shape of a coach's evening.
 */
export function makeStationGroup(
  children: PlanBlock[],
  opts: { rotationMinutes?: number; groups?: number; title?: string } = {}
): PlanBlock {
  const stations = (children || []).filter(Boolean).map(c => clone(c))
  const rotation = Math.max(1, Math.round(
    Number(opts.rotationMinutes) || Number(stations[0]?.minutes) || 8
  ))
  return {
    type: 'station',
    title: opts.title || `${stations.length}-Station Rotation`,
    minutes: stationElapsedMinutes(rotation, stations.length),
    groups: Math.max(2, Math.round(Number(opts.groups) || stations.length)),
    rotation_minutes: rotation,
    stations: stations.map(s => ({ ...s, minutes: rotation })),
  }
}

/** Pull a rotation apart into the sequential blocks it was made of. */
export function ungroupStations(blocks: PlanBlock[], i: number): PlanBlock[] {
  if (!inRange(blocks, i)) return blocks
  const parent = blocks[i]
  if (!isStationGroup(parent)) return blocks
  const rotation = Number(parent.rotation_minutes) || 0
  const children = (parent.stations as PlanBlock[]).map(s => ({
    ...clone(s),
    type: s.type || 'drill',
    minutes: Number(s.minutes) || rotation || 10,
  }))
  return [...blocks.slice(0, i), ...children, ...blocks.slice(i + 1)]
}

/** Add one station to an existing rotation, keeping the elapsed time honest. */
export function addStation(blocks: PlanBlock[], i: number, station: PlanBlock): PlanBlock[] {
  if (!inRange(blocks, i)) return blocks
  const parent = blocks[i]
  if (!isStationGroup(parent)) return blocks
  const stations = [...(parent.stations as PlanBlock[])]
  const rotation = Number(parent.rotation_minutes) || Number(stations[0]?.minutes) || 8
  stations.push({ ...clone(station), minutes: rotation })
  return blocks.map((x, n) => n === i ? {
    ...x,
    stations,
    groups: Math.max(Number(x.groups) || 0, stations.length),
    minutes: stationElapsedMinutes(rotation, stations.length),
  } : x)
}

/**
 * Remove one station. A rotation of one is not a rotation, so dropping to a
 * single station collapses the group back to an ordinary block rather than
 * leaving a "1-Station Rotation" on the sheet.
 */
export function removeStation(blocks: PlanBlock[], i: number, stationIndex: number): PlanBlock[] {
  if (!inRange(blocks, i)) return blocks
  const parent = blocks[i]
  if (!isStationGroup(parent)) return blocks
  const stations = (parent.stations as PlanBlock[]).filter((_, si) => si !== stationIndex)
  const rotation = Number(parent.rotation_minutes) || 8

  if (stations.length <= 1) {
    const only = stations[0]
    if (!only) return removeBlock(blocks, i)
    return blocks.map((x, n) => n === i
      ? { ...clone(only), type: only.type || 'drill', minutes: Number(x.minutes) || rotation }
      : x)
  }

  return blocks.map((x, n) => n === i ? {
    ...x,
    stations,
    groups: Math.min(Number(x.groups) || stations.length, stations.length),
    minutes: stationElapsedMinutes(rotation, stations.length),
  } : x)
}
