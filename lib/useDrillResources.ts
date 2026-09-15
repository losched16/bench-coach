'use client'

import { useState, useEffect, useCallback } from 'react'
import { isSchedulable } from '@/lib/drills'

export interface DrillResource {
  // Returned by /api/drills and needed to favorite a drill from inside a
  // practice plan. Optional because plans generated before the API selected it
  // will not have one, and the save button falls back to "save as my own".
  id?: string
  drill_name: string
  youtube_video_id?: string
  youtube_url?: string
  thumbnail_url?: string
  channel?: string
  description?: string
  skill_category?: string
  difficulty_level?: string
  common_flaws_fixed?: string[]
  ai_coaching_notes?: string
  // Present only on the ?include=all payload. NULL or absent means nobody has
  // classified this row, which is the normal state and counts as runnable.
  resource_kind?: string | null
}

// Simple in-memory cache.
//
// allDrills holds EVERY drill this coach may see, including rows classified as
// source_collection or teaching_content. `drills` — what a surface offers —
// is the schedulable subset. The two are different questions and this hook
// answers both from one fetch:
//
//   drills      what may I offer this coach to run?   (schedulable)
//   findDrill   what does this stored name refer to?  (everything visible)
//
// findDrill searching the full set is what keeps an existing practice plan
// rendering after its drill is demoted. Demotion stops future suggestions; it
// does not reach back into a plan a coach already saved and printed.
const drillCache: Map<string, DrillResource> = new Map()
let allDrillsLoaded = false
let allDrills: DrillResource[] = []

export function useDrillResources() {
  const [drills, setDrills] = useState<DrillResource[]>(allDrills.filter(d => isSchedulable(d)))
  const [loading, setLoading] = useState(!allDrillsLoaded)

  useEffect(() => {
    if (allDrillsLoaded) {
      setDrills(allDrills.filter(d => isSchedulable(d)))
      setLoading(false)
      return
    }

    const loadDrills = async () => {
      try {
        const response = await fetch('/api/drills?include=all')
        if (response.ok) {
          const data = await response.json()
          allDrills = data.drills || []
          allDrillsLoaded = true
          
          // Populate cache
          allDrills.forEach(d => {
            drillCache.set(d.drill_name.toLowerCase(), d)
          })
          
          setDrills(allDrills.filter(d => isSchedulable(d)))
        }
      } catch (error) {
        console.error('Failed to load drill resources:', error)
      } finally {
        setLoading(false)
      }
    }

    loadDrills()
  }, [])

  // Find a drill by name (fuzzy match)
  const findDrill = useCallback((name: string): DrillResource | null => {
    if (!name) return null
    
    const nameLower = name.toLowerCase()
    
    // Exact match first
    if (drillCache.has(nameLower)) {
      return drillCache.get(nameLower)!
    }
    
    // Fuzzy match
    for (const drill of allDrills) {
      const drillNameLower = drill.drill_name.toLowerCase()
      if (
        drillNameLower.includes(nameLower) ||
        nameLower.includes(drillNameLower)
      ) {
        return drill
      }
    }
    
    return null
  }, [])

  // Find multiple drills
  const findDrills = useCallback((names: string[]): DrillResource[] => {
    return names
      .map(name => findDrill(name))
      .filter((d): d is DrillResource => d !== null)
  }, [findDrill])

  return {
    drills,
    loading,
    findDrill,
    findDrills,
  }
}

// Standalone function to check if a drill has a video
export function drillHasVideo(drill: DrillResource | null): boolean {
  return !!(drill?.youtube_video_id || drill?.youtube_url)
}
