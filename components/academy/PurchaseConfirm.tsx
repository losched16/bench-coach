'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2 } from 'lucide-react'

// Shown after Stripe returns the buyer. Asks the server to verify the session
// WITH STRIPE (the return URL alone grants nothing), then polls until the
// enrollment is active and reloads the page with the course unlocked.
export default function PurchaseConfirm({ slug, sessionId }: { slug: string; sessionId: string | null }) {
  const router = useRouter()
  const [state, setState] = useState<'checking' | 'slow' | 'failed'>('checking')

  useEffect(() => {
    let stop = false
    const run = async () => {
      if (sessionId) {
        await fetch('/api/academy/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) }).catch(() => null)
      }
      for (let i = 0; i < 30 && !stop; i++) {
        const r = await fetch(`/api/academy/enrollment?course=${slug}`, { cache: 'no-store' }).catch(() => null)
        const d = r ? await r.json().catch(() => ({})) : {}
        if (d.status === 'active') { router.replace(`/learn/${slug}?welcome=1`); router.refresh(); return }
        if (i === 6) setState('slow')
        await new Promise(res => setTimeout(res, 2000))
      }
      if (!stop) setState('failed')
    }
    void run()
    return () => { stop = true }
  }, [slug, sessionId, router])

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm" data-testid="purchase-confirm">
      {state === 'failed' ? (
        <>
          <h1 className="text-xl font-bold text-slate-900">We couldn&apos;t confirm your payment yet</h1>
          <p className="mt-2 text-slate-600">If you were charged, your course will unlock as soon as the payment clears. Refresh this page in a minute, or contact BenchCoach support with your receipt.</p>
        </>
      ) : (
        <>
          {state === 'checking' ? <Loader2 className="mx-auto animate-spin text-red-600" size={32} /> : <CheckCircle2 className="mx-auto text-emerald-600" size={32} />}
          <h1 className="mt-4 text-xl font-bold text-slate-900">Confirming your purchase…</h1>
          <p className="mt-2 text-slate-600">{state === 'slow' ? 'Still waiting on the payment provider. This usually takes a few seconds.' : 'One moment while we unlock your course.'}</p>
        </>
      )}
    </div>
  )
}
