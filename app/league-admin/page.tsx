'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Loader2, Plus, Users, UserCheck, Layers, Activity, ClipboardList,
  ArrowLeft, Copy, Check, X, AlertTriangle,
} from 'lucide-react'
import {
  CoachTable, TeamTable, DivisionSummary,
  type CoachRow, type TeamRow, type DivisionRow,
} from '@/components/league/LeagueAdminTables'

// The commissioner's dashboard.
//
// It lives at /league-admin rather than under /dashboard on purpose. The
// dashboard shell is built around a team picker and sends anyone with no teams
// and no subscription to /subscribe — which is correct for coaches and exactly
// wrong for a commissioner, most of whom do not coach and would have been
// bounced to a checkout page for a product their league already bought.
//
// What it shows is adoption, and only adoption: who was invited, who accepted,
// who has actually opened the app, how many practice plans exist. There is no
// route from this screen to a practice plan's contents, a player note, a
// scouting report or an AI conversation — see the overview API, which never
// selects those columns.

interface Overview {
  league: { id: string; name: string; logoUrl: string | null; city: string | null; state: string | null; status: string }
  seasons: Array<{ id: string; name: string; status: string }>
  activeSeason: { id: string; name: string } | null
  license: { licensed: boolean; status: string | null; coachLimit: number | null; seatsUsed: number; endsAt: string | null }
  kpis: {
    coachesInvited: number; coachesActivated: number; teams: number
    activeCoachesLast7Days: number; practicePlansCreated: number
  }
  divisions: DivisionRow[]
  teams: TeamRow[]
  coaches: CoachRow[]
}

type Tab = 'coaches' | 'teams' | 'divisions' | 'admins'
type Dialog = null | 'invite' | 'season' | 'division' | 'team' | 'member'

