// The one place that says what a Playbook is and what a Development Plan is.
//
// WHY THIS FILE EXISTS
//
// A coach could not tell the two apart, and the help had made it worse by
// explaining the difference as team versus individual. That was wrong: a
// Playbook can be started for the whole team OR for one player — "Whole Team"
// and "Specific Player" are both real buttons on the start dialog, and
// player_playbooks.player_id is nullable precisely so it can be either.
//
// The actual difference is what drives the next step:
//
//   Playbook          a fixed programme. The sessions are decided in advance;
//                     you work through them in order and tick them off.
//   Development Plan  one player, stage by stage. The next stage comes when
//                     you judge the player is ready, not when the list says.
//
// Both wordings now live here and are imported by the Playbooks page, the
// player profile's Development tab and the two help guides, so the product
// cannot drift into explaining itself two different ways again. The help
// guides in lib/helpContent.ts import these constants rather than restating
// them; scripts/test-help-content.ts asserts they match.
//
// WHAT THIS DELIBERATELY DOES NOT SAY
//
// Nothing here claims a playbook adapts, learns, re-plans, or reacts to what
// a coach records. It does not. A playbook is the same list of sessions on day
// one and day forty. Nothing here claims a development plan advances a player
// either — lib/playerPathways.ts is explicit that canAdvance() answers a
// question and a human presses the button.

import { safeId } from './helpRoutes'

/** One line each, for a heading or a tooltip. */
export const PLAYBOOK_TAGLINE = 'Follow a preset program'
export const DEVELOPMENT_TAGLINE = "Track an individual's skill progression"

/**
 * The full description of each. Written to be read next to the thing it
 * describes, so it names real controls: "Mark Complete" on a playbook session,
 * and the mastery signals a coach ticks on a development stage.
 */
export const PLAYBOOK_BLURB =
  'Follow a planned sequence of sessions with your team or an individual player. ' +
  'Mark each session complete as you work through the program.'

/**
 * Takes the player's name where there is one, so the empty state on a player's
 * profile can say "Work through skill stages with Marcus" and the generic help
 * article can say "with one player" — same sentence, one definition. Falls
 * back rather than rendering an empty gap if the name has not loaded.
 */
export function developmentBlurb(subject?: string | null): string {
  const who = subject && subject.trim() ? subject.trim() : 'one player'
  return `Work through skill stages with ${who}. Record sessions and observations, ` +
    'then use the stage\'s mastery signals to decide when they are ready to advance.'
}

export const DEVELOPMENT_BLURB = developmentBlurb()

/**
 * The distinction a coach actually needs, and the one the earlier help got
 * wrong. Stated as the thing that decides the next step, NOT as team size.
 */
export const PROGRAM_DISTINCTION =
  'A Playbook is a fixed program: the sessions are set in advance and you work ' +
  'through them in order. It is the same program whether you start it for the ' +
  'whole team or for one player. A Development Plan is a stage sequence for one ' +
  'player, and the next stage comes when you decide they are ready.'

/**
 * The point both surfaces have to make, because ticking a box looks like
 * progress and is not the same thing.
 */
export const MASTERY_NOTE =
  'Finishing a session is not the same as showing mastery. Advancing a player ' +
  'is always your call.'

/** The decision aid, in the coach's own words rather than in feature names. */
export interface DecisionAidRow {
  /** What the coach is thinking. */
  want: string
  /** The feature that answers it. */
  answer: 'Playbooks' | 'Player Development Plans'
}

export const DECISION_AID: DecisionAidRow[] = [
  {
    want: 'I want a ready-made series of sessions to follow.',
    answer: 'Playbooks',
  },
  {
    want: 'I want to track one player\'s progress and advance them when they are ready.',
    answer: 'Player Development Plans',
  },
]

/**
 * The decision aid as one sentence, for a help guide where a two-row table
 * would be heavier than the point deserves.
 *
 * Deliberately unquoted. scripts/test-help-content.ts checks that quoted
 * strings in a guide are real control labels, and "I want a ready-made series
 * of sessions" is not a button — an earlier guide tripped exactly that check
 * by quoting an illustrative phrase.
 */
export function decisionAidSentence(): string {
  return 'If you want a ready-made series of sessions to follow, use Playbooks. ' +
    'If you want to track one player and advance them when they are ready, ' +
    'use a Development Plan.'
}

/**
 * Development plans are per-player and are started from the player's profile,
 * so a link to "start one" needs a player. From the Playbooks page there is no
 * player in hand, which is why this returns the roster and a label that says
 * to pick somebody rather than pretending it can start one.
 *
 * Both branches carry teamId. A cross-link that drops the selected team sends
 * a coach to a team picker, which is the thing lib/helpRoutes.ts exists to
 * prevent, so this uses the same safeId() guard: an id from the address bar is
 * untrusted and is dropped rather than escaped if it is not id-shaped.
 */
export function developmentPlanLink(
  teamId: string | null | undefined,
  playerId?: string | null,
): { href: string; label: string; needsPlayerChoice: boolean } {
  const t = safeId(teamId)
  const p = safeId(playerId)
  const q = t ? `?teamId=${encodeURIComponent(t)}` : ''
  if (p) {
    // The Development tab, directly. The player page reads ?tab= so this
    // lands on the plan rather than on Overview.
    const sep = q ? '&' : '?'
    return {
      href: `/dashboard/roster/${encodeURIComponent(p)}${q}${sep}tab=development`,
      label: 'Open their Development Plan',
      needsPlayerChoice: false,
    }
  }
  return {
    href: `/dashboard/roster${q}`,
    label: 'Pick a player to start a Development Plan',
    needsPlayerChoice: true,
  }
}

/** The other direction. Playbooks is team-scoped, so teamId is all it needs. */
export function playbooksLink(
  teamId: string | null | undefined,
): { href: string; label: string } {
  const t = safeId(teamId)
  return {
    href: t ? `/dashboard/playbooks?teamId=${encodeURIComponent(t)}` : '/dashboard/playbooks',
    label: 'Browse Playbooks',
  }
}
