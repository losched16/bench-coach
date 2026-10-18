// BenchCoach Academy — turning a verified Stripe payment into course access.
//
// The only two ways an enrollment is ever created from a purchase:
//   1. the Stripe webhook (signature-verified by the caller), or
//   2. /api/academy/confirm, which RETRIEVES the session from Stripe with our
//      secret key — the browser's return URL is only a hint to go and ask.
// Both call fulfillCheckoutSession, which re-checks everything itself:
//   * it is an Academy one-time payment (metadata.kind, mode = 'payment');
//   * Stripe says it is paid;
//   * the buyer is the signed-in user the session was created for
//     (client_reference_id, set server-side) and still exists;
//   * the line item is the course's own Stripe price, in its currency.
// Writes are idempotent: one checkout session can enroll once (unique key),
// and a user holds at most one enrollment per course.
//
// Nothing here reads or writes `coaches`. A course is not a subscription.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

export const ACADEMY_KIND = 'academy_course'

export type FulfillOutcome =
  | 'enrolled'
  | 'reactivated'
  | 'already_enrolled'
  | 'duplicate_purchase'
  | 'not_academy'
  | 'not_paid'
  | 'rejected'
  | 'revoked'

export interface FulfillResult {
  outcome: FulfillOutcome
  detail?: string
  userId?: string
  courseId?: string
}

type StripeLike = {
  checkout: { sessions: { listLineItems: Stripe['checkout']['sessions']['listLineItems'] } }
}

export function isAcademySession(s: Pick<Stripe.Checkout.Session, 'metadata' | 'mode'>): boolean {
  return s.metadata?.kind === ACADEMY_KIND
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function fulfillCheckoutSession(
  db: SupabaseClient<any>,
  stripe: StripeLike,
  session: Stripe.Checkout.Session,
): Promise<FulfillResult> {
  if (!isAcademySession(session)) return { outcome: 'not_academy' }
  if (session.mode !== 'payment') return { outcome: 'rejected', detail: 'academy session is not a one-time payment' }
  if (session.payment_status !== 'paid') return { outcome: 'not_paid', detail: `payment_status=${session.payment_status}` }

  const userId = session.client_reference_id || ''
  const courseId = session.metadata?.course_id || ''
  if (!UUID.test(userId) || userId !== session.metadata?.user_id) return { outcome: 'rejected', detail: 'buyer identity missing or inconsistent' }
  if (!UUID.test(courseId)) return { outcome: 'rejected', detail: 'course missing' }

  const { data: course, error: courseErr } = await db
    .from('academy_courses').select('id, slug, stripe_price_id, currency').eq('id', courseId).maybeSingle()
  if (courseErr) throw new Error(`course lookup failed: ${courseErr.message}`)
  if (!course) return { outcome: 'rejected', detail: 'course not found', userId, courseId }

  // The price actually charged must be this course's price.
  const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 5 })
  const prices = items.data.map(i => i.price?.id)
  if (!course.stripe_price_id || prices.length !== 1 || prices[0] !== course.stripe_price_id) {
    return { outcome: 'rejected', detail: 'line item does not match the course price', userId, courseId }
  }
  if ((session.currency || '').toLowerCase() !== String(course.currency || 'usd').toLowerCase()) {
    return { outcome: 'rejected', detail: 'currency mismatch', userId, courseId }
  }

  const { data: user, error: userErr } = await db.auth.admin.getUserById(userId)
  if (userErr || !user?.user) return { outcome: 'rejected', detail: 'buyer account not found', userId, courseId }

  const paymentIntent = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null
  const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id || null
  const purchase = {
    status: 'active',
    source: 'purchase',
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntent,
    stripe_customer_id: customer,
    amount_total: session.amount_total ?? null,
    currency: session.currency ?? null,
    revoked_at: null,
    revoke_reason: null,
  }

  const { data: existing, error: exErr } = await db
    .from('academy_enrollments').select('id, status, stripe_checkout_session_id')
    .eq('user_id', userId).eq('course_id', courseId).maybeSingle()
  if (exErr) throw new Error(`enrollment lookup failed: ${exErr.message}`)

  if (existing) {
    if (existing.stripe_checkout_session_id === session.id) return { outcome: 'already_enrolled', userId, courseId }
    if (existing.status === 'active') {
      // Paid twice for something they already own. Access is unchanged; the
      // second payment needs a human decision (refund) — see DECISIONS.md.
      return { outcome: 'duplicate_purchase', detail: `already active via ${existing.stripe_checkout_session_id || 'grant'}`, userId, courseId }
    }
    const { error } = await db.from('academy_enrollments').update(purchase).eq('id', existing.id)
    if (error) throw new Error(`reactivate failed: ${error.message}`)
    return { outcome: 'reactivated', userId, courseId }
  }

  const { error: insErr } = await db.from('academy_enrollments').insert({ user_id: userId, course_id: courseId, ...purchase })
  if (insErr) {
    // A concurrent delivery of the same session won the race: that is success.
    if (/duplicate key|unique/i.test(insErr.message)) return { outcome: 'already_enrolled', userId, courseId }
    throw new Error(`enroll failed: ${insErr.message}`)
  }
  return { outcome: 'enrolled', userId, courseId }
}

/** A full refund ends access. A partial refund changes nothing (see DECISIONS.md). */
export async function handleRefund(db: SupabaseClient<any>, charge: Stripe.Charge): Promise<FulfillResult> {
  const pi = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id
  if (!pi) return { outcome: 'not_academy' }
  const { data: row, error } = await db
    .from('academy_enrollments').select('id, status, user_id, course_id').eq('stripe_payment_intent_id', pi).maybeSingle()
  if (error) throw new Error(`refund lookup failed: ${error.message}`)
  if (!row) return { outcome: 'not_academy' }
  if (!charge.refunded) return { outcome: 'rejected', detail: 'partial refund — access unchanged', userId: row.user_id, courseId: row.course_id }
  if (row.status !== 'active') return { outcome: 'revoked', detail: `already ${row.status}`, userId: row.user_id, courseId: row.course_id }
  const { error: upErr } = await db.from('academy_enrollments')
    .update({ status: 'refunded', revoked_at: new Date().toISOString(), revoke_reason: 'stripe_full_refund' }).eq('id', row.id)
  if (upErr) throw new Error(`refund update failed: ${upErr.message}`)
  return { outcome: 'revoked', detail: 'access ended by full refund', userId: row.user_id, courseId: row.course_id }
}

/** Has this Stripe event already been acted on? */
export async function eventSeen(db: SupabaseClient<any>, eventId: string): Promise<boolean> {
  const { data } = await db.from('academy_stripe_events').select('event_id').eq('event_id', eventId).maybeSingle()
  return !!data
}

export async function recordEvent(db: SupabaseClient<any>, event: Pick<Stripe.Event, 'id' | 'type'>, outcome: string): Promise<void> {
  const { error } = await db.from('academy_stripe_events').insert({ event_id: event.id, event_type: event.type, outcome: outcome.slice(0, 200) })
  if (error && !/duplicate key|unique/i.test(error.message)) throw new Error(`event record failed: ${error.message}`)
}
