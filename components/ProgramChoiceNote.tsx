'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import {
  PLAYBOOK_BLURB, DEVELOPMENT_BLURB, MASTERY_NOTE,
  developmentPlanLink, playbooksLink,
} from '@/lib/programChoice'

// A short note explaining the feature you are standing in, and one link to the
// other one.
//
// WHY IT IS NOT A DISMISSIBLE BANNER
//
// There is already a dismissible first-use card on these screens (ModuleHelp)
// and a full guide behind it. A second dismissible banner saying a similar
// thing would be two things to close on arrival, which is the pattern this
// product has avoided everywhere else. So this is plain page furniture: one
// paragraph under the heading, no chrome, no X, nothing to dismiss.
//
// It does not stack with the first-use card because it says something the card
// does not — the card is "here is how to use this screen", this is "here is
// which of the two features you want". Where both would appear, the caller
// passes compact so this is one line rather than a block.

export function ProgramChoiceNote({
  variant, teamId, playerId, canCrossLink = true, compact = false, className = '',
}: {
  /** Which feature the coach is currently looking at. */
  variant: 'playbooks' | 'development'
  teamId: string | null | undefined
  /** Only meaningful on the development side, where there is a player in hand. */
  playerId?: string | null
  /**
   * False for a coach who cannot start either one. The explanation still
   * shows — knowing the difference is not a privilege — but the link that
   * reads like an invitation to start something does not.
   */
  canCrossLink?: boolean
  compact?: boolean
  className?: string
}) {
  const isPlaybooks = variant === 'playbooks'
  const blurb = isPlaybooks ? PLAYBOOK_BLURB : DEVELOPMENT_BLURB

  // The link always points at the OTHER feature — that is the whole job.
  const other = isPlaybooks
    ? developmentPlanLink(teamId, playerId)
    : { ...playbooksLink(teamId), needsPlayerChoice: false }

  const prompt = isPlaybooks
    ? 'Tracking one player stage by stage, and advancing them when they are ready?'
    : 'Want a ready-made series of sessions to follow instead?'

  return (
    <div className={`text-sm text-gray-600 ${className}`}>
      {/* compact means the surrounding screen has already said what this
          feature is — the player profile's empty state renders the same blurb
          from the same constant — so repeating it here would be the stacked
          banner this component exists to avoid. Only the choice is left. */}
      {!compact && (
        <p className="leading-relaxed">
          {blurb}
          {/* Only the playbook side needs this said out loud: ticking "Mark
              Complete" is the thing that looks like mastery and is not. On the
              development side the stage detail page already says "Your call." */}
          {isPlaybooks && (
            <span className="text-gray-500"> {MASTERY_NOTE}</span>
          )}
        </p>
      )}

      {canCrossLink && (
        <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 ${compact ? '' : 'mt-2'}`}>
          <span className="text-gray-500">{prompt}</span>
          <Link
            href={other.href}
            className="inline-flex items-center gap-1 font-medium text-red-600 hover:text-red-700"
          >
            {other.label}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </p>
      )}
    </div>
  )
}
