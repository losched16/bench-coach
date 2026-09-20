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

/**
 * A team or player id from the address bar is UNTRUSTED. It decides nothing
 * about access — the roster page and every API route re-check that against the
 * signed-in coach — but it does get written back into hrefs, and an id
 * containing `/`, `?` or `#` would build a link to somewhere other than the
 * page it looks like. Ids in this product are uuids; anything outside this
 * character set is dropped rather than escaped, because there is no legitimate
 * value it could be.
 */
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
export function safeId(v: string | null | undefined): string | null {
  return v && SAFE_ID.test(v) ? v : null
}

function withContext(
  path: string, ctx: HelpRouteContext, extra?: Record<string, string>
): string {
  const params = new URLSearchParams()
  const team = safeId(ctx.teamId)
  const player = safeId(ctx.playerId)
  if (team) params.set('teamId', team)
  // The player rides along so a coach who opened help from Charlie's page is
  // still on Charlie's page after reading three related articles. It is a
  // breadcrumb, never a grant.
  if (player) params.set('playerId', player)
  for (const [k, v] of Object.entries(extra || {})) params.set(k, v)
  const qs = params.toString()
  return qs ? `${path}?${qs}` : path
}

/** A destination that is about the team, not about one player. */
function withTeam(path: string, ctx: HelpRouteContext, extra?: Record<string, string>): string {
  return withContext(path, { teamId: ctx.teamId }, extra)
}

/**
 * The primary action for a guide: the thing that starts the actual workflow.
 *
 * Returns null where a guide has no single obvious action — an overview of
 * note-taking should not pretend there is one button that does it.
 */
function playerAction(ctx: HelpRouteContext): HelpAction {
  const player = safeId(ctx.playerId)
  return player
    ? {
        label: 'Open this player',
        href: withContext(`/dashboard/roster/${player}`, { teamId: ctx.teamId }),
        enabled: !!safeId(ctx.teamId),
      }
    : {
        label: 'Choose a player',
        href: withTeam('/dashboard/roster', ctx),
        enabled: !!safeId(ctx.teamId),
      }
}

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
    case 'player-reports':
      // A player page when we know the player, the roster otherwise — sending
      // somebody to a player id that is not theirs is worse than one more tap.
      // The page itself decides whether this coach may see that player; this
      // only decides which of two links to draw.
      return playerAction(ctx)
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

/**
 * A stable, shareable link to one article.
 *
 * Carries the player as well as the team. A coach reading about development
 * plans from Charlie's profile, following "Related" to player reports and then
 * pressing the action, lands back on Charlie — not on the roster with Charlie
 * to find again. The id in the link grants nothing; the player page checks the
 * signed-in coach against the team exactly as it does for a typed URL.
 */
export function articleHref(guideId: string, ctx: HelpRouteContext): string {
  return withContext('/dashboard/help', ctx, { article: guideId })
}
