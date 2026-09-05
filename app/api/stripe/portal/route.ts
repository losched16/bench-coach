import { NextRequest, NextResponse } from 'next/server'
import { getStripe, stripeUnavailable } from '@/lib/stripe'
import { createClient } from '@supabase/supabase-js'

// Never prerendered. This route reads the session cookie to decide who is
// calling, which is only meaningful per-request — and Next's build-time
// prerender pass hands the handler a stand-in Request whose .url and .method
// throw when touched.
export const dynamic = 'force-dynamic'


const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: NextRequest) {
  const stripe = getStripe()
  if (!stripe) return stripeUnavailable()

  try {
    const { userId } = await request.json()

    if (!userId) {
      return NextResponse.json({ error: 'Missing userId' }, { status: 400 })
    }

    // Get coach's Stripe customer ID
    const { data: coach } = await supabaseAdmin
      .from('coaches')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .single()

    if (!coach?.stripe_customer_id) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
    }

    // Create billing portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: coach.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/profile`,
    })

    return NextResponse.json({ url: session.url })
  } catch (error: any) {
    console.error('Billing portal error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
