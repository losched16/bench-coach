import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { getStripe, stripeUnavailable } from '@/lib/stripe'
import { fulfillCheckoutSession } from '@/lib/academy/fulfillment'
import { adminDb, currentUser } from '@/lib/academy/server'

// After Stripe sends the buyer back. The return URL proves nothing, so this
// ASKS Stripe (with our secret key) about the session, and only for the
// signed-in user it was created for. Usually the webhook has already
// enrolled them and this is a no-op; when the webhook is slow, it means the
// buyer is not left staring at a spinner.
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 })
  const { sessionId } = await request.json().catch(() => ({}))
  if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]{6,200}$/.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid checkout session.' }, { status: 400 })
  }
  const stripe = getStripe()
  if (!stripe) return stripeUnavailable()
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId)
  } catch {
    return NextResponse.json({ error: 'Checkout session not found.' }, { status: 404 })
  }
  // Someone else's session is "not found", not "forbidden": no oracle.
  if (session.client_reference_id !== user.id) return NextResponse.json({ error: 'Checkout session not found.' }, { status: 404 })
  try {
    const r = await fulfillCheckoutSession(adminDb(), stripe, session)
    const ok = ['enrolled', 'reactivated', 'already_enrolled', 'duplicate_purchase'].includes(r.outcome)
    return NextResponse.json({ status: ok ? 'active' : r.outcome === 'not_paid' ? 'pending' : 'failed' }, { status: ok || r.outcome === 'not_paid' ? 200 : 409 })
  } catch (e: any) {
    console.error('Academy confirm error:', e?.message)
    return NextResponse.json({ status: 'pending' }, { status: 503 })
  }
}
