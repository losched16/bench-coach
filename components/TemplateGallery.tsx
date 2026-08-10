'use client'

import { useEffect, useState } from 'react'
import { createSupabaseComponentClient } from '@/lib/supabase'
import { Clock, Users, Copy, Check, Sparkles, ChevronDown, ChevronUp, Target } from 'lucide-react'
import { PracticeBlock } from '@/components/PracticeBlock'
import {
  PRACTICE_TEMPLATES, OCCASIONS, PracticeTemplate, templatePlanContent,
} from '@/lib/practiceTemplates'
import { equipmentChecklist } from '@/lib/practicePlan'

// The stock practice gallery.
//
// This used to be its own nav destination ("Practice Library"), which made it
// look like a feature. It isn't: the only thing you can do here is start a
// plan, so it belongs inside the builder's "New Plan" menu alongside "Generate
// with AI" and "Create Custom" — three answers to one question, in one place.
//
// Two things changed when the templates were rebuilt.
//
// THE TEMPLATES ARE CODE, NOT ROWS. They are identical for every coach, so
// there was never a reason for them to be database rows somebody has to
// remember to seed — and in fact nothing ever seeded them, so this gallery
// spent its whole life querying a table that may not have existed and telling
// coaches "no templates match your filters", which was not true. They now come
// from lib/practiceTemplates.ts. Any rows that DO exist in practice_templates
// are still appended, so nothing anybody wrote by hand disappears.
//
// THE PRIMARY ACTION IS NOW "SEED", NOT "COPY". Copying gives a coach a good
// generic plan. Seeding hands the occasion to the generator, which then builds
// it for THIS team — the roster, the attendance, the active priorities, last
// practice's recap. Copy stays as the second button, because it is instant and
// it is the escape hatch when the model is unavailable.

