'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { usePageView, useTracker } from '@/lib/tracking'
import {
  ENTRY_TYPES, ENTRY_TYPE_ORDER, EntryType,
  mostRecentWeekend, defaultEntryType,
} from '@/lib/entries'
import {
  Loader2, CheckCircle2, AlertTriangle, X, Plus,
  ClipboardList, ChevronRight, Trash2, Info, Target, MessageSquare,
} from 'lucide-react'
import { focusAreaLabel, focusAreaChip, focusAreaRank } from '@/lib/focusAreas'
import { PriorityDrills } from '@/components/PriorityDrills'
import { prepareImages, imagesFromClipboard } from '@/lib/imagePrep'

// ── Types ──────────────────────────────────────────────

// A priority a home session can be credited to. Several run in parallel —
// one per area of the game — so this can never be guessed.
interface OpenPriority {
  id: string
  focusArea: string | null
  subjectName: string
  priority: string | null
  playerId: string | null
  adherence: { logged: number; expected: number }
  daysElapsed: number
}

interface RosterPlayer {
  team_player_id: string
  player_id: string
  name: string
  jersey_number: string | null
}

interface ParsedPlayer {
  name: string
  jersey_number: string | null
  batting_line: any
  innings_pitched: number | null
  pitches_thrown: number | null
  pitching_k: number | null
  pitching_bb: number | null
  errors: number | null
  low_confidence_fields: string[]
  team_player_id: string | null
  match_confidence: 'exact' | 'strong' | 'possible' | 'none'
}

interface ParsedGame {
  game_date: string | null
  opponent: string | null
  team_score: number | null
  opponent_score: number | null
  result: string | null
  players: ParsedPlayer[]
  confidence: string
  warnings: string[]
}

interface RecentEntry {
  id: string
  entry_type: string
  occurred_on: string
  title: string | null
  observations?: Array<{ id: string; body: string }>
  player?: { id: string; name: string } | null
}

// ── Step heading ───────────────────────────────────────
// The numbered markers are what give this screen a wizard's clarity without
// a wizard's clicks: it reads as a sequence, but nothing is gated.

