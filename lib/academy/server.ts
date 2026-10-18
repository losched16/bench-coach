// BenchCoach Academy — server-side reads. Every page and route goes through
// these, and every access decision is made HERE, on the server, from the
// session cookie — never from a hidden button or a query parameter.
//
// Two layers on purpose:
//   * explicit checks in this file (course published, enrollment active,
//     lesson is the preview), using the service role;
//   * row-level security (migration 080) on the paid text, which the lesson
//     body is read through with the CALLER'S session — so even a bug in the
//     first layer cannot hand the text to someone without access.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { sessionClient } from '@/lib/authz'
import type { Block } from './manuscript'
import { isCourseSlug, isLessonKey } from './catalog'

let admin: SupabaseClient<any> | null = null
export function adminDb(): SupabaseClient<any> {
  if (!admin) {
    admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  }
  return admin
}

export interface AcademyUser { id: string; email: string | null }

export async function currentUser(): Promise<AcademyUser | null> {
  try {
    const supabase = await sessionClient()
    const { data } = await supabase.auth.getUser()
    return data.user ? { id: data.user.id, email: data.user.email ?? null } : null
  } catch {
    return null
  }
}

/** The product owner (same rule as requireAdmin): may preview draft courses. */
export function isAdmin(user: AcademyUser | null): boolean {
  const allowed = (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL || '').trim().toLowerCase()
  return !!user?.email && !!allowed && user.email.toLowerCase() === allowed
}

export interface Course {
  id: string
  slug: string
  title: string
  subtitle: string | null
  summary: string | null
  status: 'draft' | 'published' | 'archived'
  preview_lesson_key: string | null
  safety_note: string | null
  content_version: number
  price_cents: number | null
  currency: string
  stripe_price_id: string | null
  related_pathway_slug: string | null
}

export interface Module { module_key: string; position: number; title: string; subtitle: string | null; outcome: string | null }
export interface LessonOutline {
  lesson_key: string
  module_key: string | null
  kind: 'intro' | 'lesson' | 'resource'
  position: number
  number_label: string | null
  title: string
  est_minutes: number | null
  is_preview: boolean
}
export interface Outline { modules: Module[]; lessons: LessonOutline[] }

const COURSE_COLS = 'id, slug, title, subtitle, summary, status, preview_lesson_key, safety_note, content_version, price_cents, currency, stripe_price_id, related_pathway_slug'

/** A published course — or, for the owner only, a draft one. */
export async function getCourse(slug: string, viewer: AcademyUser | null = null): Promise<Course | null> {
  if (!isCourseSlug(slug)) return null
  const { data, error } = await adminDb().from('academy_courses').select(COURSE_COLS).eq('slug', slug).maybeSingle()
  if (error || !data) return null
  if (data.status === 'published') return data as Course
  if (data.status === 'draft' && isAdmin(viewer)) return data as Course
  return null
}

export async function listPublishedCourses(): Promise<Course[]> {
  const { data } = await adminDb().from('academy_courses').select(COURSE_COLS).eq('status', 'published')
  return ((data || []) as Course[]).sort((a, b) => a.title.localeCompare(b.title))
}

export async function getOutline(courseId: string): Promise<Outline> {
  const db = adminDb()
  const [m, l] = await Promise.all([
    db.from('academy_modules').select('module_key, position, title, subtitle, outcome').eq('course_id', courseId),
    db.from('academy_lessons').select('lesson_key, module_key, kind, position, number_label, title, est_minutes, is_preview, status').eq('course_id', courseId).eq('status', 'published'),
  ])
  const modules = ((m.data || []) as Module[]).sort((a, b) => a.position - b.position)
  const lessons = ((l.data || []) as Array<LessonOutline & { status: string }>)
    .filter(x => x.status === 'published')
    .map(({ status: _s, ...x }) => x)
    .sort((a, b) => a.position - b.position)
  return { modules, lessons }
}

export type Access = 'enrolled' | 'owner_preview' | 'none'

export async function getEnrollment(userId: string, courseId: string) {
  const { data } = await adminDb().from('academy_enrollments')
    .select('id, status, source, enrolled_at, revoked_at').eq('user_id', userId).eq('course_id', courseId).maybeSingle()
  return data as { id: string; status: 'active' | 'revoked' | 'refunded'; source: string; enrolled_at: string; revoked_at: string | null } | null
}

export async function courseAccess(user: AcademyUser | null, course: Course): Promise<Access> {
  if (!user) return 'none'
  const e = await getEnrollment(user.id, course.id)
  if (e?.status === 'active' && course.status === 'published') return 'enrolled'
  if (isAdmin(user)) return 'owner_preview'
  return 'none'
}

export interface LessonBody { blocks: Block[]; field_test: string | null }

