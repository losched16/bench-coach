#!/usr/bin/env node
// Read a schema dump before it becomes a commit.
//
//   node scripts/inspect-baseline.mjs migrations/000_baseline.sql
//   node scripts/inspect-baseline.mjs migrations/000_baseline.sql --json
//
// Two jobs, in this order, because the second does not matter if the first
// fails:
//
//   1. SECRETS. A --schema-only dump should contain no rows, but "should" is
//      not a property you commit on. Function bodies, policy expressions,
//      column defaults and COMMENTs are all schema, all dumped verbatim, and
//      all places a literal has been found before. This repo already shipped a
//      live service_role key inside a script for three months.
//
//   2. INVENTORY. What is actually in the file, grouped so a person can
//      review it: tables, views, functions, triggers, policies, grants,
//      extensions, and — separately — the things that are not BenchCoach's to
//      commit.
//
// It reads the file. It does not connect to anything.

import { readFileSync } from 'node:fs'
import { PRODUCTION_PROJECT_REF } from './lib/env-guard.mjs'

const path = process.argv[2]
const JSON_OUT = process.argv.includes('--json')
if (!path) {
  console.error('usage: node scripts/inspect-baseline.mjs <dump.sql> [--json]')
  process.exit(2)
}
const sql = readFileSync(path, 'utf8')
const bytes = Buffer.byteLength(sql)
const lines = sql.split('\n')

// ---------------------------------------------------------------------------
// 1. Secrets
// ---------------------------------------------------------------------------

const SECRET_RULES = [
  { name: 'Supabase/JWT token',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    why: 'a service_role JWT bypasses RLS on every table, forever, and git history keeps it' },
  { name: 'Anthropic API key', re: /\bsk-ant-api[0-9]{2}-[A-Za-z0-9_-]{20,}/g, why: 'billable, and usable by anyone' },
  { name: 'Stripe live key', re: /\bsk_live_[A-Za-z0-9]{16,}/g, why: 'can move money' },
  { name: 'Stripe restricted key', re: /\brk_live_[A-Za-z0-9]{16,}/g, why: 'scoped, still live' },
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9]{32,}/g, why: 'billable' },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/g, why: 'half of an AWS credential pair' },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/g, why: 'repository access' },
  { name: 'Private key block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g, why: 'a private key' },
  { name: 'URL with embedded password',
    re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s:@/]+@[^\s/]+/gi,
    why: 'a connection string carrying a password' },
  { name: 'Password assignment',
    re: /\b(?:PASSWORD|pwd|passwd)\s*(?:=>|=|:)\s*'[^']{6,}'/gi,
    why: 'a literal password' },
]

// The production project ref is not a secret, but a baseline that names one
// project is a baseline that cannot build another — which is the entire point
// of the file. Imported rather than repeated: verify:env-safety allows the ref
// to be written down in exactly two places, and it was right to stop a third.
const PROJECT_REF = PRODUCTION_PROJECT_REF

const secretHits = []
for (const rule of SECRET_RULES) {
  for (const m of sql.matchAll(rule.re)) {
    const line = sql.slice(0, m.index).split('\n').length
    secretHits.push({ rule: rule.name, why: rule.why, line, preview: redact(m[0]) })
  }
}
const refHits = []
for (const m of sql.matchAll(new RegExp(PROJECT_REF, 'g'))) {
  refHits.push(sql.slice(0, m.index).split('\n').length)
}

/** Show enough to find it, never enough to use it. */
function redact(s) {
  if (s.length <= 12) return s[0] + '…'
  return `${s.slice(0, 6)}…${s.slice(-4)}  (${s.length} chars, elided)`
}

// Email addresses embedded in policies, functions or defaults. Not a secret,
// but a real person's address hardcoded into an authorization rule is both a
// privacy leak and a rule that cannot be configured per environment.
const emails = [...new Set(
  [...sql.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)].map(m => m[0])
)].filter(e => !/example\.(com|org)$|@localhost/i.test(e))

