'use client'

import { useState, useEffect, useCallback } from 'react'

export interface DrillResource {
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
}

// Simple in-memory cache
const drillCache: Map<string, DrillResource> = new Map()
let allDrillsLoaded = false
let allDrills: DrillResource[] = []

export function useDrillResources() {
  const [drills, setDrills] = useState<DrillResource[]>(allDrills)
  const [loading, setLoading] = useState(!allDrillsLoaded)

  useEffect(() => {
    if (allDrillsLoaded) {
      setDrills(allDrills)
      setLoading(false)
      return
    }

    const loadDrills = async () => {
      try {
        const response = await fetch('/api/drills')
        if (response.ok) {
          const data = await response.json()
          allDrills = data.drills || []
          allDrillsLoaded = true
          
          // Populate cache
          allDrills.forEach(d => {
            drillCache.set(d.drill_name.toLowerCase(), d)
          })
          
          setDrills(allDrills)
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
