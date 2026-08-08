'use client'

import { useRef, useState } from 'react'
import {
  Camera, Loader2, AlertCircle, X, Plus, ArrowUp, ArrowDown, Check, Image as ImageIcon,
} from 'lucide-react'

// Getting a batting order in without typing it.
//
// The picture is the fast path and the table is the truth. Everything the model
// reads lands in an editable row, flagged where it was unsure, and nothing is
// written until the coach says so — a lineup quietly populated from a blurry
// photo is worse than an empty one, because the mistakes only surface in the
// third inning.
//
// Same component for our order and theirs. The difference is what a row means:
// ours has to point at a real roster player, theirs is just a name.

export interface ImportRow {
  slot: number
  name: string | null
  jersey: string | null
  position: string | null
  is_pitcher: boolean
  uncertain: string[]
  // Ours only — which rostered player this row is.
  team_player_id?: string | null
  matchConfidence?: 'exact' | 'strong' | 'possible' | 'none'
}

interface RosterOption { id: string; name: string; jersey: string | null }

interface Props {
  side: 'us' | 'them'
  teamId?: string | null
  gameId?: string | null
  // Ours: the roster to attach rows to. Passed in so the picker works even
  // when nothing was imported and the coach is typing from scratch.
  roster?: RosterOption[]
  onCancel: () => void
  onSave: (rows: ImportRow[], source: 'manual' | 'import') => Promise<void> | void
  saving?: boolean
}

const POSITIONS = ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH', 'EH']

