// The Stripe client, built when a request needs it rather than when the module
// loads.
//
// WHY THIS EXISTS
//
// The three Stripe routes each did `const stripe = new Stripe(
// process.env.STRIPE_SECRET_KEY!, ...)` at module scope. The `!` is a lie the
// type system accepts and the Stripe constructor does not: with the variable
// unset it throws "Neither apiKey nor config.authenticator provided" — at
// module load, which during `next build` happens while collecting page data.
//
// So the whole build failed, on every page, because one optional integration
// had no key. An environment without Stripe could not be deployed at all,
// which makes a staging environment need a production billing credential to
// exist. That is exactly backwards.
//
// Built lazily, a missing key becomes what it should always have been: the
// three checkout and billing endpoints return a clear 503 when someone calls
// them, and nothing else in the application notices.

import Stripe from 'stripe'

// Pinned deliberately. Stripe changes response shapes between versions, and a
// floating version turns a billing integration into something that breaks on
// their release schedule rather than ours.
const API_VERSION = '2025-12-15.clover'

let client: Stripe | null = null

/**
 * The Stripe client, or null when this environment has no Stripe key.
 *
 * Returns null rather than throwing so a caller can decide what a missing
 * integration means for it — which is always "tell the user this is not
 * available here", never "500".
 */
export function getStripe(): Stripe | null {
  if (client) return client
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return null
  client = new Stripe(key, { apiVersion: API_VERSION })
  return client
}

/** True when this environment can take a payment. */
export function stripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

/**
 * The response for a billing request in an environment with no Stripe.
 *
 * 503 rather than 500: nothing is broken, the capability is absent. And it
 * says which variable, because the person who sees this is almost always the
 * one who can set it.
 */
export function stripeUnavailable(): Response {
  return new Response(
    JSON.stringify({
      error: 'Billing is not configured in this environment.',
      detail: 'STRIPE_SECRET_KEY is not set. League-sponsored coaches are entitled by their league licence and never need this.',
    }),
    { status: 503, headers: { 'Content-Type': 'application/json' } }
  )
}