export function TemplateGallery({
  teamId,
  onCopied,
  onSeed,
}: {
  teamId: string | null
  onCopied?: () => void
  // Hands the template's occasion to the practice builder, prefilled.
  onSeed?: (template: PracticeTemplate) => void
}) {
  const [extra, setExtra] = useState<PracticeTemplate[]>([])
  const [selectedAge, setSelectedAge] = useState('all')
  const [selectedOccasion, setSelectedOccasion] = useState('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [copying, setCopying] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)

  const supabase = createSupabaseComponentClient()

  // Anything hand-written into practice_templates still shows. A missing table
  // is now completely fine rather than an empty gallery — the built-ins are
  // already on screen before this runs.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { data, error } = await supabase.from('practice_templates').select('*')
        if (error || !data || cancelled) return
        const builtInIds = new Set(PRACTICE_TEMPLATES.map(t => t.id))
        setExtra(
          (data as any[])
            .filter(r => !builtInIds.has(r.id))
            .map(r => ({
              ...r,
              occasion: r.occasion || r.focus_type || 'all',
              seed: r.seed || null,
              content: r.content || { blocks: [] },
            })) as PracticeTemplate[]
        )
      } catch {
        // Deliberately silent. These are a bonus, not the content.
      }
    })()
    return () => { cancelled = true }
  }, [supabase])

  const templates = [...PRACTICE_TEMPLATES, ...extra]

  const copyToMyPlans = async (template: PracticeTemplate) => {
    if (!teamId) {
      setCopyError('Pick a team first — a plan has to belong to one.')
      return
    }
    setCopying(template.id)
    setCopyError(null)
    try {
      // Cast: the browser client is generated against a Database type that
      // does not describe practice_plans, so every insert infers as `never`.
      const { error } = await (supabase.from('practice_plans') as any)
        .insert({
          team_id: teamId,
          title: template.title,
          duration_minutes: template.duration_minutes,
          focus: template.seed?.focus || [],
          // The same shape the generator writes, so the printed sheet, the plan
          // page and the recap loop cannot tell a copied template apart from a
          // generated plan.
          content: templatePlanContent(template),
        })
      if (error) throw error
      setCopied(template.id)
      setTimeout(() => setCopied(null), 3000)
      onCopied?.()
    } catch (e: any) {
      // The real reason. "Failed to copy template" told a coach nothing.
      setCopyError(e?.message || 'That plan could not be copied.')
    } finally {
      setCopying(null)
    }
  }

  const shown = templates.filter(t => {
    // A template marked 'all' is for every age — the occasion does not change
    // with the birthday. The old filter required an exact match, so an
    // age-agnostic plan was invisible unless you happened to pick "All Ages".
    const matchesAge = selectedAge === 'all' || t.age_group === 'all' || t.age_group === selectedAge
    const matchesOccasion = selectedOccasion === 'all' || t.occasion === selectedOccasion
    return matchesAge && matchesOccasion
  })

  return (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3.5">
        <p className="text-sm text-blue-900">
          These cover the nights the AI has no advantage — a first practice, a rained-out
          gym, thirty minutes before first pitch. <strong>Build for my team</strong> hands
          the occasion to the planner, which then shapes it around your roster and what
          you&apos;ve been working on. <strong>Use as-is</strong> drops it straight into your
          plans, unchanged.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center bg-white rounded-lg shadow p-4">
        <select
          value={selectedOccasion}
          onChange={(e) => setSelectedOccasion(e.target.value)}
          aria-label="Filter by occasion"
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        >
          {OCCASIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          value={selectedAge}
          onChange={(e) => setSelectedAge(e.target.value)}
          aria-label="Filter by age group"
          className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
        >
          <option value="all">All ages</option>
          {['6U', '8U', '10U', '12U'].map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-sm text-gray-500 ml-auto">
          {shown.length} plan{shown.length !== 1 ? 's' : ''}
        </span>
      </div>

      {copyError && (
        <div className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-3">
          {copyError}
        </div>
      )}

      {shown.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-10 text-center">
          <p className="text-gray-900 font-medium">
            Nothing here for {OCCASIONS.find(o => o.value === selectedOccasion)?.label.toLowerCase()}
            {selectedAge !== 'all' ? ` at ${selectedAge}` : ''}.
          </p>
          <p className="text-sm text-gray-600 mt-1">
            Clear the filters to see all {templates.length}, or generate one with AI — that
            handles anything these don&apos;t.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {shown.map(t => (
            <div key={t.id} className="bg-white rounded-lg shadow overflow-hidden flex flex-col">
              <div className="p-4 flex-1">
                <h4 className="font-semibold text-gray-900">{t.title}</h4>
                <p className="text-sm text-gray-600 mt-1">{t.description}</p>

                {t.content?.objective && (
                  <div className="mt-3 flex gap-2 items-start bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                    <Target size={14} className="text-gray-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-800 leading-relaxed">{t.content.objective}</p>
                  </div>
                )}

                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                    <Clock size={12} className="mr-1" />{t.duration_minutes} min
                  </span>
                  <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                    <Users size={12} className="mr-1" />
                    {t.age_group === 'all' ? 'Any age' : t.age_group}
                  </span>
                  <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs">
                    {t.content?.blocks?.length || 0} blocks
                  </span>
                </div>

                <button
                  onClick={() => setExpanded(expanded === t.id ? null : t.id)}
                  className="mt-3 text-sm text-blue-600 hover:text-blue-700 flex items-center font-medium"
                >
                  {expanded === t.id
                    ? <><ChevronUp size={16} className="mr-1" />Hide the plan</>
                    : <><ChevronDown size={16} className="mr-1" />See the whole plan</>}
                </button>
              </div>

              <div className="px-4 pb-4 flex flex-wrap gap-2">
                {onSeed && t.seed && (
                  <button
                    onClick={() => onSeed(t)}
                    className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    <Sparkles size={15} />
                    Build for my team
                  </button>
                )}
                <button
                  onClick={() => copyToMyPlans(t)}
                  disabled={copying === t.id}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                    copied === t.id
                      ? 'bg-green-50 border-green-300 text-green-700'
                      : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {copied === t.id
                    ? <><Check size={15} />Added to your plans</>
                    : copying === t.id
                      ? <>Adding…</>
                      : <><Copy size={15} />Use as-is</>}
                </button>
              </div>

              {expanded === t.id && (
                <div className="border-t border-gray-100 p-4 bg-gray-50">
                  {t.content?.coach_notes && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
                      <p className="text-xs font-semibold text-blue-900 uppercase tracking-wide mb-1">
                        How to run this
                      </p>
                      <p className="text-sm text-blue-900 leading-relaxed">{t.content.coach_notes}</p>
                    </div>
                  )}

                  {t.content?.coaching_points?.length > 0 && (
                    <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4">
                      <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                        Say these all practice
                      </p>
                      <ol className="space-y-1.5">
                        {t.content.coaching_points.map((p, i) => (
                          <li key={i} className="flex gap-2.5 text-sm text-gray-800">
                            <span className="font-bold text-gray-400">{i + 1}.</span>
                            <span>{p}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}

                  {(() => {
                    const kit = equipmentChecklist(t.content?.blocks || [])
                    return kit.length > 0 ? (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2">
                          What to bring
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {kit.map(item => (
                            <span key={item} className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-200 text-gray-800">
                              {item}
                            </span>
                          ))}
                        </div>
                      </div>
                    ) : null
                  })()}

                  {/* The same renderer the draft preview and the saved plan use.
                      This component used to have its own copy of it, which is
                      exactly how the draft ended up showing three fields while
                      the saved plan showed fifteen. */}
                  {t.content?.blocks?.map((block, idx) => (
                    <PracticeBlock key={idx} block={block} idx={idx} />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
