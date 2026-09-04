// The BenchCoach League Sales schema, declaratively.
//
// This file is the source of truth. audit.mjs diffs the live workspace against
// it, apply.mjs creates what is missing, verify.mjs confirms the result. Change
// the schema by changing this file, never by clicking in Attio — a hand-added
// attribute will show up in the next audit as an unexplained extra.
//
// TWO RULES RUN THROUGH EVERY DECISION HERE
//
// 1. UNKNOWN IS NOT NO. Every yes/no question is a three-option select with an
//    explicit Unknown, never a checkbox. A checkbox has two states and a
//    league we have not researched yet would sit in the same bucket as a
//    league we researched and found nothing. Those are opposite facts: one is
//    a task, the other is a disqualification. Conflating them silently poisons
//    every count and every filter built on top.
//
// 2. STRUCTURE ONLY WHERE IT DRIVES ACTION. An attribute earns its place if it
//    feeds qualification, segmentation, automation, personalization, execution
//    or reporting. "Interesting" is not a reason — it is how a CRM becomes a
//    form nobody fills in.

export const WORKSPACE = 'Bench Coach'

// Read from the live workspace on 2026-09-04. Used to detect a wrong workspace
// before writing anything.
export const EXPECTED_OBJECTS = ['companies', 'people', 'deals']

// ---------------------------------------------------------------------------
// Attributes we reuse rather than recreate.
//
// Listed explicitly so the audit can assert they still exist, and so nobody
// later "adds a Website field" without noticing domains already does the job
// (and does it better: it is unique-indexed, which is what makes it the
// dedupe key for league records).
// ---------------------------------------------------------------------------
export const REUSED = {
  companies: [
    { slug: 'name', as: 'League name' },
    { slug: 'domains', as: 'Website / dedupe key', note: 'unique-indexed, type domain' },
    { slug: 'primary_location', as: 'League location', note: 'structured locality/region/country' },
    { slug: 'description', as: 'Freeform league notes' },
    { slug: 'associated_deals', as: 'Link to the sales opportunity' },
  ],
  people: [
    { slug: 'name', as: 'Contact name' },
    { slug: 'job_title', as: 'League Role', note: 'their literal title, e.g. "VP of Baseball Operations"' },
    { slug: 'email_addresses', as: 'Email', note: 'multi-value and unique-indexed' },
    { slug: 'linkedin', as: 'LinkedIn' },
    { slug: 'company', as: 'League they belong to' },
    { slug: 'primary_location', as: 'Contact location' },
  ],
  deals: [
    { slug: 'name', as: 'Deal name', note: 'required by Attio' },
    { slug: 'stage', as: 'Deal Stage', note: 'required; the single pipeline source of truth' },
    { slug: 'owner', as: 'Deal owner', note: 'required; actor-reference to a workspace member' },
    { slug: 'value', as: 'Deal value' },
    { slug: 'associated_company', as: 'League' },
    { slug: 'associated_people', as: 'Primary contact(s)' },
  ],
}

// ---------------------------------------------------------------------------
// Attributes we deliberately do NOT create, and why.
//
// Recorded in the schema rather than only in prose so the reasoning survives.
// The next person to wonder "why is there no State field" finds the answer
// here instead of adding one.
// ---------------------------------------------------------------------------
export const OMITTED = [
  {
    name: 'City / State (as select attributes)',
    object: 'companies',
    reason:
      'primary_location already stores locality, region and country as structured data. ' +
      'Parallel selects would be a second source of truth that drifts the first time ' +
      'someone edits one and not the other, and a select of 50 states is a data-entry ' +
      'trap (Calif. / CA / California). See docs/VIEWS.md for the one real cost: ' +
      'Attio cannot currently group a view by a location subfield.',
  },
  {
    name: 'Company Outreach Status',
    object: 'companies',
    reason:
      'Duplicates Deal Stage. Two status fields for one sales motion means the ' +
      'moment someone advances the Deal and not the Company, every pipeline number ' +
      'is wrong and nobody can tell which one is lying.',
  },
  {
    name: 'Public League Email',
    object: 'people',
    reason:
      'email_addresses is already multi-value. A league info@ inbox is a Person ' +
      'record with role_category = Other, which keeps one email index and lets ' +
      'the generic inbox carry outreach_eligible like any other contact.',
  },
  {
    name: 'Primary Contact (as a separate record-reference)',
    object: 'deals',
    reason:
      'associated_people already links Person records to a Deal. A second ' +
      'reference attribute would need manual synchronisation with the first.',
  },
  {
    name: 'League (as a separate record-reference)',
    object: 'deals',
    reason: 'associated_company is exactly this, and drives Attio\'s built-in company rollups.',
  },
]

