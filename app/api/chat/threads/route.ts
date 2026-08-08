import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// The conversation list. Separate from /api/chat because that route is about
// one exchange inside one thread; this one is about which threads exist.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export interface ThreadSummary {
  id: string
  title: string | null
  last_message_at: string | null
  created_at: string
  message_count: number
  preview: string | null
  player_id: string | null
  player_name: string | null
}

// ---------------------------------------------------------------------------
// GET ?teamId=  — every conversation for this team, most recently used first
// ---------------------------------------------------------------------------
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const teamId = searchParams.get('teamId')

  if (!teamId) return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })

  try {
    const { data: threads, error } = await supabaseAdmin
      .from('chat_threads')
      .select('id, title, created_at, last_message_at, archived, player_id, player:players(name)')
      .eq('team_id', teamId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(100)

    if (error) throw error

    const visible = (threads || []).filter((t: any) => !t.archived)
    if (visible.length === 0) return NextResponse.json({ threads: [] })

    // One query for all the messages we need rather than one per thread. A
    // coach with thirty conversations should not pay thirty round trips to
    // render a sidebar.
    const ids = visible.map((t: any) => t.id)
    const { data: messages } = await supabaseAdmin
      .from('chat_messages')
      .select('thread_id, role, content, created_at')
      .in('thread_id', ids)
      .order('created_at', { ascending: true })

    const counts = new Map<string, number>()
    const firstUserMessage = new Map<string, string>()
    for (const m of (messages || []) as any[]) {
      counts.set(m.thread_id, (counts.get(m.thread_id) || 0) + 1)
      if (m.role === 'user' && !firstUserMessage.has(m.thread_id)) {
        firstUserMessage.set(m.thread_id, m.content)
      }
    }

    const summaries: ThreadSummary[] = visible.map((t: any) => ({
      id: t.id,
      title: t.title,
      last_message_at: t.last_message_at,
      created_at: t.created_at,
      message_count: counts.get(t.id) || 0,
      // Shown under the title while a thread is still untitled, and as a
      // second line otherwise — enough to tell two pitching chats apart.
      preview: (firstUserMessage.get(t.id) || '').replace(/\s+/g, ' ').slice(0, 90) || null,
      player_id: t.player_id || null,
      // Supabase returns a joined row as an array on some shapes and an object
      // on others depending on the relationship it infers.
      player_name: (Array.isArray(t.player) ? t.player[0]?.name : t.player?.name) || null,
    }))

    return NextResponse.json({ threads: summaries })
  } catch (error: any) {
    console.error('Thread list error:', error)
    // The columns from migration 020 may not be applied yet. Say so plainly
    // rather than leaving the sidebar mysteriously empty.
    const needsMigration = /last_message_at|archived|player_id/.test(String(error?.message))
    return NextResponse.json(
      { error: error.message || 'Could not load conversations', needsMigration },
      { status: needsMigration ? 200 : 500 }
    )
  }
}

// ---------------------------------------------------------------------------
// POST { teamId } — start a new conversation
// ---------------------------------------------------------------------------
// Deliberately creates an empty thread with no title. The title is written
// after the first message, when there is something to name it after.
export async function POST(request: NextRequest) {
  try {
    const { teamId, playerId } = await request.json()
    if (!teamId) return NextResponse.json({ error: 'Missing teamId' }, { status: 400 })

    const { data, error } = await supabaseAdmin
      .from('chat_threads')
      .insert({ team_id: teamId, player_id: playerId || null })
      .select('id, title, created_at, player_id')
      .single()

    if (error) throw error
    return NextResponse.json({ thread: data })
  } catch (error: any) {
    console.error('Thread create error:', error)
    return NextResponse.json({ error: error.message || 'Could not start a new chat' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH { threadId, title } — rename
// ---------------------------------------------------------------------------
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { threadId, title } = body
    if (!threadId) return NextResponse.json({ error: 'Missing threadId' }, { status: 400 })

    const patch: Record<string, any> = {}

    if (title !== undefined) {
      const clean = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 80)
      if (!clean) return NextResponse.json({ error: 'A name is required' }, { status: 400 })
      patch.title = clean
    }

    // Explicit null is meaningful here — it means "this is about the whole
    // team now" — so presence in the body is the test, not truthiness.
    if ('playerId' in body) patch.player_id = body.playerId || null

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('chat_threads')
      .update(patch)
      .eq('id', threadId)
      .select('id, title, player_id')
      .single()

    if (error) throw error
    return NextResponse.json({ thread: data })
  } catch (error: any) {
    console.error('Thread rename error:', error)
    return NextResponse.json({ error: error.message || 'Could not rename' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE ?threadId=  — remove a conversation and everything in it
// ---------------------------------------------------------------------------
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const threadId = searchParams.get('threadId')

  if (!threadId) return NextResponse.json({ error: 'Missing threadId' }, { status: 400 })

  try {
    // chat_messages cascades on the thread FK, but deleting explicitly means
    // this still does the right thing if that constraint ever changes.
    await supabaseAdmin.from('chat_messages').delete().eq('thread_id', threadId)
    const { error } = await supabaseAdmin.from('chat_threads').delete().eq('id', threadId)
    if (error) throw error

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Thread delete error:', error)
    return NextResponse.json({ error: error.message || 'Could not delete' }, { status: 500 })
  }
}
