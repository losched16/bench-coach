import { createPublicSupabaseClient } from '@/lib/supabase'
import Link from 'next/link'

interface SeoPageBreadcrumbsProps {
  category: string
  hubSlug?: string
  currentTitle: string
  pageType: 'hub' | 'spoke'
}

export async function SeoPageBreadcrumbs({ 
  category, 
  hubSlug, 
  currentTitle,
  pageType
}: SeoPageBreadcrumbsProps) {
  const supabase = createPublicSupabaseClient()
  
  let hubPage = null
  if (pageType === 'spoke' && hubSlug) {
    const { data } = await supabase
      .from('seo_pages')
      .select('title, slug, category')
      .eq('slug', hubSlug)
      .single()
    hubPage = data
  }

  const categoryLabels: Record<string, string> = {
    'coaching': 'Coaching Guides',
    'drills': 'Drills',
    'practice-plans': 'Practice Plans',
    'problems': 'Common Problems',
  }
  
  return (
    <nav className="max-w-4xl mx-auto px-4 py-4 border-b border-gray-100">
      <ol className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
        <li>
          <Link href="/" className="hover:text-red-600 transition-colors">
            Home
          </Link>
        </li>
        <li className="text-gray-400">→</li>
        <li>
          <span className="text-gray-500">
            {categoryLabels[category] || category}
          </span>
        </li>
        {hubPage && (
          <>
            <li className="text-gray-400">→</li>
            <li>
              <Link 
                href={`/${hubPage.category}/${hubPage.slug}`}
                className="hover:text-red-600 transition-colors"
              >
                {hubPage.title}
              </Link>
            </li>
          </>
        )}
        <li className="text-gray-400">→</li>
        <li className="text-gray-900 font-medium truncate max-w-[200px] sm:max-w-none">
          {currentTitle}
        </li>
      </ol>
    </nav>
  )
}
