import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/authz'
import { adminDb, currentUser } from '@/lib/academy/server'
import { isCourseSlug } from '@/lib/academy/catalog'

// The product owner's tools: who has a course, and grant/revoke by hand
// (comps, support cases, a refund handled outside Stripe). Purchases come
// only from Stripe; this never fabricates one.
export const dynamic = 'force-dynamic'

async function courseId(slug: unknown): Promise<string | null> {
  if (!isCourseSlug(slug)) return null
  const { data } = await adminDb().from('academy_courses').select('id').eq('slug', slug).maybeSingle()
  return (data as any)?.id ?? null
}

async function userIdByEmail(email: string): Promise<string | null> {
  const want = email.trim().toLowerCase()
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await adminDb().auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data?.users?.length) return null
    const hit = data.users.find(u => (u.email || '').toLowerCase() === want)
    if (hit) return hit.id
    if (data.users.length < 200) return null
  }
  return null
}

export async function GET(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const id = await courseId(request.nextUrl.searchParams.get('course'))
  if (!id) return NextResponse.json({ error: 'Unknown course.' }, { status: 404 })
  const { data, error } = await adminDb().from('academy_enrollments')
    .select('id, user_id, status, source, enrolled_at, revoked_at, revoke_reason, amount_total, currency, granted_by').eq('course_id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ enrollments: data || [] })
}

export async function POST(request: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const admin = await currentUser()
  const { course, email, action, reason } = await request.json().catch(() => ({}))
  const id = await courseId(course)
  if (!id) return NextResponse.json({ error: 'Unknown course.' }, { status: 404 })
  if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(email)) return NextResponse.json({ error: 'Enter an email address.' }, { status: 400 })
  if (!['grant', 'revoke'].includes(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
  const userId = await userIdByEmail(email)
  if (!userId) return NextResponse.json({ error: 'No account with that email. They need to sign up first.' }, { status: 404 })

  const db = adminDb()
  const { data: existing } = await db.from('academy_enrollments').select('id, status').eq('user_id', userId).eq('course_id', id).maybeSingle()
  const note = typeof reason === 'string' ? reason.slice(0, 300) : null
  if (action === 'grant') {
    if (existing?.status === 'active') return NextResponse.json({ status: 'active', changed: false })
    const row = { status: 'active', revoked_at: null, revoke_reason: null, granted_by: admin?.email ?? 'admin' }
    const { error } = existing
      ? await db.from('academy_enrollments').update(row).eq('id', existing.id)
      : await db.from('academy_enrollments').insert({ user_id: userId, course_id: id, source: 'admin_grant', ...row })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ status: 'active', changed: true })
  }
  if (!existing || existing.status !== 'active') return NextResponse.json({ status: existing?.status ?? 'none', changed: false })
  const { error } = await db.from('academy_enrollments')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoke_reason: note || 'revoked by admin' }).eq('id', existing.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ status: 'revoked', changed: true })
}
