-- ============================================================================
-- Which migrations have actually been applied?
-- ============================================================================
-- Read-only. Paste into the Supabase SQL editor and run.
--
-- Every "needsMigration" banner in the app used to name one hardcoded file
-- whatever the real failure was, so a page could tell you to re-run something
-- you had already run. This answers the question directly.
--
-- Anything marked MISSING means: run that file in /migrations. They are all
-- additive and safe to re-run.
-- ============================================================================

WITH checks(migration, feature, kind, obj, col) AS (VALUES
  ('012_activity_log.sql',              'Log an Entry, priorities',      'table',  'entries',            NULL),
  ('012_activity_log.sql',              'Log an Entry, priorities',      'table',  'observations',       NULL),
  ('012_activity_log.sql',              'Log an Entry, priorities',      'table',  'prescriptions',      NULL),
  ('014_checkins.sql',                  'Check-ins',                     'table',  'checkins',           NULL),
  ('014_checkins.sql',                  'Check-in reminders',            'column', 'prescriptions',      'last_checkin_notified_at'),
  ('015_focus_areas.sql',               'Parallel priorities',           'column', 'prescriptions',      'focus_area'),
  ('016_game_notes_and_quick_counts.sql','Pitch counter',                'table',  'pitch_count_sessions', NULL),
  ('017_scouting_analysis.sql',         'Opponent analysis',             'table',  'opponent_analyses',  NULL),
  ('018_one_game_one_record.sql',       'One game, one record',          'column', 'game_lineups',       'game_id'),
  ('019_metrics.sql',                   'Measurements',                  'table',  'metric_types',       NULL),
  ('019_metrics.sql',                   'Measurements',                  'column', 'player_metrics',     'metric_type_id'),
  ('020_chat_threads.sql',              'Separate conversations',        'column', 'chat_threads',       'last_message_at'),
  ('021_chat_thread_scope.sql',         'Conversation scope',            'column', 'chat_threads',       'player_id'),
  ('021_chat_thread_scope.sql',         'Priorities written into chat',  'column', 'chat_messages',      'meta'),
  ('022_priority_interaction.sql',      'Swapping drills',               'column', 'prescriptions',      'drill_swaps'),
  ('022_priority_interaction.sql',      'On-demand check-ins',           'column', 'checkins',           'coach_update'),
  ('023_development_plans.sql',         'Development plans',             'column', 'prescriptions',      'development_plan'),
  ('024_tiers.sql',                     'Personal and Coach tiers',      'column', 'teams',              'workspace_kind'),
  ('025_quick_log.sql',                 'One-tap session logging',       'column', 'entries',            'quick_log'),
  ('027_lineup_constraints.sql',        'Position locks',                'column', 'team_players',       'locked_position'),
  ('027_lineup_constraints.sql',        'Innings minimums',              'column', 'team_players',       'min_innings'),
  ('028_live_lineup.sql',               'The lineup, live',              'table',  'game_participation', NULL),
  ('028_live_lineup.sql',               'Who played where',              'table',  'game_position_log',  NULL),
  ('028_live_lineup.sql',               'Substitution rules',            'column', 'games',              'sub_rules'),
  ('029_house_rules.sql',               'House rules',                   'column', 'games',              'house_rules'),
  ('030_scorebook.sql',                 'The scorebook',                 'table',  'game_events',        NULL),
  ('030_scorebook.sql',                 'Home or away',                  'column', 'games',              'is_home'),
  ('031_half_innings_and_eligibility.sql','Half-innings',                 'column', 'games',              'current_half'),
  ('031_half_innings_and_eligibility.sql','Their pitch counts',           'column', 'game_pitch_counts',  'is_opponent'),
  ('031_half_innings_and_eligibility.sql','Eligibility for one game',     'table',  'game_position_eligibility', NULL),
  ('032_opponent_lineup.sql',           'Their batting order',           'table',  'game_opponent_lineup', NULL),
  ('033_opponent_threads.sql',          'Chat about one opponent',       'column', 'chat_threads',       'opponent_team_id'),
  ('034_staff_access.sql',              'Staff can use the app',         'function', 'bc_team_role',     NULL),
  ('034_staff_access.sql',              'Staff can use the app',         'policy', 'teams',              'bc_read_member_team'),
  ('035_plan_sessions.sql',             'Action plan checklist',         'table',  'plan_session_log',   NULL)
)
SELECT
  c.migration,
  c.feature,
  CASE
    WHEN c.kind = 'table' THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema = 'public' AND t.table_name = c.obj
      ) THEN 'ok' ELSE 'MISSING' END
    -- 034 creates functions and policies rather than tables, so it needs its
    -- own two checks.
    WHEN c.kind = 'function' THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = c.obj
      ) THEN 'ok' ELSE 'MISSING' END
    WHEN c.kind = 'policy' THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = c.obj AND policyname = c.col
      ) THEN 'ok' ELSE 'MISSING' END
    ELSE
      CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns k
        WHERE k.table_schema = 'public' AND k.table_name = c.obj AND k.column_name = c.col
      ) THEN 'ok' ELSE 'MISSING' END
  END AS status,
  c.obj || COALESCE('.' || c.col, '') AS object
FROM checks c
ORDER BY status DESC, c.migration, object;
