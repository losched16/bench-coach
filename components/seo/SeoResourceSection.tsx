import { ResourceBlock } from '@/lib/seoResource'
import { PracticeTimeline } from './PracticeTimeline'
import { DrillLibrary } from './DrillLibrary'
import { ResourceMetaBar, ResourceObjective, ResourcePrep, RosterVariants } from './ResourceSummary'
import { ResourceActionBar } from './ResourceActionBar'

// The utility half of a converted page, assembled per page type.
//
// Order is the point. On a practice plan the schedule comes before the
// equipment list because a coach checks the plan far more often than they
// re-read what to pack; on a drills page the quick-reference table comes
// first because the job there is choosing. Both put the useful thing above
// the article, which is the entire thesis of this change.
//
// A page with no resource block never reaches here at all — the layout
// renders it exactly as it always has.

interface SeoResourceSectionProps {
  block: ResourceBlock
  pagePath: string
  ageGroup?: string
}

export function SeoResourceSection({ block, pagePath, ageGroup }: SeoResourceSectionProps) {
  const hasDrills = !!block.drills?.length

  if (block.kind === 'practice-plan') {
    return (
      <div className="mb-12">
        <ResourceMetaBar meta={block.meta} />
        <ResourceObjective objective={block.objective} />

        {block.timeline && (
          <PracticeTimeline timeline={block.timeline} hasDrills={hasDrills} />
        )}

        <ResourceActionBar
          pagePath={pagePath}
          ageGroup={ageGroup}
          resourceType="practice-plan"
          canPrint={!!block.timeline}
        />

        <ResourcePrep block={block} />
        <RosterVariants variants={block.rosterVariants} />

        {hasDrills && (
          <DrillLibrary drills={block.drills!} pagePath={pagePath} ageGroup={ageGroup} />
        )}
      </div>
    )
  }

  if (block.kind === 'drill-library') {
    return (
      <div className="mb-12">
        <ResourceMetaBar meta={block.meta} />
        {hasDrills && (
          <DrillLibrary drills={block.drills!} pagePath={pagePath} ageGroup={ageGroup} />
        )}
        <ResourcePrep block={block} />
      </div>
    )
  }

  if (block.kind === 'problem') {
    return (
      <div className="mb-12">
        {block.symptoms?.length ? (
          <section className="my-6 rounded-xl border border-gray-200 p-5 sm:p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-3">What Are You Seeing?</h2>
            <ul className="space-y-2 list-none pl-0">
              {block.symptoms.map((s, i) => (
                <li key={i} className="flex items-start gap-3 text-gray-700">
                  <input
                    type="checkbox"
                    aria-label={s}
                    className="mt-1 h-4 w-4 rounded border-gray-400 accent-red-600 shrink-0"
                  />
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {hasDrills && (
          <DrillLibrary drills={block.drills!} pagePath={pagePath} ageGroup={ageGroup} />
        )}
      </div>
    )
  }

  // age-hub: the paths component is rendered by the layout, which has the
  // slug it needs to query. Anything the hub itself carries shows here.
  return (
    <div className="mb-12">
      <ResourceMetaBar meta={block.meta} />
      <ResourceObjective objective={block.objective} />
    </div>
  )
}
