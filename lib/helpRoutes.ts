// Where a guide's action goes, kept away from what the guide says.
//
// lib/helpContent.ts contains no URLs on purpose, and its content test fails if
// one appears. Prose that knows about routes is prose that drops the selected
// team the first time somebody copies a link between guides — and a coach who
// follows "Open Practice Plans" into an empty team picker has been sent
// backwards by the help.
//
// So the content names an ACTION and this turns it into a href carrying
// whatever context the caller is standing in.

export interface HelpRouteContext {
  teamId?: string | null
  playerId?: string | null
}

export interface HelpAction {
  label: string
  href: string
  /** False when the action cannot work from here — shown as text, not a link. */
  enabled: boolean
}

function withTeam(path: string, ctx: HelpRouteContext, extra?: Record<string, string>): string {
  const params = new URLSearchParams()
  if (ctx.teamId) params.set('teamId', ctx.teamId)
  for (const [k, v] of Object.entries(extra || {})) params.set(k, v)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/**
 * The primary action for a guide: the thing that starts the actual workflow.
 *
 * Returns null where a guide has no single obvious action — an overview of
 * note-taking should not pretend there is one button that does it.
 */
export function primaryActionFor(
  guideId: string,
  ctx: HelpRouteContext
): HelpAction | null {
  switch (guideId) {
    case 'practice-plans':
      return {
        label: 'Open Practice Plans',
        href: withTeam('/dashboard/practice', ctx),
        enabled: !!ctx.teamId,
      }
    case 'skill-development':
      return {
        label: 'Ask CoachAI',
        href: withTeam('/dashboard/chat', ctx),
        enabled: !!ctx.teamId,
      }
    case 'roster':
      return {
        label: 'Open Roster',
        href: withTeam('/dashboard/roster', ctx),
        enabled: !!ctx.teamId,
      }
    case 'player-development':
      // A player page when we know the player, the roster otherwise — sending
      // somebody to a player id that is not theirs is worse than one more tap.
      return ctx.playerId
        ? {
            label: 'Open this player',
            href: withTeam(`/dashboard/roster/${ctx.playerId}`, ctx),
            enabled: !!ctx.teamId,
          }
        : {
            label: 'Choose a player',
            href: withTeam('/dashboard/roster', ctx),
            enabled: !!ctx.teamId,
          }
    case 'player-reports':
      return ctx.playerId
        ? {
            label: 'Open this player',
            href: withTeam(`/dashboard/roster/${ctx.playerId}`, ctx),
            enabled: !!ctx.teamId,
          }
        : {
            label: 'Choose a player',
            href: withTeam('/dashboard/roster', ctx),
            enabled: !!ctx.teamId,
          }
    case 'drill-library':
      return { label: 'Open Drill Library', href: withTeam('/dashboard/drills', ctx), enabled: true }
    case 'coachai':
      return { label: 'Ask CoachAI', href: withTeam('/dashboard/chat', ctx), enabled: !!ctx.teamId }
    case 'game-day':
      return { label: 'Open Game Day', href: withTeam('/dashboard/game', ctx), enabled: !!ctx.teamId }
    case 'notes':
      return { label: 'Open Notes', href: withTeam('/dashboard/notes', ctx), enabled: !!ctx.teamId }
    case 'getting-started':
      return { label: 'Open Roster', href: withTeam('/dashboard/roster', ctx), enabled: !!ctx.teamId }
    // Playbooks deliberately has no action. It is not in the sidebar, and
    // offering a link to a feature the product has stopped surfacing would be
    // making a product decision inside a help article.
    default:
      return null
  }
}

/** A stable, shareable link to one article. */
export function articleHref(guideId: string, ctx: HelpRouteContext): string {
  return withTeam('/dashboard/help', ctx, { article: guideId })
}
