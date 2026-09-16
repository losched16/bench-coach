'use client'

// The filters, in a sheet.
//
// They used to be three <select>s in a `grid-cols-3` row on a phone — about
// 110px each at 390px wide, so every option label truncated mid-word. A sheet
// gives each control a full line and puts the whole thing within reach of one
// thumb, which is the posture a coach is actually in: standing on a field,
// holding a bucket.
//
// WHAT IS DELIBERATELY ABSENT
//
// resource_kind, variation_type, activity_family_id, verification_status.
// Those are how the product decides what to show; they are not questions to ask
// a volunteer coach. They stay in the query and out of the controls.
//
// The two toggles at the bottom are the only ones that exclude on absence, and
// they say so. station_friendly is populated on 49 of 154 rows, so "known to
// work as a station" is the honest label for what ticking it does — "stations
// only" would imply the other 105 had been assessed and failed.

import { useEffect, useRef } from 'react'
import { X, Check } from 'lucide-react'
import { FinderFilters, EMPTY_FILTERS, activeFilterCount, roleLabel } from '@/lib/drillFinder'

export interface FilterSheetProps {
  open: boolean
  filters: FinderFilters
  onChange: (next: FinderFilters) => void
  onClose: () => void
  categories: string[]
  roles: string[]
  equipmentOptions: string[]
  /** How many drills the current filters leave — shown on the apply button. */
  resultCount: number
}

const AGES = ['All', '6U', '8U', '10U', '12U']
const DIFFICULTIES = ['All', 'Beginner', 'Intermediate', 'Advanced']
const DURATIONS: Array<{ label: string; value: number | null }> = [
  { label: 'Any', value: null },
  { label: '10 min or less', value: 10 },
  { label: '15 min or less', value: 15 },
]
const SPACES: Array<{ label: string; value: 'small' | 'medium' | 'large' | null }> = [
  { label: 'Any', value: null },
  { label: 'A corner', value: 'small' },
  { label: 'Half a field', value: 'medium' },
  { label: 'A full field', value: 'large' },
]

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">{label}</p>
      {children}
    </div>
  )
}

function Pills<T>({ options, value, onPick, labelOf, valueOf }: {
  options: T[]
  value: unknown
  onPick: (v: T) => void
  labelOf: (o: T) => string
  valueOf: (o: T) => unknown
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o, i) => {
        const on = valueOf(o) === value
        return (
          <button
            key={i}
            type="button"
            onClick={() => onPick(o)}
            aria-pressed={on}
            className={`px-3 py-1.5 rounded-full text-sm border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700'
            }`}
          >
            {labelOf(o)}
          </button>
        )
      })}
    </div>
  )
}

export function FilterSheet({
  open, filters, onChange, onClose, categories, roles, equipmentOptions, resultCount,
}: FilterSheetProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const body = document.body
    const previous = body.style.overflow
    body.style.overflow = 'hidden'
    panel.current?.focus()

    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      body.style.overflow = previous
      opener?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const set = (patch: Partial<FinderFilters>) => onChange({ ...filters, ...patch })
  const count = activeFilterCount(filters)

  const toggleEquipment = (item: string) => {
    const has = filters.equipment.indexOf(item) >= 0
    set({
      equipment: has
        ? filters.equipment.filter(e => e !== item)
        : filters.equipment.concat([item]),
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-stretch sm:justify-end"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Filter drills"
        tabIndex={-1}
        className="bg-white w-full sm:w-96 max-h-[85vh] sm:max-h-none sm:h-full
                   rounded-t-2xl sm:rounded-none overflow-y-auto focus:outline-none flex flex-col"
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">Filters</h2>
          <div className="flex items-center gap-1">
            {count > 0 && (
              <button
                type="button"
                onClick={() => onChange({ ...EMPTY_FILTERS })}
                className="px-2.5 py-1.5 text-sm text-blue-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded"
              >
                Clear all
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filters"
              className="p-2 -m-1 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="px-4 py-4 space-y-5 flex-1">
          <Row label="Skill">
            <Pills
              options={['All'].concat(categories)}
              value={filters.category}
              valueOf={o => o}
              labelOf={o => o}
              onPick={o => set({ category: o })}
            />
          </Row>

          <Row label="Age">
            <Pills options={AGES} value={filters.age} valueOf={o => o} labelOf={o => o}
                   onPick={o => set({ age: o })} />
          </Row>

          <Row label="Difficulty">
            <Pills options={DIFFICULTIES} value={filters.difficulty} valueOf={o => o} labelOf={o => o}
                   onPick={o => set({ difficulty: o })} />
          </Row>

          <Row label="Time">
            <Pills options={DURATIONS} value={filters.maxMinutes}
                   valueOf={o => o.value} labelOf={o => o.label}
                   onPick={o => set({ maxMinutes: o.value })} />
          </Row>

          <Row label="Space">
            <Pills options={SPACES} value={filters.space}
                   valueOf={o => o.value} labelOf={o => o.label}
                   onPick={o => set({ space: o.value })} />
          </Row>

          <Row label="Where">
            <Pills
              options={[{ label: 'Anywhere', value: null }, { label: 'Works indoors', value: 'indoor' as const }]}
              value={filters.environment}
              valueOf={o => o.value}
              labelOf={o => o.label}
              onPick={o => set({ environment: o.value })}
            />
          </Row>

          {roles.length > 0 && (
            <Row label="What it is for">
              <Pills
                options={[null as string | null].concat(roles)}
                value={filters.role}
                valueOf={o => o}
                labelOf={o => (o == null ? 'Any' : roleLabel(o))}
                onPick={o => set({ role: o })}
              />
            </Row>
          )}

          <Row label="What you have with you">
            <div className="flex flex-wrap gap-1.5">
              {equipmentOptions.map(item => {
                const on = filters.equipment.indexOf(item) >= 0
                return (
                  <button
                    key={item}
                    type="button"
                    onClick={() => toggleEquipment(item)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm border focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                      on ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-gray-300 text-gray-700'
                    }`}
                  >
                    {on && <Check size={13} />}{item}
                  </button>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 mt-1.5">
              Tick what is in the car and nothing will ask for anything else.
              Leave it blank and every drill stays.
            </p>
          </Row>

          <Row label="Only show">
            <div className="space-y-2">
              {([
                ['favoritesOnly', 'Drills I have saved', null],
                ['stationOnly', 'Known to work as a station', 'Set on 49 of 154 — the rest have not been assessed either way.'],
                ['competitiveOnly', 'Has a winner', 'A score, a race or head-to-head.'],
              ] as Array<[keyof FinderFilters, string, string | null]>).map(([key, label, note]) => {
                const on = !!filters[key]
                return (
                  <button
                    key={String(key)}
                    type="button"
                    onClick={() => set({ [key]: !on } as Partial<FinderFilters>)}
                    aria-pressed={on}
                    className="w-full flex items-start gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded p-1 -m-1"
                  >
                    <span className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                      on ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                    }`}>
                      {on && <Check size={11} className="text-white" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm text-gray-900">{label}</span>
                      {note && <span className="block text-xs text-gray-500">{note}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          </Row>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {resultCount === 0
              ? 'No drills match — adjust and try again'
              : `Show ${resultCount} drill${resultCount === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
