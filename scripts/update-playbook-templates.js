/**
 * Update Playbook Templates with Detailed Content + YouTube Videos
 *
 * This script enriches each playbook template's session activities with:
 * - detailed_instructions (step-by-step)
 * - common_mistakes (array)
 * - drill_variations
 * - success_indicators (array)
 * - youtube_video_id, youtube_channel, drill_name (from drill library)
 *
 * Uses Claude AI to generate the enriched content while matching drill videos.
 * Run: node scripts/update-playbook-templates.js
 */

const { createClient } = require('@supabase/supabase-js');
const Anthropic = require('@anthropic-ai/sdk').default;

const supabase = createClient(
  'https://chdpqsumqospnaztvfqe.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNoZHBxc3VtcW9zcG5henR2ZnFlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTA1NjM4MiwiZXhwIjoyMDg0NjMyMzgyfQ.4XUgYeQ8PCTfSDoFBzkpXoPDx8dbMmrTpSrohaP9-wk'
);

const anthropic = new Anthropic();

async function main() {
  console.log('Loading drill resources...');
  const { data: drills } = await supabase
    .from('drill_resources')
    .select('drill_name, skill_category, youtube_video_id, channel, description, age_range, difficulty_level');

  console.log(`Loaded ${drills.length} drill resources`);

  const drillLibrary = drills.map(d =>
    `- "${d.drill_name}" (${d.skill_category}, ${d.difficulty_level || 'all'}, Ages: ${d.age_range || 'all'}) youtube_video_id="${d.youtube_video_id}" channel="${d.channel}"`
  ).join('\n');

  console.log('Loading playbook templates...');
  const { data: templates } = await supabase
    .from('playbook_templates')
    .select('*');

  console.log(`Found ${templates.length} playbook templates to update`);

  for (const template of templates) {
    console.log(`\nProcessing: ${template.title} (${template.age_group})`);

    const sessions = template.sessions?.sessions || template.sessions;
    if (!Array.isArray(sessions)) {
      console.log('  Skipping - no sessions array found');
      continue;
    }

    // Process sessions in batches of 3 to avoid rate limits
    const batchSize = 3;
    const updatedSessions = [];

    for (let i = 0; i < sessions.length; i += batchSize) {
      const batch = sessions.slice(i, i + batchSize);
      console.log(`  Processing sessions ${i + 1}-${Math.min(i + batchSize, sessions.length)} of ${sessions.length}...`);

      const batchResults = await Promise.all(
        batch.map(session => enrichSession(session, template, drillLibrary))
      );

      updatedSessions.push(...batchResults);

      // Small delay between batches
      if (i + batchSize < sessions.length) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    // Update the template in Supabase
    const updatedSessionsData = template.sessions?.sessions
      ? { ...template.sessions, sessions: updatedSessions }
      : updatedSessions;

    const { error } = await supabase
      .from('playbook_templates')
      .update({ sessions: updatedSessionsData })
      .eq('id', template.id);

    if (error) {
      console.log(`  ERROR updating: ${error.message}`);
    } else {
      console.log(`  ✅ Updated ${updatedSessions.length} sessions`);
    }
  }

  console.log('\n✅ All playbook templates updated!');
}

async function enrichSession(session, template, drillLibrary) {
  const activitiesJSON = JSON.stringify(session.activities, null, 2);

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

Return ONLY the JSON array. No text before or after.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: 'You are a veteran youth baseball coaching expert. Return only valid JSON arrays. No markdown, no explanations.',
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = content.match(/\[[\s\S]*\]/);

    if (jsonMatch) {
      const enrichedActivities = JSON.parse(jsonMatch[0]);
      return { ...session, activities: enrichedActivities };
    }
  } catch (error) {
    console.log(`    Error enriching session ${session.day}: ${error.message}`);
  }

  // Return original session if enrichment fails
  return session;
}

main().catch(console.error);
