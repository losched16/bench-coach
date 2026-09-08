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

/**
 * Does this entry belong to a team this coach tracks?
 *
 * Joined rather than trusted from the request, for the same reason every other
 * scouting route does it: the client sends an entry id, and an id is a guess
 * until the server has checked whose it is.
 */
async function entryBelongsToCoach(entryId: string, coachId: string) {
  const { data } = await supabaseAdmin
    .from('scouting_entries')
    .select('id, opponent_team:opponent_teams(id, coach_id)')
    .eq('id', entryId)
    .single()
  if (!data || (data as any).opponent_team?.coach_id !== coachId) return null
  return data
}

/**
 * PUT: edit what the coach wrote about a logged game.
 *
 * WHY THIS EXISTS
 *
 * The analysis treats entry notes as the qualitative half of the evidence, and
 * the code that assembles the prompt says so plainly — "usually the better
 * half". But until now `notes` could only be set in the second it took to
 * confirm an upload, and never again.
 *
 * That is backwards. The note worth having is the one a coach thinks of on the
 * drive home: they sat their best pitcher, the field was a swamp, we never saw
 * their real lineup. A box score cannot record any of that and the upload
 * moment is the worst time to ask for it.
 *
 * WHAT IS DELIBERATELY NOT EDITABLE
 *
 * The parsed stat lines. Those came from a screenshot and already have two
 * honest ways to change: re-parse the images, or delete the entry and log it
 * again. Hand-editing a batting line here would make the numbers untraceable
 * to the source they claim to come from — the coach could no longer tell which
 * figures the app read and which it was told.
 *
 * So: the three fields a person authored or a parser could have got wrong
 * about the GAME rather than the PLAYERS — the note, the date, the tournament.
 *
 * The analysis regenerating is not this route's job. `trg_scouting_entry_marks_stale`
 * already fires on UPDATE of this table and marks the report stale, which the
 * detail page surfaces as "New evidence since this" next to an Update button.
 * The coach decides when to spend the model call.
 */
export async function PUT(request: NextRequest) {
  const denied = await guard(request, 'record', { needs: 'teamFeatures' })
  if (denied) return denied

  try {
    const { coachId, entryId, updates } = await request.json()
    if (!coachId || !entryId) {
      return NextResponse.json({ error: 'coachId and entryId required' }, { status: 400 })
    }

    const entry = await entryBelongsToCoach(entryId, coachId)
    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    const allowed: Record<string, any> = {}
    for (const key of ['notes', 'occurred_on', 'tournament_name']) {
      if (updates?.[key] === undefined) continue
      const v = updates[key]
      // Empty string is the textarea's way of saying "I cleared this", which
      // is a real intention and must reach the column as NULL rather than as
      // an empty string that reads as a note nobody wrote.
      allowed[key] = typeof v === 'string' && v.trim() === '' ? null : v
    }

    if (Object.keys(allowed).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    // A date the parser misread is worth fixing; a date nobody can parse is
    // not worth storing. Rejected rather than coerced, because guessing here
    // would file the game against the wrong day silently.
    if (allowed.occurred_on != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(allowed.occurred_on))) {
      return NextResponse.json({ error: 'occurred_on must be YYYY-MM-DD' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('scouting_entries')
      .update(allowed)
      .eq('id', entryId)

    if (error) throw error
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Scouting entry PUT error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
