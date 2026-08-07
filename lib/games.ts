// Finding the game a thing belongs to.
//
// Three surfaces write about the same Saturday morning — Lineup Builder before
// it, Game Day during it, Log an Entry after it — and each used to create its
// own `games` row. Building a lineup, tracking the game, and uploading the box
// score gave you three unrelated records for one event, joined by nothing but
// an opponent name you typed three times. The stats page then counted the game
// twice.
//
// This is the one place that decides "is this the same game?", so the three
// paths can't drift apart on the answer.

// Called from both server routes (untyped service-role client) and client
// components (generated-types client). Those two don't share a generic
// signature, and nothing here needs table typing, so the client is loose on
// purpose rather than duplicated per caller.
type AnySupabase = {
  from: (table: string) => any
}

export interface GameKey {
  teamId: string
  gameDate: string          // YYYY-MM-DD
  opponent?: string | null
}

// Both sides of this comparison were hand-typed, so match forgivingly on case
// and whitespace — but nothing looser. Fuzzy-matching opponent names here
// would silently merge "Blue Jays" and "Blue Jays 12U", which are frequently
// different teams at the same tournament.
export function sameOpponent(a?: string | null, b?: string | null): boolean {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()
}

export async function findExistingGame(
  supabase: AnySupabase,
  key: GameKey
): Promise<{ id: string; status?: string | null; opponent?: string | null } | null> {
  if (!key.teamId || !key.gameDate) return null

  const { data } = await supabase
    .from('games')
    .select('id, status, opponent')
    .eq('team_id', key.teamId)
    .eq('game_date', key.gameDate)

  const candidates = (data || []).filter((g: any) => sameOpponent(g.opponent, key.opponent))

  // Two games against the same opponent on the same day is a real thing
  // (doubleheaders, pool play). Attaching to an arbitrary one of them would
  // put the box score on the wrong game, so decline and let a new row be
  // created rather than guessing.
  if (candidates.length !== 1) return null
  return candidates[0] as any
}

// Attach to the game if exactly one matches; otherwise create it. Returns the
// id either way, plus whether it was reused — the caller usually wants to tell
// the coach which happened.
export async function findOrCreateGame(
  supabase: AnySupabase,
  key: GameKey,
  create: Record<string, any> = {}
): Promise<{ id: string; reused: boolean } | null> {
  const existing = await findExistingGame(supabase, key)
  if (existing) return { id: existing.id, reused: true }

  const { data, error } = await supabase
    .from('games')
    .insert({
      team_id: key.teamId,
      game_date: key.gameDate,
      opponent: key.opponent?.trim() || null,
      ...create,
    })
    .select('id')
    .single()

  if (error || !data) return null
  return { id: (data as any).id, reused: false }
}
