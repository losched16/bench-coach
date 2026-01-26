import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
})

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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
          // Update coach subscription status
          await supabaseAdmin
            .from('coaches')
            .update({
              is_subscribed: true,
              subscription_tier: 'pro',
              stripe_customer_id: customerId,
            })
            .eq('user_id', userId)

          console.log(`✅ User ${userId} subscribed successfully`)
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
          
          await supabaseAdmin
            .from('coaches')
            .update({
              is_subscribed: isActive,
              subscription_tier: isActive ? 'pro' : 'free',
            })
            .eq('stripe_customer_id', customerId)

          console.log(`✅ Subscription updated for customer ${customerId}: ${subscription.status}`)
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
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = invoice.customer as string

        console.log(`⚠️ Payment failed for customer ${customerId}`)
        // Could send email notification here
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
