// Create everything schema.mjs defines that Attio does not already have.
//
// DRY RUN BY DEFAULT. Prints the plan and exits. Writes only with --commit.
//
//   node apply.mjs                              show the plan
//   node apply.mjs --commit                     create attributes, options, statuses
//   node apply.mjs --commit --archive-default-stages   also retire Lead/In Progress/Won 🎉/Lost
//
// GUARANTEES
//
// - Additive. Creates only. Never deletes an attribute, never edits an
//   existing one, never touches a record.
// - Idempotent. Everything is read before it is written, so a second run
//   creates nothing. Safe to re-run after a partial failure.
// - Preflight-gated. Scope and endpoint checks pass before the first POST.
// - Archiving is doubly gated: an explicit flag AND a zero-record check.

import { Attio, preflight, bySlug, tokenFromEnv, tokenFingerprint, AttioError } from './attio.mjs'
import { diffAttributes, diffValues } from './audit.mjs'
import {
  OBJECT_PLAN, DEAL_STAGES, DEFAULT_DEAL_STAGES, EXPECTED_OBJECTS, WORKSPACE,
} from './schema.mjs'

const COMMIT = process.argv.includes('--commit')
const ARCHIVE_DEFAULTS = process.argv.includes('--archive-default-stages')

const log = []
function record(action, target, status, detail = '') {
  log.push({ action, target, status, detail })
  const mark = status === 'created' ? '  +' : status === 'skipped' ? '  =' : status === 'would-create' ? '  ~' : '  !'
  console.log(`${mark} ${action.padEnd(18)} ${target.padEnd(46)} ${status}${detail ? '  — ' + detail : ''}`)
}

