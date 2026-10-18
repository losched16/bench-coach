'use client'

// Owner tool: who has an Academy course, and grant / revoke by hand.
// The API (/api/academy/admin/enrollments) checks the signed-in owner on the
// server; this page is only a form over it.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { COURSES } from '@/lib/academy/catalog'

interface Row { id: string; user_id: string; status: string; source: string; enrolled_at: string; revoked_at: string | null; revoke_reason: string | null; amount_total: number | null; currency: string | null; granted_by: string | null }

export default function AcademyAdmin() {
  const [course, setCourse] = useState(COURSES[0]?.slug || '')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const r = await fetch(`/api/academy/admin/enrollments?course=${course}`)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setRows(null); setError(r.status === 404 ? 'Not available (owner only, or the course is not imported yet).' : d.error || 'Could not load.'); return }
    setRows(d.enrollments)
  }, [course])
  useEffect(() => { void load() }, [load])

  const act = async (action: 'grant' | 'revoke') => {
    setMsg(null)
    const r = await fetch('/api/academy/admin/enrollments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ course, email, action, reason }) })
    const d = await r.json().catch(() => ({}))
    setMsg(r.ok ? `${email}: ${d.status}${d.changed ? '' : ' (no change)'}` : d.error || 'Failed.')
    void load()
  }

  const active = rows?.filter(r => r.status === 'active').length ?? 0
  return (
    <div className="mx-auto max-w-5xl p-6 space-y-6">
      <div className="flex items-center gap-4"><Link href="/admin" className="text-sm text-slate-600 hover:underline">← Admin</Link><h1 className="text-2xl font-bold">Academy enrollments</h1></div>
      <label className="block text-sm">Course{' '}
        <select value={course} onChange={e => setCourse(e.target.value)} className="ml-2 rounded border px-2 py-1">
          {COURSES.map(c => <option key={c.slug} value={c.slug}>{c.slug}</option>)}
        </select>
      </label>
      <section className="rounded-xl border bg-white p-4 space-y-3">
        <h2 className="font-semibold">Grant or revoke access</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={email} onChange={e => setEmail(e.target.value)} placeholder="buyer@example.com" type="email" className="flex-1 rounded border px-3 py-2" />
          <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (revoke)" className="flex-1 rounded border px-3 py-2" />
          <button onClick={() => act('grant')} className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white">Grant</button>
          <button onClick={() => act('revoke')} className="rounded bg-red-600 px-4 py-2 font-semibold text-white">Revoke</button>
        </div>
        <p className="text-xs text-slate-500">Purchases come only from Stripe. Granting here is a comp, marked admin_grant. A full refund in Stripe ends access automatically.</p>
        {msg && <p className="text-sm" role="status">{msg}</p>}
      </section>
      {error && <p className="text-red-700">{error}</p>}
      {rows && (
        <section className="rounded-xl border bg-white overflow-x-auto">
          <p className="p-4 text-sm text-slate-600">{rows.length} enrollments · {active} active</p>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left"><tr><th className="p-2">User</th><th className="p-2">Status</th><th className="p-2">Source</th><th className="p-2">Paid</th><th className="p-2">Enrolled</th><th className="p-2">Revoked</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.id} className="border-t"><td className="p-2 font-mono text-xs">{r.user_id.slice(0, 8)}…</td><td className="p-2">{r.status}</td><td className="p-2">{r.source}{r.granted_by ? ` (${r.granted_by})` : ''}</td>
                <td className="p-2">{r.amount_total != null ? `${(r.amount_total / 100).toFixed(2)} ${(r.currency || '').toUpperCase()}` : '—'}</td>
                <td className="p-2">{new Date(r.enrolled_at).toLocaleDateString()}</td><td className="p-2">{r.revoked_at ? `${new Date(r.revoked_at).toLocaleDateString()} ${r.revoke_reason || ''}` : '—'}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  )
}
