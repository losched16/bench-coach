// Confirm the live workspace matches schema.mjs. Read-only.
//
// Deliberately separate from apply.mjs: a script that both makes a change and
// declares it correct is checking its own homework. This re-reads everything
// from Attio with fresh requests and asserts, so a create that silently no-op'd
// fails here.
//
//   node verify.mjs          exit 0 if the schema is complete, 1 if not
//   node verify.mjs --json

import { Attio, preflight, bySlug, tokenFromEnv, tokenFingerprint, AttioError } from './attio.mjs'
import { OBJECT_PLAN, REUSED, DEAL_STAGES, DEFAULT_DEAL_STAGES, WORKSPACE } from './schema.mjs'

const JSON_OUT = process.argv.includes('--json')

let passed = 0
const failures = []
const ok = (name, cond, detail = '') => {
  if (cond) passed++
  else failures.push(`${name}${detail ? ` — ${detail}` : ''}`)
  if (!JSON_OUT) console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${name}${detail && !cond ? '  — ' + detail : ''}`)
}

async function main() {
  const key = tokenFromEnv()
  const client = new Attio(key)

  if (!JSON_OUT) {
    console.log(`\nVerifying "${WORKSPACE}"   token ${tokenFingerprint(key)}\n`)
  }

  const pf = await preflight(client)
  if (!pf.ok) {
    console.error('Preflight failed; cannot verify.')
    for (const c of pf.checks.filter(c => !c.ok)) console.error(`  ${c.name}: ${c.detail}`)
    process.exit(1)
  }

  for (const { object, attributes } of OBJECT_PLAN) {
    if (!JSON_OUT) console.log(`${object.toUpperCase()}`)
    const live = await client.listAttributes(object)
    const map = bySlug(live)

    // Reused attributes still present — the plan leans on them.
    for (const r of REUSED[object] || []) {
      ok(`${object}: reuses ${r.slug} (${r.as})`, map.has(r.slug), 'not found in live schema')
    }

    for (const spec of attributes) {
      const found = map.get(spec.api_slug)
      ok(`${object}.${spec.api_slug} exists`, !!found)
      if (!found) continue

      // A status attribute may legitimately have landed as a select via the
      // documented fallback, so both are accepted for that one case.
      const typeOk = found.type === spec.type ||
        (spec.type === 'status' && found.type === 'select')
      ok(`${object}.${spec.api_slug} type is ${spec.type}`, typeOk, `got ${found.type}`)

      const wantValues = spec.options ?? spec.statuses
      if (wantValues) {
        const liveValues = found.type === 'status'
          ? await client.listStatuses(object, spec.api_slug)
          : await client.listSelectOptions(object, spec.api_slug)
        const have = new Set(liveValues.map(v => String(v.title ?? '').toLowerCase()))
        const missing = wantValues.filter(t => !have.has(t.toLowerCase()))
        ok(`${object}.${spec.api_slug} has all ${wantValues.length} values`, missing.length === 0,
          `missing: ${missing.join(', ')}`)
      }

      // The rule that matters most: an unresearched record must never be
      // indistinguishable from a researched negative.
      if (spec.type === 'select' || spec.type === 'status') {
        const values = (spec.options ?? spec.statuses).map(v => v.toLowerCase())
        const isYesNo = values.includes('yes') && values.includes('no')
        if (isYesNo) {
          ok(`${object}.${spec.api_slug} keeps Unknown distinct from No`,
            values.includes('unknown') || values.includes('needs review'),
            'a yes/no attribute without an unknown state conflates unresearched with negative')
        }
      }
    }

    // Nothing in the plan should ever be a checkbox.
    for (const spec of attributes) {
      const found = map.get(spec.api_slug)
      if (found) ok(`${object}.${spec.api_slug} is not a checkbox`, found.type !== 'checkbox')
    }
  }

  // Deal stages
  if (!JSON_OUT) console.log(`DEAL STAGES`)
  const liveStages = await client.listStatuses('deals', 'stage')
  const titles = liveStages.map(s => s.title)
  const lower = new Set(titles.map(t => t.toLowerCase()))
  for (const want of DEAL_STAGES) {
    ok(`deals.stage has "${want}"`, lower.has(want.toLowerCase()))
  }
  const stillDefault = DEFAULT_DEAL_STAGES.filter(d => titles.includes(d))
  if (!JSON_OUT && stillDefault.length) {
    console.log(`  note  default stages still present: ${stillDefault.join(', ')} (archive with apply.mjs --commit --archive-default-stages)`)
  }

  // Deal owner is required on every Deal, so automation needs a member id.
  try {
    const members = await client.listWorkspaceMembers()
    ok('at least one workspace member exists to own Deals', members.length > 0)
    if (!JSON_OUT) {
      for (const m of members) {
        const id = m?.id?.workspace_member_id ?? m?.id
        console.log(`  owner candidate: ${id}  ${m.email_address ?? m.email ?? ''}`)
      }
    }
  } catch (e) {
    ok('workspace members readable', false, e.message)
  }

  const result = { passed, failed: failures.length, failures }
  if (JSON_OUT) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`\n${passed} passed, ${failures.length} failed`)
    if (failures.length) { console.log(''); for (const f of failures) console.log(`  FAIL  ${f}`) }
    console.log('')
  }
  process.exit(failures.length ? 1 : 0)
}

// Only when run directly. audit.mjs exports diffAttributes/diffValues, which
// test-schema.mjs imports — an import must not fire a live API run.
if (process.argv[1] && process.argv[1].endsWith('verify.mjs')) main().catch(e => {
  if (e instanceof AttioError) console.error(`\n${e.message}\n`)
  else console.error(e)
  process.exit(1)
})
