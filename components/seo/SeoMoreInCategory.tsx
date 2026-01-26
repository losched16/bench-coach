import { createPublicSupabaseClient } from '@/lib/supabase'
import Link from 'next/link'

interface SeoMoreInCategoryProps {
  currentSlug: string
  category: string
  ageGroup?: string
}

export async function SeoMoreInCategory({ currentSlug, category, ageGroup }: SeoMoreInCategoryProps) {
  const supabase = createPublicSupabaseClient()
  
  // First try to get pages with same age group, then fall back to same category
  let query = supabase
    .from('seo_pages')
    .select('slug, category, title, age_group, type')
    .eq('category', category)
    .eq('is_published', true)
    .neq('slug', currentSlug)
    .limit(4)
  
  // Prioritize same age group if available
  if (ageGroup) {
    query = query.eq('age_group', ageGroup)
  }
  
  let { data: relatedPages } = await query
  
  // If no results with age group filter, try without it
  if ((!relatedPages || relatedPages.length === 0) && ageGroup) {
    const { data: fallbackPages } = await supabase
      .from('seo_pages')
      .select('slug, category, title, age_group, type')
      .eq('category', category)
      .eq('is_published', true)
      .neq('slug', currentSlug)
      .limit(4)
    
    relatedPages = fallbackPages
  }
  
  if (!relatedPages || relatedPages.length === 0) return null
  
  const categoryLabels: Record<string, string> = {
    'coaching': 'Coaching Guides',
    'drills': 'Drills',
    'practice-plans': 'Practice Plans',
    'problems': 'Common Problems',
  }
  
  return (
    <div className="my-12 border-t border-gray-200 pt-12">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-6">
        More {categoryLabels[category] || category}
      </h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {relatedPages.map((page: any) => (
          <Link
            key={page.slug}
            href={`/${page.category}/${page.slug}`}
            className="p-4 border border-gray-200 rounded-lg hover:border-red-400 hover:bg-red-50 transition-all group"
          >
            <div className="flex items-center gap-2 mb-1">
              {page.type === 'hub' && (
                <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full">
                  Guide
                </span>
              )}
              {page.age_group && (
                <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">
                  {page.age_group}
                </span>
              )}
            </div>
            <div className="font-semibold text-gray-900 group-hover:text-red-700 transition-colors">
              {page.title}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
