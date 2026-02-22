'use client'

import { useState, useMemo } from 'react'
import { Play, ChevronDown, ChevronUp } from 'lucide-react'

interface ChatMessageContentProps {
  content: string
  role: 'user' | 'assistant'
}

// Regex to find YouTube URLs in text
const YOUTUBE_REGEX = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]+)(?:[^\s]*)?/g

interface VideoEmbed {
  videoId: string
  fullUrl: string
  startIndex: number
  endIndex: number
}

export function ChatMessageContent({ content, role }: ChatMessageContentProps) {
  const [expandedVideos, setExpandedVideos] = useState<Set<string>>(new Set())

  // Parse content to find YouTube links
  const { textParts, videos } = useMemo(() => {
    const videos: VideoEmbed[] = []
    let match

    // Reset regex
    YOUTUBE_REGEX.lastIndex = 0

    while ((match = YOUTUBE_REGEX.exec(content)) !== null) {
      videos.push({
        videoId: match[1],
        fullUrl: match[0],
        startIndex: match.index,
        endIndex: match.index + match[0].length,
      })
    }

    // Split content into text parts and video markers
    const textParts: { type: 'text' | 'video'; content: string; videoId?: string }[] = []
    let lastIndex = 0

    videos.forEach((video, idx) => {
      // Add text before this video
      if (video.startIndex > lastIndex) {
        textParts.push({
          type: 'text',
          content: content.slice(lastIndex, video.startIndex),
        })
      }
      // Add video marker
      textParts.push({
        type: 'video',
        content: video.fullUrl,
        videoId: video.videoId,
      })
      lastIndex = video.endIndex
    })

    // Add remaining text
    if (lastIndex < content.length) {
      textParts.push({
        type: 'text',
        content: content.slice(lastIndex),
      })
    }

    return { textParts, videos }
  }, [content])

  const toggleVideo = (videoId: string) => {
    setExpandedVideos(prev => {
      const next = new Set(prev)
      if (next.has(videoId)) {
        next.delete(videoId)
      } else {
        next.add(videoId)
      }
      return next
    })
  }

  // If no videos, just render text
  if (videos.length === 0) {
    return <div className="whitespace-pre-wrap">{content}</div>
  }

  // Render with embedded videos
  return (
    <div className="space-y-3">
      {textParts.map((part, idx) => {
        if (part.type === 'text') {
          return (
            <div key={idx} className="whitespace-pre-wrap">
              {part.content}
            </div>
          )
        }

        // Video embed
        const isExpanded = expandedVideos.has(part.videoId!)
        return (
          <div key={idx} className="rounded-lg overflow-hidden border border-gray-300 bg-white">
            {/* Video toggle button */}
            <button
              onClick={() => toggleVideo(part.videoId!)}
              className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Play size={20} className="text-red-600 ml-0.5" fill="currentColor" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium text-gray-900">
                    {isExpanded ? 'Hide Video' : 'Watch Drill Video'}
                  </div>
                  <div className="text-xs text-gray-500 truncate max-w-xs">
                    Click to {isExpanded ? 'collapse' : 'expand'}
                  </div>
                </div>
              </div>
              {isExpanded ? (
                <ChevronUp size={20} className="text-gray-400 flex-shrink-0" />
              ) : (
                <ChevronDown size={20} className="text-gray-400 flex-shrink-0" />
              )}
            </button>

            {/* Embedded video */}
            {isExpanded && (
              <div className="border-t border-gray-200">
                <div className="aspect-video bg-black">
                  <iframe
                    src={`https://www.youtube.com/embed/${part.videoId}?rel=0`}
                    title="Drill Video"
                    className="w-full h-full"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default ChatMessageContent
