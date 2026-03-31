'use client'

import { useState, useEffect } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import {
  ArrowLeft, Trophy, TrendingUp, TrendingDown, Minus, Star, Zap,
  Calendar, ChevronDown, ChevronUp, Award, BarChart3, Target,
  Share2, Loader2
} from 'lucide-react'

interface SeasonStats {
  team_player_id: string
  player_id: string
  player_name: string
  jersey_number: string | null
  games_played: number
  total_ab: number
  total_hits: number
  total_singles: number
  total_doubles: number
  total_triples: number
  total_hr: number
  total_rbi: number
  total_runs: number
  total_walks: number
  total_strikeouts: number
  total_hbp: number
  total_sb: number
  total_cs: number
  batting_avg: number
  obp: number
  slg: number
  total_putouts: number
  total_assists: number
  total_errors: number
}

interface GameLogEntry {
  id: string
  at_bats: number | null
  hits: number | null
  doubles: number | null
  triples: number | null
  home_runs: number | null
  rbi: number | null
  runs: number | null
  walks: number | null
  strikeouts: number | null
  stolen_bases: number | null
  errors: number | null
  game_notes: string | null
  game: {
    id: string
    game_date: string
    opponent: string | null
    team_score: number | null
    opponent_score: number | null
    result: string | null
    game_type: string | null
  }
}

interface Milestone {
  id: string
  milestone_type: string
  title: string
  description: string | null
  stat_value: string | null
  achieved_at: string
}

