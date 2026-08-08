// What each plan allows.
//
// One file, because entitlements sprawl the moment they live in two. Every
// limit check, every upgrade prompt and the Stripe price mapping all read from
// here — so changing what a plan includes is one edit, not a hunt.
//
// Prices live in Stripe. This only knows price IDs, so you can change what you
// charge without touching code.

export type Tier = 'free' | 'personal' | 'team'

export interface TierConfig {
  id: Tier
  label: string
  // One line, for the plan card and the upgrade prompt.
  tagline: string
  // Who it's for, in their words rather than ours.
  audience: string
  // null means unlimited. 0 means the feature is not part of this plan.
  maxTeams: number | null
  maxPersonalPlayers: number | null
  // Everything AI-driven: the read, the check-in, the plans, chat. Splitting
  // these across plans would be splitting the product.
  ai: boolean
  // Coaching a roster brings its own surfaces. A parent tracking one kid has
  // no use for a lineup card or an opponent's pitch counts.
  teamFeatures: boolean
  features: string[]
  // Set once the price exists in Stripe. Absent means "not purchasable yet",
  // which the UI has to handle — a plan card with a dead button is worse than
  // one that says it's coming.
  priceEnvVar?: string
}

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    id: 'free',
    label: 'Free',
    tagline: 'What you get when a trial ends.',
    audience: 'Nobody signs up for this — it is where an expired plan lands.',
    // Deliberately not zero. Locking someone out of the kid they have been
    // tracking for a season is how you turn a lapsed card into a lost customer
    // and a support ticket. They keep their history and lose the engine.
    maxTeams: 0,
    maxPersonalPlayers: 1,
    ai: false,
    teamFeatures: false,
    features: [
      'Everything you have already logged stays readable',
      'Log sessions, games and measurements',
      'No new reads, check-ins or plans',
    ],
  },

  personal: {
    id: 'personal',
    label: 'Personal',
    tagline: 'One player, tracked properly.',
    audience: 'A parent working with their own kid.',
    maxTeams: 0,
    maxPersonalPlayers: 1,
    ai: true,
    teamFeatures: false,
    features: [
      'One player',
      'Ask CoachAI anything, any time',
      'A priority with drills, and a read on whether it moved',
      'Three-week development plans',
      'Measurements — exit velo, home to first, anything you define',
      'Log lessons, games and backyard sessions',
    ],
    priceEnvVar: 'STRIPE_PRICE_PERSONAL',
  },

  team: {
    id: 'team',
    label: 'Coach',
    tagline: 'Your teams, plus your own kid.',
    audience: 'Anyone running a roster — and most of them are also a parent.',
    maxTeams: null,
    // The whole reason this is one plan rather than two subscriptions: a travel
    // coach is almost always somebody's dad, and making him pay twice to track
    // his own son is the fastest way to lose him.
    maxPersonalPlayers: null,
    ai: true,
    teamFeatures: true,
    features: [
      'Unlimited teams and players',
      'Everything in Personal, for every player',
      'Practice plans built around what your team actually needs',
      'Lineup builder, game day, pitch counts',
      'Opponent scouting and availability',
    ],
    priceEnvVar: 'STRIPE_PRICE_TEAM',
  },
}

export const PAID_TIERS: Tier[] = ['personal', 'team']

export function isTier(value: unknown): value is Tier {
  return value === 'free' || value === 'personal' || value === 'team'
}

// Anything unrecognised reads as free. That includes 'pro', which is what every
// existing subscriber was written as before there were two plans — migration
// 024 moves those to 'team', so a stray 'pro' here means something went wrong
// and the safe answer is not to hand out team features.
export function tierOf(coach: { subscription_tier?: string | null; is_subscribed?: boolean | null } | null): Tier {
  if (!coach?.is_subscribed) return 'free'
  return isTier(coach.subscription_tier) ? coach.subscription_tier : 'free'
}

export function tierConfig(tier: Tier): TierConfig {
  return TIERS[tier] || TIERS.free
}

// ── Stripe ─────────────────────────────────────────────

export function priceIdFor(tier: Tier): string | null {
  const key = TIERS[tier]?.priceEnvVar
  if (!key) return null
  return process.env[key] || null
}

// Which plan a Stripe subscription belongs to. The webhook used to hardcode
// 'pro' for every subscription, which with two prices would have handed team
// features to everyone who bought Personal.
export function tierForPriceId(priceId: string | null | undefined): Tier | null {
  if (!priceId) return null
  for (const tier of PAID_TIERS) {
    if (process.env[TIERS[tier].priceEnvVar!] === priceId) return tier
  }
  // A price that exists in Stripe but not in the environment. Better to leave
  // the tier alone than to guess and either overcharge or over-grant.
  return null
}

export function isPurchasable(tier: Tier): boolean {
  return !!priceIdFor(tier)
}

// ── Limits ─────────────────────────────────────────────

export interface Usage {
  teams: number
  personalPlayers: number
}

export type LimitKind = 'team' | 'personalPlayer'

export interface LimitCheck {
  allowed: boolean
  // Shown verbatim. Names the limit and the plan that lifts it, because "upgrade
  // to continue" without either is just a wall.
  reason?: string
  upgradeTo?: Tier
}

export function canAdd(tier: Tier, kind: LimitKind, usage: Usage): LimitCheck {
  const cfg = tierConfig(tier)

  if (kind === 'team') {
    const max = cfg.maxTeams
    if (max === null) return { allowed: true }
    if (usage.teams < max) return { allowed: true }
    return {
      allowed: false,
      upgradeTo: 'team',
      reason: tier === 'free'
        ? 'Your plan has ended, so new teams are paused. Your existing teams and everything logged against them are still here.'
        : `The ${cfg.label} plan covers one player rather than a roster. Coach adds teams — and keeps your own player alongside them.`,
    }
  }

  const max = cfg.maxPersonalPlayers
  if (max === null) return { allowed: true }
  if (usage.personalPlayers < max) return { allowed: true }
  return {
    allowed: false,
    upgradeTo: 'team',
    reason: tier === 'free'
      ? 'Your plan has ended. Everything you have logged is still here — you just cannot add another player until it is active again.'
      : `${cfg.label} covers one player. Coach covers as many as you want, plus your teams.`,
  }
}
