// Read the live Attio schema and diff it against schema.mjs.
//
// Read-only. No POST, no PATCH, nothing. Safe to run against any workspace at
// any time, and the right first move before apply.
//
//   node audit.mjs           human-readable
//   node audit.mjs --json    machine-readable, for diffing runs over time

import { Attio, preflight, bySlug, tokenFromEnv, tokenFingerprint, AttioError } from './attio.mjs'
import {
  OBJECT_PLAN, REUSED, OMITTED, DEAL_STAGES, DEFAULT_DEAL_STAGES, EXPECTED_OBJECTS, WORKSPACE,
} from './schema.mjs'

const JSON_OUT = process.argv.includes('--json')

/**
 * What is missing, what already exists, and what is present but unplanned.
 *
 * The third category matters: an attribute in Attio that this schema does not
 * define is either something a human added by hand or a leftover, and either
 * way it should be visible rather than silently ignored. Nothing is ever
 * deleted on its account — it is only reported.
 */
export function diffAttributes(live, desired) {
  const liveBySlug = bySlug(live)
  const missing = []
  const existing = []
  const mismatched = []

  for (const spec of desired) {
    const found = liveBySlug.get(spec.api_slug)
    if (!found) { missing.push(spec); continue }
    existing.push({ spec, live: found })
    // Type drift is reported, never auto-corrected: changing an attribute's
    // type in Attio can destroy stored values, and that is a decision for a
    // human with context, not for a script.
    if (found.type !== spec.type) {
      mismatched.push({ slug: spec.api_slug, want: spec.type, got: found.type })
    }
  }

  const plannedSlugs = new Set(desired.map(s => s.api_slug))
  const standardish = a => !a.is_writable || ['record_id', 'created_at', 'created_by'].includes(a.api_slug)
  const unplanned = live.filter(a => !plannedSlugs.has(a.api_slug) && !standardish(a))

  return { missing, existing, mismatched, unplanned }
}

/** Which option/status titles a live attribute is missing. Case-insensitive. */
export function diffValues(liveValues, desiredTitles) {
  const have = new Set(liveValues.map(v => String(v.title ?? '').toLowerCase()))
  return desiredTitles.filter(t => !have.has(t.toLowerCase()))
}

