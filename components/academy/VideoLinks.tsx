// External demonstrations, linked out with attribution — never embedded or
// rehosted. Only links an instructor approved reach this component (server
// filters approval_status); a link marked broken shows a fallback instead.

import { ExternalLink, PlayCircle, FileText } from 'lucide-react'
import type { VideoLink } from '@/lib/academy/server'

function withStart(url: string, s: number | null): string {
  if (!s) return url
  try { const u = new URL(url); u.searchParams.set('t', `${s}s`); return u.toString() } catch { return url }
}

export default function VideoLinks({ videos }: { videos: VideoLink[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-5 py-4" data-testid="videos">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Watch a demonstration</h2>
      {videos.length === 0 ? (
        <p className="text-[15px] text-slate-600" data-testid="video-pending">
          A demonstration video for this lesson is still being reviewed by the instructor. The written lesson and drills above are everything you need to start.
        </p>
      ) : (
        <ul className="space-y-3">
          {videos.map(v => (
            <li key={v.id}>
              {v.link_status === 'broken' ? (
                <p className="text-[15px] text-slate-600" data-testid="video-broken">
                  “{v.title}” by {v.creator} isn&apos;t available right now. We check these links regularly; the written lesson covers the same movement.
                </p>
              ) : (
                <a href={withStart(v.watch_url, v.start_seconds)} target="_blank" rel="noopener noreferrer nofollow"
                  className="group flex items-start gap-3 rounded-lg p-2 -m-2 hover:bg-slate-50" data-testid="video-link">
                  {v.kind === 'article' ? <FileText className="mt-0.5 shrink-0 text-slate-500" size={20} /> : <PlayCircle className="mt-0.5 shrink-0 text-red-600" size={20} />}
                  <span>
                    <span className="font-medium text-slate-900 group-hover:underline">{v.title}</span>
                    <span className="block text-sm text-slate-600">By {v.creator} · opens on {new URL(v.watch_url).hostname.replace(/^www\./, '')} <ExternalLink className="inline -mt-0.5" size={13} /></span>
                  </span>
                </a>
              )}
            </li>
          ))}
          <li className="text-xs text-slate-500 pt-1">External creators are credited for their work and are not affiliated with BenchCoach Academy.</li>
        </ul>
      )}
    </section>
  )
}
