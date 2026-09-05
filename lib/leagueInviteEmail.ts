// The invitation email, and the one place it would be sent from.
//
// THERE IS NO EMAIL VENDOR IN THIS PROJECT. Team invitations have always worked
// by the head coach copying a link and texting it to their assistant — there is
// no Resend, no SendGrid, no SMTP anywhere in the codebase, and GoHighLevel is
// a CRM that records signups rather than a transactional sender.
//
// Adding one for Phase 1 would mean a vendor account, a verified sending
// domain, DKIM and SPF records, a bounce webhook and a deliverability problem
// nobody has time to own before the first league signs. So this module renders
// the message and defines the seam, and deliver() is honest about doing
// nothing: it returns delivered: false, and the admin UI shows the copy-link
// instead. A commissioner emailing forty coaches from their own address is a
// perfectly good Phase 1, and it is what they already do for everything else.
//
// When a sender is wired up, it goes in deliver() and nothing else changes.

export interface LeagueInviteEmailInput {
  to: string
  leagueName: string
  teamName?: string | null
  divisionName?: string | null
  inviteUrl: string
  invitedByName?: string | null
  intendedRole?: string
}

export interface RenderedEmail {
  subject: string
  text: string
}

/**
 * The message. Pure, so the copy can be tested and read without sending
 * anything.
 *
 * What it has to communicate, in this order, because a coach reads two lines
 * before deciding whether this is spam:
 *   1. Their league's name — the only reason they will trust it.
 *   2. That the league is providing it.
 *   3. That they are not being asked to pay.
 *   4. One link.
 */
export function renderLeagueInviteEmail(input: LeagueInviteEmailInput): RenderedEmail {
  const role = input.intendedRole === 'assistant_coach' ? 'assistant coach' : 'head coach'
  const team = input.teamName ? ` as ${role} of ${input.teamName}` : ''
  const from = input.invitedByName ? `${input.invitedByName} at ${input.leagueName}` : input.leagueName

  return {
    subject: `${input.leagueName} has set you up with BenchCoach`,
    text: [
      `${from} has provided you with BenchCoach${team}.`,
      '',
      'BenchCoach helps you plan practices, find the right drills, and get',
      'coaching guidance throughout the season.',
      '',
      `Your league is covering this — there is nothing for you to buy.`,
      '',
      'Accept your invitation:',
      input.inviteUrl,
      '',
      'If you already have a BenchCoach account, sign in with it and the',
      'invitation will attach to it.',
    ].join('\n'),
  }
}

export type DeliveryOutcome =
  | { delivered: true; via: string }
  | { delivered: false; reason: 'no_transport'; message: string }

/**
 * Send it, if there were anything to send it with.
 *
 * The seam. Returns rather than throws, because a commissioner who has just
 * invited thirty coaches must not see a 500 — the invitations were created and
 * their links work, which is the part that matters. The caller surfaces the
 * link and says the email was not sent.
 */
export async function deliverLeagueInvite(
  input: LeagueInviteEmailInput
): Promise<DeliveryOutcome> {
  const rendered = renderLeagueInviteEmail(input)

  // Deliberately not a silent no-op: without this line a future reader would
  // reasonably assume mail was going out.
  console.info(
    `[league-invite] no email transport configured — not sending "${rendered.subject}" to ${input.to}`
  )

  return {
    delivered: false,
    reason: 'no_transport',
    message: 'Email delivery is not set up yet — copy the invitation link and send it yourself.',
  }
}
