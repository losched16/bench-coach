# Season to season: age group, seasons, and the roster archive

A youth team ages up every year with most of the same kids. Three things
change; everything else carries over.

## Age group

Team Settings → Team Info. The age group is a field, chosen from the same
list every page uses (`lib/ageGroups.ts`). A one-click prompt offers the next
group up. Saved with the rest of the team settings.

The age group is read by CoachAI's prompts, the practice templates, the
drill retrieval age filters and the pitch-count rules, so a team that moves
to 9U gets 9U guidance from the moment it is saved.

## Season

Team Settings → Season. Shows the current season (`seasons` row the team
points at via `teams.season_id`) and lets the coach:

- **Edit dates** — name, start and end of the current season, in place.
- **Start a new season** — a new `seasons` row (same `league_type`), and the
  team's `season_id` moves to it. The age group chosen above is saved at the
  same time.

Nothing on the team moves. Roster, notes, reports, practice plans, games and
history all stay with the team. What the season changes is the window a new
player report offers sources from (`lib/playerReportSources.ts`,
`seasonWindow`) and the report's season label.

## Roster archive

Roster → **Archive** on a player card, with an optional reason. Migration
`061_roster_archive.sql`.

Archiving moves the player's `team_players` row into `team_player_archive`,
with positions, the six 1–5 ratings, focus notes, locked/excluded positions,
innings bounds and position eligibility saved as JSON (`lib/rosterArchive.ts`).
Because the roster row is gone, lineups, practice plans, CoachAI's context,
the log and stats stop offering the player — without any of those places
being changed. That is why it is a separate table and not a flag: the safe
behaviour is the default, not something every reader has to remember.

What stays: `player_notes`, `player_reports`, `player_metrics`,
`prescriptions`, `observations`, `entries`, `player_traits` are keyed on
`player_id` + `team_id`, not on the roster row, so they are untouched. The
player's page still opens (linked from the **Archived players** section of
the roster) with a banner; ratings are shown as they were and are read-only
until restored.

**Restore to roster** puts the row back with the same positions, ratings and
eligibility, and removes the archive entry.

**Delete permanently** is still there, reached from the archive dialog, and
now says what it does: removes the roster row and, if the child is on no
other team, the player record and every note, report and measurement.

RLS on `team_player_archive` mirrors `team_players`: any member reads, admin
and owner write.

## Tests

`npm run test:roster-archive` — the snapshot round-trips through JSON, an
older or malformed snapshot restores rather than throws, and the age-group
list is in order.
