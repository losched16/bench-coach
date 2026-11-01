// BenchCoach Academy — chargebacks (Stripe disputes), kept small and auditable.
//
// Principle: a dispute is a claim, not a verdict.
//   dispute created         -> record it; access STAYS ON while the owner investigates
//   dispute closed, lost    -> access ends (revoke_reason 'stripe_dispute_lost')
//   dispute closed, won     -> record it; if access had been ended by a dispute, restore it
//   funds reinstated        -> same as won (the bank returned the money)
//
// Only events whose Stripe signature the webhook route has already verified reach here.
// Everything is idempotent: the caller skips an event id it has seen, and the state rules
// below make a repeat or an out-of-order event harmless:
//   * a dispute that is already won/lost never goes back to open (a late 'created' is ignored);
//   * 'lost' on an already-revoked/refunded enrollment changes nothing;
//   * 'won' restores ONLY an enrollment this module revoked. It never restores one that
//     was refunded, or revoked by the owner by hand.
//
// A dispute on a payment that is not an Academy purchase (a subscription charge, say)
// returns not_academy so the subscription code still sees the event.

import type Stripe from 'stripe'
import type { SupabaseClient } from '@supabase/supabase-js'

export const DISPUTE_REVOKE_REASON = 'stripe_dispute_lost'

export type DisputeOutcome = 'not_academy' | 'recorded_open' | 'ignored_stale' | 'revoked' | 'already_ended' | 'restored' | 'recorded_won' | 'unchanged'

export interface DisputeResult { outcome: DisputeOutcome; detail?: string; enrollmentId?: string; disputeId?: string }

const iso = (sec?: number | null) => (typeof sec === 'number' ? new Date(sec * 1000).toISOString() : null)
const piOf = (d: Stripe.Dispute) => (typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id || null)

export async function handleDispute(db: SupabaseClient<any>, type: string, dispute: Stripe.Dispute): Promise<DisputeResult> {
  const pi = piOf(dispute)
  if (!pi) return { outcome: 'not_academy', detail: 'dispute has no payment intent' }

  const { data: enr, error } = await db.from('academy_enrollments')
    .select('id, status, revoke_reason').eq('stripe_payment_intent_id', pi).maybeSingle()
  if (error) throw new Error(`dispute enrollment lookup failed: ${error.message}`)
  if (!enr) return { outcome: 'not_academy' }

  const { data: prev, error: pErr } = await db.from('academy_disputes').select('dispute_id, status').eq('dispute_id', dispute.id).maybeSingle()
  if (pErr) throw new Error(`dispute lookup failed: ${pErr.message}`)
  const base = { enrollmentId: enr.id as string, disputeId: dispute.id }

  const common = {
    enrollment_id: enr.id, payment_intent: pi, reason: dispute.reason ?? null, amount: dispute.amount ?? null,
    currency: dispute.currency ?? null, due_by: iso(dispute.evidence_details?.due_by), updated_at: new Date().toISOString(),
  }
  const save = async (fields: Record<string, any>) => {
    const { error: e } = prev
      ? await db.from('academy_disputes').update({ ...common, ...fields }).eq('dispute_id', dispute.id)
      : await db.from('academy_disputes').insert({ dispute_id: dispute.id, opened_at: iso(dispute.created) ?? new Date().toISOString(), ...common, ...fields })
    if (e) throw new Error(`dispute write failed: ${e.message}`)
  }

  if (type === 'charge.dispute.created') {
    if (prev && prev.status !== 'open') return { outcome: 'ignored_stale', detail: `already ${prev.status}`, ...base }
    if (prev) return { outcome: 'unchanged', detail: 'already open', ...base }
    await save({ status: 'open', closed_at: null, access_action: 'kept' })
    return { outcome: 'recorded_open', detail: 'access kept while the dispute is investigated', ...base }
  }

  if (type === 'charge.dispute.closed' || type === 'charge.dispute.funds_reinstated') {
    const lost = type === 'charge.dispute.closed' && dispute.status === 'lost'
    const won = type === 'charge.dispute.funds_reinstated' || dispute.status === 'won' || dispute.status === 'warning_closed'
    if (!lost && !won) return { outcome: 'unchanged', detail: `dispute status ${dispute.status} is not final`, ...base }
    const closedAt = new Date().toISOString()

    if (lost) {
      if (prev && prev.status === 'lost') return { outcome: 'unchanged', detail: 'already recorded lost', ...base }
      if (enr.status === 'active') {
        const { error: e } = await db.from('academy_enrollments')
          .update({ status: 'revoked', revoked_at: closedAt, revoke_reason: DISPUTE_REVOKE_REASON }).eq('id', enr.id).eq('status', 'active')
        if (e) throw new Error(`dispute revoke failed: ${e.message}`)
        await save({ status: 'lost', closed_at: closedAt, access_action: 'revoked' })
        return { outcome: 'revoked', detail: 'dispute lost: access ended', ...base }
      }
      await save({ status: 'lost', closed_at: closedAt, access_action: 'none' })
      return { outcome: 'already_ended', detail: `enrollment already ${enr.status}`, ...base }
    }

    // won (or funds reinstated)
    let restored = false
    if (enr.status === 'revoked' && enr.revoke_reason === DISPUTE_REVOKE_REASON) {
      const { error: e } = await db.from('academy_enrollments')
        .update({ status: 'active', revoked_at: null, revoke_reason: null }).eq('id', enr.id).eq('status', 'revoked').eq('revoke_reason', DISPUTE_REVOKE_REASON)
      if (e) throw new Error(`dispute restore failed: ${e.message}`)
      restored = true
    }
    if (prev && prev.status === 'won' && !restored) return { outcome: 'unchanged', detail: 'already recorded won', ...base }
    await save({ status: 'won', closed_at: closedAt, access_action: restored ? 'restored' : 'none' })
    return restored ? { outcome: 'restored', detail: 'dispute resolved in our favor: access restored', ...base } : { outcome: 'recorded_won', detail: 'dispute resolved in our favor; access was not ended by it', ...base }
  }

  return { outcome: 'not_academy' }
}