function Step({
  n, title, subtitle, children,
}: {
  n: number
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3 sm:gap-4">
      <div className="flex flex-col items-center flex-shrink-0">
        <div className="w-7 h-7 rounded-full bg-red-600 text-white text-sm font-semibold flex items-center justify-center">
          {n}
        </div>
        <div className="w-px flex-1 bg-gray-200 mt-2" />
      </div>
      <div className="flex-1 min-w-0 pb-7">
        <h2 className="font-semibold text-gray-900">{title}</h2>
        {subtitle && <p className="text-sm text-gray-500 mt-0.5 mb-2">{subtitle}</p>}
        <div className={subtitle ? '' : 'mt-2'}>{children}</div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────

function LogContent() {
  const supabase = createSupabaseComponentClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const teamId = searchParams.get('teamId')
  const track = useTracker()
  usePageView('log')

  const [coachId, setCoachId] = useState<string | null>(null)
  const [teamName, setTeamName] = useState('')
  const [roster, setRoster] = useState<RosterPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [recent, setRecent] = useState<RecentEntry[]>([])

  // Form state — everything starts pre-filled so a user can land and save
  const [entryType, setEntryType] = useState<EntryType>('game')
  const [occurredOn, setOccurredOn] = useState(mostRecentWeekend())
  const [playerId, setPlayerId] = useState<string>('')
  const [instructorName, setInstructorName] = useState('')
  const [openPriorities, setOpenPriorities] = useState<OpenPriority[]>([])
  // '' means "something else" — logged, but not credited to any priority.
  const [prescriptionId, setPrescriptionId] = useState<string>('')
  const [durationMin, setDurationMin] = useState<string>('')
  const [noteValues, setNoteValues] = useState<Record<string, string>>({})

  // Screenshots + background parse
  const [files, setFiles] = useState<File[]>([])
  const [parsing, setParsing] = useState(false)
  const [parseMessage, setParseMessage] = useState<string | null>(null)
  const [parsedGames, setParsedGames] = useState<ParsedGame[] | null>(null)

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<{
    games: number; attached: number; stats: number; notes: number
    prescriptionId: string | null
    playerId: string | null
    // The coach's own words, kept so the follow-up conversation can open with
    // what they actually wrote rather than "tell me about your session".
    seed: string | null
  } | null>(null)
  const [openingThread, setOpeningThread] = useState(false)
  const startedAt = useRef<number>(Date.now())
  // Held so a save that lands mid-parse can wait for it rather than dropping
  // the stats on the floor — the user was told it would wait.
  const parsePromise = useRef<Promise<ParsedGame[] | null> | null>(null)

  const config = ENTRY_TYPES[entryType]

  // Only the priorities this session could plausibly belong to. Once a player
  // is chosen, team priorities and other players' drop out.
  const relevantPriorities = openPriorities.filter(
    p => !playerId || !p.playerId || p.playerId === playerId
  )

  // Preselect only when there is genuinely one answer. With several areas
  // running, defaulting to "most recent" is the guess this replaced.
  useEffect(() => {
    if (!config.linksToPrescription) return
    if (prescriptionId && relevantPriorities.some(p => p.id === prescriptionId)) return
    setPrescriptionId(relevantPriorities.length === 1 ? relevantPriorities[0].id : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryType, playerId, openPriorities])

  // Logging is evidence. The useful next move is a reaction to what was
  // written, not a generic "here's what to work on" — which is what the old
  // button did: it dumped you into whatever conversation you had open last,
  // about something else entirely.
  const discussSession = async () => {
    if (!saved?.seed || !teamId) return
    setOpeningThread(true)
    try {
      const res = await fetch('/api/chat/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, playerId: saved.playerId }),
      })
      const data = await res.json()
      const params = new URLSearchParams({ teamId })
      if (data.thread?.id) params.set('threadId', data.thread.id)
      if (saved.playerId) params.set('playerId', saved.playerId)
      // Browsers and proxies start dropping URLs past ~2000 characters, and a
      // truncated question is worse than a short one.
      params.set('seed', saved.seed.slice(0, 1200))
      router.push(`/dashboard/chat?${params}`)
    } catch {
      // A failure here must not strand them — the entry is already saved.
      router.push(`/dashboard/chat?teamId=${teamId}`)
    } finally {
      setOpeningThread(false)
    }
  }

  // Arriving from a finished game: type, date and opponent are already known,
  // so the coach lands on the one thing that isn't — the box score.
  useEffect(() => {
    const t = searchParams.get('type')
    if (t && (ENTRY_TYPE_ORDER as readonly string[]).includes(t)) setEntryType(t as EntryType)
    const d = searchParams.get('date')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setOccurredOn(d)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Init ──
  useEffect(() => {
    const init = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: coach } = await supabase
        .from('coaches').select('id').eq('user_id', user.id).single() as { data: { id: string } | null }
      if (!coach) return
      setCoachId(coach.id)

      if (teamId) {
        const { data: team } = await supabase
          .from('teams').select('name').eq('id', teamId).single() as { data: { name: string } | null }
        if (team) setTeamName(team.name)

        const { data: tps } = await supabase
          .from('team_players')
          .select('id, player:players(id, name, jersey_number)')
          .eq('team_id', teamId)

        const list: RosterPlayer[] = (tps || []).map((tp: any) => ({
          team_player_id: tp.id,
          player_id: tp.player?.id,
          name: tp.player?.name || '',
          jersey_number: tp.player?.jersey_number ?? null,
        })).filter((r: RosterPlayer) => r.name)

        setRoster(list)
        setEntryType(defaultEntryType(list.length))
        // Home scope: one player, so there is nothing to choose
        if (list.length === 1) setPlayerId(list[0].player_id)
      }

      await Promise.all([loadRecent(coach.id), loadPriorities(coach.id)])
      setLoading(false)
    }
    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  const loadPriorities = async (cid: string) => {
    try {
      const params = new URLSearchParams({ coachId: cid })
      if (teamId) params.set('teamId', teamId)
      const res = await fetch(`/api/checkin?${params}`)
      const data = await res.json()
      const list: OpenPriority[] = (data.prescriptions || [])
        .map((p: any) => ({
          id: p.id,
          focusArea: p.focusArea ?? null,
          subjectName: p.subjectName,
          priority: p.priority,
          playerId: p.playerId ?? null,
          adherence: p.adherence,
        }))
        .sort((a: OpenPriority, b: OpenPriority) =>
          focusAreaRank(a.focusArea) - focusAreaRank(b.focusArea))
      setOpenPriorities(list)
    } catch {
      // The picker just doesn't appear — the entry still saves.
    }
  }

  const loadRecent = async (cid: string) => {
    const params = new URLSearchParams({ coachId: cid, limit: '5' })
    if (teamId) params.set('teamId', teamId)
    const res = await fetch(`/api/log?${params}`)
    const data = await res.json()
    if (data.needsMigration) setNeedsMigration(true)
    setRecent(data.entries || [])
  }

  // ── Background parse ──
  // Fires the moment files are chosen so it runs while the user types notes.

  const startParse = useCallback((selected: File[]) => {
    if (selected.length === 0) return
    setParsing(true)
    setParseMessage(null)
    setParsedGames(null)
    track('log_parse_started', { type: entryType, images: selected.length })

    const run = async (): Promise<ParsedGame[] | null> => {
      try {
        // Downscales phone screenshots under the API's limit and reports
        // formats it can't read (HEIC) with a fix rather than a failure.
        const { images, errors: imageErrors } = await prepareImages(selected)
        if (images.length === 0) {
          setParseMessage(imageErrors[0] || "Couldn't read those images.")
          setParsing(false)
          return null
        }
        if (imageErrors.length > 0) setParseMessage(imageErrors.join(' '))
        const res = await fetch('/api/log/parse', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images, teamId, teamName }),
        })
        const data = await res.json()
        if (data.parseFailed || !data.games || data.games.length === 0) {
          setParseMessage(
            data.message ||
            "Couldn't find a box score in those images. Your notes will still save — you can add stats later."
          )
          setParsedGames([])
          return []
        }
        setParsedGames(data.games)
        track('log_parse_completed', {
          games: data.games.length,
          unmatched: data.unmatchedCount || 0,
        })
        return data.games as ParsedGame[]
      } catch {
        setParseMessage("Couldn't read those screenshots. Your notes will still save.")
        setParsedGames([])
        return []
      } finally {
        setParsing(false)
      }
    }

    const p = run()
    parsePromise.current = p
    return p
  }, [entryType, teamId, teamName, track])

  const handleFiles = (selected: File[]) => {
    setFiles(selected)
    setParsedGames(null)
    setParseMessage(null)
    if (selected.length > 0 && config.parses) startParse(selected)
  }

  // Pasting a screenshot is the gesture people actually use. The page ignored
  // it entirely before, silently — no image, no error, nothing.
  useEffect(() => {
    if (config.screenshots === 'none') return
    const onPaste = (e: ClipboardEvent) => {
      const pasted = imagesFromClipboard(e)
      if (pasted.length === 0) return
      e.preventDefault()
      handleFiles([...files, ...pasted])
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryType, files])

  // ── Editing the parse ──
  const updatePlayer = (gi: number, pi: number, field: string, value: any) => {
    setParsedGames(prev => {
      if (!prev) return prev
      const next = prev.map((g, i) => {
        if (i !== gi) return g
        return {
          ...g,
          players: g.players.map((p, j) => {
            if (j !== pi) return p
            if (field.startsWith('bl.')) {
              const key = field.slice(3)
              return { ...p, batting_line: { ...p.batting_line, [key]: value === '' ? undefined : Number(value) } }
            }
            return { ...p, [field]: value }
          }),
        }
      })
      return next
    })
  }

  const removePlayer = (gi: number, pi: number) => {
    setParsedGames(prev => prev
      ? prev.map((g, i) => i === gi ? { ...g, players: g.players.filter((_, j) => j !== pi) } : g)
      : prev)
  }

  // ── Save ──
  const handleSave = async () => {
    if (!coachId) return
    setSaving(true)
    try {
      // If the parse is still running, wait for it — the user was told we
      // would, and dropping it here would silently lose the stats.
      let gamesForSave = parsedGames
      if (parsing && parsePromise.current) {
        gamesForSave = await parsePromise.current
      }

      // Best-effort screenshot upload; failure never blocks the entry
      const imageUrls: string[] = []
      for (const file of files) {
        const ext = file.name.split('.').pop()
        const path = `log/${coachId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`
        const { error } = await supabase.storage.from('journal-media').upload(path, file)
        if (!error) imageUrls.push(path)
      }

      const notes = Object.entries(noteValues)
        .filter(([, body]) => body.trim())
        .map(([prompt_key, body]) => ({ prompt_key, body }))

      // Roster mappings the coach saw and accepted (or corrected)
      const rosterMappings: Array<{ source_name: string; team_player_id: string }> = []
      ;(gamesForSave || []).forEach(g => g.players.forEach(p => {
        if (p.team_player_id) rosterMappings.push({ source_name: p.name, team_player_id: p.team_player_id })
      }))

      const res = await fetch('/api/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          coachId,
          teamId,
          playerId: playerId || null,
          entryType,
          occurredOn,
          notes,
          imageUrls,
          rawParse: gamesForSave ? { games: gamesForSave } : null,
          parseStatus: gamesForSave === null ? 'none' : gamesForSave.length > 0 ? 'parsed' : 'failed',
          instructorName: config.capturesInstructor ? instructorName || null : null,
          durationMin: config.capturesDuration && durationMin ? Number(durationMin) : null,
          games: config.parses ? gamesForSave || [] : [],
          rosterMappings,
          prescriptionId: config.linksToPrescription ? prescriptionId || null : null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Save failed')

      track('entry_logged', {
        type: entryType,
        seconds: Math.round((Date.now() - startedAt.current) / 1000),
        games: data.summary?.gamesCreated || 0,
        notes: notes.length,
      })

      // Compose the follow-up question now, before the form resets. Their
      // words lead — the model should react to what happened, not ask for it.
      const noteLines = notes
        .map(n => {
          const label = config.prompts.find(p => p.key === n.prompt_key)?.label || n.prompt_key
          return `${label} ${n.body.trim()}`
        })
        .join('\n')

      const subject = playerId
        ? (roster.find(r => r.player_id === playerId)?.name || 'this player')
        : 'the team'

      setSaved({
        games: data.summary?.gamesCreated || 0,
        attached: data.summary?.gamesAttached || 0,
        stats: data.summary?.statLinesCreated || 0,
        notes: data.summary?.observations || 0,
        prescriptionId: config.linksToPrescription ? prescriptionId || null : null,
        playerId: playerId || null,
        seed: noteLines
          ? `I just logged a ${config.label.toLowerCase()} for ${subject} on ${occurredOn}.\n\n${noteLines}\n\nWhat should I take from that, and what would you do next time out?`
          : null,
      })

      // Reset for the next entry — the common case is logging several in a row
      setFiles([])
      setParsedGames(null)
      setParseMessage(null)
      setNoteValues({})
      setInstructorName('')
      setDurationMin('')
      startedAt.current = Date.now()
      await loadRecent(coachId)
    } catch (e: any) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    )
  }

  const unmatched = (parsedGames || []).reduce(
    (n, g) => n + g.players.filter(p => !p.team_player_id).length, 0
  )
  const notesStep = config.screenshots !== 'none' ? 4 : 3
  // openPriorities is reloaded after every save, so this count already includes
  // the session that was just written.
  const savedPriority = saved?.prescriptionId
    ? openPriorities.find(p => p.id === saved.prescriptionId) || null
    : null

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ClipboardList className="text-red-600" size={26} />
          Log an Entry
        </h1>
        <p className="text-gray-600 text-sm mt-1">
          Takes about 30 seconds. Only the first two steps are required — everything else is optional.
        </p>
      </div>

      {needsMigration && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
          <AlertTriangle className="text-amber-600 flex-shrink-0" size={20} />
          <div className="text-sm text-amber-800">
            The activity log tables aren&apos;t set up yet. Run{' '}
            <code className="bg-amber-100 px-1 rounded">migrations/012_activity_log.sql</code>{' '}
            in your Supabase SQL editor, then refresh.
          </div>
        </div>
      )}

      {/* Saved confirmation */}
      {saved && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle2 className="text-green-600 flex-shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-green-900 flex-1">
            <strong>Logged.</strong>{' '}
            {[
              saved.games > 0 && `${saved.games} game${saved.games === 1 ? '' : 's'}`,
              saved.stats > 0 && `${saved.stats} stat line${saved.stats === 1 ? '' : 's'}`,
              saved.notes > 0 && `${saved.notes} note${saved.notes === 1 ? '' : 's'}`,
            ].filter(Boolean).join(', ') || 'Entry saved'}
            . The form is cleared and ready for the next one.
            {saved.attached > 0 && (
              <div className="mt-1.5 text-green-800">
                {saved.attached === 1 ? 'One game was' : `${saved.attached} games were`} already on file
                {' '}— we added the box score to {saved.attached === 1 ? 'it' : 'them'} rather than creating a
                second copy.
              </div>
            )}
          </div>
          <button onClick={() => setSaved(null)} className="text-green-700 hover:text-green-900">
            <X size={16} />
          </button>
        </div>
      )}

      {/* What to do with what was just logged. This is the moment the coach is
          most engaged — they've just written down what they saw — and until now
          the only thing here was a button that dumped them into an unrelated
          conversation. */}
      {saved && (savedPriority || saved.seed) && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 space-y-4">
          {savedPriority && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Target size={16} className="text-red-600" />
                <h3 className="font-semibold text-gray-900">
                  Counted toward {savedPriority.subjectName}&apos;s{' '}
                  {focusAreaLabel(savedPriority.focusArea).toLowerCase()} priority
                </h3>
              </div>
              <p className="text-sm text-gray-600">
                {savedPriority.adherence.logged} session
                {savedPriority.adherence.logged === 1 ? '' : 's'} logged against it so far
                {savedPriority.daysElapsed > 0 && ` over ${savedPriority.daysElapsed} days`}.
              </p>
            </div>
          )}

          {savedPriority && coachId && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                For next time
              </h4>
              <PriorityDrills prescriptionId={savedPriority.id} coachId={coachId} />
            </div>
          )}

          {saved.seed && (
            <div className={savedPriority ? 'pt-4 border-t border-gray-100' : ''}>
              <button
                onClick={discussSession}
                disabled={openingThread}
                className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {openingThread
                  ? <Loader2 className="animate-spin" size={15} />
                  : <MessageSquare size={15} />}
                Talk this session through
              </button>
              <p className="text-xs text-gray-500 mt-2">
                Opens a new conversation with what you just wrote, so you can ask why it happened
                or what to change.
              </p>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6">
        {/* Step 1 — type */}
        <Step n={1} title="What happened?">
          <div className="flex flex-wrap gap-2">
            {ENTRY_TYPE_ORDER.map(t => (
              <button
                key={t}
                onClick={() => { setEntryType(t); setNoteValues({}) }}
                className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${
                  entryType === t
                    ? 'border-red-500 bg-red-50 text-red-700'
                    : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                }`}
              >
                {ENTRY_TYPES[t].label}
              </button>
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-2">{config.hint}</p>
        </Step>

        {/* Step 2 — when / who */}
        <Step n={2} title="When?">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
              <input
                type="date"
                value={occurredOn}
                onChange={e => setOccurredOn(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
            </div>

            {roster.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  {config.type === 'lesson' || config.type === 'home_session'
                    ? 'Which player?'
                    : 'Anyone in particular? (optional)'}
                </label>
                <select
                  value={playerId}
                  onChange={e => setPlayerId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                >
                  <option value="">Whole team</option>
                  {roster.map(r => (
                    <option key={r.player_id} value={r.player_id}>{r.name}</option>
                  ))}
                </select>
              </div>
            )}

            {config.capturesInstructor && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Instructor (optional)</label>
                <input
                  type="text"
                  value={instructorName}
                  onChange={e => setInstructorName(e.target.value)}
                  placeholder="e.g. Coach Dave"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            )}

            {config.capturesDuration && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Minutes (optional)</label>
                <input
                  type="number"
                  value={durationMin}
                  onChange={e => setDurationMin(e.target.value)}
                  placeholder="e.g. 30"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
                />
              </div>
            )}
          </div>

          {/* Which priority this session counts toward.
              Never guessed: a driveway session on outfield credited to the
              pitching priority corrupts the adherence number the check-in uses
              to decide whether a drill failed or was simply never run. */}
          {config.linksToPrescription && (
            relevantPriorities.length > 0 ? (
              <div className="mt-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  What did this session count toward?
                </label>
                <div className="space-y-2">
                  {relevantPriorities.map(p => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setPrescriptionId(p.id)}
                      className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                        prescriptionId === p.id
                          ? 'border-red-400 bg-red-50 ring-1 ring-red-100'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <Target
                        size={16}
                        className={`flex-shrink-0 mt-0.5 ${prescriptionId === p.id ? 'text-red-600' : 'text-gray-400'}`}
                      />
                      <span className="min-w-0">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${focusAreaChip(p.focusArea)}`}>
                            {focusAreaLabel(p.focusArea)}
                          </span>
                          <span className="text-xs text-gray-500">
                            {p.subjectName} · {p.adherence.logged} logged
                          </span>
                        </span>
                        <span className="block text-sm text-gray-800 mt-1 line-clamp-2">{p.priority}</span>
                      </span>
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={() => setPrescriptionId('')}
                    className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                      prescriptionId === ''
                        ? 'border-gray-400 bg-gray-50 ring-1 ring-gray-200'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    <ChevronRight size={16} className="flex-shrink-0 mt-0.5 text-gray-400" />
                    <span>
                      <span className="block text-sm font-medium text-gray-800">Something else</span>
                      <span className="block text-xs text-gray-500">
                        Maintenance reps or general work. Still logged — just not counted toward a priority.
                      </span>
                    </span>
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-blue-800 bg-blue-50 border border-blue-200 rounded px-2 py-1.5 mt-2 inline-flex items-start gap-1.5">
                <Info size={14} className="flex-shrink-0 mt-0.5" />
                Nothing active to attach this to yet. Get a priority from What to Work On and home sessions
                start counting toward it.
              </p>
            )
          )}
        </Step>

        {/* Step 3 — screenshots (only when the type has them) */}
        {config.screenshots !== 'none' && (
          <Step
            n={3}
            title={config.screenshots === 'expected' ? 'Screenshots' : 'Screenshots (optional)'}
            subtitle={`${config.screenshotHint || ''} You can paste them straight in (Cmd/Ctrl+V).`.trim()}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={e => { handleFiles([...files, ...Array.from(e.target.files || [])]); e.target.value = '' }}
              className="block w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:bg-red-50 file:text-red-700 file:font-medium hover:file:bg-red-100"
            />

            {parsing && (
              <div className="mt-3 flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
                <Loader2 className="animate-spin" size={16} />
                Reading {files.length} screenshot{files.length === 1 ? '' : 's'}… keep going, this finishes while you type.
              </div>
            )}

            {parseMessage && !parsing && (
              <div className="mt-3 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                {parseMessage}
              </div>
            )}

            {parsedGames && parsedGames.length > 0 && !parsing && (
              <div className="mt-3 space-y-4">
                <div className="flex items-center gap-2 text-sm text-gray-700">
                  <CheckCircle2 size={16} className="text-green-600" />
                  Found {parsedGames.length} game{parsedGames.length === 1 ? '' : 's'}. Check the numbers before saving.
                </div>

                {unmatched > 0 && (
                  <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                    {unmatched} player{unmatched === 1 ? '' : 's'} couldn&apos;t be matched to your roster — pick them
                    below, or leave blank to skip. We&apos;ll remember your choice next time.
                  </div>
                )}

                {parsedGames.map((game, gi) => (
                  <ParsedGameTable
                    key={gi}
                    game={game}
                    gameIndex={gi}
                    roster={roster}
                    onUpdate={updatePlayer}
                    onRemove={removePlayer}
                  />
                ))}
              </div>
            )}
          </Step>
        )}

        {/* Notes — always last, always the point */}
        <div className="flex gap-3 sm:gap-4">
          <div className="flex flex-col items-center flex-shrink-0">
            <div className="w-7 h-7 rounded-full bg-red-600 text-white text-sm font-semibold flex items-center justify-center">
              {notesStep}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-semibold text-gray-900">What did you see?</h2>
            <p className="text-sm text-gray-500 mt-0.5 mb-3">
              This is the part the stats can&apos;t give us. Answer what&apos;s useful, skip the rest.
            </p>
            <div className="space-y-3">
              {config.prompts.map(prompt => (
                <div key={prompt.key}>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{prompt.label}</label>
                  <textarea
                    value={noteValues[prompt.key] || ''}
                    onChange={e => setNoteValues(prev => ({ ...prev, [prompt.key]: e.target.value }))}
                    rows={prompt.rows || 2}
                    placeholder={prompt.placeholder}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={handleSave}
              disabled={saving || !coachId}
              className="mt-5 flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 font-medium"
            >
              {saving ? <Loader2 className="animate-spin" size={18} /> : <Plus size={18} />}
              {saving ? 'Saving…' : 'Save Entry'}
            </button>
            {parsing && (
              <p className="text-xs text-gray-500 mt-2">
                You can save now — we&apos;ll wait for the screenshots to finish reading.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Recent entries — proof it saved, and a way back in */}
      {recent.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-2 text-sm">Recently logged</h3>
          <div className="space-y-1">
            {recent.map(e => (
              <div key={e.id} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0">
                <div className="min-w-0">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 mr-2">
                    {ENTRY_TYPES[e.entry_type as EntryType]?.label || e.entry_type}
                  </span>
                  <span className="text-gray-700">{e.occurred_on}</span>
                  {e.player?.name && <span className="text-gray-500 ml-2">{e.player.name}</span>}
                  {(e.observations?.length || 0) > 0 && (
                    <span className="text-gray-400 ml-2">
                      {e.observations!.length} note{e.observations!.length === 1 ? '' : 's'}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            onClick={() => router.push(`/dashboard?teamId=${teamId}`)}
            className="mt-3 text-sm text-red-600 hover:text-red-700 font-medium flex items-center gap-1"
          >
            See what you&apos;re working on <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Parsed game review table ───────────────────────────

function ParsedGameTable({
  game, gameIndex, roster, onUpdate, onRemove,
}: {
  game: ParsedGame
  gameIndex: number
  roster: RosterPlayer[]
  onUpdate: (gi: number, pi: number, field: string, value: any) => void
  onRemove: (gi: number, pi: number) => void
}) {
  const lowConf = (p: ParsedPlayer, field: string) =>
    p.low_confidence_fields?.includes(field)

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 text-sm flex items-center gap-2 flex-wrap">
        <span className="font-medium text-gray-900">
          {game.opponent ? `vs ${game.opponent}` : 'Game'}
        </span>
        {game.game_date && <span className="text-gray-500">{game.game_date}</span>}
        {game.team_score != null && game.opponent_score != null && (
          <span className="text-gray-600">{game.team_score}–{game.opponent_score}</span>
        )}
        {game.confidence && game.confidence !== 'high' && (
          <span className="text-xs text-amber-700">read confidence: {game.confidence}</span>
        )}
      </div>

      {game.warnings?.length > 0 && (
        <div className="px-3 py-2 text-xs text-amber-800 bg-amber-50 border-b border-amber-200">
          {game.warnings.join(' · ')}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-white">
            <tr className="text-left text-gray-500 border-b border-gray-200">
              <th className="p-2 font-medium">From box score</th>
              <th className="p-2 font-medium">Player</th>
              <th className="p-2 font-medium">AB</th>
              <th className="p-2 font-medium">H</th>
              <th className="p-2 font-medium">BB</th>
              <th className="p-2 font-medium">K</th>
              <th className="p-2 font-medium">Pitches</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {game.players.map((p, pi) => (
              <tr
                key={pi}
                className={`border-b border-gray-100 last:border-0 ${
                  !p.team_player_id ? 'bg-amber-50' : ''
                }`}
              >
                <td className="p-2 text-gray-700 whitespace-nowrap">
                  {p.jersey_number ? `#${p.jersey_number} ` : ''}{p.name}
                </td>
                <td className="p-2">
                  <select
                    value={p.team_player_id || ''}
                    onChange={e => onUpdate(gameIndex, pi, 'team_player_id', e.target.value || null)}
                    className={`px-1.5 py-1 border rounded w-32 ${
                      p.team_player_id
                        ? p.match_confidence === 'possible'
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-gray-200'
                        : 'border-amber-400'
                    }`}
                  >
                    <option value="">— skip —</option>
                    {roster.map(r => (
                      <option key={r.team_player_id} value={r.team_player_id}>{r.name}</option>
                    ))}
                  </select>
                </td>
                {(['ab', 'h', 'bb', 'k'] as const).map(key => (
                  <td className="p-2" key={key}>
                    <input
                      type="number"
                      value={p.batting_line?.[key] ?? ''}
                      onChange={e => onUpdate(gameIndex, pi, `bl.${key}`, e.target.value)}
                      className={`w-12 px-1 py-1 border rounded ${
                        lowConf(p, key) ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                      }`}
                      title={lowConf(p, key) ? 'We had trouble reading this one — double-check it' : undefined}
                    />
                  </td>
                ))}
                <td className="p-2">
                  <input
                    type="number"
                    value={p.pitches_thrown ?? ''}
                    onChange={e => onUpdate(gameIndex, pi, 'pitches_thrown', e.target.value === '' ? null : Number(e.target.value))}
                    className={`w-14 px-1 py-1 border rounded ${
                      lowConf(p, 'pitches_thrown') ? 'border-amber-400 bg-amber-50' : 'border-gray-200'
                    }`}
                  />
                </td>
                <td className="p-2">
                  <button
                    onClick={() => onRemove(gameIndex, pi)}
                    className="p-1 text-gray-400 hover:text-red-600"
                    title="Remove this row"
                  >
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Suspense wrapper ───────────────────────────────────

export default function LogPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-gray-400" size={32} />
      </div>
    }>
      <LogContent />
    </Suspense>
  )
}
