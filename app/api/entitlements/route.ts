import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { tierOf, tierConfig, canAdd, isPurchasable, Usage, Tier, TIERS, PAID_TIERS } from '@/lib/tiers'
import { migrationHintFor } from '@/lib/migrationHints'
import { guard } from '@/lib/authz'

// What this coach's plan allows, and what they are using.
//
// One endpoint so the answer is the same everywhere. Counting teams on one
// screen and players on another is how two surfaces end up disagreeing about
// whether somebody can add a kid.

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

export async function GET(request: NextRequest) {
  const denied = await guard(request, 'read')
  if (denied) return denied

  const { searchParams } = new URL(request.url)
  const coachId = searchParams.get('coachId')
  const userId = searchParams.get('userId')

  if (!coachId && !userId) {
    return NextResponse.json({ error: 'coachId or userId required' }, { status: 400 })
  }

  try {
    let q = supabaseAdmin
      .from('coaches')
      .select('id, is_subscribed, subscription_tier')
    q = coachId ? q.eq('id', coachId) : q.eq('user_id', userId!)

    const { data: coach, error } = await q.maybeSingle()
    if (error) throw error
    if (!coach) return NextResponse.json({ error: 'Coach not found' }, { status: 404 })

    const tier = tierOf(coach as any)
    const cfg = tierConfig(tier)

    const { data: teams, error: teamErr } = await supabaseAdmin
      .from('teams')
      .select('id, workspace_kind')
      .eq('coach_id', (coach as any).id)

    if (teamErr) throw teamErr

    const usage: Usage = {
      teams: (teams || []).filter((t: any) => t.workspace_kind !== 'personal').length,
      personalPlayers: (teams || []).filter((t: any) => t.workspace_kind === 'personal').length,
    }

    return NextResponse.json({
      tier,
      label: cfg.label,
      ai: cfg.ai,
      teamFeatures: cfg.teamFeatures,
      limits: { maxTeams: cfg.maxTeams, maxPersonalPlayers: cfg.maxPersonalPlayers },
      usage,
      can: {
        addTeam: canAdd(tier, 'team', usage),
        addPersonalPlayer: canAdd(tier, 'personalPlayer', usage),
      },
      // So the UI never renders a plan card whose button cannot work.
      purchasable: Object.fromEntries(PAID_TIERS.map(t => [t, isPurchasable(t)])) as Record<Tier, boolean>,
      plans: PAID_TIERS.map(t => ({
        id: t,
        label: TIERS[t].label,
        tagline: TIERS[t].tagline,
        audience: TIERS[t].audience,
        features: TIERS[t].features,
        purchasable: isPurchasable(t),
        current: t === tier,
      })),
    })
  } catch (error: any) {
    console.error('Entitlements error:', error)
    const hint = migrationHintFor(error)
    // Never block the app on a billing lookup. An entitlements call that fails
    // should cost the coach an upgrade prompt, not their session — so this
    // degrades to the most permissive answer and says why.
    return NextResponse.json({
      tier: 'team' as Tier,
      label: TIERS.team.label,
      ai: true,
      teamFeatures: true,
      limits: { maxTeams: null, maxPersonalPlayers: null },
      usage: { teams: 0, personalPlayers: 0 },
      can: { addTeam: { allowed: true }, addPersonalPlayer: { allowed: true } },
      purchasable: {},
      plans: [],
      degraded: true,
      needsMigration: !!hint,
      migrationMessage: hint?.message || null,
    })
  }
}
