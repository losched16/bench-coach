#!/usr/bin/env node
// Build 0 link-integrity check: re-run YouTube oEmbed for drill videos and
// confirm each returns 200. A dead video in a prescription is a visible
// product failure.
//
// Run from a machine with open network access (NOT the Claude sandbox — its
// proxy blocks youtube.com):
//
//   node scripts/verify-drill-links.mjs                 # check pending_review rows
//   node scripts/verify-drill-links.mjs --all           # check every drill
//   node scripts/verify-drill-links.mjs --write         # also stamp url_verified_at on passing rows
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local
// (same convention as cowork-expansion/apply-expansion.mjs). Falls back to
// checking cowork-expansion/new_drills.json if no credentials are available.

import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const CHECK_ALL = args.includes('--all')
const WRITE = args.includes('--write')

// ── Env loading (.env.local, same as apply-expansion.mjs) ──
function loadEnv() {
  const envPath = resolve(root, '.env.local')
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

async function oembedStatus(videoId) {
  const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    return res.status
  } catch (e) {
    return `ERR:${e.name}`
  }
}

async function supabaseFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${res.status} on ${path}: ${(await res.text()).slice(0, 300)}`)
  return res.status === 204 ? null : res.json()
}

async function main() {
  let rows
  if (SUPABASE_URL && SERVICE_KEY) {
    const filter = CHECK_ALL ? '' : '&status=eq.pending_review'
    rows = await supabaseFetch(
      `drill_resources?select=id,drill_name,youtube_video_id,status${filter}&limit=1000`
    )
    console.log(`Checking ${rows.length} drills from live DB (${CHECK_ALL ? 'all' : 'pending_review only'})\n`)
  } else {
    const jsonPath = resolve(root, 'cowork-expansion/new_drills.json')
    rows = JSON.parse(readFileSync(jsonPath, 'utf8'))
    console.log(`No Supabase credentials found — checking ${rows.length} rows from new_drills.json\n`)
  }

  const failures = []
  let passed = 0
  for (const row of rows) {
    const status = await oembedStatus(row.youtube_video_id)
    if (status === 200) {
      passed++
      if (WRITE && row.id && SUPABASE_URL && SERVICE_KEY) {
        await supabaseFetch(`drill_resources?id=eq.${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ url_verified_at: new Date().toISOString() }),
          headers: { Prefer: 'return=minimal' },
        })
      }
    } else {
      failures.push({ ...row, oembed: status })
      console.log(`FAIL ${status}  ${row.youtube_video_id}  ${row.drill_name}`)
    }
  }

  console.log(`\n${passed}/${rows.length} passed oEmbed${WRITE ? ' (url_verified_at stamped on passes)' : ''}`)
  if (failures.length > 2) {
    console.log(`\n${failures.length} failures — per Build 0, more than 2 means re-validate the whole set.`)
  }
  if (failures.length > 0) {
    console.log('\nFailing rows should be fixed (new video) or set status=rejected before approval.')
    process.exitCode = 1
  }
}

main().catch(e => { console.error(e); process.exit(1) })
