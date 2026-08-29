'use client'

import { useState } from 'react'
import { Play, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { embedUrl, thumbnailUrl as videoThumbnail, videoIdFor } from '@/lib/drillVideo'

interface DrillVideoProps {
  drillName: string
  youtubeVideoId?: string
  youtubeUrl?: string
  thumbnailUrl?: string
  channel?: string
  description?: string
  compact?: boolean // For inline use in lists
  autoExpand?: boolean // Start expanded
  // Where in the video this drill actually begins.
  //
  // A good part of the library is anchored to compilation videos — one row is
  // literally "10 Best Baseball Throwing Drills for Kids". Opening those at
  // 0:00 and calling it a drill is how a plan starts feeling like a folder of
  // general YouTube links. Undefined means start at the beginning, which is
  // right for the single-drill videos.
  startSeconds?: number
}

export function DrillVideo({
  drillName,
  youtubeVideoId,
  youtubeUrl,
  thumbnailUrl,
  channel,
  description,
  compact = false,
  autoExpand = false,
  startSeconds,
}: DrillVideoProps) {
  const [isExpanded, setIsExpanded] = useState(autoExpand)
  const [isPlaying, setIsPlaying] = useState(false)

  // Extract video ID from URL if not provided directly
  const videoId = videoIdFor({ youtube_video_id: youtubeVideoId, youtube_url: youtubeUrl })

  if (!videoId) {
    return null // No video available
  }

  // Both built by lib/drillVideo so this component agrees with every other
  // surface about where the drill starts. The guard against a negative or
  // non-finite startSeconds lives there now — such a value does not degrade
  // gracefully, it fails the whole embed.
  const asDrill = {
    youtube_video_id: videoId,
    youtube_url: youtubeUrl,
    thumbnail_url: thumbnailUrl,
    youtube_start_seconds: startSeconds,
  }
  const thumbnail = videoThumbnail(asDrill) || undefined
  const inlineSrc = embedUrl(asDrill) || ''
  const autoplaySrc = embedUrl(asDrill, { autoplay: true }) || ''

  if (compact) {
    // Compact inline version - expandable
    return (
      <div className="mt-3 border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-3 py-2 flex items-center justify-between hover:bg-gray-100 transition-colors"
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-red-100 flex items-center justify-center">
              <Play size={16} className="text-red-600 ml-0.5" fill="currentColor" />
            </div>
            <div className="text-left">
              <div className="text-sm font-medium text-gray-900">Watch: {drillName}</div>
              {channel && <div className="text-xs text-gray-500">via {channel}</div>}
            </div>
          </div>
          {isExpanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
        </button>

        {isExpanded && (
          <div className="border-t border-gray-200">
            <div className="aspect-video bg-black">
              <iframe
                src={inlineSrc}
                title={drillName}
                className="w-full h-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
              />
            </div>
            {channel && (
              <div className="px-3 py-2 bg-gray-100 text-xs text-gray-600">
                Video by <span className="font-medium">{channel}</span>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  // Full version with thumbnail that converts to player on click
  return (
    <div className="rounded-lg overflow-hidden border border-gray-200 bg-white">
      {!isPlaying ? (
        // Thumbnail with play button
        <div
          className="relative aspect-video cursor-pointer group"
          onClick={() => setIsPlaying(true)}
        >
          <img
            src={thumbnail}
            alt={drillName}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-black bg-opacity-30 group-hover:bg-opacity-40 transition-all flex items-center justify-center">
            <div className="w-16 h-16 rounded-full bg-red-600 group-hover:bg-red-700 transition-colors flex items-center justify-center shadow-lg">
              <Play size={32} className="text-white ml-1" fill="white" />
            </div>
          </div>
          {channel && (
            <div className="absolute bottom-2 right-2 px-2 py-1 bg-black bg-opacity-70 rounded text-xs text-white">
              {channel}
            </div>
          )}
        </div>
      ) : (
        // Embedded player
        <div className="aspect-video bg-black">
          <iframe
            src={autoplaySrc}
            title={drillName}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      )}

      {/* Info bar */}
      <div className="p-3 bg-gray-50 border-t border-gray-200">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-medium text-gray-900 text-sm">{drillName}</div>
            {channel && (
              <div className="text-xs text-gray-500">Video by {channel}</div>
            )}
          </div>
        </div>
        {description && (
          <p className="mt-2 text-xs text-gray-600">{description}</p>
        )}
      </div>
    </div>
  )
}

// Component to look up drill by name and render video if found
interface DrillVideoLookupProps {
  drillName: string
  drillResources: Array<{
    drill_name: string
    youtube_video_id?: string
    youtube_url?: string
    youtube_start_seconds?: number | null
    thumbnail_url?: string
    channel?: string
    description?: string
  }>
  compact?: boolean
  autoExpand?: boolean
}

export function DrillVideoLookup({
  drillName,
  drillResources,
  compact = true,
  autoExpand = false,
}: DrillVideoLookupProps) {
  // Find matching drill (fuzzy match on name)
  const drill = drillResources.find(d => 
    d.drill_name.toLowerCase() === drillName.toLowerCase() ||
    d.drill_name.toLowerCase().includes(drillName.toLowerCase()) ||
    drillName.toLowerCase().includes(d.drill_name.toLowerCase())
  )

  if (!drill || (!drill.youtube_video_id && !drill.youtube_url)) {
    return null
  }

  return (
    <DrillVideo
      drillName={drill.drill_name}
      youtubeVideoId={drill.youtube_video_id}
      youtubeUrl={drill.youtube_url}
      thumbnailUrl={drill.thumbnail_url}
      channel={drill.channel}
      description={drill.description}
      startSeconds={drill.youtube_start_seconds ?? undefined}
      compact={compact}
      autoExpand={autoExpand}
    />
  )
}


export default DrillVideo
