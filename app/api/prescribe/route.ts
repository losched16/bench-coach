import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import { assembleCoachContext, renderCoachContext, CoachContext } from '@/lib/coachContext'
import { AnalysisSection, splitSections, ageGuidanceFor, scoreDrillRelevance } from '@/lib/analysis'
import { COACH_VOICE } from '@/lib/coachVoice'

// Service role for server-side reads (bypasses RLS), matching the other API routes.
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
// Diagnosis is a cheap classification. The written analysis is the product —
// it gets the strongest model, because this is the surface people pay for.
const DIAGNOSE_MODEL = 'claude-haiku-4-5-20251001'
const ANALYSIS_MODEL = 'claude-opus-5'

const DIFFICULTY_RANK: Record<string, number> = { Beginner: 1, Intermediate: 2, Advanced: 3 }

interface TaxonomyRow {
  slug: string
  label: string
  skill_category: string | null
  description: string | null
  aliases: string[] | null
  do_not_coach_flag?: boolean | null
  do_not_coach_note?: string | null
  age_relevance?: string[] | null
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
      .select('slug, label, skill_category, description, aliases, do_not_coach_flag, do_not_coach_note, age_relevance')

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
    let coachId: string | null = body.coachId || null
    if (teamId) {
      const { data: team } = await supabaseAdmin
        .from('teams').select('coach_id, season:seasons(league_type)').eq('id', teamId).single()
      if (team) {
        if (!coachId) coachId = (team as any).coach_id
        const lt = (team as any).season?.league_type
        if (!competitionLevel && (lt === 'rec' || lt === 'travel')) competitionLevel = lt
      }
    }

    // 3. Diagnose. The taxonomy is an accelerator, not a gate — plenty of real
    //    questions ("how do I add velocity") are goals rather than catalogued
    //    flaws, and we answer those too. An empty match is not a dead end.
    const { slugs, categories } = await diagnose(complaint, tax)
    const primary = slugs.length > 0 ? (tax.find(t => t.slug === slugs[0]) || null) : null

    // 4. Select candidate drills mapped to those problems.
    const { data: mapRows } = slugs.length > 0
      ? await supabaseAdmin
          .from('drill_problem_map')
          .select('problem_slug, sort_order, curated, drill:drill_resources(*)')
          .in('problem_slug', slugs)
          // Only approved drills reach a prescription; filtered-out joins come
          // back as null and are skipped below
          .or('status.eq.approved,status.is.null', { foreignTable: 'drill' })
      : { data: [] as any[] }

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
    let selected = (curatedSel.length >= 2 ? curatedSel : ordered).slice(0, 4)

    // 4b. Taxonomy came up short — search the library directly against the
    //     coach's own words. This is what makes "how do I add velocity"
    //     answerable even though it is not a catalogued flaw.
    if (selected.length < 2) {
      const already = new Set(selected.map(d => d.id))
      let q = supabaseAdmin
        .from('drill_resources')
        .select('*')
        .or('status.eq.approved,status.is.null')
        .limit(400)
      if (categories.length > 0) q = q.in('skill_category', categories)

      const { data: candidates } = await q

      const scored = (candidates || [])
        .filter((d: any) => !already.has(d.id))
        .filter((d: any) => !(playerAge && d.min_age && d.max_age && (playerAge < d.min_age || playerAge > d.max_age)))
        .filter((d: any) => !(competitionLevel && d.competition_level && d.competition_level !== 'both' && d.competition_level !== competitionLevel))
        .map((d: any) => ({ ...d, _relevance: scoreDrillRelevance(complaint, d) }))
        .filter((d: any) => d._relevance > 0)
        .sort((a: any, b: any) => b._relevance - a._relevance)

      selected = [...selected, ...scored].slice(0, 4)
    }

    // 5. Write the analysis. This is the product — everything above is setup.
    const scope: 'player' | 'team' = playerId ? 'player' : 'team'
    const ctx = await assembleCoachContext(supabaseAdmin, {
      coachId: coachId || '',
      teamId: teamId || null,
      playerId: playerId || null,
    })

    // Age-sensitive problems still get a full plan — this note steers the
    // METHOD toward what actually works at this age, it does not withhold one.
    const ageGuidance = ageGuidanceFor(primary, playerAge)

    const { markdown, sections } = await writeAnalysis(
      complaint, primary, selected, ctx, scope, playerAge, ageGuidance
    )

    const drillPayload = selected.map(d => ({
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
      reps: d.reps_guidance || null,
      frequency: d.frequency_guidance || null,
      success_marker: d.success_markers?.length ? d.success_markers[0] : null,
    }))

