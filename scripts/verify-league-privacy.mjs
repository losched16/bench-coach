#!/usr/bin/env node
// A commissioner must never be able to read a coach's private work.
//
// This is the promise that makes the league layer sellable. A volunteer coach
// writes "Jayden's dad shouts at him from the fence, keep him at second" into a
// player note. If a league administrator can read that, the coach stops writing
// it down, and a product nobody writes anything into is worth nothing to either
// of them.
//
// Reviews alone will not hold that line. Somebody adding a "coach detail" panel
// two quarters from now reaches for the join that makes it work, and the tables
// are right there. So the boundary is checked mechanically, at build time,
// exactly like verify:drills and verify:authz.
//
// WHAT CHANGED IN THE SECOND PASS
//
// The first version had holes it admitted to in the audit brief: it only looked
// at literal .from('table') strings inside app/api/league*, so a Postgres
// function reached through .rpc(), a dynamically built table name, or a league
// surface living somewhere else entirely would all have sailed past. Those are
// now covered:
//
//   * .rpc() must name a function on an explicit allowlist. A new RPC is a
//     deliberate act with a stated reason, not something that appears in a diff.
//   * .from(<not a literal>) is refused outright inside league routes — a
//     computed table name cannot be checked, so it cannot be allowed.
//   * League surfaces are discovered by CONTENT as well as by path, so a route
//     anywhere in app/api that talks to league tables or league authorization
//     is checked too.
//   * PostgREST embedded joins (`select('id, player_notes(note)')`) are parsed,
//     because that is the one syntax that reads another table without ever
//     naming it in a .from().
//
//   npm run verify:league-privacy

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

// Free text written by a coach about a child, an opponent or their own team.
// None of this is a commissioner's business and none of it appears in an
// adoption report.
const PRIVATE_TABLES = [
  'chat_messages',         // what a coach asked CoachAI, and what it answered
  'player_notes',          // notes about a named child
  'player_traits',         // persistent personality/behaviour notes
  'team_notes',            // the coach's own notes on their team
  'scouting_entries',      // scouting captures
  'opponent_analyses',     // AI analysis of opponents
  'opponent_players',
  'opponent_teams',
  'observations',          // what was seen in a game
  'entries',               // the activity log's free text
  'prescriptions',         // the diagnosed priority for a named player
  'team_memory_summaries', // what the app remembers about a team
  'player_metrics',        // a named child's measurements
  'game_notes',
  'swing_analyses',
  'coach_preferences',
]

// Allowed, but only for counting and only these columns. The value of "eleven
// practice plans" is the eleven; the plans themselves are not on offer.
const METADATA_ONLY = {
  practice_plans: ['id', 'team_id', 'created_at'],
  chat_threads: ['id', 'team_id'],
  team_players: ['id', 'team_id'],
  games: ['id', 'team_id'],
}

// Column names that carry coach- or player-written prose, wherever they appear.
const FORBIDDEN_COLUMNS = [
  'content', 'note', 'notes', 'title', 'summary', 'recap_note', 'focus_notes',
  'memory_suggestions', 'outcome_note', 'success_criteria', 'priority',
]

// Postgres functions a league route may call, each with the reason it is safe.
// A function is a black box to a static checker — it can read anything — so the
// only defensible rule is that the list is short, explicit, and reviewed.
const ALLOWED_RPCS = {
  bc_claim_league_seat:
    'migration 050 — locks the licence row, counts accepted invitations, flips one ' +
    'invitation to accepted. Touches league_licenses and league_invitations only, ' +
    'and returns booleans and counts.',
  bc_release_league_seat:
    'migration 050 — sets one invitation back to pending. Touches league_invitations ' +
    'only and returns a boolean.',
}

const LEAGUE_ROUTE_DIRS = ['app/api/league', 'app/api/league-admin']
// A route is also "league-facing" if it talks to league tables or league
// authorization, wherever it lives. Path is a convention; this is a fact.
const LEAGUE_CONTENT_MARKERS = [
  'leagueAuthz', 'requireLeagueRole', 'guardLeague', 'getLeagueMembership',
  "from('league_", 'from("league_', 'leagueEntitlements', 'getUserEntitlements',
]
const GUARDS = ['guardLeague(', 'requireLeagueRole(', 'requireSession(', 'requireAdmin(']

