import { createPublicSupabaseClient } from '@/lib/supabase'
import Link from 'next/link'

interface SeoHubSpokesProps {
  hubSlug: string
  hubCategory: string
}

export async function SeoHubSpokes({ hubSlug, hubCategory }: SeoHubSpokesProps) {
  const supabase = createPublicSupabaseClient()
  
  // Auto-fetch all spoke pages that reference this hub
  const { data: spokePages } = await supabase
    .from('seo_pages')
    .select('slug, category, title, age_group, topic, meta_description')
    .eq('hub_slug', hubSlug)
    .eq('is_published', true)
    .order('title')
  
  if (!spokePages || spokePages.length === 0) return null
  
  return (
    <div className="my-10 p-6 sm:p-8 bg-slate-50 rounded-2xl border border-slate-200">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2">
        📚 In This Guide
      </h2>
      <p className="text-gray-600 mb-6">
        Dive deeper into specific topics:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {spokePages.map((page: any) => (
          <Link
            key={page.slug}
            href={`/${page.category}/${page.slug}`}
            className="p-4 bg-white rounded-lg border border-slate-200 hover:border-red-400 hover:shadow-md transition-all group"
          >
            <div className="font-semibold text-gray-900 group-hover:text-red-700 transition-colors mb-1">
              {page.title}
            </div>
            {page.meta_description && (
              <div className="text-sm text-gray-500 line-clamp-2">
                {page.meta_description.substring(0, 100)}...
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}
