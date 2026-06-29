import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

// Service role for server-side reads (bypasses RLS), matching the other API routes.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
// Fast/cheap model for the diagnosis classification; stronger model for the plan prose.
const DIAGNOSE_MODEL = 'claude-haiku-4-5-20251001'
const PLAN_MODEL = 'claude-sonnet-4-6'

const DIFFICULTY_RANK: Record<string, number> = { Beginner: 1, Intermediate: 2, Advanced: 3 }

interface TaxonomyRow {
  slug: string
  label: string
  skill_category: string | null
  description: string | null
  aliases: string[] | null
}

// ---------------------------------------------------------------------------
// GET — returns the problem taxonomy for the quick-pick chips on the UI.
// ---------------------------------------------------------------------------
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('problem_taxonomy')
    .select('slug, label, skill_category')
    .order('skill_category')
    .order('label')

  if (error) {
    // Table not created yet — tell the UI so it can prompt to apply migrations.
    return NextResponse.json({ problems: [], needsMigration: true })
  }
  return NextResponse.json({ problems: data || [] })
}

// ---------------------------------------------------------------------------
// POST — diagnose a plain-English complaint and return a sequenced drill plan.
//   body: { complaint, teamId?, playerId?, playerAge?, competitionLevel? }
// ---------------------------------------------------------------------------
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { complaint, teamId, playerId } = body
    let { playerAge, competitionLevel } = body

    if (!complaint || typeof complaint !== 'string' || !complaint.trim()) {
      return NextResponse.json({ error: 'Please describe what the player is struggling with.' }, { status: 400 })
    }
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: 'API key not configured' }, { status: 500 })
    }

    // 1. Load the controlled vocabulary. Without it there is no engine.
    const { data: taxonomy, error: taxErr } = await supabaseAdmin
      .from('problem_taxonomy')
      .select('slug, label, skill_category, description, aliases')

    if (taxErr || !taxonomy || taxonomy.length === 0) {
      return NextResponse.json({
        needsMigration: true,
        error: 'The prescription tables are not set up yet. Apply the migrations in /migrations, then try again.',
      }, { status: 503 })
    }
    const tax = taxonomy as TaxonomyRow[]

    // 2. Optionally enrich with player context from the workspace (age + level).
    if (playerId) {
      const { data: player } = await supabaseAdmin
        .from('players').select('birth_year').eq('id', playerId).single()
      if (player?.birth_year && !playerAge) {
        playerAge = new Date().getFullYear() - player.birth_year
      }
    }
    if (teamId && !competitionLevel) {
      const { data: team } = await supabaseAdmin
        .from('teams').select('season:seasons(league_type)').eq('id', teamId).single()
      const lt = (team?.season as any)?.league_type
      if (lt === 'rec' || lt === 'travel') competitionLevel = lt
    }

    // 3. Diagnose: map the complaint -> 1-3 ranked problem slugs (semantic via Claude).
    const slugs = await diagnose(complaint, tax)
    if (slugs.length === 0) {
      return NextResponse.json({
        diagnosis: null,
        drills: [],
        message: "I couldn't match that to a known problem yet. Try describing the specific skill (hitting, throwing, fielding, pitching, baserunning).",
      })
    }
    const primary = tax.find(t => t.slug === slugs[0]) || null

    // 4. Select candidate drills mapped to those problems.
    const { data: mapRows } = await supabaseAdmin
      .from('drill_problem_map')
      .select('problem_slug, sort_order, curated, drill:drill_resources(*)')
      .in('problem_slug', slugs)

    // Flatten + dedupe drills (a drill may fix several of the matched problems).
    const byId = new Map<string, any>()
    for (const row of (mapRows || [])) {
      const drill = Array.isArray(row.drill) ? row.drill[0] : row.drill
      if (!drill) continue
      // age filter (only when both bounds + a player age are known)
      if (playerAge && drill.min_age && drill.max_age && (playerAge < drill.min_age || playerAge > drill.max_age)) continue
      // competition-level filter (drill scoped to the other level only)
      if (competitionLevel && drill.competition_level && drill.competition_level !== 'both' && drill.competition_level !== competitionLevel) continue
      const existing = byId.get(drill.id)
      const score = (row.curated ? 0 : 1000) + (row.sort_order ?? 100)
      if (!existing || score < existing._score) {
        byId.set(drill.id, { ...drill, _score: score, _curated: row.curated })
      }
    }

    // Order: curated first, then sort_order, then progression (nulls last), then difficulty.
    const ordered = Array.from(byId.values()).sort((a, b) => {
      if (a._curated !== b._curated) return a._curated ? -1 : 1
      const ap = a.progression_level ?? 99, bp = b.progression_level ?? 99
      if (ap !== bp) return ap - bp
      return (DIFFICULTY_RANK[a.difficulty_level] ?? 99) - (DIFFICULTY_RANK[b.difficulty_level] ?? 99)
    })

    // If the problem has a curated sequence, show only the curated drills (clean,
    // verified plan). Otherwise fall back to the best auto-mapped drills.
    const curatedSel = ordered.filter(d => d._curated)
    const selected = (curatedSel.length >= 2 ? curatedSel : ordered).slice(0, 4)
    if (selected.length === 0) {
      return NextResponse.json({
        diagnosis: primary,
        matchedProblems: slugs.map(s => tax.find(t => t.slug === s)).filter(Boolean),
        drills: [],
        message: `Diagnosed as "${primary?.label}", but no drills match this player's age/level filters yet.`,
      })
    }

    // 5. Wrap the selected drills into a coaching plan (why / reps / success marker).
    const plan = await buildPlan(complaint, primary, selected, playerAge, competitionLevel)

    return NextResponse.json({
      diagnosis: primary,
      matchedProblems: slugs.map(s => tax.find(t => t.slug === s)).filter(Boolean),
      summary: plan.summary,
      reassess: plan.reassess,
      drills: selected.map((d, i) => {
        const p = plan.drills[i] || {}
        return {
          id: d.id,
          drill_name: d.drill_name,
          description: d.description,
          youtube_video_id: d.youtube_video_id,
          youtube_url: d.youtube_url,
          thumbnail_url: d.thumbnail_url,
          channel: d.channel,
          skill_category: d.skill_category,
          difficulty_level: d.difficulty_level,
          equipment_needed: d.equipment_needed,
          ai_coaching_notes: d.ai_coaching_notes,
          // prefer real DB values, fall back to the AI-generated wrapper
          why: p.why || null,
          reps: d.reps_guidance || p.reps || null,
          frequency: d.frequency_guidance || p.frequency || null,
          success_marker: (d.success_markers && d.success_markers.length ? d.success_markers[0] : null) || p.success_marker || null,
        }
      }),
    })
  } catch (error: any) {
    console.error('Prescribe API error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// --- diagnosis: semantic match with deterministic alias fallback ------------
async function diagnose(complaint: string, tax: TaxonomyRow[]): Promise<string[]> {
  const list = tax.map(t => `- ${t.slug} (${t.skill_category}): ${t.label}${t.aliases?.length ? ` — e.g. ${t.aliases.slice(0, 6).join(', ')}` : ''}`).join('\n')
  const prompt = `A youth baseball coach describes a problem. Match it to the 1-3 most relevant problem slugs from the list. Return ONLY a JSON array of slugs, most relevant first, e.g. ["late-timing"]. If nothing fits, return [].

COACH SAYS: "${complaint}"

PROBLEMS:
${list}`

  try {
    const res = await anthropic.messages.create({
      model: DIAGNOSE_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    const m = text.match(/\[[\s\S]*\]/)
    if (m) {
      const arr = JSON.parse(m[0]) as string[]
      const valid = arr.filter(s => tax.some(t => t.slug === s))
      if (valid.length) return valid.slice(0, 3)
    }
  } catch (e) {
    console.warn('Claude diagnosis failed, falling back to alias match:', (e as any)?.message)
  }

  // Fallback: substring match of complaint against aliases/labels.
  const c = complaint.toLowerCase()
  const scored = tax.map(t => {
    const terms = [t.label.toLowerCase(), ...(t.aliases || []).map(a => a.toLowerCase())]
    const score = terms.reduce((s, term) => s + (term.length > 3 && c.includes(term) ? 1 : 0), 0)
    return { slug: t.slug, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score)
  return scored.slice(0, 3).map(x => x.slug)
}

// --- plan wrapper: why / reps / success marker per drill --------------------
async function buildPlan(
  complaint: string,
  problem: TaxonomyRow | null,
  drills: any[],
  playerAge?: number,
  competitionLevel?: string,
): Promise<{ summary: string; reassess: string; drills: Array<{ why?: string; reps?: string; frequency?: string; success_marker?: string }> }> {
  const drillList = drills.map((d, i) =>
    `[${i}] "${d.drill_name}" (${d.skill_category}, ${d.difficulty_level || 'any level'}). ${d.description || ''} Coaching cues: ${d.ai_coaching_notes || 'none'}`
  ).join('\n')

  const prompt = `You are a youth baseball coach building a focused, sequenced fix for one problem. Keep it simple enough for a volunteer parent-coach to run.

PROBLEM: ${problem?.label || complaint}
COACH'S WORDS: "${complaint}"
${playerAge ? `PLAYER AGE: ${playerAge}` : ''}${competitionLevel ? ` | LEVEL: ${competitionLevel}` : ''}

DRILLS (already chosen, in order, foundational first):
${drillList}

Return ONLY JSON in this shape:
{
  "summary": "1-2 sentences: the plan and why these drills, in order.",
  "reassess": "When/how to check progress, e.g. 'Re-check in 2 weeks — have them face faster tosses and see if contact is on time.'",
  "drills": [
    { "why": "One sentence: why this drill fixes the problem.", "reps": "Concrete dose, e.g. '3 sets of 10'.", "frequency": "e.g. '2-3x/week'.", "success_marker": "Observable sign it's working." }
  ]
}
The "drills" array MUST have exactly ${drills.length} items, in the same order.`

  try {
    const res = await anthropic.messages.create({
      model: PLAN_MODEL,
      max_tokens: 2000,
      system: 'You are a veteran youth baseball coach. Return only valid JSON. No markdown, no prose outside the JSON.',
      messages: [{ role: 'user', content: prompt }],
    })
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0])
      return {
        summary: parsed.summary || '',
        reassess: parsed.reassess || '',
        drills: Array.isArray(parsed.drills) ? parsed.drills : [],
      }
    }
  } catch (e) {
    console.warn('Claude plan wrapper failed:', (e as any)?.message)
  }
  return { summary: '', reassess: '', drills: [] }
}