export function LineupImport({
  side, teamId, gameId, roster = [], onCancel, onSave, saving,
}: Props) {
  const [rows, setRows] = useState<ImportRow[]>([])
  const [reading, setReading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [confidence, setConfidence] = useState<string | null>(null)
  const [cameFromImage, setCameFromImage] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const readImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setReading(true)
    setError(null)
    setWarnings([])
    try {
      const images = await Promise.all(
        Array.from(files).slice(0, 4).map(
          file => new Promise<{ data: string; mimeType: string }>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const result = String(reader.result || '')
              resolve({ data: result.split(',')[1] || '', mimeType: file.type || 'image/png' })
            }
            reader.onerror = reject
            reader.readAsDataURL(file)
          })
        )
      )

      const res = await fetch('/api/game/lineup-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images, side, teamId, gameId }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Could not read that')
      if (d.parseFailed) {
        setError(d.message || "Couldn't read a lineup in that. You can still type it in.")
        return
      }

      setRows((d.players || []).map((p: ImportRow, i: number) => ({ ...p, slot: i + 1 })))
      setWarnings(d.warnings || [])
      setConfidence(d.confidence || null)
      setCameFromImage(true)
    } catch (e: any) {
      setError(e.message || 'Could not read that image.')
    } finally {
      setReading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const addRow = () => setRows(prev => [...prev, {
    slot: prev.length + 1, name: '', jersey: null, position: null,
    is_pitcher: false, uncertain: [], team_player_id: null, matchConfidence: 'none',
  }])

  const patch = (i: number, p: Partial<ImportRow>) =>
    setRows(prev => prev.map((r, x) => x === i ? { ...r, ...p } : r))

  const remove = (i: number) =>
    setRows(prev => prev.filter((_, x) => x !== i).map((r, x) => ({ ...r, slot: x + 1 })))

  const move = (i: number, delta: number) => setRows(prev => {
    const to = i + delta
    if (to < 0 || to >= prev.length) return prev
    const next = [...prev]
    ;[next[i], next[to]] = [next[to], next[i]]
    return next.map((r, x) => ({ ...r, slot: x + 1 }))
  })

  // Ours has to point at a real player; theirs only needs something to call
  // them. Both refuse to save an order of blanks.
  const usable = side === 'us'
    ? rows.filter(r => r.team_player_id)
    : rows.filter(r => (r.name || '').trim() || (r.jersey || '').trim())

  const unmatched = side === 'us' ? rows.filter(r => !r.team_player_id).length : 0
  const lowConfidence = confidence === 'low'

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-gray-900">
            {side === 'us' ? 'Our batting order' : 'Their batting order'}
          </h3>
          <p className="text-sm text-gray-600 mt-0.5">
            {side === 'us'
              ? 'Snap your lineup card or type it in.'
              : 'Snap their card, a GameChanger screen, or the page in their book — then check it.'}
          </p>
        </div>
        <button onClick={onCancel} className="text-sm text-gray-500 hover:text-gray-700 shrink-0">
          Cancel
        </button>
      </div>

      {/* The fast path */}
      <div className="flex flex-wrap gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          onChange={e => readImages(e.target.files)}
          className="hidden"
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={reading}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium disabled:opacity-50"
        >
          {reading ? <Loader2 size={17} className="animate-spin" /> : <Camera size={17} />}
          {reading ? 'Reading it…' : rows.length > 0 ? 'Read another picture' : 'Take or pick a photo'}
        </button>
        <button
          onClick={addRow}
          className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 rounded-xl text-sm font-medium text-gray-700"
        >
          <Plus size={17} /> Add a row
        </button>
      </div>

      {reading && (
        <p className="text-xs text-gray-500">
          Handwriting takes a few seconds longer than a screenshot.
        </p>
      )}

      {error && (
        <div className="flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-600" />
          <span>{error}</span>
        </div>
      )}

      {/* What it struggled with, said before the coach commits it. */}
      {cameFromImage && (warnings.length > 0 || lowConfidence) && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1.5">
          {lowConfidence && (
            <p className="text-sm text-amber-900 font-medium">
              This one was hard to read — check every row.
            </p>
          )}
          {warnings.map((w, i) => (
            <p key={i} className="text-sm text-amber-900 flex items-start gap-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      {/* The truth */}
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 border border-dashed border-gray-200 rounded-lg px-3 py-4">
          Nothing yet. Read a picture, or add rows and type them in.
        </p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r, i) => {
            const flagged = r.uncertain.length > 0
            const needsPlayer = side === 'us' && !r.team_player_id
            return (
              <div
                key={i}
                className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border ${
                  needsPlayer || flagged ? 'border-amber-300 bg-amber-50' : 'border-gray-200'
                }`}
              >
                <span className="w-5 text-xs font-bold text-gray-400 text-right shrink-0">{i + 1}</span>

                {side === 'us' ? (
                  <select
                    value={r.team_player_id || ''}
                    onChange={e => patch(i, {
                      team_player_id: e.target.value || null,
                      name: roster.find(p => p.id === e.target.value)?.name || r.name,
                    })}
                    className="flex-1 min-w-0 text-sm border border-gray-300 rounded px-2 py-1.5 bg-white"
                    aria-label={`Player in slot ${i + 1}`}
                  >
                    <option value="">
                      {r.name ? `${r.name} — pick who this is` : 'Pick a player'}
                    </option>
                    {roster.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.jersey ? ` #${p.jersey}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <>
                    <input
                      value={r.jersey || ''}
                      onChange={e => patch(i, { jersey: e.target.value || null })}
                      placeholder="#"
                      className="w-12 shrink-0 text-sm border border-gray-300 rounded px-1.5 py-1.5 text-center"
                      aria-label={`Number in slot ${i + 1}`}
                    />
                    <input
                      value={r.name || ''}
                      onChange={e => patch(i, { name: e.target.value })}
                      placeholder="Name"
                      className="flex-1 min-w-0 text-sm border border-gray-300 rounded px-2 py-1.5"
                      aria-label={`Name in slot ${i + 1}`}
                    />
                  </>
                )}

                <select
                  value={r.position || ''}
                  onChange={e => patch(i, {
                    position: e.target.value || null,
                    is_pitcher: e.target.value === 'P',
                  })}
                  className="w-16 shrink-0 text-xs border border-gray-300 rounded px-1 py-1.5 bg-white"
                  aria-label={`Position in slot ${i + 1}`}
                >
                  <option value="">—</option>
                  {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>

                <div className="flex shrink-0">
                  <button onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1 text-gray-400 disabled:opacity-30" aria-label="Move up">
                    <ArrowUp size={13} />
                  </button>
                  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1}
                    className="p-1 text-gray-400 disabled:opacity-30" aria-label="Move down">
                    <ArrowDown size={13} />
                  </button>
                  <button onClick={() => remove(i)}
                    className="p-1 text-gray-400 hover:text-red-600" aria-label="Remove">
                    <X size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {unmatched > 0 && (
        <div className="flex gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
          <AlertCircle size={15} className="shrink-0 mt-0.5 text-amber-600" />
          <span>
            {unmatched} row{unmatched === 1 ? '' : 's'} {unmatched === 1 ? 'is' : 'are'} not
            matched to anyone on your roster yet. Those will be left out.
          </span>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-3 rounded-xl border border-gray-300 text-gray-700 font-medium"
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(usable, cameFromImage ? 'import' : 'manual')}
          disabled={!!saving || usable.length === 0}
          className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {saving ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}
          Save {usable.length > 0 ? `${usable.length} ` : ''}
          {usable.length === 1 ? 'player' : 'players'}
        </button>
      </div>
    </div>
  )
}
