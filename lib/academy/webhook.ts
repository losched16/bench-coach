// BenchCoach Academy — the Academy's share of the Stripe webhook.
//
// app/api/stripe/webhook verifies the signature and then asks this first.
// Anything this handles never reaches the subscription code below it, which
// is what stops a course purchase from switching on `coaches.is_subscribed`.
//
// Replays: an event id already recorded is acknowledged and skipped. A
// transient failure (database down) throws, so the route answers 500 and
// Stripe retries; a permanent rejection (wrong price) is recorded and
// acknowledged so it is not retried forever.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'
import { eventSeen, fulfillCheckoutSession, handleRefund, isAcademySession, recordEvent } from './fulfillment'

export interface AcademyWebhookResult {
  handled: boolean
  outcome?: string
  replay?: boolean
}

type StripeLike = Parameters<typeof fulfillCheckoutSession>[1]

export async function handleAcademyEvent(db: SupabaseClient<any>, stripe: StripeLike, event: Stripe.Event): Promise<AcademyWebhookResult> {
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
    case 'checkout.session.async_payment_failed': {
      const session = event.data.object as Stripe.Checkout.Session
      if (!isAcademySession(session)) return { handled: false }
      if (await eventSeen(db, event.id)) return { handled: true, replay: true, outcome: 'replay' }
      if (event.type === 'checkout.session.async_payment_failed') {
        await recordEvent(db, event, 'payment_failed')
        return { handled: true, outcome: 'payment_failed' }
      }
      const r = await fulfillCheckoutSession(db, stripe, session)
      await recordEvent(db, event, r.detail ? `${r.outcome}: ${r.detail}` : r.outcome)
      return { handled: true, outcome: r.outcome }
    }
    case 'charge.refunded': {
      if (await eventSeen(db, event.id)) return { handled: true, replay: true, outcome: 'replay' }
      const r = await handleRefund(db, event.data.object as Stripe.Charge)
      if (r.outcome === 'not_academy') return { handled: false }
      await recordEvent(db, event, r.detail ? `${r.outcome}: ${r.detail}` : r.outcome)
      return { handled: true, outcome: r.outcome }
    }
    default:
      return { handled: false }
  }
}