// Authenticated by other means, with the reason. Same list and same standard as
// scripts/verify-authz.mjs — adding to it is a deliberate act, and every privacy
// check still applies to these files.
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

// Comments describe the boundary at length in these files, and naming a table in
// order to say "we never read this" must not trip the check that we never read
// it. Strings are preserved: that is where the table names actually live.
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}


function revokeBlock(sql) {
  // The DO block that performs the REVOKEs, so a check can confirm both the
  // function and the role are named inside the SAME block rather than merely
  // appearing somewhere in the file.
  const i = sql.indexOf('REVOKE ALL ON FUNCTION')
  if (i === -1) return ''
  const start = sql.lastIndexOf('DO $$', i)
  const end = sql.indexOf('END $$;', i)
  return start === -1 || end === -1 ? '' : sql.slice(start, end)
}

const problems = []
const inspected = []

// ── Discover every league-facing route, by path OR by content ──────────────
const candidates = new Set()
for (const dir of LEAGUE_ROUTE_DIRS) for (const f of walk(dir)) candidates.add(f)
for (const f of walk('app/api')) {
  const raw = readFileSync(f, 'utf8')
  if (LEAGUE_CONTENT_MARKERS.some(m => raw.includes(m))) candidates.add(f)
}

for (const file of Array.from(candidates).sort()) {
  const src = stripComments(readFileSync(file, 'utf8'))
  inspected.push(file)

  // 1. Private tables named in any form.
  //
  // The lookbehind excludes method calls: Array.from(map.entries()) is
  // JavaScript, not the `entries` table, and flagging it would train people to
  // ignore this check — the failure mode that matters most for a rule nobody
  // can run in their head.
  for (const table of PRIVATE_TABLES) {
    if (new RegExp(`['"\`]${table}['"\`]|(?<![.\\w])${table}\\s*\\(`).test(src)) {
      problems.push(
        `${file} — references the private table "${table}". League reporting is built from ` +
        `counts and timestamps, never from coach-written content.`
      )
    }
  }

  // 2. Metadata tables: only the allowed columns.
  for (const [table, allowed] of Object.entries(METADATA_ONLY)) {
    const re = new RegExp(`from\\(['"\`]${table}['"\`]\\)\\s*\\.select\\(\\s*['"\`]([^'"\`]*)['"\`]`, 'g')
    let m
    while ((m = re.exec(src)) !== null) {
      for (const col of m[1].split(',').map(c => c.trim()).filter(Boolean)) {
        if (!allowed.includes(col)) {
          problems.push(
            `${file} — selects "${col}" from ${table}. Only ${allowed.join(', ')} may be read ` +
            `there; everything else is the coach's content.`
          )
        }
      }
    }
  }

  // 3. Forbidden columns named in any select string, including inside a
  //    PostgREST embedded join — the one syntax that reads another table
  //    without ever naming it in a .from().
  const selects = src.match(/\.select\(\s*['"`][^'"`]*['"`]/g) || []
  for (const sel of selects) {
    for (const col of FORBIDDEN_COLUMNS) {
      if (new RegExp(`[('",\\s(]${col}\\s*[,'"\`\\s)]`).test(sel)) {
        problems.push(`${file} — a select names the column "${col}", which carries coach-written text.`)
      }
    }
    // An embedded join reads a whole other table: select('id, player_notes(note)').
    for (const embed of sel.match(/([a-z_]+)\s*\(/g) || []) {
      const name = embed.replace(/\s*\($/, '')
      if (PRIVATE_TABLES.includes(name)) {
        problems.push(`${file} — embeds the private table "${name}" in a select.`)
      }
    }
  }

  // 4. .rpc() must be on the allowlist. A Postgres function is opaque to a
  //    static checker and can read anything, so the only defensible rule is
  //    that each one is named and justified here.
  for (const m of src.matchAll(/\.rpc\(\s*['"`]([^'"`]+)['"`]/g)) {
    if (!(m[1] in ALLOWED_RPCS)) {
      problems.push(
        `${file} — calls the Postgres function "${m[1]}" which is not on the league RPC ` +
        `allowlist. A function can read any table, so add it to ALLOWED_RPCS in this script ` +
        `with a stated reason, or do not call it from a league surface.`
      )
    }
  }
  // A computed RPC name cannot be checked at all.
  if (/\.rpc\(\s*[^'"`\s)]/.test(src)) {
    problems.push(`${file} — calls .rpc() with a non-literal function name, which cannot be verified.`)
  }

  // 5. A computed table name cannot be checked either. Refused outright.
  //
  // The lookbehind spares Array.from(), which is JavaScript and appears all over
  // these files. Excluding it by name rather than loosening the pattern keeps
  // the check strict about the thing it actually cares about: a Supabase query
  // whose table this script cannot read.
  if (/(?<!Array)\.from\(\s*[^'"`\s)]/.test(src)) {
    problems.push(
      `${file} — calls .from() with a non-literal table name. League surfaces must name their ` +
      `tables literally so this check can see them.`
    )
  }

  // 6. Every league handler authorizes. verify:authz covers this too; repeated
  //    because that script's exemption list is editable and this is a different
  //    guarantee.
  if (!GUARD_EXEMPT[file]) {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      const at = src.search(new RegExp(`export async function ${method}\\s*\\(`))
      if (at === -1) continue
      if (!GUARDS.some(g => src.slice(at, at + 600).includes(g))) {
        problems.push(`${file} — ${method} does not authorize its caller before doing anything.`)
      }
    }
  }
}

// ── The database must agree with the routes ───────────────────────────────
const migration = readFileSync('migrations/050_league_layer.sql', 'utf8')

for (const stmt of migration.match(/CREATE POLICY[\s\S]*?;/gi) || []) {
  for (const table of [...PRIVATE_TABLES, 'teams', 'players', 'seasons', 'practice_plans', 'chat_threads']) {
    if (new RegExp(`\\bON\\s+${table}\\b`, 'i').test(stmt)) {
      problems.push(
        `migrations/050_league_layer.sql — creates a policy ON ${table}. The league layer must not ` +
        `widen access to team-scoped data; adoption reporting goes through authorized server-side ` +
        `queries instead.`
      )
    }
  }
}

// league_invitations holds live bearer tokens and must stay unreadable by the
// browser client entirely.
if (!/ALTER TABLE league_invitations ENABLE ROW LEVEL SECURITY/i.test(migration)) {
  problems.push('migrations/050_league_layer.sql — league_invitations does not have RLS enabled.')
}
if (/CREATE POLICY[^;]*ON\s+league_invitations/i.test(migration)) {
  problems.push(
    'migrations/050_league_layer.sql — league_invitations has an RLS policy. A table of live invite ' +
    'tokens readable by any authenticated user is an account takeover; it is service-role only by design.'
  )
}

// Every SECURITY DEFINER function the migration adds runs with the definer's
// rights, so one that is EXECUTE-able by the browser client is a hole straight
// through RLS. The seat functions must be revoked from anon/authenticated.
for (const fn of ['bc_claim_league_seat', 'bc_release_league_seat']) {
  if (!migration.includes(`CREATE OR REPLACE FUNCTION ${fn}`)) {
    problems.push(`migrations/050_league_layer.sql — ${fn}() is missing; the accept route depends on it.`)
    continue
  }
  const block = revokeBlock(migration)
  if (!(block.includes(fn) && block.includes('authenticated'))) {
    problems.push(
      `migrations/050_league_layer.sql — ${fn}() is SECURITY DEFINER but not revoked from ` +
      `authenticated. A signed-in browser client could call it directly.`
    )
  }
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
  `Checked ${inspected.length} league-facing route files (by path and by content), ` +
  `${Object.keys(ALLOWED_RPCS).length} allowlisted RPCs, and migration 050 — no league surface ` +
  `reads chat, player notes, team notes, scouting or any coach-written content; no league policy ` +
  `touches a team table; both SECURITY DEFINER functions are revoked from the browser client.`
)
