// Phase 2H — does production hold EXACTLY the drills the fixture describes?
//
//   npm run verify:speed-drills
//
// Read-only. Compares every field of every new movement drill against
// scripts/fixtures/speed-agility.ts, character for character.
//
// WHY THIS EXISTS
//
// Migration 074 is 82KB, most of it curated coaching prose, and the tool used
// to apply it to production takes SQL as an argument rather than a file path.
// Anything retyped can drift, and a drifted drill description is the worst kind
// of error: permanent, invisible, and sitting in front of a coach.
//
// So this closes the loop. The fixture is the source of truth; production has
// to match it or this fails and names the drill and the field.

import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { NEW_DRILLS, NewDrillSpec } from './fixtures/speed-agility'

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

// Must match the emitter exactly, or every id mismatches.
const NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
function uuidv5(name: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex')
  const h = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest()
  h[6] = (h[6] & 0x0f) | 0x50
  h[8] = (h[8] & 0x3f) | 0x80
  const s = h.subarray(0, 16).toString('hex')
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`
}

const arrEq = (a: any, b: string[] | undefined) =>
  JSON.stringify((a || []).map(String)) === JSON.stringify(b || [])

async function main() {
  if (!URL || !KEY) { console.error('Set the Supabase env vars.'); process.exit(1) }
  const sb = createClient(URL, KEY)

  const ids = NEW_DRILLS.map(d => uuidv5(d.name))
  const { data, error } = await sb.from('drill_resources').select('*').in('id', ids)
  if (error) { console.error(error.message); process.exit(1) }
  const rows = new Map((data || []).map((r: any) => [r.id, r]))

  let failures = 0
  let missing = 0
  const report = (drill: string, field: string, want: any, got: any) => {
    failures++
    console.log(`  MISMATCH  ${drill}`)
    console.log(`            field: ${field}`)
    console.log(`            fixture:    ${JSON.stringify(want).slice(0, 120)}`)
    console.log(`            production: ${JSON.stringify(got).slice(0, 120)}`)
  }

  console.log(`\nComparing ${NEW_DRILLS.length} movement drills against the fixture\n`)

  for (const d of NEW_DRILLS as NewDrillSpec[]) {
    const id = uuidv5(d.name)
    const r = rows.get(id)
    if (!r) {
      missing++
      console.log(`  MISSING   ${d.name}  (${id})`)
      continue
    }

    // The long prose fields, where a retyping error would actually hide.
    if (r.drill_name !== d.name) report(d.name, 'drill_name', d.name, r.drill_name)
    if (r.description !== d.description) report(d.name, 'description', d.description, r.description)
    if (r.ai_coaching_notes !== d.coachingNotes) report(d.name, 'ai_coaching_notes', d.coachingNotes, r.ai_coaching_notes)
    if ((r.safety_notes ?? null) !== (d.safetyNotes ?? null)) report(d.name, 'safety_notes', d.safetyNotes ?? null, r.safety_notes)
    if (r.reps_guidance !== d.repsGuidance) report(d.name, 'reps_guidance', d.repsGuidance, r.reps_guidance)
    if (r.regression_notes !== d.regression) report(d.name, 'regression_notes', d.regression, r.regression_notes)
    if (r.progression_notes !== d.progression) report(d.name, 'progression_notes', d.progression, r.progression_notes)

    // Arrays.
    if (!arrEq(r.success_markers, d.successMarkers)) report(d.name, 'success_markers', d.successMarkers, r.success_markers)
    if (!arrEq(r.mechanic_focus, d.mechanicFocus)) report(d.name, 'mechanic_focus', d.mechanicFocus, r.mechanic_focus)
    if (!arrEq(r.common_flaws_fixed, d.commonFlaws)) report(d.name, 'common_flaws_fixed', d.commonFlaws, r.common_flaws_fixed)
    if (!arrEq(r.tags, d.tags)) report(d.name, 'tags', d.tags, r.tags)
    if (!arrEq(r.equipment_needed, d.equipment)) report(d.name, 'equipment_needed', d.equipment, r.equipment_needed)
    if (!arrEq(r.practice_roles, d.practiceRoles)) report(d.name, 'practice_roles', d.practiceRoles, r.practice_roles)

    // Scalars that change behaviour if wrong.
    const scalars: Array<[string, any, any]> = [
      ['skill_category', d.skillCategory, r.skill_category],
      ['primary_skill', d.primarySkill, r.primary_skill],
      ['secondary_skill', d.secondarySkill, r.secondary_skill],
      ['min_age', d.minAge, r.min_age],
      ['max_age', d.maxAge, r.max_age],
      ['difficulty_level', d.difficulty, r.difficulty_level],
      ['progression_level', d.progressionLevel, r.progression_level],
      ['indoor_outdoor', d.indoorOutdoor, r.indoor_outdoor],
      ['space_required', d.space, r.space_required],
      ['requires_partner', d.requiresPartner, r.requires_partner],
      ['est_duration_minutes', d.minutes, r.est_duration_minutes],
      ['activity_format', d.activityFormat, r.activity_format],
      ['min_players', d.minPlayers, r.min_players],
      ['ideal_group_size', d.idealGroupSize, r.ideal_group_size],
      ['min_coaches', d.minCoaches, r.min_coaches],
      ['station_friendly', d.stationFriendly, r.station_friendly],
      ['rep_density', d.repDensity, r.rep_density],
      ['idle_time_risk', d.idleRisk, r.idle_time_risk],
      ['engagement_level', d.engagement, r.engagement_level],
      ['competition_style', d.competitionStyle, r.competition_style],
      ['instruction_complexity', d.instructionComplexity, r.instruction_complexity],
      ['physical_intensity', d.physicalIntensity, r.physical_intensity],
      ['mixed_skill_friendly', d.mixedSkillFriendly, r.mixed_skill_friendly],
      // Fixed for every row, and each one matters: a young arm takes no
      // throwing load from movement work, and a row that is not 'activity'
      // + 'approved' never reaches a coach.
      ['throwing_load', 'none', r.throwing_load],
      ['resource_kind', 'activity', r.resource_kind],
      ['status', 'approved', r.status],
      ['source', 'benchcoach_original', r.source],
      ['created_by_coach_id', null, r.created_by_coach_id],
      ['competition_level', 'both', r.competition_level],
      ['age_range', `${d.minAge}-${d.maxAge}`, r.age_range],
    ]
    for (const [field, want, got] of scalars) {
      if (want !== got) report(d.name, field, want, got)
    }
  }

  console.log('')
  if (missing) console.log(`${missing} drill(s) not in production at all — migration 074 is not fully applied.`)
  if (failures) {
    console.log(`FAIL — ${failures} field(s) do not match the fixture.\n`)
    process.exit(1)
  }
  if (missing) { console.log('FAIL — incomplete.\n'); process.exit(1) }

  console.log(`PASS — all ${NEW_DRILLS.length} drills match the fixture exactly.\n`)
}

main()
