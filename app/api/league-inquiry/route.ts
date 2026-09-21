import { NextRequest, NextResponse } from 'next/server'
import { upsertContact, addNoteToContact } from '@/lib/gohighlevel'

// A league asking about access. PUBLIC and unauthenticated by design: the
// person filling this in does not have an account, which is the entire point.
//
// WHERE A SUBMISSION ACTUALLY GOES, in order of reliability:
//
//   1. A structured line in the server log. This ALWAYS happens, before
//      anything else is attempted, and it is what makes the form honest — a
//      submission cannot be silently lost because a third party was down.
//      Retrievable from the Vercel runtime logs.
//   2. A GoHighLevel contact tagged `league-inquiry`, through the same
//      upsertContact() that trackSignup and the Stripe webhook already use.
//   3. The details as a note on that contact, so the league name, size and
//      message are readable in the CRM rather than only in a log.
//
// Steps 2 and 3 are wrapped so that neither can fail the request. If the CRM
// is misconfigured or down, the inquiry is still captured at step 1 and the
// coach still gets a confirmation — because they did everything right, and
// telling them it failed when we have their details would be a lie in the
// other direction.
//
// The response reports whether the CRM leg succeeded so the operator can tell
// the difference; the visitor is never shown it.

export const dynamic = 'force-dynamic'

/** Length caps, because this is an unauthenticated write. */
const LIMITS = { name: 120, email: 254, phone: 40, league: 160, size: 40, message: 2000 }

function clean(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

// Deliberately permissive. Rejecting a real address is worse than accepting a
// fake one — a fake one wastes a row, a rejected one loses a customer.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Could not read that request.' }, { status: 400 })
  }

  const name = clean(body.name, LIMITS.name)
  const email = clean(body.email, LIMITS.email)
  const phone = clean(body.phone, LIMITS.phone)
  const league = clean(body.league, LIMITS.league)
  const size = clean(body.size, LIMITS.size)
  const message = clean(body.message, LIMITS.message)

  if (!name || !email || !league) {
    return NextResponse.json(
      { error: 'Please give your name, your email and your league.' }, { status: 400 })
  }
  if (!EMAIL.test(email)) {
    return NextResponse.json({ error: 'That email address does not look right.' }, { status: 400 })
  }

  // STEP 1 — the backstop, first and unconditionally.
  console.log('[league-inquiry]', JSON.stringify({
    at: new Date().toISOString(), name, email, phone, league, size, message,
  }))

  // STEP 2/3 — the CRM. Never allowed to fail the request.
  let crm = false
  try {
    const first = name.split(/\s+/)[0] || name
    const last = name.split(/\s+/).slice(1).join(' ')
    const contact = await upsertContact({
      email, firstName: first, lastName: last, phone: phone || undefined,
      tags: ['league-inquiry'],
    })
    if (contact?.id) {
      crm = true
      // createContact does not send customFields despite declaring them, so
      // the detail goes in a note, which is readable in the CRM either way.
      await addNoteToContact(contact.id, [
        'BenchCoach league inquiry',
        `League: ${league}`,
        size ? `Size: ${size}` : null,
        phone ? `Phone: ${phone}` : null,
        message ? `\n${message}` : null,
      ].filter(Boolean).join('\n'))
    }
  } catch (error) {
    console.error('[league-inquiry] CRM sync threw; the inquiry is in the log above', error)
  }

  // upsertContact swallows its own failures and returns null, so a miss is
  // silent unless it is said out loud here. Without this line the only symptom
  // of a misconfigured CRM would be inquiries that never appear in it.
  if (!crm) {
    console.warn('[league-inquiry] NOT synced to the CRM — recover this one from the log line above')
  }

  return NextResponse.json({ ok: true, crm })
}
