// Coach language → named problems.
//
// Lifted verbatim out of app/api/prescribe/route.ts, where it was the one part
// of BenchCoach that genuinely understood "he keeps dropping his back shoulder"
// as a thing with a name. Chat had no equivalent and no way to get one without
// building a second, unrelated diagnosis system — which is how two surfaces end
// up disagreeing about what a coach just said.
//
// The behaviour here is unchanged from the prescribe implementation, including
// the two decisions that make it work:
//
//   1. It is allowed to match nothing. Plenty of what coaches ask is a goal
//      ("add velocity", "hit for more power") rather than a flaw, and forcing
//      those onto the nearest slug produces a confident wrong answer. An empty
//      slug list is a valid result and the caller must have a path for it.
//
//   2. When the model call fails it falls back to substring matching against
//      labels and aliases rather than giving up. A degraded diagnosis beats no
//      drills.

import { claude as anthropic } from '@/lib/claudeClient'
import { textFrom } from '@/lib/claudeText'

// Haiku, matching what prescribe used before this was extracted — picking from
// a list and returning JSON is exactly the shape it is good at, and the
// judgement that matters happens later against the drills themselves. Keeping
// the model identical is what makes the extraction a refactor rather than a
// change.
const DIAGNOSE_MODEL = 'claude-haiku-4-5-20251001'

export interface TaxonomyRow {
  slug: string
  label: string
  skill_category: string | null
  description?: string | null
  aliases: string[] | null
  // These three live on problem_taxonomy, NOT on drill_resources — a
  // production export settled that after an earlier audit assumed otherwise.
  // A problem can be developmentally normal at an age; a drill cannot.
  do_not_coach_flag?: boolean | null
  do_not_coach_note?: string | null
  age_relevance?: string[] | null
}

export interface Diagnosis {
  /** 1-3 problem slugs, most relevant first. Empty is a valid answer. */
  slugs: string[]
  /** Skill areas, whether or not a slug matched, so the library is searchable. */
  categories: string[]
  /** How it was reached — 'model', 'aliases' when the model call failed. */
  via: 'model' | 'aliases'
}

/** Everything the taxonomy read needs. Shared so the columns stay in one place. */
export const TAXONOMY_FIELDS =
  'slug, label, skill_category, description, aliases, do_not_coach_flag, ' +
  'do_not_coach_note, age_relevance'

export async function loadTaxonomy(supabase: any): Promise<TaxonomyRow[]> {
  const { data } = await supabase.from('problem_taxonomy').select(TAXONOMY_FIELDS)
  return (data || []) as TaxonomyRow[]
}

/**
 * Read a coach's complaint against the controlled vocabulary.
 *
 * Returns slugs AND categories separately on purpose: a request can fail to
 * name a known flaw while still obviously being about hitting, and that second
 * fact is enough to search the library usefully.
 */
export async function diagnose(
  complaint: string,
  tax: TaxonomyRow[],
): Promise<Diagnosis> {
  const list = tax
    .map(t => `- ${t.slug} (${t.skill_category}): ${t.label}${t.aliases?.length ? ` — e.g. ${t.aliases.slice(0, 6).join(', ')}` : ''}`)
    .join('\n')
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
    const text = textFrom(res)
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
        return { slugs: validSlugs, categories: Array.from(new Set(canonicalCats)), via: 'model' }
      }
    }
  } catch (e) {
    console.warn('Claude diagnosis failed, falling back to alias match:', (e as any)?.message)
  }

  return { ...diagnoseByAlias(complaint, tax), via: 'aliases' }
}

/**
 * The no-model path: substring match against labels and aliases.
 *
 * Exported separately so tests can exercise retrieval end to end without an
 * API key, and so a caller who wants a cheap first pass can take one.
 */
export function diagnoseByAlias(
  complaint: string,
  tax: TaxonomyRow[],
): { slugs: string[]; categories: string[] } {
  // Scoring is the prescribe implementation unchanged — number of matching
  // terms, minimum length 4. Tempting to make it smarter (longest match wins
  // reads better on paper), but this is the fallback path for a failed model
  // call and changing it here would change prescribe's behaviour silently,
  // which is the one thing this extraction must not do.
  const c = complaint.toLowerCase()
  const scored = tax.map(t => {
    const terms = [t.label.toLowerCase(), ...(t.aliases || []).map(a => a.toLowerCase())]
    const score = terms.reduce((s, term) => s + (term.length > 3 && c.includes(term) ? 1 : 0), 0)
    return { slug: t.slug, score }
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score)

  const slugs = scored.slice(0, 3).map(x => x.slug)
  const categories = Array.from(new Set(
    slugs.map(sl => tax.find(t => t.slug === sl)?.skill_category).filter(Boolean)
  )) as string[]
  return { slugs, categories }
}

/**
 * The age caveat attached to a matched problem, when there is one.
 *
 * do_not_coach_flag means the "problem" is developmentally normal at younger
 * ages — a seven-year-old stepping in the bucket is a seven-year-old, not a
 * flaw to drill out. The note is guidance for the answer, never a reason to
 * withhold drills.
 */
export function ageCaveats(
  slugs: string[],
  tax: TaxonomyRow[],
): Array<{ slug: string; label: string; note: string }> {
  const out: Array<{ slug: string; label: string; note: string }> = []
  for (const slug of slugs) {
    const t = tax.find(x => x.slug === slug)
    if (t?.do_not_coach_flag && t.do_not_coach_note) {
      out.push({ slug: t.slug, label: t.label, note: t.do_not_coach_note })
    }
  }
  return out
}