export default function LeagueAdminPage() {
  // Every hook runs before any early return, without exception. Two useState
  // calls added next to the function that used them — below a `if (loading)
  // return` — is what took the team page down once, and scripts/verify-hooks.mjs
  // exists because of it.
  const [leagues, setLeagues] = useState<Array<{ leagueId: string; name: string; role: string }>>([])
  const [leagueId, setLeagueId] = useState<string | null>(null)
  const [overview, setOverview] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('coaches')
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [members, setMembers] = useState<Array<{ id: string; name: string | null; role: string; isYou: boolean }>>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/league/me')
        const d = await res.json()
        if (cancelled) return
        const admin = Array.isArray(d.admin) ? d.admin : []
        setLeagues(admin)
        if (admin.length > 0) setLeagueId(admin[0].leagueId)
        else setLoading(false)
      } catch {
        if (!cancelled) { setError('We could not load your leagues.'); setLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async (id: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/league-admin/overview?leagueId=${id}`)
      const d = await res.json()
      if (!res.ok) { setError(d.error || 'We could not load this league.'); return }
      setOverview(d)
      setError(null)
      // Who else runs this league. A separate call because it is gated on a
      // stronger capability than the overview and may legitimately be refused
      // for a coaching director who can still see everything else.
      try {
        const mRes = await fetch(`/api/league-admin/members?leagueId=${id}`)
        const mData = await mRes.json()
        if (mRes.ok) setMembers(mData.members || [])
      } catch { /* the tab shows empty; nothing else depends on it */ }
    } catch {
      setError('We could not load this league.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (leagueId) load(leagueId) }, [leagueId, load])

  const refresh = useCallback(() => { if (leagueId) load(leagueId) }, [leagueId, load])

  const handleResend = useCallback(async (id: string) => {
    if (!leagueId) return
    setBusyId(id)
    try {
      const res = await fetch('/api/league-admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, resendId: id }),
      })
      const d = await res.json()
      if (res.ok) { setInviteLink(d.inviteUrl); refresh() }
      else setError(d.error || 'Could not resend that invitation.')
    } finally {
      setBusyId(null)
    }
  }, [leagueId, refresh])

  const handleRevoke = useCallback(async (id: string) => {
    if (!leagueId) return
    setBusyId(id)
    try {
      const res = await fetch(`/api/league-admin/invitations?leagueId=${leagueId}&id=${id}`, { method: 'DELETE' })
      const d = await res.json()
      if (res.ok) refresh()
      else setError(d.error || 'Could not revoke that invitation.')
    } finally {
      setBusyId(null)
    }
  }, [leagueId, refresh])

  const copyLink = useCallback(() => {
    if (!inviteLink) return
    navigator.clipboard?.writeText(inviteLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [inviteLink])

  // ── Render ───────────────────────────────────────────

  if (loading && !overview) {
    return (
      <Shell>
        <div className="py-24 text-center">
          <Loader2 className="animate-spin mx-auto text-gray-400 mb-4" size={40} />
          <p className="text-gray-600">Loading your league…</p>
        </div>
      </Shell>
    )
  }

  // Not an administrator of anything. 404-shaped rather than "access denied":
  // an admin surface should not confirm it exists, which is the same call
  // requireAdmin() in lib/authz.ts makes.
  if (leagues.length === 0) {
    return (
      <Shell>
        <div className="py-24 text-center max-w-sm mx-auto">
          <h1 className="text-xl font-bold text-gray-900">Not found</h1>
          <p className="mt-2 text-gray-600">
            There is no league administration here for your account.
          </p>
          <Link href="/dashboard" className="mt-6 inline-flex items-center gap-2 text-red-600 font-semibold">
            <ArrowLeft size={16} /> Back to BenchCoach
          </Link>
        </div>
      </Shell>
    )
  }

  // Capability, from the role /api/league/me already reported. Presentation
  // only — the members endpoint enforces 'administer' regardless of what is
  // shown here.
  const myRole = leagues.find(l => l.leagueId === leagueId)?.role
  const canAdminister = myRole === 'owner' || myRole === 'commissioner'

  const o = overview

  return (
    <Shell>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          {o?.league.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={o.league.logoUrl} alt="" className="h-12 w-12 rounded-xl object-contain bg-white border border-gray-200" />
          ) : (
            <div className="h-12 w-12 rounded-xl bg-[#0f172a] flex items-center justify-center shrink-0">
              <Layers className="text-white" size={22} />
            </div>
          )}
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
              {o?.league.name || 'League'}
            </h1>
            <p className="text-sm text-gray-500 truncate">
              {o?.activeSeason?.name || 'No season yet'}
              {o?.league.city ? ` · ${o.league.city}${o.league.state ? `, ${o.league.state}` : ''}` : ''}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => { setInviteLink(null); setDialog('invite') }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-red-600 text-white rounded-xl font-semibold active:bg-red-700"
          >
            <Plus size={17} /> Invite coach
          </button>
        </div>
      </div>

      {/* A lapsed licence is the first thing a commissioner should see, because
          it is the only thing on this page that stops their coaches working. */}
      {o && !o.license.licensed && (
        <div className="mt-5 flex gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={20} />
          <div className="text-sm text-amber-900">
            <p className="font-semibold">This league&apos;s BenchCoach access is not active.</p>
            <p className="mt-1">
              Coaches cannot accept new invitations until it is. Get in touch and we will sort it out.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-5 flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="text-sm text-red-800 flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X size={16} /></button>
        </div>
      )}

      {/* A freshly created or resent invitation link. Prominent, because with no
          email transport this link IS the invitation and losing it means
          resending. */}
      {inviteLink && (
        <div className="mt-5 bg-green-50 border border-green-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-green-900">Invitation ready</p>
          <p className="mt-1 text-sm text-green-800">
            Email isn&apos;t set up yet, so send this link to the coach yourself.
          </p>
          <div className="mt-3 flex gap-2">
            <input
              readOnly
              value={inviteLink}
              onFocus={e => e.currentTarget.select()}
              className="flex-1 min-w-0 px-3 py-2 text-sm bg-white border border-green-200 rounded-lg text-gray-700"
            />
            <button
              onClick={copyLink}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold shrink-0"
            >
              {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
            </button>
          </div>
        </div>
      )}

      {/* KPIs */}
      {o && (
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi icon={Users} label="Coaches invited" value={o.kpis.coachesInvited} />
          <Kpi icon={UserCheck} label="Coaches activated" value={o.kpis.coachesActivated} />
          <Kpi icon={Layers} label="Teams" value={o.kpis.teams} />
          <Kpi icon={Activity} label="Active last 7 days" value={o.kpis.activeCoachesLast7Days} />
          <Kpi icon={ClipboardList} label="Practice plans" value={o.kpis.practicePlansCreated} />
        </div>
      )}

      {o && o.license.coachLimit !== null && (
        <p className="mt-3 text-sm text-gray-500">
          {o.license.seatsUsed} of {o.license.coachLimit} coach seats used.
        </p>
      )}

      {/* Tabs */}
      <div className="mt-7 border-b border-gray-200 flex gap-1 overflow-x-auto">
        {([
          ['coaches', 'Coaches'],
          ['teams', 'Teams'],
          ['divisions', 'Divisions'],
          ['admins', 'Administrators'],
        ] as Array<[Tab, string]>).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors ${
              tab === id
                ? 'border-red-600 text-red-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-5 bg-white border border-gray-200 rounded-2xl p-4 sm:p-6">
        {tab === 'coaches' && o && (
          <CoachTable coaches={o.coaches} onResend={handleResend} onRevoke={handleRevoke} busyId={busyId} />
        )}

        {tab === 'teams' && o && (
          <>
            <div className="flex justify-end mb-4">
              <SecondaryButton onClick={() => setDialog('team')}>New team</SecondaryButton>
            </div>
            <TeamTable teams={o.teams} />
          </>
        )}

        {tab === 'admins' && o && (
          <>
            {canAdminister && (
              <div className="flex justify-end mb-4">
                <SecondaryButton onClick={() => setDialog('member')}>Add administrator</SecondaryButton>
              </div>
            )}
            {members.length === 0 ? (
              <p className="text-center py-10 text-sm text-gray-600">
                No administrators listed yet.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {members.map(m => (
                  <li key={m.id} className="py-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-900 font-medium truncate">
                      {m.name || 'League administrator'}
                      {m.isYou && <span className="ml-2 text-xs text-gray-400">You</span>}
                    </span>
                    <span className="text-sm text-gray-600 capitalize shrink-0">
                      {m.role.replace(/_/g, ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-4 text-xs text-gray-500">
              A league administrator sees adoption numbers. They do not get access to any
              coach&apos;s roster, notes, practice plans or conversations.
            </p>
          </>
        )}

        {tab === 'divisions' && o && (
          <>
            <div className="flex flex-wrap justify-end gap-2 mb-4">
              <SecondaryButton onClick={() => setDialog('season')}>New season</SecondaryButton>
              <SecondaryButton onClick={() => setDialog('division')}>New division</SecondaryButton>
            </div>
            <DivisionSummary divisions={o.divisions} />
          </>
        )}
      </div>

      {dialog && o && (
        <CreateDialog
          kind={dialog}
          leagueId={o.league.id}
          seasons={o.seasons}
          divisions={o.divisions}
          teams={o.teams}
          onClose={() => setDialog(null)}
          onDone={(link) => {
            setDialog(null)
            if (link) setInviteLink(link)
            refresh()
          }}
        />
      )}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-[#0f172a]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/dashboard">
            <Image src="/logo.png" alt="Bench Coach" width={160} height={45} className="h-9 w-auto" priority />
          </Link>
          <Link href="/dashboard" className="text-sm text-slate-300 hover:text-white">
            My teams
          </Link>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">{children}</main>
    </div>
  )
}

function Kpi({ icon: Icon, label, value }: { icon: any; label: string; value: number }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <Icon className="text-gray-400" size={18} />
      <div className="mt-2 text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500 leading-tight">{label}</div>
    </div>
  )
}

function SecondaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 border border-gray-200 rounded-xl text-sm font-semibold text-gray-700 hover:bg-gray-50"
    >
      <Plus size={15} /> {children}
    </button>
  )
}

function CreateDialog({
  kind, leagueId, seasons, divisions, teams, onClose, onDone,
}: {
  kind: Exclude<Dialog, null>
  leagueId: string
  seasons: Array<{ id: string; name: string }>
  divisions: DivisionRow[]
  teams: TeamRow[]
  onClose: () => void
  onDone: (inviteLink?: string) => void
}) {
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [fields, setFields] = useState<Record<string, string>>({
    intendedRole: 'head_coach',
    leagueSeasonId: seasons[0]?.id || '',
  })

  const set = (k: string, v: string) => setFields(f => ({ ...f, [k]: v }))

  const submit = async () => {
    setSaving(true)
    setErr(null)
    try {
      const endpoint =
        kind === 'invite' ? 'invitations' :
        kind === 'season' ? 'seasons' :
        kind === 'division' ? 'divisions' :
        kind === 'member' ? 'members' : 'teams'

      const body: Record<string, any> = { leagueId }
      if (kind === 'invite') {
        body.email = fields.email
        body.teamId = fields.teamId || null
        body.intendedRole = fields.intendedRole
        body.leagueSeasonId = fields.leagueSeasonId || null
      } else if (kind === 'member') {
        body.email = fields.email
        body.role = fields.role || 'admin'
      } else if (kind === 'season') {
        body.name = fields.name
        body.startsAt = fields.startsAt || null
        body.endsAt = fields.endsAt || null
      } else if (kind === 'division') {
        body.name = fields.name
        body.ageGroup = fields.ageGroup
        body.leagueSeasonId = fields.leagueSeasonId
      } else {
        body.name = fields.name
        body.ageGroup = fields.ageGroup
        body.leagueSeasonId = fields.leagueSeasonId || null
        body.leagueDivisionId = fields.leagueDivisionId || null
      }

      const res = await fetch(`/api/league-admin/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = await res.json()
      if (!res.ok) { setErr(d.error || 'That did not work.'); return }
      onDone(d.inviteUrl)
    } catch {
      setErr('That did not work.')
    } finally {
      setSaving(false)
    }
  }

  const title =
    kind === 'invite' ? 'Invite a coach' :
    kind === 'season' ? 'New season' :
    kind === 'division' ? 'New division' :
    kind === 'member' ? 'Add administrator' : 'New team'

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>

        <div className="space-y-4">
          {kind === 'invite' && (
            <>
              <Field label="Coach's email">
                <input
                  type="email"
                  autoFocus
                  value={fields.email || ''}
                  onChange={e => set('email', e.target.value)}
                  placeholder="coach@example.com"
                  className={inputCls}
                />
              </Field>
              <Field label="Team">
                <select value={fields.teamId || ''} onChange={e => set('teamId', e.target.value)} className={inputCls}>
                  <option value="">No team yet</option>
                  {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </Field>
              <Field label="Role">
                <select value={fields.intendedRole} onChange={e => set('intendedRole', e.target.value)} className={inputCls}>
                  <option value="head_coach">Head coach</option>
                  <option value="assistant_coach">Assistant coach</option>
                </select>
              </Field>
            </>
          )}

          {kind === 'member' && (
            <>
              <Field label="Their email">
                <input
                  type="email"
                  autoFocus
                  value={fields.email || ''}
                  onChange={e => set('email', e.target.value)}
                  placeholder="commissioner@example.com"
                  className={inputCls}
                />
              </Field>
              <Field label="Role">
                <select value={fields.role || 'admin'} onChange={e => set('role', e.target.value)} className={inputCls}>
                  <option value="commissioner">Commissioner</option>
                  <option value="admin">Admin</option>
                  <option value="coaching_director">Coaching director</option>
                  <option value="owner">Owner</option>
                </select>
              </Field>
              <p className="text-xs text-gray-500">
                They need a BenchCoach account already. League administrators see adoption
                numbers — never a coach&apos;s roster, notes or conversations.
              </p>
            </>
          )}

          {kind === 'season' && (
            <>
              <Field label="Season name">
                <input autoFocus value={fields.name || ''} onChange={e => set('name', e.target.value)} placeholder="Spring 2027" className={inputCls} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts"><input type="date" value={fields.startsAt || ''} onChange={e => set('startsAt', e.target.value)} className={inputCls} /></Field>
                <Field label="Ends"><input type="date" value={fields.endsAt || ''} onChange={e => set('endsAt', e.target.value)} className={inputCls} /></Field>
              </div>
            </>
          )}

          {kind === 'division' && (
            <>
              <Field label="Division name">
                <input autoFocus value={fields.name || ''} onChange={e => set('name', e.target.value)} placeholder="10U Majors" className={inputCls} />
              </Field>
              <Field label="Age group">
                <input value={fields.ageGroup || ''} onChange={e => set('ageGroup', e.target.value)} placeholder="10U" className={inputCls} />
              </Field>
              <Field label="Season">
                <select value={fields.leagueSeasonId || ''} onChange={e => set('leagueSeasonId', e.target.value)} className={inputCls}>
                  <option value="">Pick a season</option>
                  {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
            </>
          )}

          {kind === 'team' && (
            <>
              <Field label="Team name">
                <input autoFocus value={fields.name || ''} onChange={e => set('name', e.target.value)} placeholder="8U Phillies" className={inputCls} />
              </Field>
              <Field label="Age group">
                <input value={fields.ageGroup || ''} onChange={e => set('ageGroup', e.target.value)} placeholder="8U" className={inputCls} />
              </Field>
              <Field label="Division">
                <select value={fields.leagueDivisionId || ''} onChange={e => set('leagueDivisionId', e.target.value)} className={inputCls}>
                  <option value="">No division</option>
                  {divisions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </Field>
              <Field label="Season">
                <select value={fields.leagueSeasonId || ''} onChange={e => set('leagueSeasonId', e.target.value)} className={inputCls}>
                  <option value="">No season</option>
                  {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </Field>
              <p className="text-xs text-gray-500">
                You&apos;ll hold this team until the head coach accepts their invitation —
                then it becomes theirs.
              </p>
            </>
          )}

          {err && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg p-3">{err}</p>}

          <button
            onClick={submit}
            disabled={saving}
            className="w-full py-3 bg-red-600 text-white rounded-xl font-bold active:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <><Loader2 className="animate-spin" size={17} /> Saving…</> : title}
          </button>
        </div>
      </div>
    </div>
  )
}

const inputCls =
  'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-[15px] text-gray-900 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400'

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-gray-700 mb-1.5">{label}</span>
      {children}
    </label>
  )
}
