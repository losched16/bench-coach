// Turning a Postgres error into the migration that fixes it.
//
// Every API route that touches a newer table wraps its query in a try/catch and
// reports `needsMigration`, and every one of those banners names a single
// hardcoded file. That is fine right up until a DIFFERENT migration is the one
// missing — then the page confidently tells you to run something you already
// ran, and there is no way to find out what it actually wanted.
//
// Postgres already says exactly what it couldn't find. This maps that to the
// file that creates it.

// Which migration introduces which database object. Only objects added after
// the initial schema — anything in supabase-schema.sql is assumed present.
const OBJECT_TO_MIGRATION: Array<{ match: RegExp; file: string; what: string }> = [
  // 012 — the activity log and the prescriptions everything else hangs off
  { match: /\b(entries|observations|prescriptions|player_metrics|roster_name_mappings)\b/, file: '012_activity_log.sql', what: 'the activity log tables' },
  // 014 — the check-in record
  { match: /\b(checkins|last_checkin_notified_at)\b/, file: '014_checkins.sql', what: 'the check-in tables' },
  // 015 — one priority per area of the game
  { match: /\bfocus_area\b/, file: '015_focus_areas.sql', what: 'focus areas on priorities' },
  // 016 — game notes bridge and the standalone pitch counter
  { match: /\b(pitch_count_sessions|source_game_note_id)\b/, file: '016_game_notes_and_quick_counts.sql', what: 'pitch counting' },
  // 017 — rolling opponent analysis
  { match: /\b(opponent_analyses|analysis_stale)\b/, file: '017_scouting_analysis.sql', what: 'opponent analysis' },
  // 019 — coach-defined measurements
  { match: /\b(metric_types|metric_type_id)\b/, file: '019_metrics.sql', what: 'measurements' },
  // 020 — many conversations per team
  { match: /\b(last_message_at|archived)\b/, file: '020_chat_threads.sql', what: 'separate conversations' },
  // 021 — who a conversation is about
  { match: /\b(chat_threads\.player_id|meta)\b/, file: '021_chat_thread_scope.sql', what: 'conversation scope' },
  // 022 — interacting with a running priority
  { match: /\b(drill_swaps|retired_drill_ids|coach_update)\b/, file: '022_priority_interaction.sql', what: 'drill swaps and priority updates' },
  // 023 — the multi-week plan behind a priority
  { match: /\bdevelopment_plan\b/, file: '023_development_plans.sql', what: 'development plans' },
  // 024 — Personal and Coach
  { match: /\b(subscription_tier|workspace_kind)\b/, file: '024_tiers.sql', what: 'the subscription tiers' },
  // 025 — logging a session in one tap, without double-counting it
  { match: /\bquick_log\b/, file: '025_quick_log.sql', what: 'one-tap session logging' },
  // 027 — rules the lineup solver may not trade away
  { match: /\b(locked_position|excluded_positions|min_innings|max_innings)\b/, file: '027_lineup_constraints.sql', what: 'position locks and innings limits' },
  // 028 — who is in the game, and where
  { match: /\b(game_participation|game_position_log|sub_rules|lineup_locked_at|times_removed|reentries)\b/, file: '028_live_lineup.sql', what: 'the live lineup and substitution rules' },
  // 029 — league quirks the coach states in the dugout chat
  { match: /\bhouse_rules\b/, file: '029_house_rules.sql', what: 'house rules on a game' },
  // 030 — the book
  { match: /\b(game_events|is_home|scorebook_started_at|outs_after|bases_after|runs_scored)\b/, file: '030_scorebook.sql', what: 'the scorebook' },
]

export interface MigrationHint {
  // The file to run, when we can identify one
  file: string | null
  // What the missing thing enables, in the coach's terms
  what: string | null
  // The name Postgres couldn't resolve
  missing: string | null
  // Ready to show. Always says something useful, even when unmapped.
  message: string
}

// Postgres: 42P01 undefined_table, 42703 undefined_column, 42883 undefined_function
const SCHEMA_ERROR_CODES = new Set(['42P01', '42703', '42883', 'PGRST204', 'PGRST205'])

export function migrationHintFor(error: any): MigrationHint | null {
  if (!error) return null

  const code = String(error.code || '')
  const text = `${error.message || ''} ${error.details || ''} ${error.hint || ''}`

  // Only schema-shaped failures. A timeout or a permissions problem is not
  // solved by running SQL, and saying so sends people down the wrong path.
  const looksSchematic =
    SCHEMA_ERROR_CODES.has(code) ||
    /does not exist|could not find|schema cache|unknown column|undefined column|undefined table/i.test(text)

  if (!looksSchematic) return null

  // The quoted identifier in the error is the thing that's missing.
  const quoted = text.match(/'([a-zA-Z0-9_.]+)'/) || text.match(/"([a-zA-Z0-9_.]+)"/)
  const missing = quoted ? quoted[1] : null

  const hit = OBJECT_TO_MIGRATION.find(m => m.match.test(text))

  if (hit) {
    return {
      file: hit.file,
      what: hit.what,
      missing,
      message:
        `Your database is missing ${hit.what}${missing ? ` (${missing})` : ''}. ` +
        `Run migrations/${hit.file} in the Supabase SQL editor, then refresh.`,
    }
  }

  return {
    file: null,
    what: null,
    missing,
    message: missing
      ? `Your database is missing "${missing}". Check the files in /migrations for the one that adds it — they're safe to re-run.`
      : `The database rejected that query: ${error.message || 'unknown error'}. The files in /migrations are safe to re-run.`,
  }
}
