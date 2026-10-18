// BenchCoach Academy — the public catalog: what each course is called, its
// sales copy, and which lesson is the free preview.
//
// Everything here is PUBLIC by design (sales pages, SEO). The paid lesson text
// is not in the repository; it lives in Supabase behind row-level security and
// is loaded with `npm run academy:import` from the private manuscript.
//
// Sales copy is the manuscript's own (Part XI), not rewritten. Anything the
// manuscript marks as undecided — price, refund policy, trial pricing — is
// NOT stated here; see docs/academy/DECISIONS.md.
//
// Adding a course: add an entry, write its manuscript, import it. No route,
// table or component is course-specific.

export interface CourseCopy {
  slug: string
  previewLessonKey: string
  /** development_pathways.slug this course feeds (Phase 2 import target). */
  relatedPathwaySlug: string | null
  ages: string
  headline: string
  subheadline: string
  whoFor: string
  learn: string[]
  getItems: string[]
  softwareNote: string
  notPromised: string[]
  credibility: string
  ctaLabel: string
  previewLabel: string
  handoff: { title: string; body: string; keep: string }
}

export const COURSES: CourseCopy[] = [
  {
    slug: 'build-a-better-baseball-swing',
    previewLessonKey: '1-1',
    relatedPathwaySlug: 'build-the-swing',
    ages: 'Recommended approximately ages 7–12; adapt to player readiness, not age alone.',
    headline: 'Stop guessing what to teach your young hitter next.',
    subheadline:
      'Build a better baseball swing from the ground up—with clear lessons on grip, stance, posture, load, stride, rotation, contact and timing, plus drills you can use in your next backyard session or team practice.',
    whoFor: 'Parents helping their own baseball player; first-time rec coaches; experienced coaches who want a clear, teachable hitting sequence.',
    learn: [
      'Set up for success',
      'Create a balanced, on-time load',
      'Build a controllable stride',
      'Turn efficiently',
      'Deliver the barrel to different pitch locations',
      'Adjust and make decisions against a moving ball',
    ],
    getItems: [
      '19 written lessons across six modules',
      'Step-by-step drill assignments',
      'Vetted external video demonstrations (once approved)',
      'A four-week example program',
      'Printable progress checklists',
      'A straightforward troubleshooting guide',
    ],
    softwareNote: "BenchCoach's personalized software tools are an optional separate subscription, not a condition of course access.",
    notPromised: [
      'A uniform MLB-style swing',
      'Guaranteed velocity or batting average improvements',
      'AI motion analysis',
      'An individual professional diagnosis',
      'Instant mastery',
    ],
    credibility:
      'Created by Clint Losch, a former Division I baseball player at Lafayette College, former high-school coach and private instructor at All Star Baseball Academy, now a rec and travel baseball coach whose 8U team reached the Cal Ripken World Series. His experience informs the teaching; the course does not claim measured outcomes absent evidence.',
    ctaLabel: 'Get the Hitting Blueprint',
    previewLabel: 'Read the free lesson: The grip',
    handoff: {
      title: "You've learned what to coach. Now make a plan for your player.",
      body: "BenchCoach can help you organize a player's focus areas, choose appropriate drills, plan sessions and record what you see over time.",
      keep: 'The Academy course remains yours whether or not you choose the software.',
    },
  },
]

export function courseCopy(slug: string): CourseCopy | null {
  return COURSES.find(c => c.slug === slug) ?? null
}

/** Only a lowercase slug ever reaches a query or a path. */
export function isCourseSlug(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length <= 80
}

export function isLessonKey(s: unknown): s is string {
  return typeof s === 'string' && /^[a-z0-9-]{1,40}$/.test(s)
}

export const SITE_URL = 'https://www.mybenchcoach.com'
