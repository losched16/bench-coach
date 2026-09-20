'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  Search, ChevronRight, ChevronDown, ChevronUp, ArrowLeft, BookOpen,
  ClipboardList, Users, Target, Activity, FileText, Lightbulb, Info, Rocket,
} from 'lucide-react'
import { useUiPref, ONBOARDING_PREF_KEY } from '@/lib/useUiPref'
import { usePageView, useTracker } from '@/lib/tracking'
import { useRole } from '@/lib/useRole'
import {
  HELP_GUIDES, HELP_TASKS, HelpTask, guideById, guidesForTask, searchGuides,
  unmetRequirements, requirementMessage,
} from '@/lib/helpContent'
import { primaryActionFor, articleHref, safeId } from '@/lib/helpRoutes'
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

  const teamId = safeId(searchParams.get('teamId'))
  // Carried from wherever help was opened, so "Open this player" after reading
  // three articles still means the player the coach started on. It is a
  // breadcrumb for building links and nothing else — no player data is loaded
  // here, and the pages it links to authorize the coach themselves.
  const playerId = safeId(searchParams.get('playerId'))
  const articleId = searchParams.get('article')
  const { can } = useRole(teamId)

  const [query, setQuery] = useState('')
  const [openTask, setOpenTask] = useState<HelpTask | null>(null)
  const [openResource, setOpenResource] = useState<string | null>(null)

  const ctx = { teamId, playerId }
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

  // router.push rather than state, so back works and the URL is shareable.
  // Both of these go through articleHref so every route into and out of an
  // article keeps the same team and player.
  const openArticle = (id: string) => router.push(articleHref(id, ctx))

  const backToIndex = () => {
    const qs = new URLSearchParams()
    if (teamId) qs.set('teamId', teamId)
    if (playerId) qs.set('playerId', playerId)
    const s = qs.toString()
    router.push(s ? `/dashboard/help?${s}` : '/dashboard/help')
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

          <ResumeOnboarding teamId={teamId} canCreatePlans={can('decide')} />

          {/* No invented address, and no pretending that asking the person who
              set up your team is a support channel — it is not, and calling it
              "the fastest fix" told coaches something untrue. */}
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex gap-3">
            <Info size={18} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-gray-600">
              BenchCoach does not have a way to contact support from inside the app yet.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

/**
 * "Show me the first-practice checklist again."
 *
 * The checklist lives on the dashboard and can be skipped or finished, after
 * which it is gone. Until now there was no way back to it, which made the
 * dismiss button a one-way door.
 *
 * WHAT REOPENING DOES AND DOES NOT DO
 *
 * It sets `reopenedAt` and clears `skipped`. It does NOT touch `completedAt`,
 * so a coach who finished last spring is still finished — the checklist opens
 * showing the steps already ticked from their real data, and no second
 * onboarding_completed is reported for the same first practice. Reopening
 * never marks anything done that the coach has not actually done: every tick
 * is still read from their roster and plan rows.
 *
 * Hidden from anyone who cannot create practice plans, because the middle step
 * is one they are not allowed to perform.
 */
function ResumeOnboarding({
  teamId, canCreatePlans,
}: { teamId: string | null; canCreatePlans: boolean }) {
  const router = useRouter()
  const track = useTracker()
  const { value, ready, set } = useUiPref(ONBOARDING_PREF_KEY)

  if (!ready || !teamId || !canCreatePlans) return null

  const finished = !!value?.completedAt
  const hidden = !!value?.skipped
  const showing = !hidden && !finished

  const reopen = () => {
    if (!showing) {
      track('onboarding_reopened', { checklist: 'first-practice' })
      // completedAt and startedAt are deliberately left alone.
      set({ skipped: false, reopenedAt: new Date().toISOString() })
    }
    router.push(`/dashboard?teamId=${teamId}`)
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 flex items-start gap-3">
      <Rocket size={18} className="text-red-600 flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900">Setting up your first practice</p>
        <p className="text-sm text-gray-600 mt-0.5">
          {finished
            ? 'You have already saved a practice plan. You can still open the checklist to see the steps.'
            : hidden
              ? 'You hid this earlier. It picks up wherever you got to.'
              : 'It is on your dashboard now.'}
        </p>
      </div>
      <button
        type="button"
        onClick={reopen}
        data-testid="resume-onboarding"
        className="flex-shrink-0 text-sm font-medium text-red-600 hover:text-red-700"
      >
        {showing ? 'Go to it' : 'Show it again'}
      </button>
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
