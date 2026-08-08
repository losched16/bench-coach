import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { tierForPriceId, isTier, Tier } from '@/lib/tiers'
import {
  trackTrialStarted,
  trackCustomerCreated,
  trackSubscriptionCancelled,
  trackPaymentFailed,
} from '@/lib/gohighlevel'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  // Matched to checkout and portal. The SDK's types are for this version, so
  // declaring an older one meant Stripe sending event shapes the code was
  // typechecked against but not actually receiving.
  apiVersion: '2025-12-15.clover',
})

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Helper to get email from Stripe customer
async function getCustomerEmail(customerId: string): Promise<string | null> {
  try {
    const customer = await stripe.customers.retrieve(customerId)
    if (customer.deleted) return null
    return (customer as Stripe.Customer).email || null
  } catch {
    return null
  }
}

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')!

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (err: any) {
    console.error('Webhook signature verification failed:', err.message)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const userId = session.metadata?.user_id
        const customerId = session.customer as string

        if (userId) {
          // Which plan they actually bought. This used to be hardcoded 'pro',
          // which with two prices would hand coach features to everyone who
          // paid for the parent plan.
          let tier: Tier | null = null
          if (session.subscription) {
            const sub = await stripe.subscriptions.retrieve(session.subscription as string)
            tier = tierForPriceId(sub.items.data[0]?.price?.id)
          }
          // The price is the source of truth; checkout metadata is the fallback
          // for a price that has gone missing from the environment.
          if (!tier && isTier(session.metadata?.tier)) tier = session.metadata!.tier as Tier

          await supabaseAdmin
            .from('coaches')
            .update({
              is_subscribed: true,
              // Never silently grant the bigger plan on an unresolvable price.
              subscription_tier: tier || 'personal',
              stripe_customer_id: customerId,
            })
            .eq('user_id', userId)

          console.log(`✅ User ${userId} subscribed successfully`)

          // Track in GoHighLevel
          const email = session.customer_email || await getCustomerEmail(customerId)
          if (email) {
            // Check if trial or direct purchase
            const subscription = session.subscription
            if (subscription) {
              const sub = await stripe.subscriptions.retrieve(subscription as string)
              if (sub.status === 'trialing') {
                await trackTrialStarted(email)
                console.log(`📧 GHL: Trial started for ${email}`)
              } else {
                await trackCustomerCreated(email)
                console.log(`📧 GHL: Customer created for ${email}`)
              }
            }
          }
        }
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Find coach by Stripe customer ID
        const { data: coach } = await supabaseAdmin
          .from('coaches')
          .select('user_id')
          .eq('stripe_customer_id', customerId)
          .single()

        if (coach) {
          const isActive = ['active', 'trialing'].includes(subscription.status)
          // Read the plan off the subscription every time: this event also
          // fires when someone switches between plans in the billing portal,
          // and that is exactly when the tier must follow.
          const priceTier = tierForPriceId(subscription.items.data[0]?.price?.id)

          const update: Record<string, any> = { is_subscribed: isActive }
          if (!isActive) {
            update.subscription_tier = 'free'
          } else if (priceTier) {
            update.subscription_tier = priceTier
          }
          // An active subscription on an unrecognised price leaves the tier
          // alone rather than guessing — downgrading a paying customer over a
          // missing env var is worse than a stale tier.

          await supabaseAdmin
            .from('coaches')
            .update(update)
            .eq('stripe_customer_id', customerId)

          console.log(`✅ Subscription updated for customer ${customerId}: ${subscription.status}`)

          // Track in GoHighLevel when trial converts to active
          if (subscription.status === 'active' && event.type === 'customer.subscription.updated') {
            const email = await getCustomerEmail(customerId)
            if (email) {
              await trackCustomerCreated(email)
              console.log(`📧 GHL: Subscription active for ${email}`)
            }
          }
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        // Mark as unsubscribed
        await supabaseAdmin
          .from('coaches')
          .update({
            is_subscribed: false,
            subscription_tier: 'free',
          })
          .eq('stripe_customer_id', customerId)

        console.log(`✅ Subscription cancelled for customer ${customerId}`)

        // Track in GoHighLevel
        const email = await getCustomerEmail(customerId)
        if (email) {
          await trackSubscriptionCancelled(email)
          console.log(`📧 GHL: Subscription cancelled for ${email}`)
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        console.log(`⚠️ Payment failed for customer ${customerId}`)

        // Track in GoHighLevel
        const email = await getCustomerEmail(customerId)
        if (email) {
          await trackPaymentFailed(email)
          console.log(`📧 GHL: Payment failed for ${email}`)
        }
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        // If this was a retry after failure, remove the payment_failed tag
        if (invoice.billing_reason === 'subscription_cycle') {
          const email = await getCustomerEmail(customerId)
          if (email) {
            const { trackPaymentRecovered } = await import('@/lib/gohighlevel')
            await trackPaymentRecovered(email)
            console.log(`📧 GHL: Payment recovered for ${email}`)
          }
        }
        break
      }

      default:
        console.log(`Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (error: any) {
    console.error('Webhook handler error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
