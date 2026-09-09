'use client'

// Reviewing a generated practice before it becomes a practice.
//
// THE PROBLEM WITH A COLUMN
//
// This used to be a max-w-2xl modal: objective, coaching points, flags,
// coverage, then eight collapsed blocks, then the rebuild box — one column,
// one scrollbar. Collapsing the blocks made it shorter without making it
// readable, because the question a coach is actually answering here is
// "does this practice hang together", and that question needs the whole
// running order visible at once. In a column it never is. They scroll to
// block six, decide it is wrong, and have to scroll back to remember what
// block three was so they know whether moving the work there would help.
//
// So: the running order lives in a rail on the left and does not scroll for a
// normal practice. One thing at a time is open on the right. Clicking a rail
// row swaps the right pane — no scrolling to navigate, only to read.
//
// AI SUGGESTED, OR MANUAL
//
// Every block carries a mode. "AI suggested" is what came back; "Manual" turns
// the same block into a form. A coach who wants the third block to say
// something specific should not have to describe that change in prose to a
// model and hope — the rebuild box is the right tool for "rethink this
// practice", and the wrong one for "call it Tee Work and make it 12 minutes".
//
// Edits are held in the draft and saved with it. Nothing here writes to the
// database; the footer's buttons still own that.

import { useState, useMemo } from 'react'
import {
  X, AlertCircle, Sparkles, Pencil, Check, RotateCcw, Clock, Video as VideoIcon,
} from 'lucide-react'
import { PracticeBlock } from './PracticeBlock'
import { PriorityCoverageSummary } from './PriorityCoverageSummary'
import { isStationGroup } from '@/lib/practicePlan'
import { parsePastedVideo, formatTimestamp, videoFieldsFromPaste } from '@/lib/drillVideo'

const TYPES = ['warmup', 'drill', 'station', 'game', 'cooldown'] as const

const TYPE_LABEL: Record<string, string> = {
  warmup: 'Warm-up', drill: 'Drill', station: 'Stations', game: 'Game', cooldown: 'Cool-down',
}

function typeBadge(type: string): string {
  return type === 'warmup' ? 'bg-yellow-100 text-yellow-700' :
    type === 'drill' ? 'bg-blue-100 text-blue-700' :
    type === 'station' ? 'bg-indigo-100 text-indigo-700' :
    type === 'game' ? 'bg-green-100 text-green-700' :
    type === 'cooldown' ? 'bg-purple-100 text-purple-700' :
    'bg-gray-100 text-gray-700'
}

/** Cues are an array in the plan and a textarea to a person. */
const cuesToText = (v: any): string => Array.isArray(v) ? v.join('\n') : String(v || '')
const textToCues = (s: string): string[] => s.split('\n').map(x => x.trim()).filter(Boolean)

