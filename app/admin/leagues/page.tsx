'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createSupabaseComponentClient } from '@/lib/supabase'
import {
  Loader2, Shield, Plus, Building2, ArrowRight, ArrowLeft,
  CheckCircle, AlertTriangle, Copy, Check, ExternalLink,
} from 'lucide-react'

// Provisioning a league. BenchCoach staff only.
//
// WHY THIS IS NOT IN /league-admin
//
// A commissioner administers the league they were given. Creating leagues and
// issuing licences is selling, and letting a commissioner do it would let any
// customer mint themselves unlimited licensed leagues. Different job, different
// surface, different authorization: /league-admin checks league membership,
// this checks ADMIN_EMAIL.
//
// WHAT IT IS FOR
//
// /api/admin/leagues has existed and worked for a while, and there was no way
// to call it without curl. That is the whole gap this closes — a league, a
// licence and a first administrator have to agree with each other, and typing
// three INSERTs into the SQL editor is how they end up not agreeing.
//
// The auth check below is a CONVENIENCE, not the control. It hides the form
// from someone who should not see it; the API re-checks every request against
// ADMIN_EMAIL server-side, and that is what actually stops anyone. A client
// check never stops anything — it just avoids showing a form that would 404.

const ADMIN_EMAIL = process.env.NEXT_PUBLIC_ADMIN_EMAIL || 'clint@mybenchcoach.com'

interface LeagueRow {
  id: string
  name: string
  slug: string
  status: string
  city: string | null
  state: string | null
  created_at: string
  licenses: Array<{ status: string; plan: string | null; coach_limit: number | null }>
}

interface Provisioned {
  league: { id: string; name: string; slug: string; status: string }
  owner: { userId: string; email: string; role: string } | null
  license: { id: string; status: string; plan: string | null; coach_limit: number | null } | null
  atomic?: boolean
}

