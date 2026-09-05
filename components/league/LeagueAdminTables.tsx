'use client'

import { Mail, RotateCcw, XCircle, CheckCircle2, Clock, MinusCircle } from 'lucide-react'

// The three tables on the commissioner's dashboard.
//
// Every one of them renders twice: cards below sm, a table above it. That is
// deliberate rather than lazy — a commissioner checks adoption on their phone
// in a parking lot between games, and a nine-column table inside a horizontal
// scroller is unreadable there. The desktop table is for the person sitting
// down to chase the eleven coaches who have not accepted.
//
// Purely presentational: no hooks, no fetching. Everything arrives as props
// from the page, which owns the one authorized read.

export interface CoachRow {
  kind: string
  invitationId: string | null
  name: string | null
  email: string | null
  role: string
  teamId: string | null
  teamName: string | null
  divisionName: string | null
  inviteStatus: string | null
  activated: boolean
  lastActiveAt: string | null
  practicePlans: number
  chatUsed: boolean
}

export interface TeamRow {
  id: string
  name: string
  ageGroup: string | null
  divisionName: string | null
  headCoachName: string | null
  assistantCount: number
  activated: boolean
  practicePlans: number
  chatUsed: boolean
}

export interface DivisionRow {
  id: string
  name: string
  ageGroup: string | null
  teams: number
  coachesInvited: number
  coachesActivated: number
  activeCoaches: number
}

function roleLabel(role: string): string {
  if (role === 'head_coach') return 'Head coach'
  if (role === 'assistant_coach') return 'Assistant'
  if (role === 'admin') return 'Team admin'
  if (role === 'contributor') return 'Assistant'
  if (role === 'viewer') return 'Viewer'
  return role
}

export function relativeDay(iso: string | null): string {
  if (!iso) return 'Never'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 14) return 'Last week'
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`
  return new Date(iso).toLocaleDateString()
}

export function StatusBadge({ status, activated }: { status: string | null; activated: boolean }) {
  // Activated outranks the invite status. A coach who has accepted AND opened
  // the app is the outcome the league is paying for, and it should be legible
  // at a glance rather than inferred from two columns.
  const spec = activated
    ? { label: 'Active', cls: 'bg-green-100 text-green-800', Icon: CheckCircle2 }
    : status === 'accepted'
      ? { label: 'Accepted', cls: 'bg-blue-100 text-blue-800', Icon: CheckCircle2 }
      : status === 'pending'
        ? { label: 'Invited', cls: 'bg-amber-100 text-amber-800', Icon: Clock }
        : status === 'revoked'
          ? { label: 'Revoked', cls: 'bg-gray-100 text-gray-600', Icon: MinusCircle }
          : status === 'expired'
            ? { label: 'Expired', cls: 'bg-gray-100 text-gray-600', Icon: MinusCircle }
            : { label: 'On a team', cls: 'bg-gray-100 text-gray-700', Icon: CheckCircle2 }

  const { label, cls, Icon } = spec
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${cls}`}>
      <Icon size={12} />
      {label}
    </span>
  )
}

