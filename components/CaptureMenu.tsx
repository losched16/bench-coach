'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Plus, ClipboardList, Timer, UserPlus, Users } from 'lucide-react'

// Capture, from anywhere.
//
// Logging what happened was a sidebar destination called "Log an Entry" — the
// name of a database operation, and a place you had to navigate to. But capture
// isn't somewhere you go; it's something you do while standing at a fence with
// one hand on a phone. The old "New" menu was worse than absent on mobile: it
// was inside a `hidden sm:flex` block, so it didn't exist there at all.
//
// Recording something that happened sits above creating something that didn't,
// because it happens twenty times as often.

interface Props {
  teamId: string
  canCreate: boolean
  // A Personal plan has no teams to create. Defaults to true so the two other
  // callers of this menu keep their behaviour.
  canCreateTeams?: boolean
  className?: string
}

export function CaptureMenu({ teamId, canCreate, canCreateTeams = true, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // A menu that stays open after you tap past it is a menu that eats the next
  // tap, which on a phone reads as the app being broken.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const item = 'flex items-center gap-2.5 px-4 py-2.5 text-gray-700 hover:bg-gray-100 text-sm'

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-sm"
        aria-label="Add"
        aria-expanded={open}
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Add</span>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg py-1 z-50">
          <Link href={`/dashboard/log?teamId=${teamId}`} className={item} onClick={() => setOpen(false)}>
            <ClipboardList size={16} className="text-red-600" />
            <span className="font-medium">Log an entry</span>
          </Link>
          <Link href={`/dashboard/count?teamId=${teamId}`} className={item} onClick={() => setOpen(false)}>
            <Timer size={16} className="text-red-600" />
            <span className="font-medium">Count pitches</span>
          </Link>

          {canCreate && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <Link href="/dashboard/new-player" className={item} onClick={() => setOpen(false)}>
                <UserPlus size={16} className="text-gray-400" />
                New player
              </Link>
              {canCreateTeams && (
                <Link href="/dashboard/new-team" className={item} onClick={() => setOpen(false)}>
                  <Users size={16} className="text-gray-400" />
                  New team
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