    // 6. Persist it. Without a saved prescription there is no return visit,
    //    no reassessment, and no compounding value — the whole retention
    //    argument rests on this row existing.
    let prescriptionId: string | null = null
    if (coachId) {
      const priority = sections.find(x => x.key.startsWith('the_one_thing'))?.body || null
      const successCriteria = sections.find(x => x.key.startsWith('what_to_watch'))?.body || null
      const summary = sections.find(x => x.key.startsWith('what_the_data'))?.body || null

      // A lesson diagnosis in the evidence means this priority came from an
      // instructor, and is exempt from AI override during the hold window.
      const origin = (ctx.lessonDiagnoses?.length || 0) > 0 ? 'instructor' : 'ai'

      const { data: saved, error: saveErr } = await supabaseAdmin
        .from('prescriptions')
        .insert({
          coach_id: coachId,
          scope,
          player_id: scope === 'player' ? playerId : null,
          team_id: teamId || null,
          problem_id: primary?.slug || null,
          origin,
          summary,
          priority,
          success_criteria: successCriteria,
          drill_ids: selected.map(d => d.id),
          sessions: { markdown, sections },
          status: 'active',
        })
        .select('id, review_due_at')
        .single()

      if (!saveErr && saved) prescriptionId = (saved as any).id
    }

    return NextResponse.json({
      diagnosis: primary,
      matchedProblems: slugs.map(s => tax.find(t => t.slug === s)).filter(Boolean),
      analysis: markdown,
      sections,
      drills: drillPayload,
      prescriptionId,
    })
  } catch (error: any) {
    console.error('Prescribe API error:', error)
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// --- diagnosis: semantic match with deterministic alias fallback ------------
async function diagnose(
  complaint: string,
  tax: TaxonomyRow[],
): Promise<{ slugs: string[]; categories: string[] }> {
  const list = tax.map(t => `- ${t.slug} (${t.skill_category}): ${t.label}${t.aliases?.length ? ` — e.g. ${t.aliases.slice(0, 6).join(', ')}` : ''}`).join('\n')
  const allCategories = Array.from(new Set(tax.map(t => t.skill_category).filter(Boolean))) as string[]

  const prompt = `A youth baseball coach describes something they want help with. Two jobs:

1. Match it to the 1-3 most relevant problem slugs, most relevant first. Many requests are goals rather than flaws ("add velocity", "hit for more power") and will not match any slug — that is fine, return an empty array. Do not force a bad match.
2. Name the skill area(s) it belongs to, whether or not a slug matched, so we can search the drill library. Use only values from the category list.

Return ONLY JSON: {"slugs": ["late-timing"], "categories": ["Hitting"]}

COACH SAYS: "${complaint}"

CATEGORIES: ${allCategories.join(', ')}

PROBLEMS:
${list}`

  try {
    const res = await anthropic.messages.create({
      model: DIAGNOSE_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    })
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    const m = text.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0]) as { slugs?: string[]; categories?: string[] }
      const validSlugs = (parsed.slugs || []).filter(x => tax.some(t => t.slug === x)).slice(0, 3)
      const validCats = (parsed.categories || []).filter(c =>
        tax.some(t => (t.skill_category || '').toLowerCase() === String(c).toLowerCase())
      )
      // Normalize category casing back to what the database stores
      const canonicalCats = validCats.map(c =>
        (tax.find(t => (t.skill_category || '').toLowerCase() === String(c).toLowerCase())?.skill_category) || c
      )
      if (validSlugs.length || canonicalCats.length) {
        return { slugs: validSlugs, categories: Array.from(new Set(canonicalCats)) }
      }
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
  const fallbackSlugs = scored.slice(0, 3).map(x => x.slug)
  const fallbackCats = Array.from(new Set(
    fallbackSlugs.map(sl => tax.find(t => t.slug === sl)?.skill_category).filter(Boolean)
  )) as string[]
  return { slugs: fallbackSlugs, categories: fallbackCats }
}


// ---------------------------------------------------------------------------
// The written analysis — this is the product.
//
// The previous version asked Claude to fill in a JSON object of one-sentence
// fields. That is the single biggest reason API output reads worse than a
// conversation: a model populating a schema writes fragments, not coaching.
// This asks it to WRITE, gives it everything we know, and parses the sections
// out afterwards for layout.
// ---------------------------------------------------------------------------

// The persona and depth standard live in lib/coachVoice.ts so Chat and this
// surface cannot drift apart. Only the output contract is specific to here.
const ANALYSIS_SYSTEM = `${COACH_VOICE}

THE OUTPUT CONTRACT

Every recommendation names a specific observable, a specific fix, and a specific way to know it worked. If you cannot supply all three, you do not have a recommendation yet — say what you would need to see.

ONE PRIORITY. Not a list. Youth players improve on one thing at a time over four to six weeks. If you name three things, none of them get done well. Anything else you noticed goes in a single "also noticed, not working on yet" line — visible, but not competing for attention.`

