import { createPublicSupabaseClient } from '@/lib/supabase'
import Link from 'next/link'

// The four things a coach comes to an age hub to do.
//
// Built from the pages that actually exist. The hub asks the database for
// every page pointing at it, buckets them by category, and renders the
// buckets that came back with something in them. Nothing is hardcoded, so
// this cannot link to a page that was never written, cannot go stale when one
// is renamed, and needs no edit at all when a new 8U drills page is
// published — it simply appears under TEACH THE SKILLS.
//
// It is also the reason this scales to 6U, 10U and 12U for free: the same
// component over a different hub_slug is a different age's hub.
//
// This replaces SeoHubSpokes for hub pages, which listed the same rows as one
// undifferentiated grid titled "In This Guide". Same links, same query, but a
// coach looking for a practice plan can now see which four of them are
// practice plans.

const PATHS: Array<{
  category: string
  title: string
  blurb: string
  icon: string
}> = [
  {
    category: 'practice-plans',
    title: 'Plan Your Practice',
    blurb: 'Ready-to-run plans you can print and take to the field.',
    icon: '📋',
  },
  {
    category: 'drills',
    title: 'Teach the Skills',
    blurb: 'Drills for hitting, fielding, throwing and baserunning.',
    icon: '⚾',
  },
  {
    category: 'problems',
    title: 'Fix a Problem',
    blurb: 'What to do when something is not working.',
    icon: '🔧',
  },
  {
    category: 'coaching',
    title: 'Coach the Team',
    blurb: 'Game management, parents, positions and playing time.',
    icon: '🧢',
  },
]

interface AgeHubPathsProps {
  hubSlug: string
}

export async function AgeHubPaths({ hubSlug }: AgeHubPathsProps) {
  const supabase = createPublicSupabaseClient()

  const { data: spokes } = await supabase
    .from('seo_pages')
    .select('slug, category, title, age_group, meta_description')
    .eq('hub_slug', hubSlug)
    .eq('is_published', true)
    .order('priority', { ascending: false })

  if (!spokes || spokes.length === 0) return null

  const byCategory = new Map<string, any[]>()
  for (const page of spokes as any[]) {
    if (!byCategory.has(page.category)) byCategory.set(page.category, [])
    byCategory.get(page.category)!.push(page)
  }

  // A category with no pages is not rendered as an empty promise.
  const present = PATHS.filter(p => (byCategory.get(p.category)?.length || 0) > 0)

  // Anything in a category the four paths do not cover still needs a home,
  // rather than silently vanishing from its own hub.
  const covered = new Set(PATHS.map(p => p.category))
  const leftovers = (spokes as any[]).filter(p => !covered.has(p.category))

  if (present.length === 0 && leftovers.length === 0) return null

  return (
    <section className="my-10" aria-labelledby="hub-paths">
      <h2 id="hub-paths" className="sr-only">Coaching resources</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {present.map(path => {
          const pages = byCategory.get(path.category)!
          return (
            <div
              key={path.category}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-5 sm:p-6"
            >
              <div className="flex items-start gap-3 mb-1">
                <span aria-hidden="true" className="text-2xl leading-none">{path.icon}</span>
                <div>
                  <h3 className="text-lg font-bold uppercase tracking-wide text-gray-900">
                    {path.title}
                  </h3>
                  <p className="text-sm text-gray-600">{path.blurb}</p>
                </div>
              </div>
              <ul className="mt-4 space-y-1 list-none pl-0">
                {pages.map(page => (
                  <li key={page.slug}>
                    <Link
                      href={`/${page.category}/${page.slug}`}
                      className="group flex items-start gap-2 rounded-lg px-3 py-2.5 -mx-1 hover:bg-white transition-colors min-h-[44px]"
                    >
                      <span className="text-red-600 mt-0.5" aria-hidden="true">→</span>
                      <span className="font-medium text-gray-900 group-hover:text-red-700 transition-colors">
                        {page.title}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>

      {leftovers.length > 0 && (
        <ul className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 list-none pl-0">
          {leftovers.map(page => (
            <li key={page.slug}>
              <Link
                href={`/${page.category}/${page.slug}`}
                className="block p-4 rounded-xl border border-gray-200 hover:border-red-400 hover:bg-red-50 transition-colors font-medium text-gray-900"
              >
                {page.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
