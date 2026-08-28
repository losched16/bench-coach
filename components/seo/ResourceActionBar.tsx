'use client'

import Link from 'next/link'
import { trackSeoEvent } from '@/lib/seoTracking'

// The row of things a coach can actually DO with the resource they are
// looking at. Print it, or cross into the app to make it theirs.
//
// This is the only interactive part of a converted SEO page, and it is
// deliberately tiny: a couple of buttons and a fetch. Everything else on
// these pages renders on the server as static HTML, because the whole point
// of the exercise is that they load fast and rank — shipping a heavy client
// bundle to make a print button work would trade the thing we want for a
// thing we do not.
//
// Print is `window.print()` against the page itself rather than a separate
// printable URL. That is a search decision, not a lazy one: a second URL with
// the same content is a duplicate Google has to reconcile, and the ranking
// URL is the asset here. The print stylesheet lives with the layout.

interface ResourceActionBarProps {
  /** Reported with every event so the funnel can be read per page. */
  pagePath: string
  ageGroup?: string
  resourceType: string
  /** Hidden when the page has no schedule worth printing. */
  canPrint?: boolean
}

export function ResourceActionBar({
  pagePath,
  ageGroup,
  resourceType,
  canPrint = true,
}: ResourceActionBarProps) {
  const context = { page: pagePath, age_group: ageGroup, resource_type: resourceType }

  return (
    <div className="print:hidden my-8 flex flex-wrap gap-3">
      {canPrint && (
        <button
          type="button"
          onClick={() => {
            trackSeoEvent('practice_print', context)
            window.print()
          }}
          className="inline-flex items-center gap-2 px-4 py-3 bg-slate-900 text-white rounded-lg font-semibold hover:bg-slate-800 transition-colors min-h-[44px]"
        >
          <span aria-hidden="true">🖨</span> Print this practice
        </button>
      )}

      {/* The product bridge. A coach who wants this practice adapted to their
          actual roster is exactly the person the app is for, so the CTA
          points at the real builder rather than a marketing page. */}
      <Link
        href="/auth/signup?from=practice-plan"
        onClick={() => trackSeoEvent('practice_generate', context)}
        className="inline-flex items-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 transition-colors min-h-[44px]"
      >
        Build my practice →
      </Link>
    </div>
  )
}

/**
 * "Add to practice" next to a drill.
 *
 * Signup rather than a real add-to-plan: there is no practice to add to until
 * someone has a team. Tracked separately from the page-level CTA so the
 * difference between "wanted the whole plan" and "wanted this one drill" is
 * visible in the data rather than guessed at.
 */
export function AddDrillButton({
  drillName,
  pagePath,
  ageGroup,
}: {
  drillName: string
  pagePath: string
  ageGroup?: string
}) {
  return (
    <Link
      href="/auth/signup?from=drill"
      onClick={() =>
        trackSeoEvent('drill_add_to_practice', {
          page: pagePath,
          age_group: ageGroup,
          drill_name: drillName,
        })
      }
      className="print:hidden inline-flex items-center gap-2 text-sm font-semibold text-red-700 hover:text-red-800 hover:underline min-h-[44px] py-2"
    >
      + Add this drill to a practice
    </Link>
  )
}
