import { NextResponse } from 'next/server'
import { isAdmin, type AcademyUser } from './server'

// The Academy launch flag. OFF unless ACADEMY_LAUNCH is exactly "1", so merging
// and deploying the Academy exposes nothing: no catalog, no sales page, no
// checkout, no navigation link, no sitemap entry.
//
// What it does NOT switch off, on purpose:
//  - the Stripe webhook (a refund or a late payment must still be processed);
//  - /learn for someone who has already bought a course (turning the flag off
//    is a way to stop selling, not a way to lock paying customers out);
//  - /admin/academy and the admin APIs (the owner needs them to prepare).
export function academyLaunched(): boolean {
  return process.env.ACADEMY_LAUNCH === '1'
}

/** Public pages: visible to everyone once launched, and before that only to the site owner (to preview). */
export function academyVisibleTo(user: AcademyUser | null): boolean {
  return academyLaunched() || isAdmin(user)
}

/** For the purchase-path API routes. When not launched they do not exist, for anyone. */
export function academyOff(): NextResponse | null {
  return academyLaunched() ? null : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
