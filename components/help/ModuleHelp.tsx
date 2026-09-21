'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { HelpCircle, X, ChevronRight, Lightbulb, AlertCircle } from 'lucide-react'
import {
  HelpGuide, HelpModule, guideForModule, guideById, unmetRequirements, requirementMessage,
} from '@/lib/helpContent'
import { primaryActionFor, articleHref, HelpRouteContext } from '@/lib/helpRoutes'
import { useUiPref, helpDismissKey } from '@/lib/useUiPref'
import { useTracker } from '@/lib/tracking'

// Guidance inside a module: a card the first time, a button forever after.
//
// WHY IT NEVER RENDERS BEFORE THE PREFERENCE HAS LOADED
//
// A coach who dismissed this last week should not watch it flash onto the page
// and disappear on every visit. `ready` gates the card, and the "How to use
// this" button renders immediately either way — so the help is always reachable
// even while the preference is still in flight, and nothing jumps.
//
// WHY IT IS NOT A TOUR
//
// No steps that move the page, no modal on arrival, nothing that has to be
// clicked through before the coach can work. This is a card with a dismiss on
// it, above the thing it describes. A volunteer who opened the app to print a
// practice sheet at 5:20 can ignore it entirely.

interface Props {
  module: HelpModule
  ctx: HelpRouteContext
  /** For explaining a missing prerequisite rather than offering a dead action. */
  hasTeam?: boolean
  can?: (c: 'record' | 'decide' | 'own') => boolean
  /**
   * Set when the module already explains itself — an empty state with real
   * prose in it. The first-use card is suppressed and only the button shows,
   * so the two do not stack.
   */
  suppressCard?: boolean
  className?: string
}

