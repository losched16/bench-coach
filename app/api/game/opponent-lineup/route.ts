import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { migrationHintFor } from '@/lib/migrationHints'
import { guard } from '@/lib/authz'

// Their batting order, for one game.
//
// The scorebook's only question is "whose name goes on this plate appearance",
// and the answer is a slot number away. Everything here is scoped to a single
// game owned by a single coach — see migration 032 for why that boundary is
// drawn where it is.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const gameId = searchParams.get('gameId')
  if (!gameId) return NextResponse.json({ error: 'gameId required' }, { status: 400 })

  try {
    const { data, error } = await supabaseAdmin
      .from('game_opponent_lineup')
      .select('*')
      .eq('game_id', gameId)
      .order('slot')
    if (error) throw error
    return NextResponse.json({ players: data || [] })
  } catch (error: any) {
    const hint = migrationHintFor(error)
    // A missing table is a migration away, not a broken game screen. The book
    // still works — it just asks for names.
    return NextResponse.json({
      players: [],
      needsMigration: !!hint,
      migrationMessage: hint?.message || 'Run migration 032_opponent_lineup.sql.',
    })
  }
}

// Replace the whole order. A lineup is one object to a coach, and saving it
// row by row leaves half an order behind when something fails midway.
export async function POST(request: NextRequest) {
  const denied = await guard(request, 'record')
  if (denied) return denied

  try {
    const { gameId, players, source } = await request.json()
    if (!gameId || !Array.isArray(players)) {
      return NextResponse.json({ error: 'gameId and players are required' }, { status: 400 })
    }

    const rows = players
      .map((p: any, i: number) => ({
        game_id: gameId,
        slot: Number(p.slot) > 0 ? Number(p.slot) : i + 1,
        name: p.name?.trim() || null,
        jersey: p.jersey != null && String(p.jersey).trim() ? String(p.jersey).trim() : null,
        position: p.position?.trim() || null,
        is_pitcher: !!p.is_pitcher,
        source: source === 'import' ? 'import' : 'manual',
      }))
      // A slot with nothing in it is not a player. Keeping it would put a
      // blank name in the book.
      .filter((r: any) => r.name || r.jersey)

    // Slots the coach removed have to go, or a shortened order keeps its tail.
    const keep = rows.map((r: any) => r.slot)
    let del = supabaseAdmin.from('game_opponent_lineup').delete().eq('game_id', gameId)
    if (keep.length > 0) del = del.not('slot', 'in', `(${keep.join(',')})`)
    const { error: delErr } = await del
    if (delErr) throw delErr

    if (rows.length > 0) {
      const { error } = await supabaseAdmin
        .from('game_opponent_lineup')
        .upsert(rows, { onConflict: 'game_id,slot' })
      if (error) throw error
    }

    return NextResponse.json({ success: true, count: rows.length })
  } catch (error: any) {
    console.error('Opponent lineup POST error:', error)
    const hint = migrationHintFor(error)
    return NextResponse.json(
      { error: hint?.message || error.message || 'Could not save their lineup' },
      { status: 500 }
    )
  }
}
