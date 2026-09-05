#!/usr/bin/env node
// A commissioner must never be able to read a coach's private work.
//
// This is the promise that makes the league layer sellable. A volunteer coach
// writes "Jayden's dad shouts at him from the fence, keep him at second" into a
// player note. If a league administrator can read that, the coach stops writing
// it down, and a product nobody writes anything into is worth nothing to
// either of them.
//
// Reviews alone will not hold that line. Somebody adding a "coach detail" panel
// two quarters from now reaches for the join that makes it work, and the tables
// are right there. So the boundary is checked mechanically, at build time,
// exactly like verify:drills and verify:authz.
//
// THREE THINGS ARE CHECKED
//
//   1. No league route names a private table at all.
//   2. The metadata tables league routes ARE allowed to touch (practice_plans,
//      chat_threads) are only ever asked for identifiers and timestamps —
//      never content, never titles.
//   3. Migration 050 adds no RLS policy to any private table, so the database
//      answer is the same as the route's.
//
//   npm run verify:league-privacy

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Free text written by a coach about a child, an opponent or their own team.
// None of this is a commissioner's business, and none of it appears in an
// adoption report.
const PRIVATE_TABLES = [
  'chat_messages',        // what a coach asked CoachAI, and what it answered
  'player_notes',         // notes about a named child
  'player_traits',        // persistent personality/behaviour notes
  'team_notes',           // the coach's own notes on their team
  'scouting_entries',     // scouting captures
  'opponent_analyses',    // AI analysis of opponents
  'opponent_players',
  'observations',         // what was seen in a game
  'entries',              // the activity log's free text
  'prescriptions',        // the diagnosed priority for a player
  'team_memory_summaries',// what the app remembers about a team
  'player_metrics',       // a named child's measurements
  'game_notes',
]

// Allowed, but only for counting. The value of "eleven practice plans" is the
// eleven; the plans themselves are not on offer.
const METADATA_ONLY = {
  practice_plans: ['id', 'team_id', 'created_at'],
  chat_threads: ['id', 'team_id'],
}

// Every column a league route may ever select from those tables.
const FORBIDDEN_COLUMNS = ['content', 'note', 'title', 'summary', 'recap_note', 'focus_notes', 'memory_suggestions']

const LEAGUE_ROUTE_DIRS = ['app/api/league', 'app/api/league-admin']
const GUARDS = ['guardLeague(', 'requireLeagueRole(', 'requireSession(']

// Authenticated by other means, with the reason. Same list and same standard as
// scripts/verify-authz.mjs — adding to it is a deliberate act, and the privacy
// checks above still apply to every file here.
const GUARD_EXEMPT = {
  'app/api/league/invite/accept/route.ts':
    'a token IS the credential — the caller is not a member of the league or the team yet',
}

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const name of entries) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

// Comments describe the boundary at length in these files, and naming a table
// in order to say "we never read this" must not trip the check that we never
// read it.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const problems = []
let routesChecked = 0

for (const dir of LEAGUE_ROUTE_DIRS) {
  for (const file of walk(dir)) {
    routesChecked++
    const raw = readFileSync(file, 'utf8')
    const src = stripComments(raw)

    // 1. Private tables, in any form — .from('x'), a PostgREST embed, anything.
    //
    // The lookbehind excludes method calls: Array.from(map.entries()) is
    // JavaScript, not the `entries` table, and flagging it would train people
    // to ignore this check — which is the failure mode that matters most for a
    // rule nobody can run in their head.
    for (const table of PRIVATE_TABLES) {
      if (new RegExp(`['"\`]${table}['"\`]|(?<![.\\w])${table}\\s*\\(`).test(src)) {
        problems.push(
          `${file} — references the private table "${table}". League reporting is built from counts and ` +
          `timestamps, never from coach-written content.`
        )
      }
    }

    // 2. Metadata tables: check what is actually selected.
    for (const [table, allowed] of Object.entries(METADATA_ONLY)) {
      const re = new RegExp(`from\\(['"\`]${table}['"\`]\\)\\s*\\.select\\(\\s*['"\`]([^'"\`]*)['"\`]`, 'g')
      let m
      while ((m = re.exec(src)) !== null) {
        const columns = m[1].split(',').map(c => c.trim()).filter(Boolean)
        for (const col of columns) {
          // Bare column names only; a nested select would be a different shape
          // and is caught by the "not in allowed" test below regardless.
          if (!allowed.includes(col)) {
            problems.push(
              `${file} — selects "${col}" from ${table}. Only ${allowed.join(', ')} may be read there; ` +
              `everything else is the coach's content.`
            )
          }
        }
      }
    }

    // 3. Belt and braces: a forbidden column named anywhere in a select string.
    const selects = src.match(/\.select\(\s*['"`][^'"`]*['"`]/g) || []
    for (const sel of selects) {
      for (const col of FORBIDDEN_COLUMNS) {
        if (new RegExp(`[('",\\s]${col}\\s*[,'"\`\\s]`).test(sel)) {
          problems.push(`${file} — a select names the column "${col}", which carries coach-written text.`)
        }
      }
    }

    // 4. Every league handler authorizes. verify:authz covers this too; it is
    //    repeated because the exemption list there is editable and this file is
    //    about a different guarantee.
    if (!GUARD_EXEMPT[file]) {
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        const at = src.search(new RegExp(`export async function ${method}\\s*\\(`))
        if (at === -1) continue
        const head = src.slice(at, at + 600)
        if (!GUARDS.some(g => head.includes(g))) {
          problems.push(`${file} — ${method} does not authorize its caller before doing anything.`)
        }
      }
    }
  }
}

// 5. The database must agree. Migration 050 must not grant league members a
//    read policy on any private table — if it did, the browser client could
//    reach what these routes carefully do not.
const migration = readFileSync('migrations/050_league_layer.sql', 'utf8')
const policyStatements = migration.match(/CREATE POLICY[\s\S]*?;/gi) || []
for (const stmt of policyStatements) {
  for (const table of [...PRIVATE_TABLES, 'teams']) {
    if (new RegExp(`\\bON\\s+${table}\\b`, 'i').test(stmt)) {
      problems.push(
        `migrations/050_league_layer.sql — creates a policy ON ${table}. The league layer must not widen ` +
        `access to team-scoped data; adoption reporting goes through authorized server-side queries instead.`
      )
    }
  }
}

// 6. league_invitations holds live bearer tokens and must stay unreadable by
//    the browser client entirely.
if (!/ALTER TABLE league_invitations ENABLE ROW LEVEL SECURITY/i.test(migration)) {
  problems.push('migrations/050_league_layer.sql — league_invitations does not have RLS enabled.')
}
if (/CREATE POLICY[^;]*ON\s+league_invitations/i.test(migration)) {
  problems.push(
    'migrations/050_league_layer.sql — league_invitations has an RLS policy. A table of live invite ' +
    'tokens readable by any authenticated user is an account takeover; it is service-role only by design.'
  )
}

if (problems.length > 0) {
  console.error('League privacy boundary violated:\n')
  for (const p of problems) console.error(`  ${p}`)
  console.error(
    '\nA league administrator may see that a coach is active and how much they have created.\n' +
    'They may not see what any of it says. If a report genuinely needs something here,\n' +
    'that is a product decision about coach privacy, not a query to widen.'
  )
  process.exit(1)
}

console.log(
  `Checked ${routesChecked} league route files and migration 050 — no league surface reads chat, ` +
  `player notes, team notes, scouting or any coach-written content, and no league policy touches a team table.`
)
