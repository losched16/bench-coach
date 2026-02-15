import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

const PROCESSING_SERVICE_URL = process.env.SWING_ANALYZER_URL || 'http://localhost:8080'

export async function POST(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get coach ID
    const { data: coach } = await supabase
      .from('coaches')
      .select('id')
      .eq('user_id', session.user.id)
      .single()

    if (!coach) {
      return NextResponse.json({ error: 'Coach not found' }, { status: 404 })
    }

    const formData = await request.formData()
    const videoFile = formData.get('video') as File
    const playerId = formData.get('player_id') as string
    const teamId = formData.get('team_id') as string

    if (!videoFile || !playerId || !teamId) {
      return NextResponse.json({ 
        error: 'Missing required fields: video, player_id, team_id' 
      }, { status: 400 })
    }

    // Verify player belongs to coach
    const { data: player } = await supabase
      .from('players')
      .select('id')
      .eq('id', playerId)
      .eq('coach_id', coach.id)
      .single()

    if (!player) {
      return NextResponse.json({ error: 'Player not found' }, { status: 404 })
    }

    // Upload video to Supabase Storage
    const fileName = `${playerId}/${Date.now()}_${videoFile.name}`
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('swing-videos')
      .upload(fileName, videoFile, {
        contentType: videoFile.type,
        upsert: false
      })

    if (uploadError) {
      console.error('Upload error:', uploadError)
      return NextResponse.json({ 
        error: 'Failed to upload video' 
      }, { status: 500 })
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('swing-videos')
      .getPublicUrl(fileName)

    // Create swing_analyses record
    const { data: analysis, error: insertError } = await supabase
      .from('swing_analyses')
      .insert({
        player_id: playerId,
        team_id: teamId,
        coach_id: coach.id,
        video_url: publicUrl,
        status: 'processing'
      })
      .select()
      .single()

    if (insertError) {
      console.error('Insert error:', insertError)
      return NextResponse.json({ 
        error: 'Failed to create analysis record' 
      }, { status: 500 })
    }

    // Trigger processing service asynchronously
    // Don't wait for it - let it update the record when done
    fetch(`${PROCESSING_SERVICE_URL}/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video_url: publicUrl,
        analysis_id: analysis.id,
        generate_overlay: true
      })
    }).catch(err => {
      console.error('Failed to trigger processing:', err)
      // Update record with error
      supabase
        .from('swing_analyses')
        .update({ status: 'failed', error_message: 'Failed to start processing' })
        .eq('id', analysis.id)
        .then()
    })

    return NextResponse.json({
      success: true,
      analysis_id: analysis.id,
      message: 'Video uploaded successfully. Processing started.'
    })

  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json({ 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}

// Get analysis by ID
export async function GET(request: Request) {
  try {
    const supabase = createRouteHandlerClient({ cookies })
    
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const analysisId = searchParams.get('id')

    if (!analysisId) {
      return NextResponse.json({ error: 'Missing analysis ID' }, { status: 400 })
    }

    // Get coach ID
    const { data: coach } = await supabase
      .from('coaches')
      .select('id')
      .eq('user_id', session.user.id)
      .single()

    if (!coach) {
      return NextResponse.json({ error: 'Coach not found' }, { status: 404 })
    }

    // Get analysis
    const { data: analysis, error } = await supabase
      .from('swing_analyses')
      .select(`
        *,
        players:player_id (
          id,
          name,
          jersey_number
        )
      `)
      .eq('id', analysisId)
      .eq('coach_id', coach.id)
      .single()

    if (error || !analysis) {
      return NextResponse.json({ error: 'Analysis not found' }, { status: 404 })
    }

    return NextResponse.json({ analysis })

  } catch (error: any) {
    console.error('API error:', error)
    return NextResponse.json({ 
      error: error.message || 'Internal server error' 
    }, { status: 500 })
  }
}
