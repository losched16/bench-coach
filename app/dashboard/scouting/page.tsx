'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { usePageView, useTracker } from '@/lib/tracking'
import { nameSimilarity, stalenessLabel, stalenessOf, aggregateBattingLines, MIN_PA_FOR_TENDENCY , aggregatePitchingLines} from '@/lib/scouting'
import { OpponentChat } from '@/components/OpponentChat'
import { prepareImages, imagesFromClipboard } from '@/lib/imagePrep'
import { OpponentAnalysis } from '@/components/OpponentAnalysis'
import {
  Search, Plus, Camera, Loader2, ChevronLeft, Trash2, Calendar,
  AlertTriangle, Check, CheckCircle2, XCircle, HelpCircle, Merge,
  ClipboardList, Users, X, Eye, Info,
} from 'lucide-react'
import { TeamOnly } from '@/components/TeamOnly'
import Link from 'next/link'

// ── Types ──────────────────────────────────────────────

interface OpponentTeam {
  id: string
  name: string
  org_name: string | null
  age_group: string | null
  region: string | null
  notes: string | null
  first_seen: string | null
  last_seen: string | null
  player_count?: number
  entry_count?: number
  last_entry_on?: string | null
}

interface OpponentPlayer {
  id: string
  name: string
  jersey_number: string | null
  bats: string | null
  throws: string | null
  positions: string[]
  notes: string | null
  confidence: 'confirmed' | 'probable' | 'uncertain'
  needs_review: boolean
  first_seen: string | null
  last_seen: string | null
  appearances: Appearance[]
}

interface Appearance {
  id: string
  game_date: string
  batting_order_slot: number | null
  positions_played: string[]
  batting_line: any
  pitching_line?: any
  pitches_thrown: number | null
  innings_pitched: number | null
}

interface ScoutingEntry {
  id: string
  entry_type: string
  occurred_on: string | null
  tournament_name: string | null
  notes: string | null
  parse_confidence: string | null
  created_at: string
}

interface Matchup {
  id: string
  opponent_team_id: string
  scheduled_at: string | null
  tournament_name: string | null
  bracket_position: string | null
  status: string
  opponent_team?: { id: string; name: string }
}

interface RuleSet {
  id: string
  coach_id: string | null
  sanctioning_body: string
  age_group: string
  daily_max: number | null
  thresholds: Array<{ max_pitches: number; rest_days: number }>
}

interface BoardRow {
  player: { id: string; name: string; jersey_number: string | null; identity_confidence: string }
  availability: {
    status: 'ineligible' | 'limited' | 'available' | 'unknown'
    last_pitched: string | null
    last_outing_pitches: number | null
    eligible_on: string | null
    pitches_last_7_days: number
    explanation: string
  }
}

interface ParsedBoxPlayer {
  name: string
  jersey_number: string | null
  batting_order_slot: number | null
  positions: string[]
  batting_line: any
  pitching_line?: any
  pitches_thrown: number | null
  innings_pitched: number | null
}