// ---------------------------------------------------------------------------
// Helpers. `select` always appends Unknown unless the option set already
// carries its own not-yet-known value (BenchCoach Fit uses "Unscored").
// ---------------------------------------------------------------------------
const text = (title, api_slug, description) => ({ title, api_slug, type: 'text', description })
const number = (title, api_slug, description) => ({ title, api_slug, type: 'number', description })
const date = (title, api_slug, description) => ({ title, api_slug, type: 'date', description })
const rating = (title, api_slug, description) => ({ title, api_slug, type: 'rating', description })
const select = (title, api_slug, options, description) =>
  ({ title, api_slug, type: 'select', options, description })
const status = (title, api_slug, statuses, description) =>
  ({ title, api_slug, type: 'status', statuses, description })

// ---------------------------------------------------------------------------
// COMPANIES — a youth baseball league
// ---------------------------------------------------------------------------
export const COMPANY_ATTRIBUTES = [
  select('League Type', 'league_type', ['Rec', 'Travel', 'Both', 'Unknown'],
    'Rec vs travel changes both the pitch and the coach profile. Both is common and is a real answer, not a fallback.'),

  select('Governing Body', 'governing_body',
    ['Little League', 'Cal Ripken', 'Babe Ruth', 'PONY', 'Independent', 'Other', 'Unknown'],
    'Sanctioning body. Drives messaging and, for the national bodies, a possible partnership route.'),

  text('Age Range', 'age_range',
    'Free text because leagues describe this inconsistently ("6U-14U", "T-ball through Majors"). Normalising it into a select would lose information and invent precision.'),

  number('Estimated Teams', 'estimated_teams',
    'Best estimate. Feeds the coach-seat model.'),

  number('Estimated Coaches', 'estimated_coaches',
    'The single most important sizing number: coach seats are what BenchCoach sells. Sort key for Tier A.'),

  text('Coach Resources URL', 'coach_resources_url',
    'Direct link to whatever the league gives its coaches today. The evidence behind Coach Resources Quality.'),

  text('Registration URL', 'registration_url',
    'Where coaches and families sign up. Indicates platform and season timing.'),

  text('Registration Period', 'registration_period',
    'When registration runs. Free text because leagues state it as months, dates or seasons.'),

  select('Coach Training', 'coach_training', ['Yes', 'No', 'Unknown'],
    'Does the league run any coach training? "No" is a strong buying signal. "Unknown" means we have not looked.'),

  select('Coach Resources Quality', 'coach_resources_quality',
    ['None', 'Minimal', 'Good', 'Excellent', 'Unknown'],
    'Judgement of what they currently give coaches. None/Minimal is the sweet spot; Excellent may mean an incumbent.'),

  select('Practice Resources', 'practice_resources', ['Yes', 'No', 'Unknown'],
    'Do they provide practice plans or drills today? Directly adjacent to what BenchCoach replaces.'),

  select('Decision Maker Identified', 'decision_maker_identified', ['Yes', 'No', 'Unknown'],
    'Have we found a named human who can say yes? Gates whether a league is outreach-ready.'),

  select('BenchCoach Fit', 'benchcoach_fit', ['A', 'B', 'C', 'Unscored'],
    'Overall tier. Unscored rather than Unknown so an unresearched league never reads as a considered C.'),

  text('Fit Reason', 'fit_reason',
    'One or two sentences justifying the tier. Forces the score to be defensible and reviewable.'),

  text('AI Research Summary', 'ai_research_summary',
    'Condensed research output. Bounded on purpose: the full working goes in a Note, not here.'),

  text('Personalization Angle', 'personalization_angle',
    'The specific, true, league-particular hook for the first message. The difference between outreach and spam.'),

  date('Last Researched', 'last_researched',
    'When research was last refreshed. Lets the queue surface stale records.'),

  status('Research Status', 'research_status',
    ['Not Started', 'Researching', 'Complete', 'Needs Review'],
    'STATUS, not select: this is a workflow a record moves through, so Attio gives it kanban grouping and time-in-status reporting that a select cannot. If the API refuses a status attribute on Companies, fall back to select — the option titles are identical and nothing downstream changes.'),
]