async function writeAnalysis(
  complaint: string,
  problem: TaxonomyRow | null,
  drills: any[],
  ctx: CoachContext,
  scope: 'player' | 'team',
  playerAge?: number,
  ageGuidance?: string | null,
): Promise<{ markdown: string; sections: AnalysisSection[] }> {
  const drillList = drills.length === 0
    ? '(none — our video library has nothing matching this yet)'
    : drills.map((d, i) =>
    `[${i + 1}] "${d.drill_name}" (${d.skill_category}${d.difficulty_level ? `, ${d.difficulty_level}` : ''})\n` +
    `    What it is: ${d.description || 'no description on file'}\n` +
    `    Coaching cues on file: ${d.ai_coaching_notes || 'none'}` +
    (d.equipment_needed?.length ? `\n    Equipment: ${d.equipment_needed.join(', ')}` : '') +
    (d.reps_guidance ? `\n    Suggested dose: ${d.reps_guidance}` : '')
  ).join('\n\n')

  const hasMetrics = false // player_metrics wiring lands with Build 4

  const prompt = `A coach came to you with this, in their words:

"${complaint}"

${problem
  ? `This maps to a known problem in our library: **${problem.label}**${problem.description ? ` — ${problem.description}` : ''}`
  : 'This does not map to a catalogued flaw in our library — it is likely a goal or a broader ask rather than a single mechanical fault. That is normal and it does not change your job: answer it properly from your own coaching knowledge. Do not mention the library, the taxonomy, or matching.'}

EVERYTHING WE KNOW ABOUT ${scope === 'team' ? 'THIS TEAM' : 'THIS PLAYER'}:

${renderCoachContext(ctx)}

${ageGuidance ? `HOW THIS PROBLEM WORKS AT THIS AGE (${playerAge}) — this changes your METHOD, not whether you help:

${ageGuidance}

Use that. Do NOT tell the coach to leave it alone or that it will resolve on its own — they asked for a fix and they will go find a worse one elsewhere if you decline. Give them the age-appropriate version of the fix, and be honest about what a realistic three-week change looks like at this age.

` : ''}DRILLS AVAILABLE FOR THIS PROBLEM (already filtered for age and level — use these, and only these, by name):

${drillList}

---

Write your read. Use exactly these six H2 headings, in this order, and nothing outside them:

## What the data showed
Two to four sentences. Explicitly separate signal from noise — name what is real and what is small-sample or circumstantial. If the coach's own notes contradict the stats, say so and say which you believe. If there is genuinely almost no data, say that plainly rather than padding.

## The one thing
A single priority, stated concretely enough that the coach could point at it during a game. Not "work on hitting" — name the observable. One or two sentences on why this one and not the other things you could have picked. If you noticed something else worth flagging, end with a single line: "Also noticed, not working on yet: ___".

## This week
(Every cue you give here must be a named position or movement the coach can see and correct — "hinge into the back hip and hold it a beat" not "get in a good position". If you write a cue a parent could have guessed, replace it.)
${scope === 'team'
  ? 'One practice block — how long, what it looks like, and how to run it with the whole roster rotating rather than nine kids standing around watching one.'
  : 'Two home sessions of 15–20 minutes each. Say what happens in each one, concretely enough to run without watching a video first. Then one line the parent can hand the team coach — one sentence, something a volunteer can act on in a normal practice.'}

## Drills
${drills.length === 0
  ? `We have no video in our library for this one. Say so in one short sentence — plainly, no apology — and then describe two or three drills yourself: the setup, what the player does, the dose, and what the coach watches for. The absence of a video is not a reason to give a thinner answer.`
  : drills.length < 2
    ? `We only have ${drills.length} matching video. Use it, and describe one or two more drills yourself to complete the plan — setup, dose, what to watch for — noting briefly that those don't have video yet.`
    : `Two or three of the drills listed above, by their exact names. For each: one line on why THIS drill for THIS problem — the mechanism, not a restatement of the drill name. Then the dose (sets/reps/frequency). If one of them only makes sense after another is working, say so and order them.`}

## What to watch next
The success criteria, stated in advance, in terms the coach can actually observe in a game or a session. Specific enough to be wrong: "more balls to the right side" beats "better contact". Give it a timeframe of about three weeks, and say what "no change" would look like so they can tell the difference between not working and not enough time yet.

${hasMetrics ? '## Metrics\nWhat the logged measurements show as a trend. Never celebrate a single-session jump.' : '(Omit the Metrics section entirely — nothing is logged.)'}

Write it now. No preamble, no sign-off, no "I hope this helps".`

  const res = await anthropic.messages.create({
    model: ANALYSIS_MODEL,
    max_tokens: 8000,
    system: ANALYSIS_SYSTEM,
    messages: [{ role: 'user', content: prompt }],
  })

  if ((res.stop_reason as string) === 'refusal') {
    throw new Error('The analysis could not be generated for this request.')
  }

  const textBlock = res.content.find(b => b.type === 'text')
  const markdown = textBlock && textBlock.type === 'text' ? textBlock.text.trim() : ''
  return { markdown, sections: splitSections(markdown) }
}

