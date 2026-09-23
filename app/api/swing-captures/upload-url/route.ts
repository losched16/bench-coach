import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { authorizeTeam, authzResponse } from '@/lib/authz'

export const dynamic = 'force-dynamic'

const VIDEO_BUCKET = 'journal-media'
const MAX_VIDEO_BYTES = 500 * 1024 * 1024

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

function safeExtension(filename: string, mimeType: string | null): string {
  const fromName = filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (fromName && fromName.length <= 8) return fromName
  if (mimeType === 'video/quicktime') return 'mov'
  if (mimeType === 'video/webm') return 'webm'
  return 'mp4'
}

async function playerIsOnTeam(playerId: string, teamId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('team_players')
    .select('id')
    .eq('team_id', teamId)
    .eq('player_id', playerId)
    .maybeSingle()
  return Boolean(data)
}

// Creates a short-lived, path-specific upload token only after the same team
// authorization used by the rest of the swing workflow. The browser never
// needs broad INSERT permission on the private video bucket.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const teamId = typeof body.teamId === 'string' ? body.teamId : null
    await authorizeTeam(teamId, 'record')

    // Nothing below this line is trusted until the caller has been resolved
    // against the team. In particular, do not spend storage work on metadata
    // supplied by somebody who cannot record for this team.
    const playerId = typeof body.playerId === 'string' ? body.playerId : null
    const filename = typeof body.filename === 'string' ? body.filename.slice(0, 255) : 'swing.mp4'
    const mimeType = typeof body.mimeType === 'string' ? body.mimeType : null
    const sizeBytes = body.sizeBytes == null ? null : Number(body.sizeBytes)

    if (!playerId) {
      return NextResponse.json({ error: 'playerId required' }, { status: 400 })
    }
    if (!(await playerIsOnTeam(playerId, teamId!))) {
      return NextResponse.json({ error: 'Player is not on this team.' }, { status: 404 })
    }
    if (mimeType && !mimeType.startsWith('video/')) {
      return NextResponse.json({ error: 'Swing capture must be a video.' }, { status: 400 })
    }
    if (sizeBytes != null && (!Number.isFinite(sizeBytes) || sizeBytes < 0 || sizeBytes > MAX_VIDEO_BYTES)) {
      return NextResponse.json({ error: 'Video is too large.' }, { status: 400 })
    }

    const ext = safeExtension(filename, mimeType)
    const path = `swing-captures/${teamId}/${playerId}/${randomUUID()}.${ext}`
    const { data, error } = await supabaseAdmin.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(path, { upsert: false })

    if (error || !data?.token) {
      console.error('Swing signed upload error:', error)
      return NextResponse.json({ error: 'Could not authorize video upload.' }, { status: 500 })
    }

    return NextResponse.json({
      bucket: VIDEO_BUCKET,
      path,
      token: data.token,
    })
  } catch (error: unknown) {
    const authz = authzResponse(error)
    if (authz) return NextResponse.json(authz.body, { status: authz.status })
    console.error('Swing upload URL error:', error)
    return NextResponse.json({ error: 'Could not authorize video upload.' }, { status: 500 })
  }
}
