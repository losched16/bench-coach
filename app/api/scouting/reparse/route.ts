import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { guard } from '@/lib/authz'

// Read an already-logged entry's screenshots back out of storage.
//
// The parser gets better. The box scores do not change. A coach who logged
// four games last week should not have to find those screenshots again and
// re-upload them just because the parser has since learned where GameChanger
// hides its pitch counts.
//
// scouting_entries.image_urls has held the paths since day one, so the images
// are already there. This hands them back in the same shape the capture screen
// sends them, which means the coach re-runs the normal parse-review-save flow
// and SEES what changed before anything is written. A silent server-side
// rewrite would be less code and much worse: the whole reason that screen
// exists is that a coach checks the numbers before they land.
//
// What this cannot do: invent data that was never in the picture. If the
// screenshots only ever showed the pitching table and not the Pitches-Strikes
// footer, no re-parse recovers the pitch counts — that needs a new screenshot.

export const dynamic = 'force-dynamic'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const BUCKET = 'journal-media'

export async function GET(request: NextRequest) {
  const denied = await guard(request, 'record', { needs: 'teamFeatures' })
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const entryId = searchParams.get('entryId')
  const coachId = searchParams.get('coachId')

  if (!entryId || !coachId) {
    return NextResponse.json({ error: 'entryId and coachId required' }, { status: 400 })
  }

  try {
    const { data: entry, error } = await supabaseAdmin
      .from('scouting_entries')
      .select('id, entry_type, occurred_on, tournament_name, image_urls, notes, opponent_team_id, opponent_teams(name)')
      .eq('id', entryId)
      .eq('coach_id', coachId)
      .single()
    if (error || !entry) {
      return NextResponse.json({ error: 'That entry could not be found.' }, { status: 404 })
    }

    const row = entry as any
    const paths: string[] = row.image_urls || []
    if (paths.length === 0) {
      return NextResponse.json({
        error:
          'That entry has no screenshots saved with it, so there is nothing to re-read. ' +
          'It was either typed in by hand or logged before screenshots were kept — ' +
          'upload it again to pick up the newer parsing.',
      }, { status: 422 })
    }

    // Downloaded one at a time and converted to base64, because that is what
    // the vision API takes and what the capture screen already sends.
    const images: Array<{ data: string; mimeType: string }> = []
    const missing: string[] = []
    for (const path of paths) {
      const { data: blob, error: dlError } = await supabaseAdmin.storage.from(BUCKET).download(path)
      if (dlError || !blob) {
        missing.push(path)
        continue
      }
      const buf = Buffer.from(await blob.arrayBuffer())
      images.push({
        data: buf.toString('base64'),
        mimeType: (blob as any).type || guessMime(path),
      })
    }

    if (images.length === 0) {
      return NextResponse.json({
        error: 'The screenshots for that entry could not be read back from storage.',
      }, { status: 422 })
    }

    return NextResponse.json({
      images,
      // Everything the capture screen needs to come back up in the same state,
      // so the coach is re-reading one game rather than re-entering it. The
      // date especially: they chose it, and a re-parse is not a reason to ask
      // again.
      entry: {
        id: row.id,
        entryType: row.entry_type,
        occurredOn: row.occurred_on,
        tournamentName: row.tournament_name,
        opponentTeamId: row.opponent_team_id,
        trackedTeamName: row.opponent_teams?.name || null,
        notes: row.notes,
      },
      // Named, because "some of your screenshots are gone" is worth knowing
      // before the coach concludes the parser is dropping players.
      missingImages: missing.length,
    })
  } catch (e: any) {
    console.error('Scouting reparse error:', e)
    return NextResponse.json(
      { error: e?.message || 'That entry could not be reloaded.' },
      { status: 500 }
    )
  }
}

function guessMime(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}
