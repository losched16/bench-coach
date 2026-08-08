'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Users, Loader2, AlertCircle, AlertTriangle, ArrowRightLeft, Lock, Send, Sparkles,
} from 'lucide-react'
import { SUB_RULES, SubRuleSet } from '@/lib/substitutions'

// The lineup during the game: who is in, who can come in, and what a swap
// costs before you make it.
//
// Every legality answer comes from the server, which computes it with the same
// module the write path enforces. The browser never decides whether a move is
// legal — it only shows what it was told.

const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']

interface LivePlayer {
  teamPlayerId: string
  name: string
  isStarter: boolean
  battingSlot: number | null
  isIn: boolean
  timesRemoved: number
  reentries: number
  currentPosition: string | null
  entry: { allowed: boolean; reason: string; warning?: string }
  exit: { allowed: boolean; reason: string; warning?: string }
}

interface Props {
  gameId: string
  inning: number
  // Only used to link to the builder from the empty state.
  teamId?: string | null
}

export function LiveLineup({ gameId, inning, teamId }: Props) {
  const [players, setPlayers] = useState<LivePlayer[]>([])
  const [rules, setRules] = useState<SubRuleSet>('starter_reentry')
  const [loading, setLoading] = useState(true)
  const [migrationMessage, setMigrationMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A swap in progress: who is coming out, and what the server said about it.
  const [swapOut, setSwapOut] = useState<LivePlayer | null>(null)
  const [pending, setPending] = useState<{ reason: string; warning?: string; inId: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)
  // Rules the coach stated in chat. Kept on the game, shown here, and read
  // back into every later answer.
  const [houseRules, setHouseRules] = useState('')
  const [ruleAdded, setRuleAdded] = useState<string | null>(null)
  const [proposedRuleSet, setProposedRuleSet] = useState<SubRuleSet | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/lineup?gameId=${gameId}`)
      const d = await res.json()
      setPlayers(d.players || [])
      setRules(d.rules || 'starter_reentry')
      setHouseRules(d.houseRules || '')
      if (d.needsMigration) setMigrationMessage(d.migrationMessage || 'Run migration 028.')
    } catch {
      /* the rest of the game screen still works */
    } finally {
      setLoading(false)
    }
  }, [gameId])

  useEffect(() => { load() }, [load])

  const doSwap = async (outId: string, inId: string, force = false) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/game/lineup', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, action: 'swap', outId, inId, force }),
      })
      const d = await res.json()

      // 409 is a refusal with a reason, not a failure. The coach can override
      // — an umpire's call, an injury, a league quirk we don't model — but
      // knowingly rather than by accident.
      if (res.status === 409) {
        setPending({ reason: d.reason, warning: d.warning, inId })
        return
      }
      if (!res.ok) throw new Error(d.error || 'Could not make that change')

      setSwapOut(null)
      setPending(null)
      await load()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const setPosition = async (teamPlayerId: string, position: string) => {
    // Moving someone around the field is not a substitution — it needs no
    // rules check, and optimistic is right because it always succeeds.
    setPlayers(prev => prev.map(p =>
      p.teamPlayerId === teamPlayerId ? { ...p, currentPosition: position || null } : p
    ))
    await fetch('/api/game/lineup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, action: 'position', teamPlayerId, inning, position }),
    })
  }

  const changeRules = async (patch: { subRules?: SubRuleSet; houseRules?: string }) => {
    await fetch('/api/game/lineup', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, action: 'rules', ...patch }),
    })
    setProposedRuleSet(null)
    await load()
  }

  const ask = async () => {
    if (!question.trim()) return
    setAsking(true)
    setAnswer(null)
    try {
      const res = await fetch('/api/game/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId, question }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not answer that')
      setAnswer(d.answer)
      setQuestion('')
      // A rule they stated is now on the game and will shape every later
      // answer — say so, rather than letting it happen invisibly.
      if (d.houseRuleAdded) { setRuleAdded(d.houseRuleAdded); load() }
      if (d.proposedRuleSet) setProposedRuleSet(d.proposedRuleSet)
    } catch (e: any) {
      setAnswer(`Couldn't answer that: ${e.message}`)
    } finally {
      setAsking(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 p-4">
        <Loader2 className="animate-spin" size={15} /> Loading the lineup…
      </div>
    )
  }

  if (migrationMessage) {
    return (
      <div className="m-4 flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
        <AlertCircle size={16} className="shrink-0 mt-0.5 text-amber-600" />
        <p>{migrationMessage}</p>
      </div>
    )
  }

  if (players.length === 0) {
    // Telling a coach at the field to go somewhere else, without a way to get
    // there, is how a feature gets abandoned mid-game.
    return (
      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-500">
          No lineup set for this game yet. Build one or set it yourself, and it&apos;ll show up
          here with the subs.
        </p>
        <a
          href={`/dashboard/lineup?gameId=${gameId}${teamId ? `&teamId=${teamId}` : ''}`}
          className="inline-block px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg active:bg-blue-700"
        >
          Set the lineup
        </a>
      </div>
    )
  }

  const inGame = players.filter(p => p.isIn).sort(
    (a, b) => (a.battingSlot ?? 99) - (b.battingSlot ?? 99)
  )
  const availableNow = players.filter(p => !p.isIn && p.entry.allowed)
  const unavailable = players.filter(p => !p.isIn && !p.entry.allowed)

  return (
    <div className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex items-start gap-2 text-xs text-gray-600 bg-gray-50 rounded-lg p-2.5">
          <Lock size={13} className="shrink-0 mt-0.5 text-gray-400" />
          <span className="flex-1">
            <strong>{SUB_RULES[rules].label}.</strong> {SUB_RULES[rules].hint}
          </span>
          <select
            value={rules}
            onChange={e => changeRules({ subRules: e.target.value as SubRuleSet })}
            className="shrink-0 text-xs border border-gray-300 rounded px-1.5 py-1 bg-white"
            aria-label="Substitution rules"
          >
            {(Object.keys(SUB_RULES) as SubRuleSet[]).map(r => (
              <option key={r} value={r}>{SUB_RULES[r].label}</option>
            ))}
          </select>
        </div>

        {/* Anything the coach told the assistant about this league. Visible
            and removable, because a rule you can't see is one you can't
            correct when it was mis-transcribed. */}
        {houseRules && (
          <div className="text-xs bg-blue-50 border border-blue-200 rounded-lg p-2.5">
            <div className="flex items-start gap-2">
              <Sparkles size={13} className="shrink-0 mt-0.5 text-blue-500" />
              <div className="flex-1">
                <p className="font-medium text-blue-900 mb-1">Your rules for this game</p>
                {houseRules.split('\n').map((line, i) => (
                  <p key={i} className="text-blue-900">• {line}</p>
                ))}
              </div>
              <button
                onClick={() => changeRules({ houseRules: '' })}
                className="shrink-0 text-blue-400 hover:text-blue-700"
                aria-label="Clear house rules"
              >
                ✕
              </button>
            </div>
            <p className="text-blue-700 mt-1.5">
              Used in every answer below. The buttons still enforce the ruleset above — where the two
              disagree, use &ldquo;Do it anyway&rdquo;.
            </p>
          </div>
        )}

        {proposedRuleSet && (
          <div className="text-xs bg-amber-50 border border-amber-200 rounded-lg p-2.5">
            <p className="text-amber-900 mb-2">
              That sounds like <strong>{SUB_RULES[proposedRuleSet].label}</strong>. Switch this game
              over so the buttons match?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => changeRules({ subRules: proposedRuleSet })}
                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg"
              >
                Switch
              </button>
              <button
                onClick={() => setProposedRuleSet(null)}
                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg"
              >
                Leave it
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {/* On the field */}
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          In the game ({inGame.length})
        </h4>
        <div className="space-y-2">
          {inGame.map(p => (
            <div
              key={p.teamPlayerId}
              className={`flex items-center gap-2 p-2.5 rounded-lg border ${
                swapOut?.teamPlayerId === p.teamPlayerId
                  ? 'border-red-400 bg-red-50'
                  : 'border-gray-200 bg-white'
              }`}
            >
              <span className="w-6 text-xs text-gray-400 tabular-nums shrink-0">
                {p.battingSlot ?? '—'}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-medium text-gray-900 truncate">{p.name}</span>
                <span className="block text-xs text-gray-500">
                  {p.isStarter ? 'Starter' : 'Sub'}
                  {p.isStarter && p.reentries === 0 && rules === 'starter_reentry' && ' · re-entry available'}
                  {p.reentries > 0 && ' · re-entry used'}
                </span>
              </span>

              <select
                value={p.currentPosition || ''}
                onChange={e => setPosition(p.teamPlayerId, e.target.value)}
                className="text-xs border border-gray-300 rounded px-1.5 py-1 shrink-0"
              >
                <option value="">Bench</option>
                {POSITIONS.map(pos => <option key={pos} value={pos}>{pos}</option>)}
              </select>

              <button
                onClick={() => { setSwapOut(swapOut?.teamPlayerId === p.teamPlayerId ? null : p); setPending(null) }}
                className={`shrink-0 p-1.5 rounded ${
                  swapOut?.teamPlayerId === p.teamPlayerId
                    ? 'bg-red-600 text-white'
                    : 'text-gray-400 hover:text-gray-700'
                }`}
                aria-label={`Sub out ${p.name}`}
              >
                <ArrowRightLeft size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Who can come in for them */}
      {swapOut && (
        <div className="border-2 border-red-200 rounded-lg p-3 bg-red-50/40">
          <p className="text-sm font-medium text-gray-900 mb-1">
            Who comes in for {swapOut.name}?
          </p>
          {swapOut.exit.warning && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 mb-2 flex gap-1.5">
              <AlertTriangle size={13} className="shrink-0 mt-0.5 text-amber-600" />
              {swapOut.exit.warning}
            </p>
          )}

          {pending && (
            <div className="mb-2 p-2.5 bg-white border border-red-300 rounded">
              <p className="text-sm text-red-800">{pending.reason}</p>
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => doSwap(swapOut.teamPlayerId, pending.inId, true)}
                  disabled={busy}
                  className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg disabled:opacity-50"
                >
                  Do it anyway
                </button>
                <button
                  onClick={() => setPending(null)}
                  className="px-3 py-1.5 bg-white border border-gray-300 text-xs rounded-lg"
                >
                  Never mind
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                Override only if an umpire or your league says otherwise — it&apos;s recorded either way.
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {availableNow.map(p => (
              <button
                key={p.teamPlayerId}
                onClick={() => doSwap(swapOut.teamPlayerId, p.teamPlayerId)}
                disabled={busy}
                className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:border-gray-500 disabled:opacity-50"
              >
                {p.name}
                {p.isStarter && p.timesRemoved > 0 && (
                  <span className="block text-[10px] text-amber-700">uses re-entry</span>
                )}
              </button>
            ))}
            {availableNow.length === 0 && (
              <p className="text-sm text-gray-600">Nobody on the bench can legally come in.</p>
            )}
          </div>

          <button
            onClick={() => { setSwapOut(null); setPending(null) }}
            className="mt-3 text-xs text-gray-500 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Done for the day, and why. Shown so a coach doesn't keep looking for
          a kid who can't come back. */}
      {unavailable.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Can&apos;t re-enter
          </h4>
          <div className="space-y-1">
            {unavailable.map(p => (
              <p key={p.teamPlayerId} className="text-xs text-gray-600">
                <span className="font-medium text-gray-800">{p.name}</span> — {p.entry.reason}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Ask. The rules state above is what it answers from. */}
      <div className="pt-3 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && ask()}
            placeholder="Can I bring RJ back in? Should I pull the pitcher?"
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <button
            onClick={ask}
            disabled={asking || !question.trim()}
            className="px-3 py-2 bg-gray-900 text-white rounded-lg disabled:opacity-50"
            aria-label="Ask"
          >
            {asking ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
          </button>
        </div>
        {ruleAdded && (
          <p className="mt-2 text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded p-2">
            Saved for this game: &ldquo;{ruleAdded}&rdquo;
          </p>
        )}
        {answer && (
          <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900 flex gap-2">
            <Sparkles size={15} className="shrink-0 mt-0.5 text-blue-500" />
            <p className="whitespace-pre-wrap">{answer}</p>
          </div>
        )}
      </div>
    </div>
  )
}
