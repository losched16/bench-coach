'use client'

import Link from 'next/link'
import { trackSeoEvent } from '@/lib/seoTracking'

// One resource card, labelled by what it actually is.
//
// The type badge is the whole point. "Practice Plan · 8U" tells a coach
// whether the thing behind the link is something to run on Tuesday or
// something to read tonight, and that is the judgement they are making when
// they decide whether to click.
//
// A client component only because of the click event. The link itself is a
// plain <Link> and works with no JavaScript at all, which matters for both
// crawling and for a phone on field wifi.

const TYPE_LABELS: Record<string, string> = {
  coaching: 'Coaching Guide',
  drills: 'Drills',
  'practice-plans': 'Practice Plan',
  problems: 'Problem',
}

interface RelatedResourceCardProps {
  slug: string
  category: string
  title: string
  ageGroup?: string
  description?: string
  /** The page the click came from — the other half of a link graph. */
  fromPath: string
  location: string
}

export function RelatedResourceCard({
  slug,
  category,
  title,
  ageGroup,
  description,
  fromPath,
  location,
}: RelatedResourceCardProps) {
  const href = `/${category}/${slug}`

  return (
    <Link
      href={href}
      onClick={() =>
        trackSeoEvent('related_resource_click', {
          page: fromPath,
          age_group: ageGroup,
          resource_type: category,
          destination: href,
          location,
        })
      }
      className="group flex flex-col p-4 border border-gray-200 rounded-xl hover:border-red-400 hover:bg-red-50 transition-colors"
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-red-700">
          {TYPE_LABELS[category] || category.replace('-', ' ')}
        </span>
        {ageGroup && (
          <span className="text-[11px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {ageGroup}
          </span>
        )}
      </div>
      <div className="font-semibold text-gray-900 group-hover:text-red-700 transition-colors">
        {title}
      </div>
      {description && (
        <p className="text-sm text-gray-500 mt-1 line-clamp-2">{description}</p>
      )}
    </Link>
  )
}
