#!/usr/bin/env node
/**
 * Enrich playbook template sessions with detailed instructions + drill videos.
 *
 * For each activity in each template's sessions, Claude adds
 * detailed_instructions, common_mistakes, drill_variations,
 * success_indicators, equipment, and — where a real match exists — the
 * youtube_video_id / channel / drill_name from the drill library.
 *
 *   npm run enrich:playbooks -- --dry-run     # generate, write nothing
 *   npm run enrich:playbooks                  # generate and save
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 *
 * This script used to open with a hardcoded production Supabase URL and a
 * hardcoded production service_role key, then run .update() on
 * playbook_templates. There was no environment variable that could redirect
 * it: running it at all meant rewriting live rows, and the credential was
 * committed to the repository. It now reads its credentials from the
 * environment and goes through scripts/lib/env-guard.mjs, which prints the
 * target and refuses production unless the caller names the project.
 *
 * Removing the literal does NOT undo the exposure — the value is still in git
 * history and the key is still live. See docs/audits/security-secret-followup.md;
 * rotation is the only remedy and remains outstanding.
 *
 * A note on --dry-run: this is a generative script whose output is prose a
 * coach will read, and it overwrites a JSON column wholesale. Being able to
 * look at what it produced before it lands is worth the extra flag.
 */

import { writeFileSync } from 'node:fs'
import Anthropic from '@anthropic-ai/sdk'
import { serviceClient } from './lib/env-guard.mjs'

const DRY_RUN = process.argv.includes('--dry-run')

const { db: supabase } = await serviceClient({
  script: 'update-playbook-templates',
  writes: !DRY_RUN,
  what: 'rewrites the sessions column of every row in playbook_templates',
})

const anthropic = new Anthropic()

async function main() {
  console.log('Loading drill resources...')
  const { data: drills, error: drillErr } = await supabase
    .from('drill_resources')
    .select('drill_name, skill_category, youtube_video_id, channel, description, age_range, difficulty_level')

  if (drillErr) throw new Error(`could not read drill_resources: ${drillErr.message}`)
  if (!drills?.length) throw new Error('drill_resources is empty — refusing to enrich against no library')

  console.log(`Loaded ${drills.length} drill resources`)

  const drillLibrary = drills.map(d =>
    `- "${d.drill_name}" (${d.skill_category}, ${d.difficulty_level || 'all'}, Ages: ${d.age_range || 'all'}) youtube_video_id="${d.youtube_video_id}" channel="${d.channel}"`
  ).join('\n')

  console.log('Loading playbook templates...')
  const { data: templates, error: tplErr } = await supabase
    .from('playbook_templates')
    .select('*')

  if (tplErr) throw new Error(`could not read playbook_templates: ${tplErr.message}`)
  console.log(`Found ${templates.length} playbook templates to update`)

  const preview = []

  for (const template of templates) {
    console.log(`\nProcessing: ${template.title} (${template.age_group})`)

    const sessions = template.sessions?.sessions || template.sessions
    if (!Array.isArray(sessions)) {
      console.log('  Skipping - no sessions array found')
      continue
    }

    // Process sessions in batches of 3 to avoid rate limits
    const batchSize = 3
    const updatedSessions = []

    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize)
      console.log(`  Processing sessions ${i + 1}-${Math.min(i + batchSize, sessions.length)} of ${sessions.length}...`)

      const batchResults = await Promise.all(
        batch.map(session => enrichSession(session, template, drillLibrary))
      )

      updatedSessions.push(...batchResults)

      if (i + batchSize < sessions.length) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    const updatedSessionsData = template.sessions?.sessions
      ? { ...template.sessions, sessions: updatedSessions }
      : updatedSessions

    if (DRY_RUN) {
      preview.push({ id: template.id, title: template.title, sessions: updatedSessionsData })
      console.log(`  (dry run) ${updatedSessions.length} sessions enriched, not saved`)
      continue
    }

    const { error } = await supabase
      .from('playbook_templates')
      .update({ sessions: updatedSessionsData })
      .eq('id', template.id)

    if (error) {
      console.log(`  ERROR updating: ${error.message}`)
    } else {
      console.log(`  ✅ Updated ${updatedSessions.length} sessions`)
    }
  }

  if (DRY_RUN) {
    const out = 'playbook-enrichment-preview.json'
    writeFileSync(out, JSON.stringify(preview, null, 2))
    console.log(`\nDry run complete. ${preview.length} templates written to ${out}. Nothing was saved.`)
    return
  }

  console.log('\n✅ All playbook templates updated!')
}

async function enrichSession(session, template, drillLibrary) {
  const activitiesJSON = JSON.stringify(session.activities, null, 2)

  const prompt = `I have a youth baseball playbook session that needs to be enriched with more detail. The playbook is "${template.title}" for age group ${template.age_group}, skill category: ${template.skill_category}.

SESSION:
- Day ${session.day}: "${session.title}"
- Phase: ${session.phase}
- Goal: ${session.goal}

CURRENT ACTIVITIES:
${activitiesJSON}

DRILL VIDEO LIBRARY (match activities to these when relevant):
${drillLibrary}

For EACH activity, ADD these fields while keeping all existing fields:
1. "detailed_instructions" — Expand the existing "instructions" into 5-10 numbered steps with EXACT distances, reps, timing, and setup details. Make it so detailed that a parent who has never coached could run this drill perfectly.
2. "common_mistakes" — Array of 2-4 strings, each in format "Mistake description — How to fix it"
3. "drill_variations" — One string: "Easier: ... Harder: ..."
4. "success_indicators" — Array of 2-3 observable success signs
5. "equipment" — Array of equipment needed for this specific activity
6. If a drill from the DRILL VIDEO LIBRARY matches this activity, add:
   - "youtube_video_id": exact ID from library
   - "youtube_channel": exact channel name from library
   - "drill_name": exact drill name from library
   Only match if the drill is genuinely relevant. Don't force a match.

Return the COMPLETE activities array as valid JSON. Keep ALL existing fields (name, duration, reps, setup, instructions, coaching_cues, success_indicator) and ADD the new ones.

Return ONLY the JSON array. No text before or after.`

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-5',
      max_tokens: 8000,
      system: 'You are a veteran youth baseball coaching expert. Return only valid JSON arrays. No markdown, no explanations.',
      messages: [{ role: 'user', content: prompt }],
    })

    const content = response.content[0].type === 'text' ? response.content[0].text : ''
    const jsonMatch = content.match(/\[[\s\S]*\]/)

    if (jsonMatch) {
      const enrichedActivities = JSON.parse(jsonMatch[0])
      return { ...session, activities: enrichedActivities }
    }
  } catch (error) {
    console.log(`    Error enriching session ${session.day}: ${error.message}`)
  }

  // Return the original session if enrichment fails. Losing the detail is
  // recoverable; replacing a real session with a half-parsed one is not.
  return session
}

main().catch(err => { console.error(err); process.exit(1) })
