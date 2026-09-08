import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guard } from '@/lib/authz'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/** The stat keys a coach can correct, and what each one is. */
const BATTING_KEYS = ['ab', 'h', 'bb', 'k', 'rbi', 'r'] as const
const PITCHING_KEYS = ['ip', 'h', 'r', 'er', 'bb', 'k'] as const

/**
 * A stat is a whole non-negative number, except innings, which are the one
 * genuinely fractional figure in a box score — 1.2 means one and two thirds.
 *
 * Returns undefined for anything unusable rather than coercing it, because a
 * silently-zeroed hit is the failure this whole route exists to repair.
 */
function statValue(raw: any, key: string): number | null | undefined {
  if (raw === null || raw === '') return null
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(n) || n < 0) return undefined
  if (key === 'ip') return Math.round(n * 10) / 10
  return Number.isInteger(n) ? n : undefined
}

function cleanLine(input: any, keys: readonly string[]): { line: Record<string, number> | null; bad: string[] } {
  if (input == null) return { line: null, bad: [] }
  const line: Record<string, number> = {}
  const bad: string[] = []
  for (const key of keys) {
    const v = statValue(input[key], key)
    if (v === undefined) { bad.push(key); continue }
    if (v !== null) line[key] = v
  }
  return { line: Object.keys(line).length ? line : null, bad }
}

/**
 * Does this appearance belong to a team this coach tracks?
 *
 * Joined rather than trusted from the request. An appearance id is a guess
 * until the server has checked whose it is.
 */
async function appearanceBelongsToCoach(appearanceId: string, coachId: string) {
  const { data } = await supabaseAdmin
    .from('opponent_appearances')
    .select('id, opponent_player:opponent_players(id, opponent_team:opponent_teams(id, coach_id))')
    .eq('id', appearanceId)
    .single()
  const owner = (data as any)?.opponent_player?.opponent_team?.coach_id
  if (!data || owner !== coachId) return null
  return data
}

/**
 * PUT: correct one player's line for one game.
 *
 * WHY THIS EXISTS
 *
 * The parser reads a screenshot, and screenshots get scrolled, cropped and
 * misread. This is not hypothetical: in a logged 8U game the GameChanger recap
 * stored alongside the parse says "Teddy H, Rodrick G, Greyson, Charlie L,
 * Lucas, and Wes B each collected one hit" — six players — and the parsed lines
 * credit four. Two hits were dropped, and one of those players then read 0-for-8
 * across the season on a page his coach was using to decide a line-up.
 *
 * Until now the only repairs available were re-parse (same screenshots, likely
 * the same misreading) and delete (throws away the other twenty players' lines
 * to fix one). Neither is what a coach wants at 9pm holding the paper book that
 * says otherwise.
 *
 * PER GAME, NOT PER SEASON
 *
 * The season line is derived by aggregating appearances, so it is deliberately
 * not writable. Editing a total would leave it disagreeing with the games it is
 * supposedly the sum of, and no later re-parse could reconcile them. Fixing the
 * game that is wrong keeps the arithmetic honest and survives a re-parse of any
 * other entry.
 *
 * The report regenerates on the coach's schedule: trg_appearance_marks_stale
 * already fires on UPDATE here and flips the scouting report to "New evidence
 * since this" with an Update button next to it.
 */
export async function PUT(request: NextRequest) {
  const denied = await guard(request, 'record', { needs: 'teamFeatures' })
  if (denied) return denied

  try {
    const { coachId, appearanceId, batting, pitching, pitchesThrown } = await request.json()
    if (!coachId || !appearanceId) {
      return NextResponse.json({ error: 'coachId and appearanceId required' }, { status: 400 })
    }

    const appearance = await appearanceBelongsToCoach(appearanceId, coachId)
    if (!appearance) {
      return NextResponse.json({ error: 'Appearance not found' }, { status: 404 })
    }

    const updates: Record<string, any> = {}
    const rejected: string[] = []

    if (batting !== undefined) {
      const { line, bad } = cleanLine(batting, BATTING_KEYS)
      rejected.push(...bad.map(k => `batting.${k}`))
      updates.batting_line = line
    }

    if (pitching !== undefined) {
      const { line, bad } = cleanLine(pitching, PITCHING_KEYS)
      rejected.push(...bad.map(k => `pitching.${k}`))
      updates.pitching_line = line
      // Innings are what the availability board counts outings by, so the
      // column and the line must not be allowed to disagree.
      updates.innings_pitched = line?.ip ?? null
    }

    if (pitchesThrown !== undefined) {
      const v = statValue(pitchesThrown, 'pitches_thrown')
      if (v === undefined) rejected.push('pitchesThrown')
      else updates.pitches_thrown = v
    }

    if (rejected.length > 0) {
      return NextResponse.json(
        { error: `Whole numbers only (innings may be like 1.2): ${rejected.join(', ')}` },
        { status: 400 }
      )
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    // A batter cannot have more hits than at-bats. Caught here because the
    // number that follows a coach around is the average, and h > ab produces
    // one above 1.000 that looks like a bug in the app rather than a typo.
    const b = updates.batting_line
    if (b && typeof b.h === 'number' && typeof b.ab === 'number' && b.h > b.ab) {
      return NextResponse.json(
        { error: `${b.h} hits in ${b.ab} at-bats. Walks and sacrifices are not at-bats, but a hit always is.` },
        { status: 400 }
      )
    }

    const { error } = await supabaseAdmin
      .from('opponent_appearances')
      .update(updates)
      .eq('id', appearanceId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Scouting appearance PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