async function main() {
  const key = tokenFromEnv()
  const client = new Attio(key)

  const report = {
    workspace_expected: WORKSPACE,
    token: tokenFingerprint(key),
    ran_at: new Date().toISOString(),
    preflight: null,
    objects: {},
    deal_stages: null,
    workspace_members: [],
    omitted: OMITTED,
  }

  const pf = await preflight(client)
  report.preflight = pf

  if (!JSON_OUT) {
    console.log(`\nAttio schema audit — expecting workspace "${WORKSPACE}"`)
    console.log(`token ${report.token}   ${report.ran_at}\n`)
    console.log('PREFLIGHT')
    for (const c of pf.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}  — ${c.detail}`)
    if (pf.scope) {
      console.log(`  scope object_configuration:read-write -> ${
        pf.scope.ok === 'unknown' ? 'NOT REPORTED (will be enforced by the API)' : pf.scope.ok ? 'granted' : 'MISSING'}`)
    }
  }

  if (!pf.ok) {
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2))
    else console.log('\nPreflight failed. Not reading further — fix the above first.\n')
    process.exit(1)
  }

  // Guard against auditing (and later writing to) the wrong workspace.
  const objects = await client.listObjects()
  const slugs = objects.map(o => o.api_slug).filter(Boolean)
  const missingObjects = EXPECTED_OBJECTS.filter(o => !slugs.includes(o))
  report.objects_present = slugs
  if (missingObjects.length) {
    const msg = `Expected objects not found: ${missingObjects.join(', ')}. Wrong workspace?`
    if (JSON_OUT) { report.error = msg; console.log(JSON.stringify(report, null, 2)) }
    else console.log(`\n${msg}\n`)
    process.exit(1)
  }

  for (const { object, attributes } of OBJECT_PLAN) {
    const live = await client.listAttributes(object)
    const d = diffAttributes(live, attributes)

    // Reused attributes must still be there — the plan depends on them.
    const liveBySlug = bySlug(live)
    const reuse = (REUSED[object] || []).map(r => ({
      ...r, present: liveBySlug.has(r.slug), type: liveBySlug.get(r.slug)?.type ?? null,
    }))

    // For attributes that already exist and carry values, which values are missing.
    const valueGaps = []
    for (const { spec, live: found } of d.existing) {
      if (spec.type === 'select' && spec.options) {
        const opts = await client.listSelectOptions(object, spec.api_slug)
        const gap = diffValues(opts, spec.options)
        if (gap.length) valueGaps.push({ slug: spec.api_slug, kind: 'options', missing: gap })
      }
      if (spec.type === 'status' && spec.statuses) {
        const sts = await client.listStatuses(object, spec.api_slug)
        const gap = diffValues(sts, spec.statuses)
        if (gap.length) valueGaps.push({ slug: spec.api_slug, kind: 'statuses', missing: gap })
      }
    }

    report.objects[object] = {
      live_attribute_count: live.length,
      reused: reuse,
      missing: d.missing.map(s => ({ slug: s.api_slug, title: s.title, type: s.type })),
      existing: d.existing.map(e => ({ slug: e.spec.api_slug, type: e.live.type })),
      mismatched: d.mismatched,
      unplanned: d.unplanned.map(a => ({ slug: a.api_slug, title: a.title, type: a.type })),
      value_gaps: valueGaps,
    }

    if (!JSON_OUT) {
      console.log(`\n${object.toUpperCase()}  (${live.length} attributes live)`)
      const missingReuse = reuse.filter(r => !r.present)
      if (missingReuse.length) {
        console.log(`  REUSE BROKEN: ${missingReuse.map(r => r.slug).join(', ')} not found`)
      } else {
        console.log(`  reusing ${reuse.length}: ${reuse.map(r => r.slug).join(', ')}`)
      }
      console.log(`  to create : ${d.missing.length}${d.missing.length ? ' — ' + d.missing.map(s => s.api_slug).join(', ') : ''}`)
      console.log(`  already   : ${d.existing.length}${d.existing.length ? ' — ' + d.existing.map(e => e.spec.api_slug).join(', ') : ''}`)
      if (d.mismatched.length) {
        for (const m of d.mismatched) console.log(`  TYPE DRIFT: ${m.slug} is ${m.got}, schema wants ${m.want} (reported only, never auto-changed)`)
      }
      for (const g of valueGaps) console.log(`  missing ${g.kind} on ${g.slug}: ${g.missing.join(', ')}`)
      if (d.unplanned.length) {
        console.log(`  present but not in schema.mjs: ${d.unplanned.map(a => a.api_slug).join(', ')}`)
      }
    }
  }

  // Deal stages, plus the record count that decides whether archiving is safe.
  const dealAttrs = await client.listAttributes('deals')
  const stageAttr = bySlug(dealAttrs).get('stage')
  if (stageAttr) {
    const liveStages = await client.listStatuses('deals', 'stage')
    const titles = liveStages.map(s => s.title)
    let dealCount = null
    try { dealCount = await client.countRecords('deals') } catch { dealCount = null }

    report.deal_stages = {
      live: titles,
      missing: diffValues(liveStages, DEAL_STAGES),
      defaults_still_present: DEFAULT_DEAL_STAGES.filter(d => titles.includes(d)),
      deal_record_count_probe: dealCount,
      safe_to_archive_defaults: dealCount === 0,
    }

    if (!JSON_OUT) {
      console.log(`\nDEAL STAGES`)
      console.log(`  live    : ${titles.join(' | ')}`)
      console.log(`  create  : ${report.deal_stages.missing.join(' | ') || '(none)'}`)
      console.log(`  defaults still present: ${report.deal_stages.defaults_still_present.join(' | ') || '(none)'}`)
      console.log(`  deal records found in a 1-row probe: ${dealCount === null ? 'could not read' : dealCount}`)
      console.log(`  archiving defaults ${report.deal_stages.safe_to_archive_defaults
        ? 'is SAFE (no deal records)'
        : 'is NOT automatic — deals exist or could not be counted'}`)
    }
  }

  try {
    const members = await client.listWorkspaceMembers()
    report.workspace_members = members.map(m => ({
      id: m?.id?.workspace_member_id ?? m?.id,
      name: [m.first_name, m.last_name].filter(Boolean).join(' ') || m.name || null,
      email: m.email_address ?? m.email ?? null,
      access: m.access_level ?? null,
    }))
    if (!JSON_OUT) {
      console.log(`\nWORKSPACE MEMBERS (Deal owner is required on every Deal)`)
      for (const m of report.workspace_members) console.log(`  ${m.id}  ${m.name} <${m.email}>  ${m.access}`)
    }
  } catch (e) {
    if (!JSON_OUT) console.log(`\nWORKSPACE MEMBERS: could not read (${e.message})`)
  }

  if (JSON_OUT) console.log(JSON.stringify(report, null, 2))
  else console.log(`\nRead-only. Nothing was modified. Next: node apply.mjs (dry run)\n`)
}

// Only when run directly. audit.mjs exports diffAttributes/diffValues, which
// test-schema.mjs imports — an import must not fire a live API run.
if (process.argv[1] && process.argv[1].endsWith('audit.mjs')) main().catch(e => {
  if (e instanceof AttioError) {
    console.error(`\n${e.message}\n`)
    if (e.status === 403) console.error('403 usually means the token lacks object_configuration:read-write.\n')
  } else {
    console.error(e)
  }
  process.exit(1)
})