/**
 * The paid text of one lesson, for someone ALREADY checked by the caller
 * (`access !== 'none'`, or the lesson is the published preview).
 *
 * Read with the caller's own session so row-level security applies as a
 * second gate. The owner's draft preview has no enrollment to satisfy RLS,
 * so it — and only it — reads with the service role.
 */
export async function getLessonBody(course: Course, lessonKey: string, how: 'session' | 'owner'): Promise<LessonBody | null> {
  if (!isLessonKey(lessonKey)) return null
  const db = how === 'owner' ? adminDb() : await sessionClient()
  const { data, error } = await db.from('academy_lesson_bodies')
    .select('blocks, field_test').eq('course_id', course.id).eq('lesson_key', lessonKey).maybeSingle()
  if (error || !data) return null
  return { blocks: Array.isArray(data.blocks) ? data.blocks : [], field_test: data.field_test ?? null }
}

/** Every readable lesson body of a course (checklist page). Same two gates as getLessonBody. */
export async function getAllBodies(course: Course, how: 'session' | 'owner'): Promise<Record<string, LessonBody>> {
  const db = how === 'owner' ? adminDb() : await sessionClient()
  const { data } = await db.from('academy_lesson_bodies').select('lesson_key, blocks, field_test').eq('course_id', course.id)
  const out: Record<string, LessonBody> = {}
  for (const r of (data || []) as any[]) out[r.lesson_key] = { blocks: Array.isArray(r.blocks) ? r.blocks : [], field_test: r.field_test ?? null }
  return out
}

export interface VideoLink {
  id: string
  kind: 'video' | 'article'
  title: string
  creator: string
  watch_url: string
  supported_skill: string | null
  start_seconds: number | null
  link_status: 'unchecked' | 'ok' | 'broken'
}

/** Approved demonstrations only — candidates and rejected links are never returned. */
export async function getVideos(courseId: string, lessonKey: string): Promise<VideoLink[]> {
  const { data } = await adminDb().from('academy_video_links')
    .select('id, kind, title, creator, watch_url, supported_skill, start_seconds, link_status, approval_status, position')
    .eq('course_id', courseId).eq('lesson_key', lessonKey).eq('approval_status', 'approved')
  return ((data || []) as Array<VideoLink & { approval_status: string; position: number }>)
    .filter(v => v.approval_status === 'approved' && /^https:\/\//.test(v.watch_url))
    .sort((a, b) => a.position - b.position)
    .map(({ approval_status: _a, position: _p, ...v }) => v)
}

export interface Progress { [lessonKey: string]: { completed: boolean; last_opened_at: string | null } }

export async function getProgress(userId: string, courseId: string): Promise<Progress> {
  const { data } = await adminDb().from('academy_lesson_progress')
    .select('lesson_key, completed_at, last_opened_at').eq('user_id', userId).eq('course_id', courseId)
  const out: Progress = {}
  for (const r of (data || []) as any[]) out[r.lesson_key] = { completed: !!r.completed_at, last_opened_at: r.last_opened_at }
  return out
}

export async function isSubscriber(userId: string): Promise<boolean> {
  const { data } = await adminDb().from('coaches').select('is_subscribed').eq('user_id', userId).maybeSingle()
  return !!(data as any)?.is_subscribed
}

export async function myCourses(userId: string): Promise<Array<{ course: Course; completed: number; total: number }>> {
  const { data } = await adminDb().from('academy_enrollments').select('course_id, status').eq('user_id', userId).eq('status', 'active')
  const out = []
  for (const e of (data || []) as any[]) {
    const { data: c } = await adminDb().from('academy_courses').select(COURSE_COLS).eq('id', e.course_id).maybeSingle()
    if (!c || (c as any).status !== 'published') continue
    const outline = await getOutline((c as any).id)
    const prog = await getProgress(userId, (c as any).id)
    const total = outline.lessons.filter(l => l.kind === 'lesson').length
    const completed = outline.lessons.filter(l => l.kind === 'lesson' && prog[l.lesson_key]?.completed).length
    out.push({ course: c as Course, completed, total })
  }
  return out
}

export function formatPrice(cents: number | null, currency: string): string | null {
  if (!cents) return null
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

/** Next/previous in reading order (intro → modules → resources). */
export function neighbours(outline: Outline, key: string) {
  const i = outline.lessons.findIndex(l => l.lesson_key === key)
  return { prev: i > 0 ? outline.lessons[i - 1] : null, next: i >= 0 && i < outline.lessons.length - 1 ? outline.lessons[i + 1] : null }
}

export function appOrigin(requestOrigin: string): string {
  const env = (process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '')
  return /^https?:\/\//.test(env) ? env : requestOrigin
}
