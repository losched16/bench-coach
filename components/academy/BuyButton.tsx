'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2, Lock } from 'lucide-react'
import { track } from './Track'

// Starts the one-time course checkout. Signed out → sign up first, then come
// straight back here with ?buy=1 and continue to Stripe automatically.
export default function BuyButton({ slug, label, price, onSale, signedIn, autoStart = false, className = '' }: {
  slug: string; label: string; price: string | null; onSale: boolean; signedIn: boolean; autoStart?: boolean; className?: string
}) {
  const router = useRouter()
  const params = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const auto = useRef(false)

  const buy = async () => {
    if (!onSale) return
    if (!signedIn) {
      const back = `/academy/${slug}?buy=1`
      router.push(`/auth/signup?redirect=${encodeURIComponent(back)}`)
      return
    }
    setBusy(true); setError(null)
    track('course_checkout_started', slug)
    try {
      const r = await fetch('/api/academy/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course: slug }) })
      const d = await r.json().catch(() => ({}))
      if (r.status === 401) { router.push(`/auth/login?redirect=${encodeURIComponent(`/academy/${slug}?buy=1`)}`); return }
      if (!r.ok || !d.url) throw new Error(d.error || 'Checkout could not be started.')
      window.location.assign(d.url)
    } catch (e: any) {
      setError(e.message); setBusy(false)
    }
  }

  useEffect(() => {
    // Only ONE button on a page may resume a purchase, or two checkouts start.
    if (autoStart && !auto.current && params.get('buy') === '1' && signedIn && onSale) { auto.current = true; void buy() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, signedIn, onSale, autoStart])

  if (!onSale) {
    return (
      <div className={className}>
        <button disabled className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-slate-300 px-8 py-4 text-lg font-semibold text-slate-600 cursor-not-allowed" data-testid="buy-disabled">
          <Lock size={18} /> Enrollment opens soon
        </button>
      </div>
    )
  }
  return (
    <div className={className}>
      <button onClick={buy} disabled={busy} data-testid="buy"
        className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-lg bg-red-600 px-8 py-4 text-lg font-semibold text-white shadow-lg hover:bg-red-700 disabled:opacity-70">
        {busy && <Loader2 className="animate-spin" size={18} />} {label}{price ? ` — ${price}` : ''}
      </button>
      <p className="mt-2 text-sm text-slate-500">One-time purchase. No subscription, no team needed.</p>
      {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
    </div>
  )
}