export default function PlayerStatsPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const playerId = params.playerId as string
  const teamId = searchParams.get('teamId')

  const [loading, setLoading] = useState(true)
  const [seasonStats, setSeasonStats] = useState<SeasonStats | null>(null)
  const [gameLog, setGameLog] = useState<GameLogEntry[]>([])
  const [milestones, setMilestones] = useState<Milestone[]>([])
  const [activeTab, setActiveTab] = useState<'overview' | 'games' | 'milestones'>('overview')

  useEffect(() => {
    if (!playerId || !teamId) return
    const load = async () => {
      const res = await fetch(`/api/stats?playerId=${playerId}&teamId=${teamId}`)
      const data = await res.json()
      setSeasonStats(data.seasonStats)
      setGameLog(data.gameLog || [])
      setMilestones(data.milestones || [])
      setLoading(false)
    }
    load()
  }, [playerId, teamId])

  const [sharing, setSharing] = useState(false)

  const handleShare = async () => {
    setSharing(true)
    try {
      const cardUrl = `/api/stats/player-card?playerId=${playerId}&teamId=${teamId}`
      
      // Try native share first (mobile)
      if (navigator.share) {
        // Fetch the SVG and convert to blob for sharing
        const res = await fetch(cardUrl)
        const svgText = await res.text()
        
        // Convert SVG to canvas to PNG
        const canvas = document.createElement('canvas')
        canvas.width = 600
        canvas.height = 340
        const ctx = canvas.getContext('2d')
        
        const img = new Image()
        img.onload = async () => {
          ctx?.drawImage(img, 0, 0)
          canvas.toBlob(async (blob) => {
            if (blob) {
              const file = new File([blob], `${seasonStats?.player_name || 'player'}-stats.png`, { type: 'image/png' })
              try {
                await navigator.share({
                  title: `${seasonStats?.player_name} - Season Stats`,
                  text: `Check out ${seasonStats?.player_name}'s stats! Powered by Bench Coach`,
                  files: [file],
                })
              } catch (e) {
                // User cancelled share or share failed, try URL fallback
                await navigator.share({
                  title: `${seasonStats?.player_name} - Season Stats`,
                  text: `${seasonStats?.player_name} is batting ${(Number(seasonStats?.batting_avg) || 0).toFixed(3)} this season! ${seasonStats?.total_hits} hits, ${seasonStats?.total_rbi} RBI, ${seasonStats?.total_hr} HR. Tracked with Bench Coach - mybenchcoach.com`,
                })
              }
            }
            setSharing(false)
          }, 'image/png')
        }
        img.onerror = () => {
          // SVG load failed, share text only
          navigator.share({
            title: `${seasonStats?.player_name} - Season Stats`,
            text: `${seasonStats?.player_name} is batting ${(Number(seasonStats?.batting_avg) || 0).toFixed(3)} this season! ${seasonStats?.total_hits} hits, ${seasonStats?.total_rbi} RBI, ${seasonStats?.total_hr} HR. Tracked with Bench Coach - mybenchcoach.com`,
          })
          setSharing(false)
        }
        img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText)
      } else {
        // Desktop fallback: open card image in new tab
        window.open(cardUrl, '_blank')
        setSharing(false)
      }
    } catch (error) {
      console.error('Share error:', error)
      setSharing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-red-600" size={32} />
      </div>
    )
  }

  if (!seasonStats) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 text-center text-slate-500">
        <p>No stats found for this player.</p>
        <button
          onClick={() => window.history.back()}
          className="mt-4 text-red-600 font-medium"
        >
          Go Back
        </button>
      </div>
    )
  }

  const ops = (Number(seasonStats.obp) || 0) + (Number(seasonStats.slg) || 0)

  // Rolling average (last 5 games vs prior 5)
  const recent5 = gameLog.slice(0, 5)
  const prior5 = gameLog.slice(5, 10)
  const recentAvg = recent5.length > 0
    ? recent5.reduce((s, g) => s + (g.hits || 0), 0) / Math.max(recent5.reduce((s, g) => s + (g.at_bats || 0), 0), 1)
    : 0
  const priorAvg = prior5.length > 0
    ? prior5.reduce((s, g) => s + (g.hits || 0), 0) / Math.max(prior5.reduce((s, g) => s + (g.at_bats || 0), 0), 1)
    : 0
  const avgTrend = recentAvg - priorAvg

  // Highlights auto-generation
  const highlights: string[] = []
  const bestGame = gameLog.reduce((best, g) => {
    const hits = g.hits || 0
    const bestHits = best?.hits || 0
    return hits > bestHits ? g : best
  }, gameLog[0])
  if (bestGame && (bestGame.hits || 0) > 0) {
    highlights.push(`Best game: ${bestGame.hits}-for-${bestGame.at_bats} vs ${bestGame.game?.opponent || 'opponent'}`)
  }
  // Hitting streak
  let streak = 0
  for (const g of gameLog) {
    if ((g.hits || 0) > 0) streak++
    else break
  }
  if (streak >= 2) highlights.push(`${streak}-game hitting streak`)
  if (seasonStats.total_hr > 0) highlights.push(`${seasonStats.total_hr} home run${seasonStats.total_hr > 1 ? 's' : ''} this season`)
  if (seasonStats.total_sb >= 3) highlights.push(`${seasonStats.total_sb} stolen bases`)

  return (
    <div className="max-w-4xl mx-auto px-4 pb-24">
      {/* Back + Share */}
      <div className="flex items-center justify-between py-3">
        <button
          onClick={() => window.history.back()}
          className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft size={16} /> Back to Stats
        </button>
        <button
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center gap-1.5 bg-red-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {sharing ? <Loader2 size={14} className="animate-spin" /> : <Share2 size={14} />}
          Share Card
        </button>
      </div>

      {/* Player Card Header */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-2xl p-5 text-white mb-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-3xl font-black">
              {seasonStats.jersey_number ? `#${seasonStats.jersey_number}` : ''}
            </div>
            <h1 className="text-xl font-bold mt-1">{seasonStats.player_name}</h1>
            <p className="text-slate-400 text-sm mt-0.5">
              {seasonStats.games_played} game{seasonStats.games_played !== 1 ? 's' : ''} played
            </p>
          </div>
          <div className="text-right">
            <div className="text-4xl font-black font-mono">
              {(Number(seasonStats.batting_avg) || 0).toFixed(3).replace('0.', '.')}
            </div>
            <p className="text-slate-400 text-xs mt-0.5">AVG</p>
          </div>
        </div>

        {/* Big 4 Stats */}
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'OBP', value: (Number(seasonStats.obp) || 0).toFixed(3).replace('0.', '.') },
            { label: 'SLG', value: (Number(seasonStats.slg) || 0).toFixed(3).replace('0.', '.') },
            { label: 'OPS', value: ops.toFixed(3).replace(/^0/, '') },
            { label: 'RBI', value: (seasonStats.total_rbi || 0).toString() },
          ].map(stat => (
            <div key={stat.label} className="text-center">
              <div className="text-lg font-bold font-mono">{stat.value}</div>
              <div className="text-[10px] text-slate-400 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))}
        </div>

        {/* Trend Indicator */}
        {gameLog.length >= 5 && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            {avgTrend > 0.02 ? (
              <><TrendingUp size={14} className="text-green-400" /><span className="text-green-400">Trending up (last 5 games)</span></>
            ) : avgTrend < -0.02 ? (
              <><TrendingDown size={14} className="text-red-400" /><span className="text-red-400">Trending down (last 5 games)</span></>
            ) : (
              <><Minus size={14} className="text-slate-400" /><span className="text-slate-400">Steady (last 5 games)</span></>
            )}
          </div>
        )}
      </div>

      {/* Highlights */}
      {highlights.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-3 mb-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-yellow-700 mb-1.5">
            <Star size={12} /> Season Highlights
          </div>
          <div className="space-y-1">
            {highlights.map((h, i) => (
              <p key={i} className="text-sm text-yellow-800">{h}</p>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-4">
        {(['overview', 'games', 'milestones'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors capitalize ${
              activeTab === tab
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Counting Stats */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Batting</h3>
            <div className="grid grid-cols-4 gap-y-3 gap-x-2">
              {[
                { label: 'AB', value: seasonStats.total_ab },
                { label: 'H', value: seasonStats.total_hits },
                { label: 'R', value: seasonStats.total_runs },
                { label: 'RBI', value: seasonStats.total_rbi },
                { label: '2B', value: seasonStats.total_doubles },
                { label: '3B', value: seasonStats.total_triples },
                { label: 'HR', value: seasonStats.total_hr },
                { label: 'BB', value: seasonStats.total_walks },
                { label: 'K', value: seasonStats.total_strikeouts },
                { label: 'SB', value: seasonStats.total_sb },
                { label: 'HBP', value: seasonStats.total_hbp },
                { label: 'CS', value: seasonStats.total_cs },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <div className="text-lg font-bold text-slate-900">{s.value}</div>
                  <div className="text-[10px] text-slate-400 uppercase">{s.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Fielding */}
          {(seasonStats.total_putouts > 0 || seasonStats.total_assists > 0 || seasonStats.total_errors > 0) && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">Fielding</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-900">{seasonStats.total_putouts}</div>
                  <div className="text-[10px] text-slate-400 uppercase">PO</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-900">{seasonStats.total_assists}</div>
                  <div className="text-[10px] text-slate-400 uppercase">A</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-slate-900">{seasonStats.total_errors}</div>
                  <div className="text-[10px] text-slate-400 uppercase">E</div>
                </div>
              </div>
            </div>
          )}

          {/* Rolling Average Chart (simple text-based) */}
          {gameLog.length >= 3 && (
            <div className="bg-white rounded-xl border border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mb-3">
                Game-by-Game AVG
              </h3>
              <div className="flex items-end gap-1.5 h-24">
                {gameLog.slice(0, 10).reverse().map((g, i) => {
                  const ab = g.at_bats || 0
                  const h = g.hits || 0
                  const avg = ab > 0 ? h / ab : 0
                  const heightPct = Math.max(avg * 100, 4) // min 4% so 0-for shows
                  return (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1">
                      <div
                        className={`w-full rounded-t transition-all ${
                          avg >= 0.300 ? 'bg-green-500' : avg > 0 ? 'bg-red-400' : 'bg-slate-200'
                        }`}
                        style={{ height: `${heightPct}%` }}
                        title={`${h}-${ab} (${avg.toFixed(3)})`}
                      />
                      <span className="text-[9px] text-slate-400">
                        {h}-{ab}
                      </span>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-slate-400 text-center mt-2">
                Last {Math.min(gameLog.length, 10)} games (oldest → newest)
              </p>
            </div>
          )}
        </div>
      )}

      {/* Games Tab */}
      {activeTab === 'games' && (
        <div className="space-y-2">
          {gameLog.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Calendar size={36} className="mx-auto mb-2 opacity-50" />
              <p>No games logged</p>
            </div>
          ) : (
            gameLog.map(g => (
              <div key={g.id} className="bg-white rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                      g.game?.result === 'win' ? 'bg-green-100 text-green-700' :
                      g.game?.result === 'loss' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-500'
                    }`}>
                      {g.game?.result?.charAt(0).toUpperCase() || '—'}
                    </span>
                    <span className="text-sm font-medium text-slate-900">
                      vs {g.game?.opponent || 'Unknown'}
                    </span>
                  </div>
                  <span className="text-xs text-slate-400">
                    {new Date(g.game?.game_date + 'T12:00:00').toLocaleDateString('en-US', {
                      month: 'short', day: 'numeric'
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  {g.at_bats !== null && (
                    <span className="font-mono font-semibold text-slate-900">
                      {g.hits || 0}-{g.at_bats}
                    </span>
                  )}
                  {(g.runs || 0) > 0 && <span className="text-slate-600">{g.runs}R</span>}
                  {(g.rbi || 0) > 0 && <span className="text-slate-600">{g.rbi}RBI</span>}
                  {(g.home_runs || 0) > 0 && <span className="text-red-600 font-medium">{g.home_runs}HR</span>}
                  {(g.doubles || 0) > 0 && <span className="text-slate-600">{g.doubles}×2B</span>}
                  {(g.stolen_bases || 0) > 0 && <span className="text-slate-600">{g.stolen_bases}SB</span>}
                  {(g.walks || 0) > 0 && <span className="text-slate-500">{g.walks}BB</span>}
                </div>
                {g.game_notes && (
                  <p className="text-xs text-slate-500 mt-2 italic">{g.game_notes}</p>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Milestones Tab */}
      {activeTab === 'milestones' && (
        <div className="space-y-2">
          {milestones.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Award size={36} className="mx-auto mb-2 opacity-50" />
              <p>No milestones yet</p>
              <p className="text-sm mt-1">Keep playing — they'll come!</p>
            </div>
          ) : (
            milestones.map(m => (
              <div key={m.id} className="bg-white rounded-xl border border-slate-200 p-4 flex items-start gap-3">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                  m.milestone_type === 'first_hr' ? 'bg-red-100' :
                  m.milestone_type === 'hitting_streak' ? 'bg-orange-100' :
                  m.milestone_type === 'multi_hit_game' ? 'bg-green-100' :
                  'bg-yellow-100'
                }`}>
                  {m.milestone_type === 'first_hr' ? <Zap size={18} className="text-red-600" /> :
                   m.milestone_type === 'hitting_streak' ? <TrendingUp size={18} className="text-orange-600" /> :
                   m.milestone_type === 'multi_hit_game' ? <Target size={18} className="text-green-600" /> :
                   <Award size={18} className="text-yellow-600" />}
                </div>
                <div>
                  <h4 className="font-semibold text-slate-900">{m.title}</h4>
                  {m.description && <p className="text-sm text-slate-600 mt-0.5">{m.description}</p>}
                  <p className="text-xs text-slate-400 mt-1">
                    {new Date(m.achieved_at + 'T12:00:00').toLocaleDateString('en-US', {
                      month: 'long', day: 'numeric', year: 'numeric'
                    })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
