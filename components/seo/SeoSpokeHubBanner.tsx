import { createPublicSupabaseClient } from '@/lib/supabase'
import Link from 'next/link'

interface SeoSpokeHubBannerProps {
  hubSlug: string
}

export async function SeoSpokeHubBanner({ hubSlug }: SeoSpokeHubBannerProps) {
  const supabase = createPublicSupabaseClient()
  
  const { data: hubPage } = await supabase
    .from('seo_pages')
    .select('slug, category, title')
    .eq('slug', hubSlug)
    .single()
  
  if (!hubPage) return null
  
  return (
    <div className="mb-8 p-4 bg-slate-100 rounded-lg border border-slate-200">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">📖 Part of:</span>
        <Link 
          href={`/${hubPage.category}/${hubPage.slug}`}
          className="font-medium text-red-700 hover:text-red-800 hover:underline transition-colors"
        >
          {hubPage.title}
        </Link>
      </div>
    </div>
  )
}
