// Asks YouTube's public oEmbed endpoint whether a video exists and may be embedded, and what it is called.
// A video that is private, removed or not embeddable fails here, so it never becomes a mapping.
// YOUTUBE_OEMBED_BASE exists only so tests can point this at a local fake; it is unset in production.

export interface YoutubeFacts { title: string; channel: string }

export async function checkYoutubeVideo(videoId: string): Promise<YoutubeFacts | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null
  const base = process.env.YOUTUBE_OEMBED_BASE || 'https://www.youtube.com/oembed'
  try {
    const url = `${base}?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`
    const r = await fetch(url, { signal: AbortSignal.timeout(7000), cache: 'no-store' })
    if (!r.ok) return null
    const j: any = await r.json()
    const title = typeof j?.title === 'string' ? j.title.slice(0, 200) : ''
    if (!title) return null
    return { title, channel: typeof j?.author_name === 'string' ? j.author_name.slice(0, 120) : '' }
  } catch { return null }
}
