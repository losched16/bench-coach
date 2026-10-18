import { NextRequest, NextResponse } from 'next/server'
import { requireSession } from '@/lib/authz'
import { getStripe, stripeUnavailable } from '@/lib/stripe'
import { ACADEMY_KIND } from '@/lib/academy/fulfillment'
import { appOrigin, courseAccess, currentUser, getCourse } from '@/lib/academy/server'
import { isCourseSlug } from '@/lib/academy/catalog'

// One-time course purchase. NOT the subscription checkout: mode 'payment',
// its own metadata kind, and the buyer is whoever is signed in — never a
// user id from the request body.
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const denied = await requireSession()
  if (denied) return denied
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Sign in to buy this course.' }, { status: 401 })

  const body = await request.json().catch(() => ({}))
  const slug = body?.course
  if (!isCourseSlug(slug)) return NextResponse.json({ error: 'Unknown course.' }, { status: 400 })
  const course = await getCourse(slug)
  if (!course) return NextResponse.json({ error: 'Unknown course.' }, { status: 404 })

  const origin = appOrigin(request.nextUrl.origin)
  if ((await courseAccess(user, course)) === 'enrolled') {
    return NextResponse.json({ alreadyEnrolled: true, url: `${origin}/learn/${course.slug}` })
  }
  if (!course.price_cents || !course.stripe_price_id) {
    return NextResponse.json({ error: 'This course is not on sale yet.' }, { status: 409 })
  }
  const stripe = getStripe()
  if (!stripe) return stripeUnavailable()

  try {
    const meta = { kind: ACADEMY_KIND, course_id: course.id, course_slug: course.slug, user_id: user.id }
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: course.stripe_price_id, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email || undefined,
      metadata: meta,
      payment_intent_data: { metadata: meta },
      success_url: `${origin}/learn/${course.slug}?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/academy/${course.slug}?checkout=cancelled`,
    })
    return NextResponse.json({ url: session.url })
  } catch (e: any) {
    console.error('Academy checkout error:', e?.message)
    return NextResponse.json({ error: 'Checkout could not be started. Please try again.' }, { status: 502 })
  }
}
