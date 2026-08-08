import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'
import { priceIdFor, isTier } from '@/lib/tiers'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2025-12-15.clover',
})

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  try {
    const { userId, returnUrl, tier } = await request.json()
    const requestedTier = isTier(tier) ? tier : null

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // Get user email
    const { data: userData } = await supabaseAdmin.auth.admin.getUserById(userId)
    const email = userData?.user?.email

    // Check if user already has a Stripe customer ID
    const { data: coach } = await supabaseAdmin
      .from('coaches')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single()

    let customerId = coach?.stripe_customer_id

    // Create Stripe customer if doesn't exist
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: email,
        metadata: {
          user_id: userId,
        },
      })
      customerId = customer.id

      // Save customer ID to coaches table
      await supabaseAdmin
        .from('coaches')
        .update({ stripe_customer_id: customerId })
        .eq('user_id', userId)
    }

    // Create checkout session
    // Which plan they picked. Falls back to the single price the app shipped
    // with, so an older client that posts no tier still checks out.
    const price = (requestedTier && priceIdFor(requestedTier)) || process.env.STRIPE_PRICE_ID
    if (!price) {
      return NextResponse.json(
        { error: 'That plan is not set up for checkout yet.' },
        { status: 400 }
      )
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
      },
      success_url: `${returnUrl || process.env.NEXT_PUBLIC_APP_URL}/subscribe?upgrade=success`,
      cancel_url: `${returnUrl || process.env.NEXT_PUBLIC_APP_URL}/subscribe?upgrade=cancelled`,
      metadata: {
        user_id: userId,
        // Belt and braces: the webhook resolves the tier from the price on the
        // subscription, but if a price ever goes missing from the environment
        // this is the record of what they actually bought.
        tier: requestedTier || '',
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('Stripe checkout error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