function slugify(name: string): string {
  return name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export default function AdminLeaguesPage() {
  const supabase = createSupabaseComponentClient()

  const [checking, setChecking] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null)

  const [leagues, setLeagues] = useState<LeagueRow[]>([])
  const [loadingLeagues, setLoadingLeagues] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [name, setName] = useState('')
  // Tracked separately so typing a slug stops it following the name, but an
  // untouched slug keeps updating. Editing the name after hand-writing a slug
  // and silently losing the slug is a small betrayal that is easy to avoid.
  const [slugTouched, setSlugTouched] = useState(false)
  const [slug, setSlug] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [governingBody, setGoverningBody] = useState('')
  const [website, setWebsite] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [status, setStatus] = useState<'pilot' | 'active' | 'inactive'>('pilot')

  const [ownerEmail, setOwnerEmail] = useState('')

  const [licenseStatus, setLicenseStatus] = useState<'trial' | 'active'>('trial')
  const [plan, setPlan] = useState('')
  const [coachLimit, setCoachLimit] = useState('20')
  const [endsAt, setEndsAt] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<Provisioned | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (cancelled) return
      setSignedInEmail(user?.email ?? null)
      setAuthorized(!!user?.email && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase())
      setChecking(false)
    })()
    return () => { cancelled = true }
  }, [supabase])

  const loadLeagues = useCallback(async () => {
    setLoadingLeagues(true)
    setListError(null)
    try {
      const res = await fetch('/api/admin/leagues')
      if (!res.ok) {
        // 404 here is requireAdmin() refusing — almost always ADMIN_EMAIL
        // unset or set to a different address than the one signed in.
        setListError(
          res.status === 404
            ? 'The server refused this request. ADMIN_EMAIL is probably unset in this deployment, or set to a different address than the one you are signed in with.'
            : 'Could not load leagues.'
        )
        return
      }
      const json = await res.json()
      setLeagues(json.leagues || [])
    } catch {
      setListError('Could not reach the server.')
    } finally {
      setLoadingLeagues(false)
    }
  }, [])

  useEffect(() => { if (authorized) loadLeagues() }, [authorized, loadLeagues])

  const effectiveSlug = slugTouched ? slug : slugify(name)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const limit = coachLimit.trim() === '' ? null : Number(coachLimit)
      const res = await fetch('/api/admin/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          slug: effectiveSlug,
          city: city.trim() || null,
          state: state.trim() || null,
          governingBody: governingBody.trim() || null,
          website: website.trim() || null,
          logoUrl: logoUrl.trim() || null,
          status,
          ownerEmail: ownerEmail.trim(),
          license: {
            status: licenseStatus,
            plan: plan.trim() || null,
            coachLimit: Number.isFinite(limit as number) ? limit : null,
            endsAt: endsAt || null,
          },
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(json.error || (res.status === 404
          ? 'Not found — ADMIN_EMAIL may be unset in this deployment.'
          : 'Could not create that league.'))
        return
      }
      setResult(json)
      loadLeagues()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    setResult(null)
    setName(''); setSlug(''); setSlugTouched(false)
    setCity(''); setState(''); setGoverningBody(''); setWebsite(''); setLogoUrl('')
    setStatus('pilot'); setOwnerEmail('')
    setLicenseStatus('trial'); setPlan(''); setCoachLimit('20'); setEndsAt('')
    setError(null)
  }

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <Loader2 className="animate-spin text-red-500" size={32} />
      </div>
    )
  }

  if (!authorized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-950">
        <div className="text-center px-6">
          <Shield size={48} className="mx-auto mb-4 text-red-500" />
          <h1 className="text-xl font-bold text-white">Access Denied</h1>
          <p className="text-slate-400 mt-2">Admin access only.</p>
          {signedInEmail && (
            <p className="text-slate-600 text-xs mt-3">Signed in as {signedInEmail}</p>
          )}
        </div>
      </div>
    )
  }

  const input = 'w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-slate-600'
  const label = 'block text-xs font-medium text-slate-400 mb-1.5'

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <div className="border-b border-slate-800 px-4 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
              <Building2 size={18} />
            </div>
            <div>
              <h1 className="text-lg font-bold">Leagues</h1>
              <p className="text-xs text-slate-500">Provision a league, its licence and its first administrator</p>
            </div>
          </div>
          <Link href="/admin" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors">
            <ArrowLeft size={14} /> Admin
          </Link>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* ---------------------------------------------------------------- */}
        {/* Success. Deliberately the whole screen: after provisioning, the   */}
        {/* only thing anyone wants is the way into the dashboard.           */}
        {/* ---------------------------------------------------------------- */}
        {result && (
          <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-5">
            <div className="flex items-start gap-3">
              <CheckCircle className="text-emerald-400 shrink-0 mt-0.5" size={20} />
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-emerald-100">{result.league.name} is ready</h2>
                <p className="text-sm text-emerald-300/80 mt-0.5">
                  League, licence and owner were created
                  {result.atomic === false && ' (sequentially — see note below)'}.
                </p>

                <dl className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div className="flex justify-between gap-3 border-b border-emerald-900/40 pb-1.5">
                    <dt className="text-emerald-400/70">League ID</dt>
                    <dd className="font-mono text-xs text-emerald-100 truncate" title={result.league.id}>{result.league.id}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-emerald-900/40 pb-1.5">
                    <dt className="text-emerald-400/70">Slug</dt>
                    <dd className="font-mono text-xs text-emerald-100">{result.league.slug}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-emerald-900/40 pb-1.5">
                    <dt className="text-emerald-400/70">Owner</dt>
                    <dd className="text-emerald-100 truncate">{result.owner?.email ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-emerald-900/40 pb-1.5">
                    <dt className="text-emerald-400/70">Owner role</dt>
                    <dd className="text-emerald-100">{result.owner?.role ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-emerald-900/40 pb-1.5">
                    <dt className="text-emerald-400/70">Licence</dt>
                    <dd className="text-emerald-100">{result.license?.status ?? '—'}{result.license?.plan ? ` · ${result.license.plan}` : ''}</dd>
                  </div>
                  <div className="flex justify-between gap-3 border-b border-emerald-900/40 pb-1.5">
                    <dt className="text-emerald-400/70">Coach limit</dt>
                    <dd className="text-emerald-100">{result.license?.coach_limit ?? 'unlimited'}</dd>
                  </div>
                </dl>

                {result.owner?.email && signedInEmail &&
                 result.owner.email.toLowerCase() !== signedInEmail.toLowerCase() && (
                  <p className="mt-4 text-xs text-amber-300/90 flex items-start gap-1.5">
                    <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                    The owner is {result.owner.email}, not you. /league-admin will show
                    nothing for your account — sign in as the owner to see the dashboard.
                  </p>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <Link
                    href="/league-admin"
                    className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-4 py-2.5 rounded-lg transition-colors"
                  >
                    Open Commissioner Dashboard <ArrowRight size={15} />
                  </Link>
                  <button
                    onClick={() => {
                      navigator.clipboard?.writeText(result.league.id)
                      setCopied(true); setTimeout(() => setCopied(false), 1600)
                    }}
                    className="inline-flex items-center gap-1.5 text-sm text-emerald-300 hover:text-emerald-100 px-3 py-2.5"
                  >
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? 'Copied' : 'Copy league ID'}
                  </button>
                  <button onClick={reset} className="text-sm text-slate-400 hover:text-white px-3 py-2.5">
                    Create another
                  </button>
                </div>

                {result.atomic === false && (
                  <p className="mt-4 text-xs text-slate-400">
                    Created without <code className="text-slate-300">bc_provision_league</code>. Apply{' '}
                    <code className="text-slate-300">migrations/051_provision_league_atomically.sql</code>{' '}
                    to make provisioning a single transaction.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {!result && (
          <form onSubmit={submit} className="space-y-6">
            <section className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-4">League</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2">
                  <label className={label}>Name</label>
                  <input
                    className={input} value={name} required
                    onChange={e => setName(e.target.value)}
                    placeholder="BenchCoach Test League"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={label}>
                    Slug <span className="text-slate-600">· used in URLs, must be unique</span>
                  </label>
                  <input
                    className={`${input} font-mono`} value={effectiveSlug}
                    onChange={e => { setSlugTouched(true); setSlug(slugify(e.target.value)) }}
                    placeholder="benchcoach-test-league"
                  />
                </div>
                <div>
                  <label className={label}>City</label>
                  <input className={input} value={city} onChange={e => setCity(e.target.value)} />
                </div>
                <div>
                  <label className={label}>State</label>
                  <input className={input} value={state} onChange={e => setState(e.target.value)} />
                </div>
                <div>
                  <label className={label}>Governing body</label>
                  <input
                    className={input} value={governingBody}
                    onChange={e => setGoverningBody(e.target.value)}
                    placeholder="Little League, Cal Ripken, PONY…"
                  />
                </div>
                <div>
                  <label className={label}>Status</label>
                  <select className={input} value={status} onChange={e => setStatus(e.target.value as any)}>
                    <option value="pilot">Pilot</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className={label}>Website</label>
                  <input className={input} value={website} onChange={e => setWebsite(e.target.value)} placeholder="https://" />
                </div>
                <div>
                  <label className={label}>Logo URL</label>
                  <input className={input} value={logoUrl} onChange={e => setLogoUrl(e.target.value)} placeholder="https://" />
                </div>
              </div>
            </section>

            <section className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-1">First administrator</h2>
              <p className="text-xs text-slate-500 mb-4">
                Must already have a BenchCoach account. They become the league <strong className="text-slate-400">owner</strong> and
                are the only person who can open the commissioner dashboard until they add others.
              </p>
              <label className={label}>Owner email</label>
              <input
                className={input} type="email" value={ownerEmail} required
                onChange={e => setOwnerEmail(e.target.value)}
                placeholder="you@example.com"
              />
              {signedInEmail && ownerEmail.trim() === '' && (
                <button
                  type="button"
                  onClick={() => setOwnerEmail(signedInEmail)}
                  className="mt-2 text-xs text-slate-400 hover:text-white underline underline-offset-2"
                >
                  Use my account ({signedInEmail})
                </button>
              )}
            </section>

            <section className="bg-slate-900/40 border border-slate-800 rounded-xl p-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-1">Licence</h2>
              <p className="text-xs text-slate-500 mb-4">
                Without an active or trial licence, coaches cannot accept their invitations.
                Trial grants access exactly like active.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={label}>Status</label>
                  <select className={input} value={licenseStatus} onChange={e => setLicenseStatus(e.target.value as any)}>
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                  </select>
                </div>
                <div>
                  <label className={label}>
                    Coach limit <span className="text-slate-600">· blank = unlimited</span>
                  </label>
                  <input
                    className={input} type="number" min="0" value={coachLimit}
                    onChange={e => setCoachLimit(e.target.value)}
                  />
                </div>
                <div>
                  <label className={label}>Plan <span className="text-slate-600">· optional label</span></label>
                  <input className={input} value={plan} onChange={e => setPlan(e.target.value)} placeholder="pilot" />
                </div>
                <div>
                  <label className={label}>Ends <span className="text-slate-600">· blank = no end date</span></label>
                  <input className={input} type="date" value={endsAt} onChange={e => setEndsAt(e.target.value)} />
                </div>
              </div>
              <p className="text-xs text-slate-600 mt-3">Starts now.</p>
            </section>

            {error && (
              <div className="bg-red-950/40 border border-red-900/60 rounded-lg px-4 py-3 flex items-start gap-2">
                <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-sm text-red-200">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !name.trim() || !ownerEmail.trim()}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-500 disabled:bg-slate-800 disabled:text-slate-600 text-white font-medium px-5 py-3 rounded-lg transition-colors"
            >
              {submitting ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />}
              {submitting ? 'Creating…' : 'Create league'}
            </button>
          </form>
        )}

        {/* ---------------------------------------------------------------- */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
            Existing leagues{leagues.length > 0 && ` (${leagues.length})`}
          </h2>
          {listError && (
            <div className="bg-amber-950/30 border border-amber-900/50 rounded-lg px-4 py-3 flex items-start gap-2">
              <AlertTriangle size={15} className="text-amber-400 shrink-0 mt-0.5" />
              <p className="text-sm text-amber-200">{listError}</p>
            </div>
          )}
          {!listError && loadingLeagues && (
            <div className="text-slate-600 text-sm flex items-center gap-2">
              <Loader2 className="animate-spin" size={14} /> Loading…
            </div>
          )}
          {!listError && !loadingLeagues && leagues.length === 0 && (
            <p className="text-sm text-slate-600">No leagues yet.</p>
          )}
          {!listError && leagues.length > 0 && (
            <div className="border border-slate-800 rounded-xl overflow-hidden divide-y divide-slate-800">
              {leagues.map(l => {
                const lic = l.licenses?.[0]
                return (
                  <div key={l.id} className="flex items-center justify-between gap-4 px-4 py-3 bg-slate-900/30">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{l.name}</p>
                      <p className="text-xs text-slate-500 font-mono truncate">
                        {l.slug}
                        {(l.city || l.state) && <span className="font-sans"> · {[l.city, l.state].filter(Boolean).join(', ')}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 text-xs">
                      <span className="text-slate-500">{l.status}</span>
                      <span className={lic && ['trial', 'active'].includes(lic.status) ? 'text-emerald-400' : 'text-amber-400'}>
                        {lic ? `${lic.status}${lic.coach_limit != null ? ` · ${lic.coach_limit} seats` : ' · unlimited'}` : 'no licence'}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="mt-4 text-xs text-slate-600 flex items-center gap-1.5">
            <ExternalLink size={12} />
            Commissioners administer their own league at <code className="text-slate-500">/league-admin</code>.
            Creating leagues stays here.
          </p>
        </section>
      </div>
    </div>
  )
}
