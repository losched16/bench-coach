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
  ('022_priority_interaction.sql',      'On-demand check-ins',           'column', 'checkins',           'coach_update')
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
    ELSE
      CASE WHEN EXISTS (
        SELECT 1 FROM information_schema.columns k
        WHERE k.table_schema = 'public' AND k.table_name = c.obj AND k.column_name = c.col
      ) THEN 'ok' ELSE 'MISSING' END
  END AS status,
  c.obj || COALESCE('.' || c.col, '') AS object
FROM checks c
ORDER BY status DESC, c.migration, object;