export function CoachTable({
  coaches, onResend, onRevoke, busyId,
}: {
  coaches: CoachRow[]
  onResend: (id: string) => void
  onRevoke: (id: string) => void
  busyId: string | null
}) {
  if (coaches.length === 0) {
    return (
      <Empty
        title="No coaches yet"
        body="Invite your first coach and they will show up here the moment they accept."
      />
    )
  }

  return (
    <>
      {/* Mobile */}
      <div className="sm:hidden space-y-3">
        {coaches.map((c, i) => (
          <div key={c.invitationId || `${c.teamId}-${i}`} className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{c.name || c.email || 'Invited coach'}</div>
                {c.email && c.name && <div className="text-sm text-gray-500 truncate">{c.email}</div>}
              </div>
              <StatusBadge status={c.inviteStatus} activated={c.activated} />
            </div>
            <div className="mt-2 text-sm text-gray-600">
              {c.teamName || 'No team yet'}
              {c.divisionName ? ` · ${c.divisionName}` : ''}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {roleLabel(c.role)} · Last active {relativeDay(c.lastActiveAt)}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {c.practicePlans} practice {c.practicePlans === 1 ? 'plan' : 'plans'} on this team
            </div>
            {c.inviteStatus === 'pending' && c.invitationId && (
              <div className="mt-3 flex gap-2">
                <RowAction onClick={() => onResend(c.invitationId!)} busy={busyId === c.invitationId} Icon={RotateCcw}>
                  Resend
                </RowAction>
                <RowAction onClick={() => onRevoke(c.invitationId!)} busy={busyId === c.invitationId} Icon={XCircle} danger>
                  Revoke
                </RowAction>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Desktop */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-200">
              <Th>Coach</Th>
              <Th>Team</Th>
              <Th>Division</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last active</Th>
              <Th>Plans</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {coaches.map((c, i) => (
              <tr key={c.invitationId || `${c.teamId}-${i}`} className="hover:bg-gray-50">
                <td className="py-3 pr-4">
                  <div className="font-medium text-gray-900">{c.name || '—'}</div>
                  {c.email && <div className="text-gray-500">{c.email}</div>}
                </td>
                <td className="py-3 pr-4 text-gray-700">{c.teamName || '—'}</td>
                <td className="py-3 pr-4 text-gray-700">{c.divisionName || '—'}</td>
                <td className="py-3 pr-4 text-gray-700">{roleLabel(c.role)}</td>
                <td className="py-3 pr-4"><StatusBadge status={c.inviteStatus} activated={c.activated} /></td>
                <td className="py-3 pr-4 text-gray-700">{relativeDay(c.lastActiveAt)}</td>
                <td className="py-3 pr-4 text-gray-700">{c.practicePlans}</td>
                <td className="py-3 text-right whitespace-nowrap">
                  {c.inviteStatus === 'pending' && c.invitationId && (
                    <div className="flex gap-1 justify-end">
                      <RowAction onClick={() => onResend(c.invitationId!)} busy={busyId === c.invitationId} Icon={RotateCcw}>
                        Resend
                      </RowAction>
                      <RowAction onClick={() => onRevoke(c.invitationId!)} busy={busyId === c.invitationId} Icon={XCircle} danger>
                        Revoke
                      </RowAction>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Said once, under the table, rather than in a tooltip nobody opens.
          Naming the limit is what stops "0 plans" being read as "this coach is
          doing nothing" when it might mean "their assistant made the plans". */}
      <p className="mt-4 text-xs text-gray-500">
        Practice plans are counted per team, not per coach — BenchCoach records which
        team a plan belongs to, not who typed it. &ldquo;Last active&rdquo; comes from pages
        opened in the last 30 days.
      </p>
    </>
  )
}

export function TeamTable({ teams }: { teams: TeamRow[] }) {
  if (teams.length === 0) {
    return (
      <Empty
        title="No teams yet"
        body="Create your divisions first, then add the teams that sit inside them."
      />
    )
  }

  return (
    <>
      <div className="sm:hidden space-y-3">
        {teams.map(t => (
          <div key={t.id} className="border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-semibold text-gray-900 truncate">{t.name}</div>
                <div className="text-sm text-gray-500">
                  {t.divisionName || 'No division'}{t.ageGroup ? ` · ${t.ageGroup}` : ''}
                </div>
              </div>
              <StatusBadge status={t.activated ? 'accepted' : 'pending'} activated={t.activated} />
            </div>
            <div className="mt-2 text-sm text-gray-600">
              {t.headCoachName ? `Head coach: ${t.headCoachName}` : 'No head coach yet'}
            </div>
            <div className="mt-1 text-sm text-gray-500">
              {t.assistantCount} {t.assistantCount === 1 ? 'assistant' : 'assistants'} · {t.practicePlans} plans
            </div>
          </div>
        ))}
      </div>

      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400 border-b border-gray-200">
              <Th>Team</Th>
              <Th>Division</Th>
              <Th>Head coach</Th>
              <Th>Assistants</Th>
              <Th>Plans</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {teams.map(t => (
              <tr key={t.id} className="hover:bg-gray-50">
                <td className="py-3 pr-4">
                  <div className="font-medium text-gray-900">{t.name}</div>
                  {t.ageGroup && <div className="text-gray-500">{t.ageGroup}</div>}
                </td>
                <td className="py-3 pr-4 text-gray-700">{t.divisionName || '—'}</td>
                <td className="py-3 pr-4 text-gray-700">{t.headCoachName || '—'}</td>
                <td className="py-3 pr-4 text-gray-700">{t.assistantCount}</td>
                <td className="py-3 pr-4 text-gray-700">{t.practicePlans}</td>
                <td className="py-3"><StatusBadge status={t.activated ? 'accepted' : 'pending'} activated={t.activated} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export function DivisionSummary({ divisions }: { divisions: DivisionRow[] }) {
  if (divisions.length === 0) {
    return (
      <Empty
        title="No divisions yet"
        body="Divisions are how the adoption numbers break down — 8U Minors, 10U Majors, and so on."
      />
    )
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {divisions.map(d => (
        <div key={d.id} className="border border-gray-200 rounded-xl p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-bold text-gray-900">{d.name}</h3>
            {d.ageGroup && <span className="text-sm text-gray-500">{d.ageGroup}</span>}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Stat label="Teams" value={d.teams} />
            <Stat label="Invited" value={d.coachesInvited} />
            <Stat label="Active" value={d.activeCoaches} />
          </div>
          {d.coachesInvited > 0 && (
            <div className="mt-3">
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full"
                  style={{ width: `${Math.min(100, Math.round((d.coachesActivated / d.coachesInvited) * 100))}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-500">
                {d.coachesActivated} of {d.coachesInvited} accepted
              </p>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-bold text-gray-900">{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="py-2 pr-4 font-semibold">{children}</th>
}

function RowAction({
  children, onClick, busy, Icon, danger,
}: {
  children: React.ReactNode
  onClick: () => void
  busy: boolean
  Icon: any
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${
        danger
          ? 'border-red-200 text-red-700 hover:bg-red-50'
          : 'border-gray-200 text-gray-700 hover:bg-gray-50'
      }`}
    >
      <Icon size={13} />
      {children}
    </button>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-10 px-4">
      <div className="w-11 h-11 rounded-xl bg-gray-100 flex items-center justify-center mx-auto mb-3">
        <Mail className="text-gray-400" size={20} />
      </div>
      <h3 className="font-bold text-gray-900">{title}</h3>
      <p className="mt-1 text-sm text-gray-600 max-w-sm mx-auto">{body}</p>
    </div>
  )
}
