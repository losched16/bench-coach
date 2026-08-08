'use client'

import { History, Search, Target, CalendarCheck, ChevronRight, Dumbbell, Eye, ClipboardList } from 'lucide-react'
import { AnalysisProse } from './AnalysisProse'

// The written read, in sections.
//
// Shared rather than copied because it exists in two places now — the analysis
// screen and inside a CoachAI thread — and the moment they diverge one of them
// silently becomes the worse version. That already happened once: committing a
// priority from chat rendered the whole thing as flat markdown, so "the one
// thing" was a paragraph among paragraphs instead of the point of the page.

export interface Section {
  key: string
  heading: string
  body: string
}

// Keys are what splitSections() produces from the canonical headings in
// lib/analysis.ts (the analysis) and lib/checkin.ts (the check-in) — heading
// lowercased with non-letters collapsed to underscores. Change a heading there
// and the icon here goes generic, which is a visual downgrade rather than a
// break.
const SECTION_META: Record<string, { icon: any; accent: string }> = {
  // Analysis — "What the data showed" through "Metrics"
  what_the_data_showed: { icon: Search, accent: 'text-blue-600' },
  the_one_thing: { icon: Target, accent: 'text-red-600' },
  this_week: { icon: CalendarCheck, accent: 'text-blue-600' },
  drills: { icon: Dumbbell, accent: 'text-green-600' },
  what_to_watch_next: { icon: Eye, accent: 'text-purple-600' },
  metrics: { icon: ClipboardList, accent: 'text-gray-600' },
  // Check-in — "Where this started" through "Next three weeks"
  where_this_started: { icon: History, accent: 'text-slate-600' },
  what_s_happened_since: { icon: Search, accent: 'text-blue-600' },
  the_read: { icon: Target, accent: 'text-red-600' },
  next_three_weeks: { icon: CalendarCheck, accent: 'text-green-600' },
}

interface Props {
  sections: Section[]
  // Draws the caret on the last section while text is still arriving.
  streaming?: boolean
}

export function PrescriptionSections({ sections, streaming }: Props) {
  if (!sections?.length) return null

  return (
    <div className="space-y-4">
      {sections.map((section, idx) => {
        const meta = SECTION_META[section.key] || { icon: ChevronRight, accent: 'text-gray-600' }
        const Icon = meta.icon
        // The priority is the deliverable. Everything else is the argument for
        // it, so it gets the ring and nothing else does.
        const isPriority = section.key.startsWith('the_one_thing') || section.key === 'the_read'
        return (
          <div
            key={`${section.key}-${idx}`}
            className={`bg-white rounded-lg shadow-sm border p-5 ${
              isPriority ? 'border-red-300 ring-1 ring-red-100' : 'border-gray-200'
            }`}
          >
            <div className="flex items-center gap-2 mb-3">
              <Icon className={meta.accent} size={18} />
              <h2 className="font-semibold text-gray-900">{section.heading}</h2>
            </div>
            <AnalysisProse body={section.body} />
            {streaming && idx === sections.length - 1 && (
              <span className="inline-block w-2 h-4 bg-red-500 animate-pulse align-middle ml-0.5 rounded-sm" />
            )}
          </div>
        )
      })}
    </div>
  )
}