// A schema-only dump has no COPY blocks and no INSERTs. If it does, the wrong
// flag was used and the file may contain customer rows.
const dataBlocks = []
for (const [i, l] of lines.entries()) {
  if (/^COPY\s+[\w."]+\s*\(/i.test(l)) dataBlocks.push({ line: i + 1, kind: 'COPY', text: l.slice(0, 80) })
  if (/^INSERT\s+INTO\s/i.test(l)) dataBlocks.push({ line: i + 1, kind: 'INSERT', text: l.slice(0, 80) })
}

// ---------------------------------------------------------------------------
// 2. Inventory
// ---------------------------------------------------------------------------

const grab = (re, group = 1) => {
  const out = []
  for (const m of sql.matchAll(re)) out.push(m[group].toLowerCase().replace(/^public\./, '').replace(/"/g, ''))
  return out
}
const uniq = (a) => [...new Set(a)].sort()

const inv = {
  tables: uniq(grab(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)),
  views: uniq(grab(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)),
  matviews: uniq(grab(/CREATE\s+MATERIALIZED\s+VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)),
  sequences: uniq(grab(/CREATE\s+SEQUENCE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)),
  functions: uniq(grab(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)),
  triggers: uniq(grab(/CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+("?[a-z_][a-z0-9_]*"?)/gi)),
  indexes: uniq(grab(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?("?[a-z_][a-z0-9_]*"?)/gi)),
  extensions: uniq(grab(/CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-z_][a-z0-9_-]*)"?/gi)),
  types: uniq(grab(/CREATE\s+TYPE\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)/gi)),
  rlsEnabled: uniq(grab(/ALTER\s+TABLE\s+(?:ONLY\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi)),
  rlsForced: uniq(grab(/ALTER\s+TABLE\s+(?:ONLY\s+)?((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi)),
}

// Policies, with the table they sit on.
//
// The name alternation is not decoration: pg_dump quotes policy names, and
// this codebase's policy names are sentences with spaces in them
// ("coaches manage their own row"). A pattern that stops at whitespace inside
// the quotes matches nothing and reports zero policies on a file full of them
// — which is the most dangerous possible way for this tool to be wrong.
const policies = []
for (const m of sql.matchAll(/CREATE\s+POLICY\s+(?:"([^"]+)"|([a-z_][a-z0-9_]*))\s+ON\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)([\s\S]*?);/gi)) {
  const body = m[4] || ''
  policies.push({
    name: m[1] || m[2],
    table: m[3].toLowerCase().replace(/^public\./, '').replace(/"/g, ''),
    command: (body.match(/\bFOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\b/i) || [, 'ALL'])[1].toUpperCase(),
    roles: (body.match(/\bTO\s+([a-z_, ]+?)(?:\s+USING|\s+WITH|\s*$)/i) || [, 'public'])[1].trim(),
    permissive: !/\bAS\s+RESTRICTIVE\b/i.test(body),
    usesAuthUid: /auth\.uid\s*\(\s*\)/i.test(body),
    hasUsing: /\bUSING\s*\(/i.test(body),
    hasWithCheck: /\bWITH\s+CHECK\s*\(/i.test(body),
    // The shape that matters: a policy whose condition is literally true.
    unconditional: /\bUSING\s*\(\s*true\s*\)/i.test(body),
  })
}

// A parser that quietly matches nothing reports a file full of policies as
// having none, and "0 policies" reads as "nothing to review" rather than as a
// broken tool. So count the keyword independently and refuse to disagree.
const policyKeywordCount = (sql.match(/CREATE\s+POLICY\b/gi) || []).length
if (policyKeywordCount !== policies.length) {
  console.error(`\ninspect-baseline: parsed ${policies.length} policies but the file contains ` +
    `${policyKeywordCount} CREATE POLICY statements.`)
  console.error('The policy parser is wrong. Fix it rather than reviewing an undercount.\n')
  process.exit(2)
}

// SECURITY DEFINER functions, and whether each pins its search_path.
const secdef = []
for (const m of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:public\.)?"?[a-z_][a-z0-9_]*"?)\s*\(([\s\S]*?)\)\s*RETURNS([\s\S]*?)(?:\$\$|\$_\$|\bAS\b)/gi)) {
  const start = m.index
  const end = sql.indexOf('$$;', start) > 0 ? sql.indexOf('$$;', start) + 3 : start + 4000
  const whole = sql.slice(start, end)
  if (!/SECURITY\s+DEFINER/i.test(whole)) continue
  secdef.push({
    name: m[1].toLowerCase().replace(/^public\./, '').replace(/"/g, ''),
    args: m[2].replace(/\s+/g, ' ').trim().slice(0, 120),
    // The Supabase linter calls this function_search_path_mutable. A
    // SECURITY DEFINER function without it resolves every unqualified name
    // against the CALLER's search_path.
    pinsSearchPath: /SET\s+search_path\s*(?:=|TO)/i.test(whole),
    line: sql.slice(0, start).split('\n').length,
  })
}

const grants = []
for (const m of sql.matchAll(/^(GRANT|REVOKE)\s+([\s\S]*?);/gim)) {
  grants.push({ kind: m[1].toUpperCase(), text: m[2].replace(/\s+/g, ' ').trim().slice(0, 140) })
}

// Every role the privileges name.
//
// This is the list to check against a FRESH Supabase project before applying
// the baseline: a GRANT to a role that does not exist aborts the statement,
// and a REVOKE that never ran is a permission left open. Both fail quietly
// enough to reach staging.
const roles = new Set()
for (const g of grants) {
  for (const m of g.text.matchAll(/\b(?:TO|FROM)\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)/gi)) {
    for (const r of m[1].split(',')) roles.add(r.trim().toLowerCase())
  }
}
// Roles a new Supabase project already has.
const SUPABASE_ROLES = new Set([
  'postgres', 'anon', 'authenticated', 'service_role', 'authenticator',
  'dashboard_user', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin',
  'supabase_read_only_user', 'supabase_realtime_admin', 'pgbouncer', 'public',
])
const unknownRoles = [...roles].filter(r => !SUPABASE_ROLES.has(r)).sort()

// Things that are probably not BenchCoach's to commit.
const PLATFORM = /^(pg_|_pg|graphql|pgsodium|supabase_|realtime|storage|vault|net|cron|extensions|auth)/i
const notOurs = {
  bwc: inv.tables.filter(t => t.startsWith('bwc_')),
  platform: [...inv.tables, ...inv.functions, ...inv.types].filter(n => PLATFORM.test(n)),
}

// ---------------------------------------------------------------------------

const clean = secretHits.length === 0 && dataBlocks.length === 0

if (JSON_OUT) {
  console.log(JSON.stringify({ path, bytes, lines: lines.length, inv, policies, secdef, grants, roles: [...roles], unknownRoles, secretHits, refHits, emails, dataBlocks, notOurs, clean }, null, 2))
  process.exit(clean ? 0 : 1)
}

const n = (x) => String(x).padStart(5)
console.log(`\n  ${path} — ${(bytes / 1024).toFixed(1)} KB, ${lines.length} lines\n`)

console.log('  SECRET SCAN')
if (secretHits.length) {
  console.log('    FAILED — do not commit this file.\n')
  for (const h of secretHits) console.log(`      line ${h.line}: ${h.rule} — ${h.preview}\n        ${h.why}`)
} else {
  console.log('    no credentials, tokens or private keys found')
}
if (dataBlocks.length) {
  console.log(`\n    ROW DATA PRESENT (${dataBlocks.length}) — this is not a schema-only dump.`)
  for (const d of dataBlocks.slice(0, 8)) console.log(`      line ${d.line}: ${d.kind}  ${d.text}`)
  console.log('      Re-dump with --schema-only. Customer rows must not enter the repository.')
}
if (refHits.length) {
  console.log(`\n    NOTE: the production project ref appears on ${refHits.length} line(s): ${refHits.slice(0, 10).join(', ')}`)
  console.log('      Not a secret, but a baseline naming one project cannot build another.')
}
if (emails.length) {
  console.log(`\n    NOTE: ${emails.length} email address(es) embedded in schema:`)
  for (const e of emails.slice(0, 10)) console.log(`      ${e}`)
  console.log('      An address hardcoded into a policy is a rule that cannot be configured per environment.')
}

console.log('\n  INVENTORY')
for (const [k, v] of Object.entries(inv)) console.log(`    ${n(v.length)}  ${k}`)
console.log(`    ${n(policies.length)}  policies`)
console.log(`    ${n(secdef.length)}  SECURITY DEFINER functions`)
console.log(`    ${n(grants.length)}  GRANT/REVOKE statements`)
if (grants.length === 0) {
  console.log('           none — the dump was taken with --no-privileges.')
  console.log('           Deliberate REVOKEs are lost that way; see docs/BASELINE.md.')
} else {
  console.log(`           roles named: ${[...roles].sort().join(', ')}`)
  if (unknownRoles.length) {
    console.log(`           NOT standard Supabase roles: ${unknownRoles.join(', ')}`)
    console.log('           These must be created before the baseline applies, or the')
    console.log('           statement aborts and a permission is left as it was.')
  }
}

const rlsMissing = inv.tables.filter(t => !inv.rlsEnabled.includes(t) && !t.startsWith('bwc_'))
console.log('\n  RLS')
console.log(`    ${n(inv.rlsEnabled.length)}  tables with RLS enabled`)
console.log(`    ${n(rlsMissing.length)}  tables WITHOUT RLS`)
if (rlsMissing.length) console.log(`           ${rlsMissing.join(', ')}`)

const flagged = policies.filter(p => p.unconditional || (!p.usesAuthUid && p.command !== 'SELECT'))
if (flagged.length) {
  console.log(`\n    ${flagged.length} policy/policies to look at first:`)
  for (const p of flagged.slice(0, 25)) {
    console.log(`      ${p.table}.${p.name}  ${p.command}  TO ${p.roles}` +
      `${p.unconditional ? '   ← USING (true)' : ''}${!p.usesAuthUid ? '   ← no auth.uid()' : ''}`)
  }
}

const unpinned = secdef.filter(f => !f.pinsSearchPath)
console.log('\n  SECURITY DEFINER')
console.log(`    ${n(secdef.length - unpinned.length)}  pin search_path`)
console.log(`    ${n(unpinned.length)}  do NOT pin search_path`)
if (unpinned.length) {
  for (const f of unpinned.slice(0, 30)) console.log(`           ${f.name}  (line ${f.line})`)
  console.log('      Each resolves unqualified names against the CALLER\'s search_path.')
}

if (notOurs.bwc.length || notOurs.platform.length) {
  console.log('\n  PROBABLY NOT BENCHCOACH')
  if (notOurs.bwc.length) console.log(`    bwc_* (${notOurs.bwc.length}): ${notOurs.bwc.join(', ')}`)
  if (notOurs.platform.length) console.log(`    platform (${notOurs.platform.length}): ${notOurs.platform.slice(0, 20).join(', ')}`)
}

console.log('')
console.log(clean
  ? '  Secret scan clean. The inventory above still needs a human.'
  : '  NOT SAFE TO COMMIT.')
console.log('')
process.exit(clean ? 0 : 1)