export function ModuleHelp({
  module, ctx, hasTeam = true, can = () => true, suppressCard = false, className = '',
}: Props) {
  const guide = guideForModule(module)
  const track = useTracker()
  const { value, ready, set } = useUiPref(guide ? helpDismissKey(guide.id) : null)
  const [panelOpen, setPanelOpen] = useState(false)

  if (!guide) return null

  const dismissed = !!value?.dismissed
  const showCard = ready && !dismissed && !suppressCard

  const openPanel = (entry: 'card' | 'button') => {
    track('help_guide_opened', { guide_id: guide.id, module: guide.module, entry_point: entry })
    setPanelOpen(true)
  }

  const dismiss = () => {
    track('help_first_use_dismissed', { guide_id: guide.id, module: guide.module })
    set({ dismissed: true, at: new Date().toISOString() })
  }

  return (
    <div className={className}>
      {showCard ? (
        <FirstUseCard
          guide={guide}
          ctx={ctx}
          hasTeam={hasTeam}
          can={can}
          onDetails={() => openPanel('card')}
          onDismiss={dismiss}
          onAction={() =>
            track('help_guide_action', { guide_id: guide.id, module: guide.module })}
        />
      ) : (
        <button
          type="button"
          onClick={() => openPanel('button')}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800"
        >
          <HelpCircle size={15} />
          How to use this
        </button>
      )}

      {panelOpen && (
        <HelpPanel
          guide={guide}
          ctx={ctx}
          hasTeam={hasTeam}
          can={can}
          onClose={() => setPanelOpen(false)}
          onAction={() =>
            track('help_guide_action', { guide_id: guide.id, module: guide.module })}
        />
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────

function FirstUseCard({
  guide, ctx, hasTeam, can, onDetails, onDismiss, onAction,
}: {
  guide: HelpGuide
  ctx: HelpRouteContext
  hasTeam: boolean
  can: (c: 'record' | 'decide' | 'own') => boolean
  onDetails: () => void
  onDismiss: () => void
  onAction: () => void
}) {
  const unmet = unmetRequirements(guide, { hasTeam, can })
  const blocked = requirementMessage(guide, unmet)
  const action = primaryActionFor(guide.id, ctx)

  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Lightbulb size={18} className="text-blue-600 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-blue-900">{guide.summary}</p>
            <ol className="mt-2 space-y-1">
              {/* Three, not nine. The card is a nudge; the panel is the manual. */}
              {guide.steps.slice(0, 3).map((s, i) => (
                <li key={i} className="text-sm text-blue-900/80 flex gap-2">
                  <span className="text-blue-400 flex-shrink-0">{i + 1}.</span>
                  <span>{s.do}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss this tip"
          className="flex-shrink-0 p-1.5 -mr-1 -mt-1 text-blue-400 hover:text-blue-700 rounded"
        >
          <X size={16} />
        </button>
      </div>

      {blocked && (
        <p className="mt-3 text-sm text-blue-900/70 flex items-start gap-1.5">
          <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
          <span>{blocked}</span>
        </p>
      )}

      {/* Stacks on a phone so the primary action keeps a full-width target. */}
      <div className="flex flex-col sm:flex-row gap-2 mt-3">
        {action && action.enabled && unmet.length === 0 && (
          <Link
            href={action.href}
            onClick={onAction}
            className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 text-center"
          >
            {action.label}
          </Link>
        )}
        <button
          type="button"
          onClick={onDetails}
          className="px-3 py-2 border border-blue-300 text-blue-800 rounded-lg text-sm font-medium hover:bg-blue-100"
        >
          Show me how
        </button>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────

/**
 * The full guide, in a side panel on desktop and a sheet on a phone.
 *
 * Rendered NEXT TO the module rather than replacing it, and it never unmounts
 * the page behind it — so a half-filled generate form is still there when it
 * closes. That is the whole reason this is not a route.
 *
 * Accessibility, all of it deliberate:
 *   - role="dialog" aria-modal, labelled by its own heading
 *   - focus moves in on open and returns to whatever opened it on close
 *   - Tab is contained; Escape closes
 *   - the backdrop is a real button, so it is reachable without a mouse
 */
export function HelpPanel({
  guide, ctx, hasTeam, can, onClose, onAction,
}: {
  guide: HelpGuide
  ctx: HelpRouteContext
  hasTeam: boolean
  can: (c: 'record' | 'decide' | 'own') => boolean
  onClose: () => void
  onAction?: () => void
}) {
  const titleId = useId()
  const panel = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)

  useEffect(() => {
    returnTo.current = (document.activeElement as HTMLElement) || null
    const first = panel.current?.querySelector<HTMLElement>(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')
    first?.focus()
    return () => {
      // Back where they were. A coach who opened help with the keyboard ends up
      // on the control they opened it from, not at the top of the document.
      returnTo.current?.focus?.()
    }
  }, [])

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose(); return }
    if (e.key !== 'Tab') return
    const focusable = panel.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')
    if (!focusable || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }, [onClose])

  const unmet = unmetRequirements(guide, { hasTeam, can })
  const blocked = requirementMessage(guide, unmet)
  const action = primaryActionFor(guide.id, ctx)

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close help"
        onClick={onClose}
        className="absolute inset-0 bg-black bg-opacity-40"
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        className="relative bg-white w-full sm:max-w-md h-full shadow-xl flex flex-col
                   animate-in slide-in-from-right"
      >
        <div className="p-5 border-b border-gray-200 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-bold text-gray-900">{guide.title}</h2>
            <p className="text-sm text-gray-600 mt-1">{guide.purpose}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close help"
            className="flex-shrink-0 p-2 -mr-2 -mt-1 text-gray-400 hover:text-gray-700 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          <GuideBody guide={guide} blocked={blocked} />
        </div>

        <div className="p-4 border-t border-gray-200 flex flex-col sm:flex-row gap-2">
          {action && action.enabled && unmet.length === 0 && (
            <Link
              href={action.href}
              onClick={onAction}
              className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 text-center"
            >
              {action.label}
            </Link>
          )}
          <Link
            href={articleHref(guide.id, ctx)}
            className="flex-1 px-4 py-2.5 border border-gray-300 rounded-lg text-sm font-medium hover:bg-gray-50 text-center"
          >
            Open in Help
          </Link>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────────────────────

/**
 * The guide's prose. Shared by the panel and the Help Center article, so the
 * two cannot say different things.
 */
export function GuideBody({ guide, blocked }: { guide: HelpGuide; blocked?: string | null }) {
  return (
    <>
      {blocked && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5 text-sm text-amber-900 flex gap-2">
          <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
          <span>{blocked}</span>
        </div>
      )}

      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          How to do it
        </h3>
        <ol className="space-y-3">
          {guide.steps.map((s, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-600 text-xs font-medium flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-gray-800">{s.do}</p>
                {s.note && <p className="text-sm text-gray-500 mt-0.5">{s.note}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {guide.example && (
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            For example
          </h3>
          <p className="text-sm text-gray-700 leading-relaxed">{guide.example}</p>
        </section>
      )}

      <section>
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          When it goes wrong
        </h3>
        <dl className="space-y-3">
          {guide.problems.map((p, i) => (
            <div key={i}>
              <dt className="text-sm font-medium text-gray-800">{p.symptom}</dt>
              <dd className="text-sm text-gray-600 mt-0.5">{p.fix}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="bg-gray-50 rounded-lg p-3 space-y-2">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            What you end up with
          </h3>
          <p className="text-sm text-gray-700 mt-0.5">{guide.result}</p>
        </div>
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Then
          </h3>
          <p className="text-sm text-gray-700 mt-0.5">{guide.nextAction}</p>
        </div>
      </section>
    </>
  )
}

/** Related-guide links. Separate so the Help Center can place them itself. */
export function RelatedGuides({
  guide, ctx, onNavigate,
}: {
  guide: HelpGuide
  ctx: HelpRouteContext
  onNavigate?: (id: string) => void
}) {
  if (guide.related.length === 0) return null
  return (
    <section>
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Related
      </h3>
      <div className="space-y-1">
        {guide.related.map(id => {
          // The registry's content test refuses an unknown related id, so this
          // resolves — but a missing guide is skipped rather than rendered as
          // a slug, because "player-development" is not a sentence.
          const g = guideById(id)
          if (!g) return null
          return (
            <Link
              key={id}
              href={articleHref(id, ctx)}
              onClick={() => onNavigate?.(id)}
              className="flex items-center justify-between text-sm text-gray-700 hover:text-red-700 py-1"
            >
              <span>{g.title}</span>
              <ChevronRight size={15} className="text-gray-400" />
            </Link>
          )
        })}
      </div>
    </section>
  )
}
