// The first-practice checklist's decisions, separated from its markup.
//
// Everything here is a pure function of (what we know about the coach's data,
// what we know about this coach, what they have previously done with the
// checklist). It is here rather than inside the component because the rules
// that matter are the ones about NOT showing things and NOT reporting things,
// and those are exactly the rules that are impossible to see in JSX and easy
// to get wrong twice.
//
// The central distinction: `unavailable` is not `empty`. A roster count that
// failed tells us nothing about whether this coach has players. Treating it as
// zero would show an established coach a "get started" checklist and fire a
// first-run analytics event at them.

export type LoadStatus = 'loading' | 'answered' | 'unavailable'

export interface ChecklistFacts {
  status: LoadStatus
  /** Which team the counts describe; compared against the selected team. */
  teamId: string | null
  hasRoster: boolean
  hasPlan: boolean
}

export interface ChecklistPref {
  startedAt?: string
  completedAt?: string
  skipped?: boolean
  reopenedAt?: string
}

export interface ChecklistInput {
  facts: ChecklistFacts
  /** The team currently selected in the page. */
  teamId: string | null
  canCreatePlans: boolean
  /** Null while the preference is still loading. */
  pref: ChecklistPref | null
  prefReady: boolean
}

export interface ChecklistDecision {
  visible: boolean
  /** Every step is satisfied by real data. */
  complete: boolean
  /** Report onboarding_started now. */
  trackStarted: boolean
  /** Report onboarding_completed now. */
  trackCompleted: boolean
  /** Why it is not visible. For tests and for reasoning, never for coaches. */
  hiddenBecause:
    | null
    | 'pref-loading'
    | 'data-loading'
    | 'data-unavailable'
    | 'stale-team'
    | 'no-team'
    | 'skipped'
    | 'cannot-create-plans'
    | 'established-coach'
    | 'already-finished'
}

export function checklistDecision(input: ChecklistInput): ChecklistDecision {
  const { facts, teamId, canCreatePlans, pref, prefReady } = input
  const no = (hiddenBecause: ChecklistDecision['hiddenBecause']): ChecklistDecision => ({
    visible: false, complete: false, trackStarted: false, trackCompleted: false, hiddenBecause,
  })

  if (!prefReady) return no('pref-loading')
  if (!teamId) return no('no-team')
  if (facts.status === 'loading') return no('data-loading')
  // A failed or unanswerable read. Not "no rows" — no information.
  if (facts.status === 'unavailable') return no('data-unavailable')
  // An answer about a team the coach has since navigated away from.
  if (facts.teamId !== teamId) return no('stale-team')

  const skipped = !!pref?.skipped
  const started = !!pref?.startedAt
  const completed = !!pref?.completedAt
  const reopened = !!pref?.reopenedAt

  // Analytics are decided before visibility, because "started" is reported for
  // a coach who is about to be shown the checklist, and both depend on having
  // real data in hand.
  const trackStarted =
    !skipped && !started && !facts.hasPlan && canCreatePlans

  // Requires `started`: a coach reopening the checklist years after finishing
  // must not emit a second completion for the same first practice. Requires
  // `!completed` for the same reason.
  const trackCompleted =
    facts.hasPlan && started && !completed

  const decide = (hiddenBecause: ChecklistDecision['hiddenBecause']): ChecklistDecision => ({
    visible: hiddenBecause === null,
    complete: facts.hasPlan,
    trackStarted,
    trackCompleted,
    hiddenBecause,
  })

  if (skipped) return decide('skipped')
  if (!canCreatePlans) return decide('cannot-create-plans')
  // Has a plan and was never mid-checklist: an established coach, not a new
  // one — unless they asked for it back from the Help Center.
  if (facts.hasPlan && !started && !reopened) return decide('established-coach')
  if (facts.hasPlan && completed && !reopened) return decide('already-finished')

  return decide(null)
}

/**
 * What the Help Center's reopen control writes.
 *
 * completedAt and startedAt are deliberately absent: reopening restores
 * VISIBILITY, never progress. A coach who never finished stays unfinished; a
 * coach who finished stays finished and is not counted twice.
 */
export function reopenPatch(now: string): ChecklistPref {
  return { skipped: false, reopenedAt: now }
}
