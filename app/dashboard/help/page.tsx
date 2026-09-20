'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Search, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, BookOpen,
  ClipboardList, Users, Target, Activity, FileText, Lightbulb, Info,
} from 'lucide-react'
import { usePageView, useTracker } from '@/lib/tracking'
import { useRole } from '@/lib/useRole'
import {
  HELP_GUIDES, HELP_TASKS, HelpTask, guideById, guidesForTask, searchGuides,
  unmetRequirements, requirementMessage,
} from '@/lib/helpContent'
import { primaryActionFor, articleHref } from '@/lib/helpRoutes'
import { GuideBody, RelatedGuides } from '@/components/help/ModuleHelp'
import { COACHING_RESOURCES } from '@/lib/coachingResources'

// The Help Center.
//
// Organised by what a coach is trying to DO, because nobody arrives here
// wanting to read about a module. They arrive wanting to plan Tuesday.
//
// THREE THINGS THE OLD VERSION GOT WRONG, ALL FIXED HERE
//
// 1. Search matched titles only, so "screenshot" found nothing although roster
//    import is documented in detail. It now searches summaries, every step,
//    the problems section and a synonym list.
// 2. It claimed every drill has a video demonstration. Most do not, and the
//    drill guide now says so.
// 3. It sent coaches to Playbooks as a sidebar item. Playbooks is a real
//    feature with a real page, but it is not in the sidebar — so its article
//    says that, rather than directing people at a menu entry that is not there.
//
// Articles are deep-linkable at ?article=<id> and use real history, so browser
// back works and a coach can send another coach a link.
//
// PRODUCT INSTRUCTIONS AND COACHING ADVICE ARE SEPARATE SECTIONS.
// lib/helpContent.ts is checked against the code. lib/coachingResources.tsx is
// somebody's opinion about eight-year-olds. Both are useful; presenting them as
// the same kind of thing is not.

const TASK_ICON: Record<HelpTask, React.ElementType> = {
  'plan-practice': ClipboardList,
  'help-a-player': Target,
  'build-roster': Users,
  'record-what-happened': FileText,
  'prepare-for-a-game': Activity,
  'player-report': BookOpen,
}

