'use client'

// Events from the public marketing pages.
//
// lib/tracking.ts cannot do this job. It resolves a Supabase user before it
// sends anything and returns early when there is nobody logged in — correct
// for the dashboard, where every event belongs to a coach, and exactly wrong
// here, where the entire audience is anonymous. Pointing the existing tracker
// at an SEO page would have recorded nothing at all, silently, which is the
// worst possible outcome for a measurement pilot.
//
// So: a separate, narrow path that expects no user. It carries no identifier
// of any kind — no id, no cookie, no fingerprint. These events answer "did
// anyone print the 8U practice plan", which needs counts and not people.

/** The events these pages are allowed to send. The API rejects anything else. */
export type SeoEventName =
  | 'practice_print'
  | 'practice_customize'
  | 'practice_generate'
  | 'drill_add_to_practice'
  | 'related_resource_click'
  | 'seo_to_app_cta'

export interface SeoEventContext {
  page?: string
  age_group?: string
  resource_type?: string
  drill_name?: string
  /** Where on the page the click happened — 'action_bar', 'related', 'hub_path'. */
  location?: string
  /** For a link click: where it went. */
  destination?: string
}

/**
 * Fire and forget. Never awaited, never surfaced, never allowed to throw.
 *
 * A failed analytics call must not cost a coach the click they came to make,
 * so every failure path here ends in a swallowed promise. `keepalive` is what
 * lets the request survive the navigation it is usually reporting.
 */
export function trackSeoEvent(name: SeoEventName, context: SeoEventContext = {}): void {
  try {
    const body = JSON.stringify({
      eventName: name,
      // Read at call time rather than passed in, so a component that forgets
      // to thread the path through still reports something useful.
      pagePath: context.page || (typeof window !== 'undefined' ? window.location.pathname : undefined),
      metadata: {
        age_group: context.age_group,
        resource_type: context.resource_type,
        drill_name: context.drill_name,
        location: context.location,
        destination: context.destination,
      },
    })

    fetch('/api/track/seo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {})
  } catch {
    // Serialization failed, or there is no fetch. Either way this is
    // instrumentation, and instrumentation does not get to break a page.
  }
}