const todayStr = () => new Date().toISOString().split('T')[0]
const tomorrowStr = () => {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

// ── Page ───────────────────────────────────────────────

function ScoutingContent() {
  const supabase = createSupabaseComponentClient()
  const searchParams = useSearchParams()
  const teamId = searchParams.get('teamId')
  const track = useTracker()
  usePageView('scouting')

  const [coachId, setCoachId] = useState<string | null>(null)
  const [ownTeamName, setOwnTeamName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'opponents' | 'capture' | 'board'>('opponents')
  // What a destructive action actually did. Deleting data and showing no
  // confirmation is how a coach ends up unsure whether it worked.
  const [dataNotice, setDataNotice] = useState<string | null>(null)

  const [opponents, setOpponents] = useState<OpponentTeam[]>([])
  const [matchups, setMatchups] = useState<Matchup[]>([])
  const [rules, setRules] = useState<RuleSet[]>([])
  const [boardPrefillId, setBoardPrefillId] = useState<string | null>(null)
  // Why the list is empty, when it is empty for a reason other than "no data".
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loadErrorIsPlan, setLoadErrorIsPlan] = useState(false)

  // Detail view
  const [selectedOpponentId, setSelectedOpponentId] = useState<string | null>(null)
  const [detail, setDetail] = useState<{
    team: OpponentTeam
    players: OpponentPlayer[]
    entries: ScoutingEntry[]
    matchups: Matchup[]
  } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSelection, setMergeSelection] = useState<string[]>([])
  const [merging, setMerging] = useState(false)

  // ── Init ──
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: coach } = await supabase
        .from('coaches')
        .select('id')
        .eq('user_id', user.id)
        .single() as { data: { id: string } | null }
      if (!coach) return
      setCoachId(coach.id)

      if (teamId) {
        const { data: team } = await supabase
          .from('teams')
          .select('name, age_group')
          .eq('id', teamId)
          .single() as { data: { name: string; age_group: string | null } | null }
        if (team) setOwnTeamName(team.name)
      }

      await Promise.all([loadOpponents(coach.id), loadRules(coach.id)])
      setLoading(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  const loadOpponents = async (cid: string) => {
    // A failed load used to leave the list empty and say nothing, which is
    // indistinguishable from having no opponents — so a refused request or a
    // server error read as "my scouting data was erased". Never again: if the
    // list is empty because something broke, the page says so.
    try {
      const res = await fetch(`/api/scouting?coachId=${cid}`)
      const data = await res.json()
      if (!res.ok) {
        // A 402 is not a failure to load, so it must not borrow the "nothing
        // has been deleted" reassurance — that headline over a plan message
        // reads as two unrelated sentences stapled together. TeamOnly normally
        // catches this before the page renders; this is the belt to its braces.
        setLoadErrorIsPlan(res.status === 402)
        setLoadError(
          data.error ||
          `Couldn't load your opponents (${res.status}). Nothing has been deleted — this is a loading problem.`
        )
        return
      }
      setLoadErrorIsPlan(false)
      setLoadError(null)
      setOpponents(data.teams || [])
      setMatchups(data.matchups || [])
    } catch (e: any) {
      setLoadError(
        `Couldn't reach the server to load your opponents. Nothing has been deleted. (${e?.message || 'network error'})`
      )
    }
  }

  const loadRules = async (cid: string) => {
    try {
      const res = await fetch(`/api/scouting/rules?coachId=${cid}`)
      const data = await res.json()
      if (res.ok) setRules(data.rules || [])
    } catch { /* rules are a detail; the opponents list is the headline */ }
  }

  const loadDetail = useCallback(async (opponentId: string) => {
    if (!coachId) return
    setDetailLoading(true)
    setSelectedOpponentId(opponentId)
    const res = await fetch(`/api/scouting?coachId=${coachId}&opponentTeamId=${opponentId}`)
    const data = await res.json()
    if (res.ok) setDetail(data)
    setDetailLoading(false)
  }, [coachId])

  const handleMerge = async (keepId: string) => {
    if (!coachId || mergeSelection.length !== 2) return
    const mergeId = mergeSelection.find(id => id !== keepId)
    if (!mergeId) return
    setMerging(true)
    const res = await fetch('/api/scouting/players', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachId, action: 'merge', keepId, mergeId }),
    })
    setMerging(false)
    if (res.ok) {
      track('scouting_players_merged')
      setMergeMode(false)
      setMergeSelection([])
      if (selectedOpponentId) await loadDetail(selectedOpponentId)
    } else {
      const data = await res.json()
      alert(data.error || 'Merge failed')
    }
  }

  const clearReviewFlag = async (playerId: string) => {
    if (!coachId) return
    await fetch('/api/scouting/players', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coachId, playerId, updates: { needs_review: false, confidence: 'confirmed' } }),
    })
    if (selectedOpponentId) await loadDetail(selectedOpponentId)
  }

  const deleteEntry = async (entryId: string) => {
    if (!coachId || !confirm('Delete this entry? The games and stats parsed from it go too, and any player left with no games at all is removed.')) return
    const res = await fetch(`/api/scouting?coachId=${coachId}&entryId=${entryId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    // Say what happened. Deleting an entry used to leave its players behind
    // with nothing to explain the count that stayed on screen.
    if (data.removedPlayers?.length) {
      setDataNotice(
        `Entry deleted, and ${data.removedPlayers.length} player${data.removedPlayers.length === 1 ? '' : 's'} ` +
        `with no games left: ${data.removedPlayers.slice(0, 6).join(', ')}` +
        `${data.removedPlayers.length > 6 ? '…' : ''}`
      )
    }
    if (selectedOpponentId) await loadDetail(selectedOpponentId)
    await loadOpponents(coachId)
  }

  // Remove one tracked player. For the ones a coach can see are wrong — a
  // stray row from the other side of a box score, a duplicate the merge tool
  // did not catch.
  const deletePlayer = async (playerId: string, name: string) => {
    if (!coachId || !confirm(`Remove ${name} from this team? Their logged games go with them.`)) return
    const res = await fetch(`/api/scouting?coachId=${coachId}&playerId=${playerId}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setDataNotice(d.error || 'That player could not be removed.')
      return
    }
    if (selectedOpponentId) await loadDetail(selectedOpponentId)
    await loadOpponents(coachId)
  }

  // The cleanup for teams that already carry orphans from before entry
  // deletion started pruning — which is every team that existed today.
  const prunePlayers = async (opponentTeamId: string) => {
    if (!coachId) return
    const res = await fetch(`/api/scouting?coachId=${coachId}&pruneTeamId=${opponentTeamId}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    setDataNotice(
      data.removedPlayers?.length
        ? `Removed ${data.removedPlayers.length} player${data.removedPlayers.length === 1 ? '' : 's'} with no games behind them.`
        : 'Nothing to clean up — every player here has at least one logged game.'
    )
    if (selectedOpponentId) await loadDetail(selectedOpponentId)
    await loadOpponents(coachId)
  }

  const deleteTrackedTeam = async (opponentTeamId: string, name: string) => {
    if (!coachId) return
    if (!confirm(`Delete ${name} completely? Every entry, player and logged game for them is removed. This cannot be undone.`)) return
    const res = await fetch(`/api/scouting?coachId=${coachId}&opponentTeamId=${opponentTeamId}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setDataNotice(d.error || 'That team could not be deleted.')
      return
    }
    setSelectedOpponentId(null)
    setDetail(null)
    setDataNotice(`${name} and everything logged for them has been deleted.`)
    await loadOpponents(coachId)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Search className="text-red-600" size={26} />
            Scouting Reports
          </h1>
          <p className="text-gray-600 text-sm mt-1">
            Organized notes on games you already watched, from data the tournament already published.
          </p>
        </div>
        <button
          onClick={() => setTab('capture')}
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors self-start"
        >
          <Plus size={18} />
          Log Scouting Entry
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-200 rounded-lg p-1 w-fit">
        {([
          ['opponents', 'Opponents', Users],
          ['capture', 'Log Entry', Camera],
          ['board', 'Availability Board', ClipboardList],
        ] as const).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-2">
          <Info size={16} className="text-red-600 shrink-0 mt-0.5" />
          <div className="text-sm text-red-800">
            <p className="font-medium">
              {loadErrorIsPlan
                ? 'Scouting comes with the Coach plan.'
                : 'Your scouting data is still there.'}
            </p>
            <p className="mt-0.5">{loadError}</p>
            {loadErrorIsPlan ? (
              <Link href="/subscribe" className="mt-2 inline-block underline font-medium">
                See the Coach plan
              </Link>
            ) : (
              <button
                onClick={() => coachId && loadOpponents(coachId)}
                className="mt-2 underline font-medium"
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      {/* What the last destructive action actually did. Deleting data and
          changing a count with no explanation is what made "23 players
          tracked" so confusing after the entries were gone. */}
      {dataNotice && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
          <Info size={16} className="text-blue-700 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-900 flex-1">{dataNotice}</p>
          <button
            onClick={() => setDataNotice(null)}
            className="text-blue-700 hover:text-blue-900 shrink-0"
            aria-label="Dismiss"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {tab === 'opponents' && !selectedOpponentId && (
        <OpponentList
          opponents={opponents}
          matchups={matchups}
          onSelect={loadDetail}
          onPrep={(oid) => { setSelectedOpponentId(null); setTab('board'); setBoardPrefillId(oid) }}
        />
      )}

      {tab === 'opponents' && selectedOpponentId && (
        <OpponentDetail
          teamId={teamId}
          detail={detail}
          loading={detailLoading}
          coachId={coachId}
          mergeMode={mergeMode}
          mergeSelection={mergeSelection}
          merging={merging}
          onBack={() => { setSelectedOpponentId(null); setDetail(null); setMergeMode(false); setMergeSelection([]) }}
          onToggleMergeMode={() => { setMergeMode(!mergeMode); setMergeSelection([]) }}
          onToggleMergeSelect={(id) => {
            setMergeSelection(prev =>
              prev.includes(id) ? prev.filter(x => x !== id) : prev.length < 2 ? [...prev, id] : prev
            )
          }}
          onMerge={handleMerge}
          onClearReview={clearReviewFlag}
          onDeleteEntry={deleteEntry}
          onDeletePlayer={deletePlayer}
          onPrunePlayers={prunePlayers}
          onDeleteTeam={deleteTrackedTeam}
          onViewBoard={() => { setTab('board'); setBoardPrefillId(selectedOpponentId) }}
        />
      )}

      {tab === 'capture' && coachId && (
        <CaptureForm
          coachId={coachId}
          teamId={teamId}
          ownTeamName={ownTeamName}
          opponents={opponents}
          track={track}
          onSaved={async (opponentTeamId) => {
            await loadOpponents(coachId)
            if (opponentTeamId) {
              setTab('opponents')
              await loadDetail(opponentTeamId)
            } else {
              setTab('opponents')
            }
          }}
        />
      )}

      {tab === 'board' && coachId && (
        <AvailabilityBoard
          coachId={coachId}
          teamId={teamId}
          ownTeamName={ownTeamName}
          opponents={opponents}
          rules={rules}
          prefillOpponentId={boardPrefillId}
          track={track}
          onRulesChanged={() => loadRules(coachId)}
        />
      )}
    </div>
  )
}

// ── Opponent list ──────────────────────────────────────

function OpponentList({
  opponents,
  matchups,
  onSelect,
  onPrep,
}: {
  opponents: OpponentTeam[]
  matchups: Matchup[]
  onSelect: (id: string) => void
  onPrep: (id: string) => void
}) {
  const today = todayStr()
  return (
    <div className="space-y-6">
      {matchups.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Calendar size={18} className="text-red-600" /> Upcoming & Possible Matchups
          </h2>
          <div className="space-y-2">
            {matchups.map(m => (
              <div key={m.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <span className="font-medium text-gray-900">{m.opponent_team?.name || 'Unknown'}</span>
                  <span className={`ml-2 text-xs px-2 py-0.5 rounded-full ${
                    m.status === 'possible' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800'
                  }`}>
                    {m.status === 'possible' ? 'possible (bracket)' : 'upcoming'}
                  </span>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {m.scheduled_at ? new Date(m.scheduled_at).toLocaleString() : 'Not scheduled'}
                    {m.tournament_name ? ` — ${m.tournament_name}` : ''}
                    {m.bracket_position ? ` (${m.bracket_position})` : ''}
                  </div>
                </div>
                <button
                  onClick={() => onPrep(m.opponent_team_id)}
                  className="text-sm text-red-600 hover:text-red-700 font-medium"
                >
                  Prep →
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {opponents.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
          <Search className="mx-auto text-gray-300 mb-3" size={48} />
          <h3 className="font-semibold text-gray-900 mb-1">No teams tracked yet</h3>
          <p className="text-gray-600 text-sm max-w-md mx-auto">
            Log a box score or recap screenshot from GameChanger for any team you want to
            follow — one you played, or one you only watched. The most valuable habit is
            logging every box score across a tournament weekend, because that is what
            powers the pitching availability board.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {opponents.map(o => {
            const stale = o.last_seen ? stalenessOf(o.last_seen, today) : null
            return (
              <button
                key={o.id}
                onClick={() => onSelect(o.id)}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-left hover:border-red-300 hover:shadow transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-gray-900">{o.name}</div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {[o.org_name, o.age_group, o.region].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  {stale === 'historical' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">historical</span>
                  )}
                  {stale === 'aging' && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">aging data</span>
                  )}
                </div>
                <div className="flex gap-4 mt-3 text-xs text-gray-600">
                  <span>{o.entry_count || 0} entries</span>
                  <span>{o.player_count || 0} players</span>
                  <span>Last seen: {o.last_seen || 'unknown'}</span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Opponent detail ────────────────────────────────────

function OpponentDetail({
  detail, loading, coachId, teamId, mergeMode, mergeSelection, merging,
  onBack, onToggleMergeMode, onToggleMergeSelect, onMerge, onClearReview, onDeleteEntry,
  onDeletePlayer, onPrunePlayers, onDeleteTeam, onViewBoard,
}: {
  detail: { team: OpponentTeam; players: OpponentPlayer[]; entries: ScoutingEntry[]; matchups: Matchup[] } | null
  loading: boolean
  coachId: string | null
  teamId: string | null
  mergeMode: boolean
  mergeSelection: string[]
  merging: boolean
  onBack: () => void
  onToggleMergeMode: () => void
  onToggleMergeSelect: (id: string) => void
  onMerge: (keepId: string) => void
  onClearReview: (id: string) => void
  onDeleteEntry: (id: string) => void
  onDeletePlayer: (id: string, name: string) => void
  onPrunePlayers: (opponentTeamId: string) => void
  onDeleteTeam: (opponentTeamId: string, name: string) => void
  onViewBoard: () => void
}) {
  const today = todayStr()

  if (loading || !detail) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    )
  }

  const { team, players, entries } = detail
  // Tracked players with no appearance behind them. Notes are excluded because
  // a coach typed those by hand and they are not derived from any entry.
  const emptyPlayers = players.filter(
    p => (p.appearances?.length || 0) === 0 && !p.notes?.trim()
  )
  const needsReview = players.filter(p => p.needs_review)
  const stale = team.last_seen ? stalenessOf(team.last_seen, today) : null

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
        <ChevronLeft size={16} /> All teams
      </button>

      {/* Ask about them. Sits at the top because it is the reason a coach opens
          this page the night before a game — the tables below are the record,
          this is the question. */}
      {teamId && coachId && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <OpponentChat
            teamId={teamId}
            opponentTeamId={team.id}
            opponentName={team.name}
          />
        </div>
      )}

      {/* Players with nothing behind them. opponent_appearances cascades when
          an entry is deleted and opponent_players did not, so a coach who
          cleared out a team still saw the old player count and had no way to
          fix it. Deleting an entry prunes now; this clears the ones already
          stranded. */}
      {emptyPlayers.length > 0 && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-900">
              {emptyPlayers.length} player{emptyPlayers.length === 1 ? ' has' : 's have'} no logged games
            </p>
            <p className="text-xs text-amber-900 mt-0.5">
              {emptyPlayers.slice(0, 8).map(p => p.name).join(', ')}
              {emptyPlayers.length > 8 ? '…' : ''} — left behind by entries you deleted.
            </p>
          </div>
          <button
            onClick={() => onPrunePlayers(team.id)}
            className="shrink-0 px-3 py-1.5 bg-amber-700 text-white rounded-lg text-sm font-medium hover:bg-amber-800"
          >
            Remove them
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-gray-900">{team.name}</h2>
            <div className="text-sm text-gray-500">
              {[team.org_name, team.age_group, team.region].filter(Boolean).join(' · ') || 'No details'}
              {' · '}First seen {team.first_seen || '?'} · Last seen {team.last_seen || '?'}
            </div>
            {stale !== 'current' && team.last_seen && (
              <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 inline-block">
                Scouting data is {stalenessLabel(team.last_seen, today)}. Kids this age change fast — treat as a starting point, not current form.
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 self-start">
            <button
              onClick={onViewBoard}
              className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors text-sm"
            >
              <ClipboardList size={16} /> Pitching Availability
            </button>
            {/* Deleting the whole team existed in the API and was reachable
                from nowhere, so a coach who wanted to start a team over had no
                way to do it. */}
            <button
              onClick={() => onDeleteTeam(team.id, team.name)}
              title="Delete this team and everything logged for them"
              className="flex items-center gap-1.5 px-3 py-2 border border-red-300 text-red-700 rounded-lg hover:bg-red-50 transition-colors text-sm"
            >
              <Trash2 size={15} /> Delete team
            </button>
          </div>
        </div>
        {team.notes && <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{team.notes}</p>}
      </div>

      {/* The synthesis, directly under the header — it's the reason to open
          this page, not a footnote below the roster table. */}
      <OpponentAnalysis
        coachId={coachId}
        opponentTeamId={team.id}
        opponentName={team.name}
        entryCount={entries.length}
      />

      {needsReview.length > 0 && !mergeMode && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={18} />
          <div className="text-sm text-amber-900">
            <strong>{needsReview.length} player{needsReview.length === 1 ? '' : 's'} flagged as possible duplicates.</strong>{' '}
            Review them below — merge if it&apos;s the same kid, or mark as a separate player. Duplicates make the
            pitch-count picture look safer than it is.
          </div>
        </div>
      )}

      {/* Players */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-gray-900">Known Players ({players.length})</h3>
          {players.length >= 2 && (
            <button
              onClick={onToggleMergeMode}
              className={`flex items-center gap-1 text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                mergeMode ? 'bg-red-50 border-red-300 text-red-700' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {mergeMode ? <X size={14} /> : <Merge size={14} />}
              {mergeMode ? 'Cancel merge' : 'Merge duplicates'}
            </button>
          )}
        </div>

        {mergeMode && (
          <div className="mb-3 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
            Select the two rows that are the same kid. Appearances combine onto the player you keep.
            {mergeSelection.length === 2 && (
              <div className="mt-2 flex gap-2">
                {mergeSelection.map(id => {
                  const p = players.find(x => x.id === id)
                  return p ? (
                    <button
                      key={id}
                      disabled={merging}
                      onClick={() => onMerge(id)}
                      className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
                    >
                      {merging ? 'Merging…' : `Keep "${p.name}${p.jersey_number ? ` #${p.jersey_number}` : ''}"`}
                    </button>
                  ) : null
                })}
              </div>
            )}
          </div>
        )}

        {players.length === 0 ? (
          <p className="text-sm text-gray-500">No players logged yet — log a box score to build the roster.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-200">
                  {mergeMode && <th className="py-2 pr-2"></th>}
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Name</th>
                  <th className="py-2 pr-3">Identity</th>
                  <th className="py-2 pr-3">Games</th>
                  <th className="py-2 pr-3">Batting (logged)</th>
                  <th className="py-2 pr-3">Pitching (logged)</th>
                  <th className="py-2 pr-3">Last seen</th>
                  <th className="py-2 pl-1"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {players.map(p => {
                  const totals = aggregateBattingLines((p.appearances || []).map(a => a.batting_line))
                  const pitchApps = (p.appearances || []).filter(a => (a.pitches_thrown || 0) > 0)
                  const totalPitches = pitchApps.reduce((s, a) => s + (a.pitches_thrown || 0), 0)
                  const smallSample = totals.pa > 0 && totals.pa < MIN_PA_FOR_TENDENCY
                  return (
                    <tr key={p.id} className={`border-b border-gray-100 ${p.needs_review ? 'bg-amber-50' : ''}`}>
                      {mergeMode && (
                        <td className="py-2 pr-2">
                          <input
                            type="checkbox"
                            checked={mergeSelection.includes(p.id)}
                            onChange={() => onToggleMergeSelect(p.id)}
                            className="rounded"
                          />
                        </td>
                      )}
                      <td className="py-2 pr-3 text-gray-600">{p.jersey_number || '—'}</td>
                      <td className="py-2 pr-3">
                        <div className="font-medium text-gray-900">{p.name}</div>
                        {p.positions?.length > 0 && (
                          <div className="text-xs text-gray-500">{p.positions.join('/')}</div>
                        )}
                        {p.notes && <div className="text-xs text-gray-500 mt-0.5 max-w-xs truncate" title={p.notes}>{p.notes}</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <ConfidenceBadge confidence={p.confidence} />
                        {p.needs_review && (
                          <button
                            onClick={() => onClearReview(p.id)}
                            className="block text-xs text-amber-700 underline mt-1"
                            title="Confirm this is a separate player, not a duplicate"
                          >
                            not a duplicate
                          </button>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-gray-600">{p.appearances?.length || 0}</td>
                      <td className="py-2 pr-3 text-gray-600">
                        {totals.pa > 0 ? (
                          <>
                            {totals.h}/{totals.ab}{totals.bb > 0 ? `, ${totals.bb}BB` : ''}{totals.k > 0 ? `, ${totals.k}K` : ''}
                            {smallSample && (
                              <span className="block text-xs text-amber-600">small sample ({totals.pa} PA)</span>
                            )}
                          </>
                        ) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-600">
                        {pitchApps.length > 0 ? (
                          <>
                            {totalPitches} pitches over {pitchApps.length} outing{pitchApps.length === 1 ? '' : 's'}
                            {/* The line itself. Outings logged before the
                                pitching line existed have counts and nothing
                                else, and printing "0 H, 0 BB, 0 K" for them
                                would read as a shutout rather than as no data. */}
                            {(() => {
                              const pl = aggregatePitchingLines(pitchApps)
                              return (pl.h || pl.bb || pl.k || pl.r) ? (
                                <span className="block text-xs text-gray-500">
                                  {pl.ip} IP · {pl.h} H · {pl.r} R ({pl.er} ER) · {pl.bb} BB · {pl.k} K
                                </span>
                              ) : null
                            })()}
                          </>
                        ) : '—'}
                      </td>
                      <td className="py-2 pr-3 text-gray-500">{p.last_seen || '—'}</td>
                      {/* Per-player removal, for the stray row from the other
                          side of a box score that the merge tool cannot help
                          with because it is not a duplicate of anything. */}
                      <td className="py-2 pl-1">
                        <button
                          onClick={() => onDeletePlayer(p.id, p.name)}
                          title={`Remove ${p.name} from this team`}
                          aria-label={`Remove ${p.name}`}
                          className="p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Entries */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 className="font-semibold text-gray-900 mb-3">Scouting Entries ({entries.length})</h3>
        {entries.length === 0 ? (
          <p className="text-sm text-gray-500">Nothing logged yet.</p>
        ) : (
          <div className="space-y-2">
            {entries.map(e => (
              <div key={e.id} className="flex items-start justify-between p-3 bg-gray-50 rounded-lg">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                      {e.entry_type.replace('_', ' ')}
                    </span>
                    <span className="text-sm text-gray-700">{e.occurred_on || 'No date'}</span>
                    {e.tournament_name && <span className="text-xs text-gray-500">{e.tournament_name}</span>}
                    {e.parse_confidence && e.parse_confidence !== 'high' && (
                      <span className="text-xs text-amber-600">parse confidence: {e.parse_confidence}</span>
                    )}
                  </div>
                  {e.notes && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{e.notes}</p>}
                </div>
                <button
                  onClick={() => onDeleteEntry(e.id)}
                  className="p-1.5 text-gray-400 hover:text-red-600 flex-shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: string }) {
  const styles: Record<string, string> = {
    confirmed: 'bg-green-100 text-green-800',
    probable: 'bg-blue-100 text-blue-800',
    uncertain: 'bg-amber-100 text-amber-800',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[confidence] || 'bg-gray-100 text-gray-700'}`}>
      {confidence}
    </span>
  )
}

// ── Capture form (single screen, no wizard) ────────────

function CaptureForm({
  coachId, teamId, ownTeamName, opponents, track, onSaved,
}: {
  coachId: string
  teamId: string | null
  ownTeamName: string
  opponents: OpponentTeam[]
  track: (event: string, metadata?: any) => void
  onSaved: (opponentTeamId: string | null) => void
}) {
  const supabase = createSupabaseComponentClient()
  const [entryType, setEntryType] = useState<'box_score' | 'recap' | 'observation' | 'bracket'>('box_score')
  const [opponentTeamId, setOpponentTeamId] = useState<string>('')
  const [newTeamName, setNewTeamName] = useState('')
  const [occurredOn, setOccurredOn] = useState(todayStr())

  const [tournamentName, setTournamentName] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [pastedText, setPastedText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  // Both teams from the image, and which one we picked. Kept so the coach can
  // see the decision and flip it — a box score has two teams and the app
  // choosing silently is exactly how their own players got into an opponent's
  // roster.
  const [sides, setSides] = useState<any[]>([])
  const [sideReason, setSideReason] = useState<string>('')
  const [sideConfident, setSideConfident] = useState(true)
  // Parsed names that match the coach's own roster. Almost always means a
  // row from the wrong side of the box score survived.
  const [ownPlayersFound, setOwnPlayersFound] = useState<string[]>([])
  // Whether trying the same thing again is worth suggesting. An overloaded
  // AI service clears in seconds; a screenshot it cannot read never will.
  const [parseRetryable, setParseRetryable] = useState(false)
  const [parsed, setParsed] = useState<any>(null)
  const [parsedPlayers, setParsedPlayers] = useState<ParsedBoxPlayer[]>([])
  const [notePitching, setNotePitching] = useState('')
  const [noteStyle, setNoteStyle] = useState('')
  const [noteRemember, setNoteRemember] = useState('')
  const [saving, setSaving] = useState(false)

  // Fuzzy-match hint against existing opponents to avoid duplicate teams
  const suggestion = newTeamName.trim().length >= 3 && !opponentTeamId
    ? opponents
        .map(o => ({ o, sim: nameSimilarity(newTeamName, o.name) }))
        .filter(x => x.sim >= 0.7 && x.sim < 0.999)
        .sort((a, b) => b.sim - a.sim)[0]
    : null

  // Screenshots arrive by paste far more often than by file picker — it's the
  // gesture people already use — and the page used to ignore them entirely.
  const addFiles = (incoming: File[]) => {
    if (incoming.length === 0) return
    setFiles(prev => [...prev, ...incoming])
    setParsed(null)
    setParsedPlayers([])
    setParseError(null)
  }

  useEffect(() => {
    if (entryType === 'observation') return
    const onPaste = (e: ClipboardEvent) => {
      const pasted = imagesFromClipboard(e)
      if (pasted.length > 0) {
        e.preventDefault()
        addFiles(pasted)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryType])

  const handleParse = async () => {
    if (files.length === 0 && !pastedText.trim()) return
    setParsing(true)
    setParseError(null)
    setParseRetryable(false)
    setSides([])
    setSideReason('')
    setSideConfident(true)
    setOwnPlayersFound([])
    try {
      // Downscales and rejects formats the API can't read, with a message
      // that says what to do rather than failing opaquely.
      const { images, errors: imageErrors } = await prepareImages(files)
      if (images.length === 0 && imageErrors.length > 0) {
        throw new Error(imageErrors.join(' '))
      }
      if (imageErrors.length > 0) setParseError(imageErrors.join(' '))
      const res = await fetch('/api/scouting/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images, text: pastedText.trim() || undefined, entryType,
          // Who we are and who we are scouting. Without these the parser has
          // no way to tell the two teams in a box score apart.
          teamId,
          ourTeamName: ownTeamName,
          // The team the coach selected. This is the subject of the upload and
          // outranks every other signal — if they said Warrington, the answer
          // is Warrington or a question, never Springfield.
          trackedTeamName:
            opponents.find(o => o.id === opponentTeamId)?.name || newTeamName.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setParseRetryable(!!data.retryable)
        throw new Error(data.error || 'Parse failed')
      }
      setParsed(data.parsed)
      setSides(data.sides || [])
      setSideReason(data.sideChoice?.reason || '')
      setSideConfident(data.sideChoice?.confident !== false)
      setOwnPlayersFound(data.sideChoice?.ownPlayers || [])
      if (entryType === 'box_score') {
        setParsedPlayers(
          (data.parsed.players || []).map((p: any) => ({
            name: p.name || '',
            jersey_number: p.jersey_number || null,
            batting_order_slot: p.batting_order_slot ?? null,
            positions: p.positions || [],
            batting_line: p.batting_line || {},
            pitching_line: p.pitching_line || {},
            pitches_thrown: p.pitches_thrown ?? null,
            innings_pitched: p.innings_pitched ?? null,
          }))
        )
        if (data.parsed.team_name && !newTeamName && !opponentTeamId) {
          setNewTeamName(data.parsed.team_name)
        }
        // The date field is NOT touched by parsing. The coach selects a date
        // deliberately, and a year guessed off a screenshot that printed
        // "Jul 14" with no year is not a reason to change it — that is how a
        // July 2026 game got logged as 2024. What they picked is what saves.
      }
      if (entryType === 'bracket' && data.parsed.tournament_name && !tournamentName) {
        setTournamentName(data.parsed.tournament_name)
      }
    } catch (e: any) {
      // A fetch that rejects outright never reached the server, so it is worth
      // another go for the same reason a 529 is.
      if (e?.name === 'TypeError') setParseRetryable(true)
      setParseError(e.message)
    } finally {
      setParsing(false)
    }
  }

  const updateParsedPlayer = (idx: number, field: string, value: any) => {
    setParsedPlayers(prev =>
      prev.map((p, i) => {
        if (i !== idx) return p
        if (field.startsWith('bl.')) {
          const key = field.slice(3)
          return { ...p, batting_line: { ...p.batting_line, [key]: value === '' ? undefined : Number(value) } }
        }
        // Pitching, which is a different table on the box score and a
        // different set of numbers: bb here is walks ISSUED, not the batter's
        // own walks in bl.bb.
        if (field.startsWith('pl.')) {
          const key = field.slice(3)
          return { ...p, pitching_line: { ...p.pitching_line, [key]: value === '' ? undefined : Number(value) } }
        }
        return { ...p, [field]: value }
      })
    )
  }

  const canSave =
    !saving &&
    (entryType === 'bracket'
      ? !!parsed || files.length === 0 // bracket can be saved after parse (or as a bare note)
      : !!opponentTeamId || newTeamName.trim().length > 0)

  const handleSave = async () => {
    if (!canSave) return
    setSaving(true)
    try {
      // Best-effort screenshot upload (reuses the existing journal-media bucket)
      const imageUrls: string[] = []
      for (const file of files) {
        const ext = file.name.split('.').pop()
        const path = `scouting/${coachId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`
        const { error } = await supabase.storage.from('journal-media').upload(path, file)
        if (!error) imageUrls.push(path)
      }

      const noteParts: string[] = []
      if (notePitching.trim()) noteParts.push(`Pitching: ${notePitching.trim()}`)
      if (noteStyle.trim()) noteParts.push(`How they play: ${noteStyle.trim()}`)
      if (noteRemember.trim()) noteParts.push(`Remember: ${noteRemember.trim()}`)

      const body: any = {
        coachId,
        entryType,
        occurredOn,
        tournamentName: tournamentName || null,
        notes: noteParts.join('\n') || null,
        imageUrls,
        rawParse: parsed || null,
        parseConfidence: parsed?.confidence || null,
        pastedText: pastedText.trim() || null,
        teamId,
        ownTeamName,
      }
      if (entryType !== 'bracket') {
        if (opponentTeamId) body.opponentTeamId = opponentTeamId
        else body.newTeam = { name: newTeamName.trim() }
      }
      if (entryType === 'box_score') {
        body.players = parsedPlayers.filter(p => p.name.trim())
      }
      if (entryType === 'bracket' && parsed) {
        body.bracket = parsed
      }

      const res = await fetch('/api/scouting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')

      track('scouting_entry_created', { type: entryType, players: parsedPlayers.length })
      onSaved(data.opponentTeamId || null)
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 space-y-5">
      {/* 1. Team */}
      {entryType !== 'bracket' && (
        <div>
          {/* Not "opponent". A coach building a scouting database tracks teams
              they may never play, from games they were not in — and reading
              this as "our opponent" is what made a Warrington upload come back
              full of Springfield players. */}
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Which team are you logging?
          </label>
          <p className="text-xs text-gray-500 mb-1.5">
            The team whose players and stats are in this upload. Any team you want to
            track — you don&apos;t have to be playing them.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={opponentTeamId}
              onChange={e => { setOpponentTeamId(e.target.value); if (e.target.value) setNewTeamName('') }}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
            >
              <option value="">— Add a team —</option>
              {opponents.map(o => (
                <option key={o.id} value={o.id}>{o.name}{o.age_group ? ` (${o.age_group})` : ''}</option>
              ))}
            </select>
            {!opponentTeamId && (
              <input
                type="text"
                value={newTeamName}
                onChange={e => setNewTeamName(e.target.value)}
                placeholder="Team name, e.g. Warrington"
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            )}
          </div>
          {suggestion && (
            <button
              onClick={() => { setOpponentTeamId(suggestion.o.id); setNewTeamName('') }}
              className="mt-1 text-xs text-blue-700 hover:underline"
            >
              Did you mean &quot;{suggestion.o.name}&quot;? Click to use the existing record instead of creating a duplicate.
            </button>
          )}
        </div>
      )}

      {/* 2. Type */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Entry type</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            ['box_score', 'Box Score'],
            ['recap', 'Recap'],
            ['observation', 'Observation'],
            ['bracket', 'Bracket'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setEntryType(key); setParsed(null); setParsedPlayers([]); setParseError(null) }}
              className={`px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                entryType === key
                  ? 'border-red-500 bg-red-50 text-red-700'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {entryType === 'bracket' && (
          <p className="text-xs text-gray-500 mt-1">
            Log a full tournament bracket and we&apos;ll create &quot;possible&quot; matchups for teams you might
            face — so you can prep for the semifinal opponent before the quarterfinal is played.
          </p>
        )}
      </div>

      {/* 3. Date + tournament */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {entryType === 'box_score' ? 'Game date' : 'Date'}
          </label>
          <input
            type="date"
            value={occurredOn}
            onChange={e => setOccurredOn(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Tournament (optional)</label>
          <input
            type="text"
            value={tournamentName}
            onChange={e => setTournamentName(e.target.value)}
            placeholder="e.g. USSSA Summer Slam"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* 4. Screenshots + pasted recap text */}
      {entryType !== 'observation' && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Screenshots <span className="font-normal text-gray-500">— or just paste them (Cmd/Ctrl+V)</span>
          </label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = '' }}
            className="block w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-red-50 file:text-red-700 file:font-medium hover:file:bg-red-100"
          />

          {files.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {files.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-2 py-1 bg-gray-100 rounded text-xs text-gray-700">
                  {f.name || `pasted image ${i + 1}`}
                  <button
                    onClick={() => { setFiles(prev => prev.filter((_, j) => j !== i)); setParsed(null); setParsedPlayers([]) }}
                    className="text-gray-400 hover:text-red-600"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {(entryType === 'recap' || entryType === 'box_score') && (
            <div className="mt-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {entryType === 'recap'
                  ? 'Paste the GameChanger recap'
                  : 'Paste the game recap (optional — adds context to the box score)'}
              </label>
              <textarea
                value={pastedText}
                onChange={e => { setPastedText(e.target.value); setParsed(null); setParsedPlayers([]) }}
                rows={entryType === 'recap' ? 6 : 3}
                placeholder="Copy the written game recap from GameChanger and paste it here…"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
              />
              {entryType === 'recap' && (
                <p className="text-xs text-gray-500 mt-0.5">
                  Text, screenshots, or both — we&apos;ll pull out pitching notes, tendencies, and players mentioned.
                </p>
              )}
            </div>
          )}

          {(files.length > 0 || (pastedText.trim() && entryType === 'recap')) && !parsed && (
            <button
              onClick={handleParse}
              disabled={parsing || (entryType === 'box_score' && files.length === 0)}
              className="mt-2 flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 text-sm"
            >
              {parsing ? <Loader2 className="animate-spin" size={16} /> : <Camera size={16} />}
              {parsing
                ? 'Reading…'
                : files.length > 0
                  ? `Parse ${files.length} screenshot${files.length === 1 ? '' : 's'}${pastedText.trim() ? ' + recap text' : ''}`
                  : 'Parse recap text'}
            </button>
          )}
          {parseError && (
            <div className="mt-2 text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
              <p>{parseError}</p>
              {/* The screenshots are still in state, so this costs them nothing
                  but a tap — which is the whole point of saying so. */}
              {parseRetryable && (
                <button
                  onClick={handleParse}
                  disabled={parsing}
                  className="mt-2 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                >
                  {parsing ? 'Trying again…' : 'Try again'}
                </button>
              )}
            </div>
          )}

          {/* Which team came out of the image, and the way to change it.
              A box score has two teams; before this the app picked one without
              saying so and a coach's own players could end up saved as an
              opponent's roster, where they drive pitch-count availability. */}
          {entryType === 'box_score' && sides.length > 0 && (
            <div className={`mt-3 rounded-lg border p-3 ${
              sideConfident ? 'bg-gray-50 border-gray-200' : 'bg-amber-50 border-amber-300'
            }`}>
              <p className={`text-sm font-medium ${sideConfident ? 'text-gray-900' : 'text-amber-900'}`}>
                {sideConfident ? 'Logging this team' : 'Which of these are you logging?'}
              </p>
              {sideReason && (
                <p className={`text-xs mt-0.5 ${sideConfident ? 'text-gray-600' : 'text-amber-900'}`}>
                  {sideReason}
                </p>
              )}
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {sides.map((sd: any, i: number) => {
                  const chosen = (parsed?.players || []).length > 0 &&
                    sd.players?.[0]?.name === parsed.players[0]?.name
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        // Switching sides re-seeds everything the review table
                        // and the save path read.
                        setParsed({ ...parsed, team_name: sd.team_name, players: sd.players })
                        setParsedPlayers(
                          (sd.players || []).map((pl: any) => ({
                            name: pl.name || '',
                            jersey_number: pl.jersey_number || null,
                            batting_order_slot: pl.batting_order_slot ?? null,
                            positions: pl.positions || [],
                            batting_line: pl.batting_line || {},
                            pitching_line: pl.pitching_line || {},
                            pitches_thrown: pl.pitches_thrown ?? null,
                            innings_pitched: pl.innings_pitched ?? null,
                          }))
                        )
                        if (sd.team_name && !newTeamName && !opponentTeamId) setNewTeamName(sd.team_name)
                      }}
                      className={`text-left rounded-lg border p-2.5 transition-colors ${
                        chosen
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-gray-300 bg-white hover:border-gray-400'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {sd.team_name || 'Unnamed team'}
                        </span>
                        {sd.is_ours && (
                          <span className="text-[10px] font-semibold uppercase tracking-wide bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded">
                            Your team
                          </span>
                        )}
                        {!sd.is_ours && sd.team_name && (
                          <span className="text-[10px] uppercase tracking-wide text-gray-400">
                            {sd.player_count} listed
                          </span>
                        )}
                        {chosen && <Check size={14} className="text-blue-600 ml-auto" />}
                      </span>
                      <span className="block text-xs text-gray-600 mt-0.5">
                        {sd.player_count} player{sd.player_count === 1 ? '' : 's'}
                        {sd.sample?.length > 0 && ` — ${sd.sample.join(', ')}${sd.player_count > sd.sample.length ? '…' : ''}`}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Your own players in an opponent's roster is the specific mess
              this whole flow exists to prevent, so it gets said loudly and
              with the names in it. */}
          {ownPlayersFound.length > 0 && (
            <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3">
              <p className="text-sm font-semibold text-red-900">
                {ownPlayersFound.length} of these look like your own players
              </p>
              <p className="text-xs text-red-900 mt-0.5">
                {ownPlayersFound.join(', ')} — {ownPlayersFound.length === 1 ? 'that name is' : 'those names are'}{' '}
                on your roster. If this is the wrong side of the box score, switch teams above.
                Otherwise clear {ownPlayersFound.length === 1 ? 'that row' : 'those rows'} before saving —
                your own players in an opponent&apos;s roster will make their pitching availability wrong.
              </p>
            </div>
          )}

          {parsed && parsed.warnings?.length > 0 && (
            <div className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
              {parsed.warnings.join(' · ')}
            </div>
          )}

          {/* Parsed box score review table */}
          {entryType === 'box_score' && parsedPlayers.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 text-sm text-gray-700 mb-2">
                <CheckCircle2 size={16} className="text-green-600" />
                Parsed {parsedPlayers.length} players
                {parsed.confidence && parsed.confidence !== 'high' && (
                  <span className="text-amber-600">— confidence {parsed.confidence}, double-check the numbers</span>
                )}
              </div>
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr className="text-left text-gray-500">
                      <th className="p-2">#</th>
                      <th className="p-2">Name</th>
                      <th className="p-2">Pos</th>
                      <th className="p-2">AB</th>
                      <th className="p-2">H</th>
                      <th className="p-2">BB</th>
                      <th className="p-2">K</th>
                      <th className="p-2 bg-red-50">Pitches</th>
                      <th className="p-2">IP</th>
                      {/* The outing, not just its volume. These were read off
                          the box score and thrown away until now. */}
                      <th className="p-2" title="Hits allowed">pH</th>
                      <th className="p-2" title="Runs allowed">pR</th>
                      <th className="p-2" title="Earned runs">ER</th>
                      <th className="p-2" title="Walks ISSUED — not the batter's own walks">pBB</th>
                      <th className="p-2" title="Strikeouts THROWN — not the batter's own strikeouts">pK</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedPlayers.map((p, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="p-1">
                          <input value={p.jersey_number || ''} onChange={e => updateParsedPlayer(i, 'jersey_number', e.target.value || null)}
                            className="w-10 px-1 py-1 border border-gray-200 rounded" />
                        </td>
                        <td className="p-1">
                          <input value={p.name} onChange={e => updateParsedPlayer(i, 'name', e.target.value)}
                            className="w-32 px-1 py-1 border border-gray-200 rounded" />
                        </td>
                        <td className="p-1">
                          <input value={(p.positions || []).join('/')}
                            onChange={e => updateParsedPlayer(i, 'positions', e.target.value.split('/').map(s => s.trim()).filter(Boolean))}
                            className="w-16 px-1 py-1 border border-gray-200 rounded" />
                        </td>
                        {(['ab', 'h', 'bb', 'k'] as const).map(key => (
                          <td className="p-1" key={key}>
                            <input type="number" value={p.batting_line?.[key] ?? ''}
                              onChange={e => updateParsedPlayer(i, `bl.${key}`, e.target.value)}
                              className="w-11 px-1 py-1 border border-gray-200 rounded" />
                          </td>
                        ))}
                        <td className="p-1 bg-red-50">
                          <input type="number" value={p.pitches_thrown ?? ''}
                            onChange={e => updateParsedPlayer(i, 'pitches_thrown', e.target.value === '' ? null : Number(e.target.value))}
                            className="w-14 px-1 py-1 border border-red-200 rounded font-medium" />
                        </td>
                        <td className="p-1">
                          <input type="number" step="0.1" value={p.innings_pitched ?? ''}
                            onChange={e => updateParsedPlayer(i, 'innings_pitched', e.target.value === '' ? null : Number(e.target.value))}
                            className="w-12 px-1 py-1 border border-gray-200 rounded" />
                        </td>
                        {(['h', 'r', 'er', 'bb', 'k'] as const).map(key => (
                          <td className="p-1" key={`pl-${key}`}>
                            <input type="number" value={p.pitching_line?.[key] ?? ''}
                              onChange={e => updateParsedPlayer(i, `pl.${key}`, e.target.value)}
                              className="w-11 px-1 py-1 border border-gray-200 rounded" />
                          </td>
                        ))}
                        <td className="p-1">
                          <button onClick={() => setParsedPlayers(prev => prev.filter((_, j) => j !== i))}
                            className="p-1 text-gray-400 hover:text-red-600">
                            <X size={14} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Pitch counts drive the availability board — worth a quick double-check before saving.
              </p>
            </div>
          )}

          {/* Parsed recap review */}
          {entryType === 'recap' && parsed && (
            <div className="mt-3 text-sm bg-gray-50 rounded-lg p-3 space-y-2">
              {parsed.summary && <p><strong>Summary:</strong> {parsed.summary}</p>}
              {parsed.pitching_notes && <p><strong>Pitching:</strong> {parsed.pitching_notes}</p>}
              {parsed.tendencies?.length > 0 && <p><strong>Tendencies:</strong> {parsed.tendencies.join(', ')}</p>}
              {parsed.players_mentioned?.length > 0 && (
                <p><strong>Players mentioned:</strong>{' '}
                  {parsed.players_mentioned.map((pm: any) => `${pm.name}${pm.jersey_number ? ` #${pm.jersey_number}` : ''}`).join(', ')}
                </p>
              )}
            </div>
          )}

          {/* Parsed bracket review */}
          {entryType === 'bracket' && parsed && (
            <div className="mt-3 text-sm bg-gray-50 rounded-lg p-3 space-y-2">
              {parsed.tournament_name && <p><strong>Tournament:</strong> {parsed.tournament_name}</p>}
              {parsed.teams?.length > 0 && (
                <div>
                  <strong>Teams found ({parsed.teams.length}):</strong>
                  <ul className="mt-1 space-y-0.5">
                    {parsed.teams.map((t: any, i: number) => (
                      <li key={i} className="text-gray-700">
                        {t.name}{t.bracket_position ? ` — ${t.bracket_position}` : ''}
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-gray-500 mt-1">
                    Saving creates a &quot;possible&quot; matchup for each team (your own team is skipped automatically).
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 5. Prompted notes */}
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">What stood out about their pitching?</label>
          <textarea value={notePitching} onChange={e => setNotePitching(e.target.value)} rows={2}
            placeholder="e.g. #12 threw hard but wild — walked 4 in 2 innings"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Anything about how they play — aggressive on the bases, bunting, shifts?
          </label>
          <textarea value={noteStyle} onChange={e => setNoteStyle(e.target.value)} rows={2}
            placeholder="e.g. steal on every passed ball, first-pitch swingers at the top of the order"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Anything you&apos;d want to remember before playing them again?
          </label>
          <textarea value={noteRemember} onChange={e => setNoteRemember(e.target.value)} rows={2}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm" />
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={!canSave}
        className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
      >
        {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
        {saving ? 'Saving…' : 'Save Scouting Entry'}
      </button>
    </div>
  )
}

// ── Availability board ─────────────────────────────────

function AvailabilityBoard({
  coachId, teamId, ownTeamName, opponents, rules, prefillOpponentId, track, onRulesChanged,
}: {
  coachId: string
  teamId: string | null
  ownTeamName: string
  opponents: OpponentTeam[]
  rules: RuleSet[]
  prefillOpponentId: string | null
  track: (event: string, metadata?: any) => void
  onRulesChanged: () => void
}) {
  const [subjectId, setSubjectId] = useState<string>(prefillOpponentId || '')
  const [date, setDate] = useState(tomorrowStr())
  const [ruleId, setRuleId] = useState<string>('')
  const [showRuleManager, setShowRuleManager] = useState(false)
  const [loading, setLoading] = useState(false)
  const [board, setBoard] = useState<BoardRow[] | null>(null)
  const [coverage, setCoverage] = useState<{ logged_game_count: number; last_logged_game: string | null; notes: string[] } | null>(null)
  const [activeRule, setActiveRule] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (prefillOpponentId) setSubjectId(prefillOpponentId)
  }, [prefillOpponentId])

  const loadBoard = async () => {
    if (!subjectId) return
    setLoading(true)
    setError(null)
    try {
      const isOwn = subjectId === '__own__'
      const params = new URLSearchParams({ coachId, date })
      if (isOwn && teamId) params.set('ownTeamId', teamId)
      else params.set('opponentTeamId', subjectId)
      if (ruleId) params.set('ruleId', ruleId)

      const res = await fetch(`/api/scouting/availability?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load board')
      setBoard(data.board)
      setCoverage(data.coverage)
      setActiveRule(data.ruleSet)
      track('availability_board_viewed', { subject: isOwn ? 'own_team' : 'opponent' })
    } catch (e: any) {
      setError(e.message)
      setBoard(null)
    } finally {
      setLoading(false)
    }
  }

  const statusStyle: Record<string, { badge: string; icon: any }> = {
    ineligible: { badge: 'bg-red-100 text-red-800', icon: XCircle },
    limited: { badge: 'bg-amber-100 text-amber-800', icon: AlertTriangle },
    available: { badge: 'bg-green-100 text-green-800', icon: CheckCircle2 },
    unknown: { badge: 'bg-gray-100 text-gray-600', icon: HelpCircle },
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Team</label>
            <select
              value={subjectId}
              onChange={e => { setSubjectId(e.target.value); setBoard(null) }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
            >
              <option value="">Select a team…</option>
              {teamId && <option value="__own__">My team{ownTeamName ? ` (${ownTeamName})` : ''} — see yourself as opponents do</option>}
              {opponents.map(o => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Game date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rule set</label>
            <select value={ruleId} onChange={e => setRuleId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent">
              <option value="">Default (Little League 11-12)</option>
              {rules.map(r => (
                <option key={r.id} value={r.id}>
                  {r.sanctioning_body} {r.age_group}{r.coach_id ? ' (custom)' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 flex-wrap">
          <button
            onClick={loadBoard}
            disabled={!subjectId || loading}
            className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 text-sm font-medium"
          >
            {loading ? <Loader2 className="animate-spin" size={16} /> : <Eye size={16} />}
            {loading ? 'Computing…' : 'Show Availability'}
          </button>
          <button
            onClick={() => setShowRuleManager(!showRuleManager)}
            className="text-sm text-blue-700 hover:underline"
          >
            {showRuleManager ? 'Hide rule editor' : 'Tournament uses different rules? Add or edit a rule set'}
          </button>
        </div>
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>

      {showRuleManager && (
        <RuleManager
          coachId={coachId}
          rules={rules}
          track={track}
          onSaved={async (newRuleId) => {
            onRulesChanged()
            if (newRuleId) setRuleId(newRuleId)
          }}
        />
      )}

      {board && coverage && (
        <>
          {/* Coverage honesty box — never imply full coverage */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
            <Info className="text-blue-600 flex-shrink-0 mt-0.5" size={18} />
            <div className="text-sm text-blue-900 space-y-1">
              {coverage.notes.map((n, i) => <p key={i}>{n}</p>)}
              {activeRule && (
                <p className="text-xs text-blue-700">
                  Rules applied: {activeRule.sanctioning_body} {activeRule.age_group}
                  {activeRule.daily_max ? ` (daily max ${activeRule.daily_max})` : ''} — verify against your
                  tournament&apos;s published rules.
                </p>
              )}
            </div>
          </div>

          {board.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center text-gray-500">
              No pitching appearances logged for this team yet. Log box scores with pitch counts to build the board.
            </div>
          ) : (
            <div className="space-y-2">
              {board.map(row => {
                const style = statusStyle[row.availability.status]
                const Icon = style.icon
                return (
                  <div key={row.player.id} className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="font-semibold text-gray-900">
                          {row.player.jersey_number ? `#${row.player.jersey_number} ` : ''}{row.player.name}
                          {row.player.identity_confidence !== 'confirmed' && (
                            <span className="ml-2 align-middle inline-flex">
                              <ConfidenceBadge confidence={row.player.identity_confidence} />
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 mt-0.5">
                          {row.availability.last_pitched
                            ? `Last pitched ${row.availability.last_pitched} (${row.availability.last_outing_pitches} pitches)`
                            : 'No outings logged'}
                          {row.availability.pitches_last_7_days > 0 &&
                            ` · ${row.availability.pitches_last_7_days} pitches in last 7 days`}
                          {row.availability.eligible_on && row.availability.status === 'ineligible' &&
                            ` · eligible ${row.availability.eligible_on}`}
                        </div>
                      </div>
                      <span className={`flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${style.badge}`}>
                        <Icon size={13} />
                        {row.availability.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 mt-2">{row.availability.explanation}</p>
                    {row.player.identity_confidence === 'uncertain' && (
                      <p className="text-xs text-amber-700 mt-1">
                        Identity of this player is uncertain — pitch totals could belong to a different kid. Review duplicates before relying on this.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Pitch count rule editor ────────────────────────────
// Tournament directors tweak rules weekend to weekend, so coaches can clone
// any rule set (system or their own), adjust the bands, and save it under
// the tournament's name. Editing an existing custom set = saving with the
// same name + age group (upsert). System defaults can't be changed, only
// cloned.

function RuleManager({
  coachId, rules, track, onSaved,
}: {
  coachId: string
  rules: RuleSet[]
  track: (event: string, metadata?: any) => void
  onSaved: (newRuleId: string | null) => void
}) {
  const [name, setName] = useState('')
  const [ageGroup, setAgeGroup] = useState('')
  const [dailyMax, setDailyMax] = useState<string>('')
  const [bands, setBands] = useState<Array<{ max_pitches: string; rest_days: string }>>([
    { max_pitches: '20', rest_days: '0' },
    { max_pitches: '35', rest_days: '1' },
    { max_pitches: '50', rest_days: '2' },
  ])
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const customRules = rules.filter(r => r.coach_id)

  const loadFrom = (rule: RuleSet) => {
    // Cloning a system set keeps the name editable; loading your own custom
    // set keeps its name so saving overwrites it in place
    setName(rule.coach_id ? rule.sanctioning_body : `${rule.sanctioning_body} (adjusted)`)
    setAgeGroup(rule.age_group)
    setDailyMax(rule.daily_max != null ? String(rule.daily_max) : '')
    setBands(rule.thresholds.map(t => ({ max_pitches: String(t.max_pitches), rest_days: String(t.rest_days) })))
    setErr(null)
  }

  const handleSave = async () => {
    setErr(null)
    const parsedBands = bands
      .filter(b => b.max_pitches !== '' && b.rest_days !== '')
      .map(b => ({ max_pitches: Number(b.max_pitches), rest_days: Number(b.rest_days) }))
      .sort((a, b) => a.max_pitches - b.max_pitches)

    if (!name.trim() || !ageGroup.trim()) {
      setErr('Give the rule set a name (e.g. the tournament name) and an age group.')
      return
    }
    if (parsedBands.length === 0 || parsedBands.some(b => isNaN(b.max_pitches) || isNaN(b.rest_days))) {
      setErr('Add at least one valid threshold band (numbers only).')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/scouting/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId,
          sanctioningBody: name.trim(),
          ageGroup: ageGroup.trim(),
          dailyMax: dailyMax === '' ? null : Number(dailyMax),
          thresholds: parsedBands,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')
      track('pitch_rule_saved', { name: name.trim(), age_group: ageGroup.trim() })
      onSaved(data.rule?.id || null)
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (ruleId: string) => {
    if (!confirm('Delete this custom rule set?')) return
    setDeleting(ruleId)
    await fetch(`/api/scouting/rules?ruleId=${ruleId}&coachId=${coachId}`, { method: 'DELETE' })
    setDeleting(null)
    onSaved(null)
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Custom Pitch Count Rules</h3>
        <p className="text-sm text-gray-600 mt-0.5">
          Every tournament can run its own limits. Start from a published rule set, adjust the bands to
          match your tournament&apos;s rules sheet, and save it under the tournament&apos;s name.
        </p>
      </div>

      {customRules.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-700 mb-1">Your rule sets</div>
          <div className="space-y-1">
            {customRules.map(r => (
              <div key={r.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span>
                  <span className="font-medium">{r.sanctioning_body}</span> {r.age_group}
                  {r.daily_max != null && <span className="text-gray-500"> · daily max {r.daily_max}</span>}
                  <span className="text-gray-500">
                    {' · '}
                    {r.thresholds.map(t => `≤${t.max_pitches}→${t.rest_days}d`).join(', ')}
                  </span>
                </span>
                <span className="flex items-center gap-2 flex-shrink-0 ml-3">
                  <button onClick={() => loadFrom(r)} className="text-blue-700 hover:underline">edit</button>
                  <button
                    onClick={() => handleDelete(r.id)}
                    disabled={deleting === r.id}
                    className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="sm:col-span-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">Start from</label>
          <select
            defaultValue=""
            onChange={e => {
              const rule = rules.find(r => r.id === e.target.value)
              if (rule) loadFrom(rule)
            }}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
          >
            <option value="">Blank / pick a rule set to copy…</option>
            {rules.map(r => (
              <option key={r.id} value={r.id}>
                {r.sanctioning_body} {r.age_group}{r.coach_id ? ' (custom)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Rule set name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Metro Summer Slam"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Age group</label>
          <input
            type="text"
            value={ageGroup}
            onChange={e => setAgeGroup(e.target.value)}
            placeholder="e.g. 11U"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Daily max (optional)</label>
          <input
            type="number"
            value={dailyMax}
            onChange={e => setDailyMax(e.target.value)}
            placeholder="e.g. 85"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Rest-day bands</label>
        <p className="text-xs text-gray-500 mb-2">
          Read as: &quot;threw up to N pitches → needs M full rest days.&quot; A pitcher&apos;s rest requirement is the
          first band their day total fits under.
        </p>
        <div className="space-y-2">
          {bands.map((b, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Up to</span>
              <input
                type="number"
                value={b.max_pitches}
                onChange={e => setBands(prev => prev.map((x, j) => (j === i ? { ...x, max_pitches: e.target.value } : x)))}
                className="w-20 px-2 py-1.5 border border-gray-300 rounded-lg"
              />
              <span className="text-gray-600">pitches →</span>
              <input
                type="number"
                value={b.rest_days}
                onChange={e => setBands(prev => prev.map((x, j) => (j === i ? { ...x, rest_days: e.target.value } : x)))}
                className="w-16 px-2 py-1.5 border border-gray-300 rounded-lg"
              />
              <span className="text-gray-600">rest day(s)</span>
              <button
                onClick={() => setBands(prev => prev.filter((_, j) => j !== i))}
                className="p-1 text-gray-400 hover:text-red-600"
                disabled={bands.length <= 1}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => setBands(prev => [...prev, { max_pitches: '', rest_days: '' }])}
          className="mt-2 text-sm text-blue-700 hover:underline"
        >
          + Add band
        </button>
      </div>

      {err && <p className="text-sm text-red-600">{err}</p>}

      <button
        onClick={handleSave}
        disabled={saving}
        className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 text-sm font-medium"
      >
        {saving ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
        {saving ? 'Saving…' : 'Save Rule Set'}
      </button>
      <p className="text-xs text-gray-500">
        Saving with the same name and age group updates that rule set in place. Published defaults
        (Little League, USSSA, Cal Ripken, Babe Ruth, Perfect Game) can&apos;t be edited — clone and adjust instead.
      </p>
    </div>
  )
}

// ── Suspense wrapper (useSearchParams requirement) ─────

export default function ScoutingPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    }>
      <ScoutingGate />
    </Suspense>
  )
}

// Inside the boundary, because reading the workspace out of the URL is what
// tells us whether this page can work at all.
function ScoutingGate() {
  const teamId = useSearchParams().get('teamId')
  return (
    <TeamOnly feature="scouting" teamId={teamId}>
      <ScoutingContent />
    </TeamOnly>
  )
}