async function main() {
  const key = tokenFromEnv()
  const client = new Attio(key)

  console.log(`\nBenchCoach League Sales — Attio schema apply`)
  console.log(`workspace expected: "${WORKSPACE}"   token ${tokenFingerprint(key)}`)
  console.log(COMMIT ? 'MODE: COMMIT — changes will be written\n' : 'MODE: DRY RUN — nothing will be written (pass --commit to apply)\n')

  const pf = await preflight(client)
  console.log('PREFLIGHT')
  for (const c of pf.checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}  — ${c.detail}`)
  if (!pf.ok) {
    console.error('\nPreflight failed. Refusing to write. The endpoint shapes in attio.mjs may need correcting — see the note at the top of that file.\n')
    process.exit(1)
  }
  if (pf.scope && pf.scope.ok === false) {
    console.error(
      `\nToken is missing the required scope: object_configuration:read-write` +
      `\nGranted: ${pf.scope.scopes?.join(', ') || '(none reported)'}` +
      `\n\nCreate a new key at Attio -> Workspace settings -> Developers -> API keys with that scope.\n`)
    process.exit(1)
  }
  if (pf.scope && pf.scope.ok === 'unknown') {
    console.log('  note: scopes not reported in a recognised shape; relying on the API to enforce them\n')
  }

  const objects = (await client.listObjects()).map(o => o.api_slug).filter(Boolean)
  const missingObjects = EXPECTED_OBJECTS.filter(o => !objects.includes(o))
  if (missingObjects.length) {
    console.error(`\nExpected objects missing: ${missingObjects.join(', ')}. Wrong workspace? Refusing to write.\n`)
    process.exit(1)
  }

  // -------------------------------------------------------------------------
  // Attributes
  // -------------------------------------------------------------------------
  for (const { object, attributes } of OBJECT_PLAN) {
    console.log(`\n${object.toUpperCase()}`)
    const live = await client.listAttributes(object)
    const d = diffAttributes(live, attributes)

    for (const m of d.mismatched) {
      record('type-drift', `${object}.${m.slug}`, 'reported',
        `live=${m.got} schema=${m.want}; not changed — retyping can destroy values`)
    }

    for (const spec of attributes) {
      const exists = bySlug(live).get(spec.api_slug)

      if (!exists) {
        if (!COMMIT) {
          record('create-attribute', `${object}.${spec.api_slug}`, 'would-create',
            spec.type + (spec.options ? ` [${spec.options.join(', ')}]` : '') +
            (spec.statuses ? ` [${spec.statuses.join(', ')}]` : ''))
          continue
        }
        try {
          await client.createAttribute(object, spec)
          record('create-attribute', `${object}.${spec.api_slug}`, 'created', spec.type)
        } catch (e) {
          // A status attribute on a non-Deal object may be rejected. Fall back
          // to select — the option titles are identical and nothing downstream
          // depends on the distinction except kanban grouping.
          if (spec.type === 'status') {
            record('create-attribute', `${object}.${spec.api_slug}`, 'failed', e.message)
            console.log(`      retrying as type=select (fallback documented in schema.mjs)`)
            try {
              await client.createAttribute(object, { ...spec, type: 'select', options: spec.statuses })
              record('create-attribute', `${object}.${spec.api_slug}`, 'created', 'select (status fallback)')
            } catch (e2) {
              record('create-attribute', `${object}.${spec.api_slug}`, 'failed', e2.message)
            }
          } else {
            record('create-attribute', `${object}.${spec.api_slug}`, 'failed', e.message)
          }
        }
        continue
      }

      record('create-attribute', `${object}.${spec.api_slug}`, 'skipped', 'already exists')

      // Exists — top up any missing option/status values.
      if (spec.type === 'select' && spec.options) {
        const opts = await client.listSelectOptions(object, spec.api_slug)
        for (const title of diffValues(opts, spec.options)) {
          if (!COMMIT) { record('create-option', `${object}.${spec.api_slug}: ${title}`, 'would-create'); continue }
          try {
            await client.createSelectOption(object, spec.api_slug, title)
            record('create-option', `${object}.${spec.api_slug}: ${title}`, 'created')
          } catch (e) {
            record('create-option', `${object}.${spec.api_slug}: ${title}`, 'failed', e.message)
          }
        }
      }
      if (spec.type === 'status' && spec.statuses) {
        const sts = await client.listStatuses(object, spec.api_slug)
        for (const title of diffValues(sts, spec.statuses)) {
          if (!COMMIT) { record('create-status', `${object}.${spec.api_slug}: ${title}`, 'would-create'); continue }
          try {
            await client.createStatus(object, spec.api_slug, title)
            record('create-status', `${object}.${spec.api_slug}: ${title}`, 'created')
          } catch (e) {
            record('create-status', `${object}.${spec.api_slug}: ${title}`, 'failed', e.message)
          }
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Deal stages
  // -------------------------------------------------------------------------
  console.log(`\nDEAL STAGES`)
  const liveStages = await client.listStatuses('deals', 'stage')
  for (const title of diffValues(liveStages, DEAL_STAGES)) {
    if (!COMMIT) { record('create-status', `deals.stage: ${title}`, 'would-create'); continue }
    try {
      await client.createStatus('deals', 'stage', title)
      record('create-status', `deals.stage: ${title}`, 'created')
    } catch (e) {
      record('create-status', `deals.stage: ${title}`, 'failed', e.message)
    }
  }

  // Archiving the defaults. Two gates, because losing a stage that records sit
  // in is the one destructive thing available here.
  const after = COMMIT ? await client.listStatuses('deals', 'stage') : liveStages
  const defaultsPresent = after.filter(s => DEFAULT_DEAL_STAGES.includes(s.title))

  if (defaultsPresent.length === 0) {
    console.log('  = default stages already gone')
  } else if (!ARCHIVE_DEFAULTS) {
    console.log(`  ~ ${defaultsPresent.length} default stage(s) still present: ${defaultsPresent.map(s => s.title).join(', ')}`)
    console.log('    pass --archive-default-stages to retire them (archive, not delete — reversible in the UI)')
  } else {
    let dealCount = null
    try { dealCount = await client.countRecords('deals') } catch { dealCount = null }
    if (dealCount !== 0) {
      console.log(`  ! refusing to archive: deal record probe returned ${dealCount === null ? 'an error' : dealCount}`)
      console.log('    archiving a stage that records sit in would strand them. Move them first.')
    } else {
      for (const s of defaultsPresent) {
        const id = s?.id?.status_id ?? s?.id
        if (!COMMIT) { record('archive-status', `deals.stage: ${s.title}`, 'would-create', 'archive'); continue }
        try {
          await client.archiveStatus('deals', 'stage', id)
          record('archive-status', `deals.stage: ${s.title}`, 'created', 'archived')
        } catch (e) {
          record('archive-status', `deals.stage: ${s.title}`, 'failed', e.message)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  const counts = log.reduce((a, l) => (a[l.status] = (a[l.status] || 0) + 1, a), {})
  console.log(`\nSUMMARY  ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join('  ')}`)
  console.log(`API calls: ${client.calls.length}`)
  if (!COMMIT) console.log('\nDry run. Nothing was written. Re-run with --commit to apply.\n')
  else console.log('\nDone. Run: node verify.mjs\n')

  if (log.some(l => l.status === 'failed')) process.exit(2)
}

// Only when run directly. audit.mjs exports diffAttributes/diffValues, which
// test-schema.mjs imports — an import must not fire a live API run.
if (process.argv[1] && process.argv[1].endsWith('apply.mjs')) main().catch(e => {
  if (e instanceof AttioError) {
    console.error(`\n${e.message}\n`)
    if (e.status === 403) console.error('403 usually means the token lacks object_configuration:read-write.\n')
  } else {
    console.error(e)
  }
  process.exit(1)
})