/** The video already on a block, written back as something pasteable. */
function videoValueOf(block: any): string {
  if (block?.youtube_video_id) {
    const t = Number(block.youtube_start_seconds) || 0
    return `https://www.youtube.com/watch?v=${block.youtube_video_id}${t > 0 ? `&t=${t}s` : ''}`
  }
  return String(block?.video_url || '')
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent'

/** One block, as a form. */
function BlockEditor({ block, onChange }: { block: any; onChange: (patch: any) => void }) {
  const [video, setVideo] = useState(() => videoValueOf(block))
  const parsed = parsePastedVideo(video)
  const stations: any[] = isStationGroup(block) ? block.stations : []

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-12 gap-3">
        <div className="col-span-7">
          <Field label="Title">
            <input className={inputClass} value={block.title || ''}
                   onChange={e => onChange({ title: e.target.value })} />
          </Field>
        </div>
        <div className="col-span-2">
          <Field label="Minutes">
            <input type="number" min={1} className={inputClass} value={block.minutes ?? ''}
                   onChange={e => onChange({ minutes: parseInt(e.target.value) || 0 })} />
          </Field>
        </div>
        <div className="col-span-3">
          <Field label="Type">
            <select className={inputClass} value={block.type || 'drill'}
                    onChange={e => onChange({ type: e.target.value })}>
              {TYPES.map(t => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
            </select>
          </Field>
        </div>
      </div>

      <Field label="What happens">
        <textarea rows={3} className={inputClass} value={block.description || ''}
                  onChange={e => onChange({ description: e.target.value })} />
      </Field>

      <Field label="Setup">
        <textarea rows={2} className={inputClass} value={block.setup || ''}
                  onChange={e => onChange({ setup: e.target.value })} />
      </Field>

      <Field label="Coaching cues" hint="One per line — these are what you say all block.">
        <textarea rows={3} className={inputClass} value={cuesToText(block.coaching_cues)}
                  onChange={e => onChange({ coaching_cues: textToCues(e.target.value) })} />
      </Field>

      <Field label="Watch for" hint="The thing a first-time coach walks straight past.">
        <textarea rows={2} className={inputClass} value={block.watch_for || ''}
                  onChange={e => onChange({ watch_for: e.target.value })} />
      </Field>

      <Field label="Video">
        <div className="flex gap-2">
          <input
            className={inputClass}
            value={video}
            placeholder="https://youtube.com/watch?v=… — or any video link"
            onChange={e => { setVideo(e.target.value); onChange(videoFieldsFromPaste(e.target.value)) }}
          />
          {/* Clearing the box does this too, but only if you think to try it.
              Removing the drill's video is a thing coaches want and it should
              not be a discovery. */}
          {video.trim() !== '' && (
            <button
              type="button"
              onClick={() => { setVideo(''); onChange(videoFieldsFromPaste('')) }}
              className="shrink-0 px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 hover:text-red-700"
            >
              Remove
            </button>
          )}
        </div>
        {video.trim() === '' ? (
          block.video_cleared ? (
            <p className="text-xs text-gray-600 mt-1">
              No video on this block — and it won&apos;t go looking for one.
            </p>
          ) : (
            <p className="text-xs text-gray-400 mt-1">
              Paste with the time in it and it opens there instead of at the beginning.
            </p>
          )
        ) : parsed?.kind === 'youtube' ? (
          <p className="text-xs text-green-700 mt-1">
            ✓ Plays inside the block{parsed.youtube_start_seconds
              ? `, starting at ${formatTimestamp(parsed.youtube_start_seconds)}` : ', from the beginning'}
          </p>
        ) : parsed?.kind === 'link' ? (
          <p className="text-xs text-blue-700 mt-1">
            ✓ Saved as a tap-through link — only YouTube plays inline
          </p>
        ) : (
          <p className="text-xs text-red-600 mt-1">That doesn&apos;t look like a link.</p>
        )}
      </Field>

      {/* A rotation's stations are the part worth correcting by hand; the
          parent's own fields describe the rotation, not the work. */}
      {stations.length > 0 && (
        <div className="pt-2 border-t border-gray-200">
          <p className="text-xs font-medium text-gray-600 mb-2">Stations</p>
          <div className="space-y-3">
            {stations.map((s: any, si: number) => (
              <div key={si} className="rounded-lg border border-gray-200 p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-gray-500 w-5">
                    {String.fromCharCode(65 + si)}
                  </span>
                  <input
                    className={inputClass}
                    value={s.title || ''}
                    onChange={e => {
                      const next = stations.map((x, i) => i === si ? { ...x, title: e.target.value } : x)
                      onChange({ stations: next })
                    }}
                  />
                </div>
                <textarea
                  rows={2}
                  className={inputClass}
                  value={s.description || ''}
                  onChange={e => {
                    const next = stations.map((x, i) => i === si ? { ...x, description: e.target.value } : x)
                    onChange({ stations: next })
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  draft: any
  /** Write blocks back into the draft. Nothing here touches the database. */
  onBlocksChange: (blocks: any[]) => void
  onClose: () => void
  duration: number
  timeLabels: string[]
  coverage: any
  /** "writing the detail (3/8)" or "nothing saved yet". */
  status: string
  genError?: string | null
  drillResources?: any[]
  coachId?: string | null
  favorites?: Set<string>
  onFavoritesChanged?: () => void
  /** The rebuild box and the save/discard buttons — their handlers live in the page. */
  footer: React.ReactNode
}

export function PlanReview({
  draft, onBlocksChange, onClose, duration, timeLabels, coverage, status,
  genError, drillResources = [], coachId = null, favorites, onFavoritesChanged, footer,
}: Props) {
  const blocks: any[] = draft?.blocks || []
  // -1 is the overview. It is a rail row rather than a banner above the blocks
  // so that the objective, the coaching points and the flags are one click
  // away instead of occupying the top of every scroll.
  const [selected, setSelected] = useState<number>(-1)
  const [editing, setEditing] = useState<Set<number>>(new Set())
  const [edited, setEdited] = useState<Set<number>>(new Set())
  // The block as it arrived, so "revert" means something after a manual edit.
  const [original] = useState<any[]>(() => blocks.map(b => JSON.parse(JSON.stringify(b))))

  const total = useMemo(
    () => blocks.reduce((s, b) => s + (Number(b?.minutes) || 0), 0),
    [blocks]
  )

  const patchBlock = (i: number, patch: any) => {
    onBlocksChange(blocks.map((b, n) => n === i ? { ...b, ...patch } : b))
    setEdited(prev => new Set(prev).add(i))
  }

  const revertBlock = (i: number) => {
    if (!original[i]) return
    onBlocksChange(blocks.map((b, n) => n === i ? JSON.parse(JSON.stringify(original[i])) : b))
    setEdited(prev => { const next = new Set(prev); next.delete(i); return next })
    setEditing(prev => { const next = new Set(prev); next.delete(i); return next })
  }

  const setMode = (i: number, manual: boolean) => {
    setEditing(prev => {
      const next = new Set(prev)
      if (manual) next.add(i); else next.delete(i)
      return next
    })
  }

  const block = selected >= 0 ? blocks[selected] : null
  const isEditing = selected >= 0 && editing.has(selected)

  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-5 py-3 border-b border-gray-200 shrink-0">
        <div className="min-w-0">
          {/* Two lines, not one. A real generated title is
              "Springford Blue (8U) — Throwing Progressions, Infield Footwork &
              Hitting Load" — truncating that leaves the team name and cuts off
              what the practice is actually about, which is the half worth
              reading. */}
          <h2 className="text-lg font-bold text-gray-900 leading-snug line-clamp-2">
            {draft?.title || 'Practice plan'}
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {blocks.length} blocks · {total} of {duration} min
            {total > duration && <span className="text-red-600 font-medium"> · over by {total - duration}</span>}
            {' · '}{status}
            {edited.size > 0 && <span className="text-amber-700"> · {edited.size} edited by you</span>}
          </p>
        </div>
        <button onClick={onClose} className="p-2 -m-2 text-gray-400 hover:text-gray-700 shrink-0"
                aria-label="Close">
          <X size={20} />
        </button>
      </div>

      {genError && (
        <div className="flex gap-2 text-sm text-red-800 bg-red-50 border-b border-red-200 px-5 py-2 shrink-0">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{genError}</span>
        </div>
      )}

      {/* Body: the running order, and one thing at a time. */}
      <div className="flex-1 flex min-h-0 flex-col md:flex-row">
        {/* Rail. On a phone this becomes a horizontal strip so the whole
            practice is still one gesture away rather than a page of cards. */}
        <div className="md:w-80 md:shrink-0 md:border-r border-b md:border-b-0 border-gray-200
                        overflow-x-auto md:overflow-x-visible md:overflow-y-auto bg-gray-50">
          <div className="flex md:block gap-2 p-2 md:p-3 md:space-y-1">
            <button
              onClick={() => setSelected(-1)}
              className={`shrink-0 md:w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                selected === -1 ? 'bg-blue-600 text-white' : 'hover:bg-gray-200 text-gray-700'
              }`}
            >
              <span className="font-medium">Overview</span>
            </button>

            {blocks.map((b, i) => {
              const on = selected === i
              return (
                <button
                  key={i}
                  onClick={() => setSelected(i)}
                  className={`shrink-0 md:w-full text-left px-3 py-2 rounded-lg transition-colors ${
                    on ? 'bg-blue-600 text-white' : 'hover:bg-gray-200'
                  }`}
                >
                  {/* Title first and up to two lines — a real block is called
                      "Throwing Progression — Knee, Hip, Full", and one
                      truncated line of that is not identifiable. The clock and
                      the badges share the second row so a nine-block practice
                      still fits a laptop without the rail scrolling. */}
                  <div className={`text-sm font-medium leading-snug line-clamp-2 ${on ? 'text-white' : 'text-gray-900'}`}>
                    {b.title || `Block ${i + 1}`}
                  </div>
                  <div className="flex items-center flex-wrap gap-x-1.5 gap-y-0.5 mt-1">
                    <span className={`text-[11px] font-mono ${on ? 'text-blue-100' : 'text-gray-400'}`}>
                      {timeLabels[i] || `${i + 1}`}
                    </span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded ${
                      on ? 'bg-blue-500 text-blue-50' : typeBadge(b.type || 'drill')
                    }`}>
                      {TYPE_LABEL[b.type] || 'Drill'}
                    </span>
                    <span className={`text-[11px] ${on ? 'text-blue-100' : 'text-gray-500'}`}>
                      {b.minutes} min
                    </span>
                    {(b.youtube_video_id || b.video_url) && (
                      <VideoIcon size={11} className={on ? 'text-blue-100' : 'text-gray-400'} />
                    )}
                    {edited.has(i) && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                        on ? 'bg-blue-500 text-white' : 'bg-amber-100 text-amber-800'
                      }`}>edited</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Detail */}
        <div className="flex-1 overflow-y-auto min-h-0">
          {selected === -1 ? (
            <div className="p-5 space-y-4 max-w-3xl">
              {draft?.objective && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Objective</p>
                  <p className="text-gray-900">{draft.objective}</p>
                </div>
              )}
              {Array.isArray(draft?.coaching_points) && draft.coaching_points.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                    Say these all practice
                  </p>
                  <ul className="list-disc list-inside space-y-1 text-gray-800">
                    {draft.coaching_points.map((p: string, i: number) => <li key={i}>{p}</li>)}
                  </ul>
                </div>
              )}
              {draft?.coach_notes && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Before you start</p>
                  <p className="text-gray-800 whitespace-pre-line">{draft.coach_notes}</p>
                </div>
              )}
              {Array.isArray(draft?.flags) && draft.flags.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-900 uppercase tracking-wide mb-1">Worth knowing</p>
                  <ul className="list-disc list-inside space-y-1 text-sm text-amber-900">
                    {draft.flags.map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              <PriorityCoverageSummary report={coverage} />
            </div>
          ) : block ? (
            <div className="p-5 max-w-3xl">
              {/* AI suggested, or manual. The toggle is here rather than
                  global: a coach usually wants to fix ONE block by hand and
                  leave the rest as it came back. */}
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="inline-flex rounded-lg border border-gray-300 p-0.5 bg-gray-50">
                  <button
                    onClick={() => setMode(selected, false)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                      !isEditing ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Sparkles size={14} /> AI suggested
                  </button>
                  <button
                    onClick={() => setMode(selected, true)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${
                      isEditing ? 'bg-white shadow-sm text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    <Pencil size={14} /> Manual
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {edited.has(selected) && (
                    <button
                      onClick={() => revertBlock(selected)}
                      className="inline-flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900"
                    >
                      <RotateCcw size={13} /> Undo my edits
                    </button>
                  )}
                  {isEditing && (
                    <button
                      onClick={() => setMode(selected, false)}
                      className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                    >
                      <Check size={15} /> Done
                    </button>
                  )}
                </div>
              </div>

              {isEditing ? (
                <BlockEditor block={block} onChange={patch => patchBlock(selected, patch)} />
              ) : (
                <>
                  {timeLabels[selected] && (
                    <p className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
                      <Clock size={12} /> {timeLabels[selected]}
                    </p>
                  )}
                  {/* The same renderer the saved plan and the printed sheet
                      use, opened. Reviewing something that looks different
                      from what you will run is how a plan gets approved and
                      then surprises you at the field. */}
                  <PracticeBlock
                    block={block}
                    idx={selected}
                    open={true}
                    onToggle={() => {}}
                    timeLabel={timeLabels[selected]}
                    drillResources={drillResources}
                    coachId={coachId}
                    favorites={favorites}
                    onFavoritesChanged={onFavoritesChanged}
                  />
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {/* Footer: rebuild, save, discard — owned by the page. */}
      <div className="border-t border-gray-200 px-5 py-3 shrink-0 bg-white">
        {footer}
      </div>
    </div>
  )
}