// ---------------------------------------------------------------------------
// PEOPLE — a league decision maker
// ---------------------------------------------------------------------------
export const PEOPLE_ATTRIBUTES = [
  select('Role Category', 'role_category',
    ['Executive', 'Coaching', 'Player Development', 'Board', 'Other', 'Unknown'],
    'Normalised bucket for segmentation. job_title keeps their literal title; this makes titles comparable across leagues.'),

  rating('Decision Maker Score', 'decision_maker_score',
    'RATING, not number: Attio ratings are natively 1-5, so the range is enforced by the type instead of by hope. How likely this person can authorise a league-wide purchase.'),

  select('Contact Source', 'contact_source',
    ['League Website', 'LinkedIn', 'Apollo', 'Clay', 'Referral', 'Other', 'Unknown'],
    'Where the contact came from. Needed to measure which sourcing method actually produces replies.'),

  select('Preferred Contact', 'preferred_contact', ['Email', 'LinkedIn', 'Unknown'],
    'Channel to use. Unknown is the honest default before any contact.'),

  text('AI Role Assessment', 'ai_role_assessment',
    'Why we believe this person matters, in a sentence. The evidence behind Decision Maker Score.'),

  select('Outreach Eligible', 'outreach_eligible', ['Yes', 'No', 'Needs Review'],
    'Explicit gate before any message is sent. Needs Review rather than Unknown, because this is a decision someone must make, not a fact to discover.'),

  text('Outreach Notes', 'outreach_notes',
    'Constraints and context for outreach — do-not-contact requests, timing, prior history.'),
]

// ---------------------------------------------------------------------------
// DEALS — a league sales opportunity
// ---------------------------------------------------------------------------
export const DEAL_ATTRIBUTES = [
  number('Potential Coach Seats', 'potential_coach_seats',
    'Full league-wide seat count if it rolls out. The deal-size number.'),

  text('Division Pilot', 'division_pilot',
    'Which division or age group the pilot covers, in the league\'s own words.'),

  number('Estimated Pilot Coaches', 'estimated_pilot_coaches',
    'Coaches in the pilot specifically. Distinct from Potential Coach Seats: pilot-to-rollout expansion is the core motion.'),

  text('Target Season', 'target_season',
    'The season being sold into, e.g. "Spring 2027". Free text because seasons are named locally.'),

  text('Pain Identified', 'pain_identified',
    'The problem the league stated, in their words. If this is empty at Discovery Complete, discovery did not happen.'),

  text('Decision Process', 'decision_process',
    'How this league actually decides: board vote, single director, budget cycle. The usual reason league deals stall.'),

  text('Next Step', 'next_step',
    'The single next action. Paired with Next Step Date.'),

  date('Next Step Date', 'next_step_date',
    'When it is due. The one field that makes a pipeline reviewable rather than a list of hopes.'),

  text('Objection', 'objection',
    'The stated blocker. Recorded to spot patterns across lost deals.'),

  date('Pilot Start', 'pilot_start',
    'When the pilot actually begins. Anchors the rollout conversation — the ask lands while coaches are still using it, not months later.'),
  date('Pilot End', 'pilot_end', 'Pilot end date. With Pilot Start, drives the rollout conversation timing.'),
]

// ---------------------------------------------------------------------------
// DEAL STAGES
//
// Safe to reconfigure in this workspace: the audit found ZERO Deal records and
// the four stages present (Lead / In Progress / Won 🎉 / Lost) are the untouched
// Attio default template. There is no other pipeline to damage.
//
// Order matters — Attio renders the kanban in this order.
// ---------------------------------------------------------------------------
export const DEAL_STAGES = [
  'Identified',
  'Researched',
  'Outreach Ready',
  'Outreach Active',
  'Positive Reply',
  'Meeting Scheduled',
  'Discovery Complete',
  'Pilot Proposed',
  'Pilot Active',
  'League Rollout Proposed',
  'Won',
  'Lost / Not Now',
]

// The Attio defaults. Archived only with --archive-default-stages, and only
// when zero Deal records exist. Archiving is reversible in the Attio UI;
// deletion is not, which is why nothing here deletes.
export const DEFAULT_DEAL_STAGES = ['Lead', 'In Progress', 'Won 🎉', 'Lost']

export const OBJECT_PLAN = [
  { object: 'companies', attributes: COMPANY_ATTRIBUTES },
  { object: 'people', attributes: PEOPLE_ATTRIBUTES },
  { object: 'deals', attributes: DEAL_ATTRIBUTES },
]