function HelpContent() {
  usePageView('help')
  const router = useRouter()
  const searchParams = useSearchParams()
  const track = useTracker()

  const teamId = searchParams.get('teamId')
  const articleId = searchParams.get('article')
  const { can } = useRole(teamId)

  const [query, setQuery] = useState('')
  const [openTask, setOpenTask] = useState<HelpTask | null>(null)
  const [openResource, setOpenResource] = useState<string | null>(null)

  const ctx = { teamId, playerId: null }
  const article = guideById(articleId)

  // Deep-linked article view. Tracked once per article rather than on every
  // render, which is what the dependency list is for.
  useEffect(() => {
    if (article) {
      track('help_guide_opened', {
        guide_id: article.id, module: article.module, entry_point: 'help_center',
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article?.id])

  const results = useMemo(() => searchGuides(query), [query])
  const searching = query.trim().length > 0

  const openArticle = (id: string) => {
    // router.push rather than state, so back works and the URL is shareable.
    const qs = new URLSearchParams()
    if (teamId) qs.set('teamId', teamId)
    qs.set('article', id)
    router.push(`/dashboard/help?${qs.toString()}`)
  }

  const backToIndex = () => {
    router.push(teamId ? `/dashboard/help?teamId=${teamId}` : '/dashboard/help')
  }

  // ── one article ──────────────────────────────────────────────────────────
  if (article) {
    const unmet = unmetRequirements(article, { hasTeam: !!teamId, can })
    const blocked = requirementMessage(article, unmet)
    const action = primaryActionFor(article.id, ctx)

    return (
      <div className="max-w-3xl space-y-6">
        <button
          onClick={backToIndex}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} /> All help
        </button>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">{article.title}</h1>
          <p className="text-gray-600 mt-1">{article.purpose}</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6 space-y-5">
          <GuideBody guide={article} blocked={blocked} />
          <RelatedGuides guide={article} ctx={ctx} />
        </div>

        {action && (
          action.enabled && unmet.length === 0 ? (
            <Link
              href={action.href}
              onClick={() => track('help_guide_action', {
                guide_id: article.id, module: article.module,
              })}
              className="inline-block px-5 py-2.5 bg-red-600 text-white rounded-lg font-medium hover:bg-red-700"
            >
              {action.label}
            </Link>
          ) : (
            // Explain instead of offering something that will not work.
            <p className="text-sm text-gray-500">
              {blocked || 'Select a team to do this.'}
            </p>
          )
        )}
      </div>
    )
  }

  // ── index ────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Help</h1>
        <p className="text-gray-600 mt-1">
          How BenchCoach works, and some opinions about coaching kids.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search — try “screenshot”, “print”, “stages”"
          aria-label="Search help"
          className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
        />
      </div>

      {searching ? (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {results.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-gray-700 font-medium">Nothing matches “{query}”.</p>
              <p className="text-sm text-gray-500 mt-1 mb-4">
                Try a single word, or browse by what you are trying to do.
              </p>
              <button
                onClick={() => setQuery('')}
                className="text-red-600 hover:text-red-700 font-medium text-sm"
              >
                Clear the search
              </button>
            </div>
          ) : (
            results.map(g => (
              <button
                key={g.id}
                onClick={() => openArticle(g.id)}
                className="w-full text-left p-4 hover:bg-gray-50 flex items-center justify-between gap-3"
              >
                <span className="min-w-0">
                  <span className="block font-medium text-gray-900">{g.title}</span>
                  <span className="block text-sm text-gray-600 mt-0.5">{g.summary}</span>
                </span>
                <ChevronRight size={18} className="text-gray-400 flex-shrink-0" />
              </button>
            ))
          )}
        </div>
      ) : (
        <>
          {/* by task */}
          <div className="space-y-2">
            {HELP_TASKS.map(t => {
              const Icon = TASK_ICON[t.id]
              const guides = guidesForTask(t.id)
              const isOpen = openTask === t.id
              return (
                <div key={t.id} className="bg-white rounded-lg shadow overflow-hidden">
                  <button
                    onClick={() => setOpenTask(isOpen ? null : t.id)}
                    aria-expanded={isOpen}
                    className="w-full p-4 text-left flex items-center gap-3 hover:bg-gray-50"
                  >
                    <Icon size={20} className="text-red-600 flex-shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium text-gray-900">{t.label}</span>
                      <span className="block text-sm text-gray-600">{t.blurb}</span>
                    </span>
                    {isOpen
                      ? <ChevronUp size={18} className="text-gray-400 flex-shrink-0" />
                      : <ChevronDown size={18} className="text-gray-400 flex-shrink-0" />}
                  </button>
                  {isOpen && (
                    <div className="border-t border-gray-100 divide-y divide-gray-50">
                      {guides.map(g => (
                        <button
                          key={g.id}
                          onClick={() => openArticle(g.id)}
                          className="w-full text-left px-4 py-3 pl-12 hover:bg-gray-50 flex items-center justify-between gap-3"
                        >
                          <span className="text-sm text-gray-800">{g.title}</span>
                          <ChevronRight size={16} className="text-gray-400 flex-shrink-0" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* every guide, for people who would rather browse */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Every part of BenchCoach</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {HELP_GUIDES.map(g => (
                <button
                  key={g.id}
                  onClick={() => openArticle(g.id)}
                  className="w-full text-left p-4 hover:bg-gray-50 flex items-center justify-between gap-3"
                >
                  <span className="min-w-0">
                    <span className="block font-medium text-gray-900">{g.title}</span>
                    <span className="block text-sm text-gray-600 mt-0.5">{g.summary}</span>
                  </span>
                  <ChevronRight size={18} className="text-gray-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {/* coaching advice — labelled as a different kind of thing */}
          <div className="bg-white rounded-lg shadow">
            <div className="p-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                <Lightbulb size={18} className="text-amber-500" />
                Coaching youth baseball
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Not instructions for the app — thoughts on coaching kids, from people who do.
              </p>
            </div>
            <div className="divide-y divide-gray-50">
              {COACHING_RESOURCES.map(r => {
                const Icon = r.icon
                const isOpen = openResource === r.id
                return (
                  <div key={r.id}>
                    <button
                      onClick={() => setOpenResource(isOpen ? null : r.id)}
                      aria-expanded={isOpen}
                      className="w-full text-left p-4 hover:bg-gray-50 flex items-center gap-3"
                    >
                      <Icon size={18} className="text-gray-400 flex-shrink-0" />
                      <span className="flex-1 font-medium text-gray-900">{r.title}</span>
                      {isOpen
                        ? <ChevronUp size={18} className="text-gray-400" />
                        : <ChevronDown size={18} className="text-gray-400" />}
                    </button>
                    {isOpen && (
                      <div className="px-4 pb-5 pl-12 text-gray-700 text-sm">{r.content}</div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* What we cannot offer. Saying so beats an address that bounces. */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex gap-3">
            <Info size={18} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-600">
              There is no support inbox yet. If something here is wrong or missing, the
              fastest fix is to tell whoever set up your team.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

export default function HelpPage() {
  return (
    <Suspense fallback={<div className="text-gray-600">Loading help...</div>}>
      <HelpContent />
    </Suspense>
  )
}
