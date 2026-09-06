-- ============================================================================
-- Migration 054: Player development reports
-- ============================================================================
-- A coach finishes a season knowing exactly what they want to say about a kid,
-- and has no way to say it. What actually happens today is a text message at
-- 10pm — "Charlie had a great year, keep working on ground balls" — which is
-- true, kind, and gone by Tuesday. The family gets nothing they can act on and
-- nothing they can keep.
--
-- This is the document instead: what the player does well, one to three things
-- to work on next, the drills from BenchCoach's own library that work on them,
-- and the coach's own words. It ends at a PDF the coach shares themselves.
-- There is deliberately no parent account, no invitation, no link to send.
--
-- THE GOVERNING RULE: AI ASSISTS, THE COACH APPROVES
--
-- Nothing in these tables was written by a model without a coach reading it
-- first. The rewrite surface returns a suggestion to the browser and writes
-- NOTHING; only text the coach accepted is ever stored. That is why there are
-- no *_ai_suggested columns here — an unaccepted suggestion is not a fact
-- about a child and does not belong in a database.
--
-- IMMUTABILITY
--
-- A finalized report has probably already been emailed to a family. If the
-- coach later edits it, the PDF in the parent's inbox and the report in the
-- app quietly disagree, and the app is the one that is wrong. So finalizing
-- freezes the row — in the API and again in RLS below — and "edit" means
-- "start a revision", which is a new draft carrying revision_of.
--
-- THE LEAGUE LAYER
--
-- Every policy below gates on bc_team_at_least(team_id, …) from migration 034
-- and on nothing else. That is deliberate and it is load-bearing: the league
-- layer (050_league_layer.sql) keeps commissioners out of a coach's private
-- work by never letting league membership into that expression, so a report
-- is exactly as private as a player note. Do not add a league helper to any
-- policy here. scripts/test-player-report.ts checks this file for it.
--
-- NUMBERING
--
-- This file was applied to production on 2026-09-06 under the name 046, then
-- renumbered — 046 and 050 both collided with migrations on other branches
-- that a stale checkout had not seen. The schema is identical; only the name
-- changed. If the database already has player_reports, this file is a no-op.
--
-- Additive and idempotent. Apply in the Supabase SQL editor.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The report
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_reports (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The authorization scope. Every route resolves report -> team_id and hands
  -- that to authorizeTeam(), so a report is exactly as reachable as the team
  -- it belongs to and no more. CASCADE because a deleted team takes its
  -- season's reports with it — there is no player left to report on.
  team_id     UUID REFERENCES teams(id)   ON DELETE CASCADE NOT NULL,
  player_id   UUID REFERENCES players(id) ON DELETE CASCADE NOT NULL,

  -- The workspace owner, mirroring prescriptions.coach_id. Not the author:
  -- an assistant coach with admin rights writes into the head coach's
  -- workspace, which is the point of inviting them.
  coach_id    UUID REFERENCES coaches(id) ON DELETE CASCADE NOT NULL,
  -- Who actually wrote it, for the byline. SET NULL rather than CASCADE: an
  -- assistant leaving the club must not delete the reports they wrote, because
  -- those went to families.
  author_user_id UUID REFERENCES auth.users ON DELETE SET NULL,

  report_type TEXT NOT NULL DEFAULT 'general'
              CHECK (report_type IN ('midseason', 'end_of_season', 'general')),
  status      TEXT NOT NULL DEFAULT 'draft'
              CHECK (status IN ('draft', 'final')),
  report_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Player name, team name, age group, season, coach name — as they were on
  -- the day the coach finalized. A report from September 2026 must still say
  -- "8U · Fall 2026 · Coach Clint" after the team is renamed, the age group
  -- rolls over, or the season ends. Written on finalize, null while drafting
  -- (a draft reads the live values, which is what a coach still editing
  -- expects to see).
  context     JSONB,

  -- The approved prose. These are what the coach signed off on, not what any
  -- model proposed. Every one is nullable: a report with strengths, one
  -- development area and no closing comment is a perfectly good report, and
  -- the PDF omits what is empty rather than printing an empty heading.
  strengths_content     TEXT,
  development_intro     TEXT,   -- optional lead-in above the priorities
  closing_content       TEXT,

  -- Which of the seven focus areas (lib/focusAreas.ts) the coach marked as
  -- strengths. Deliberately the existing vocabulary rather than a new list of
  -- positive skill labels: the repo has exactly one taxonomy for things a
  -- player works on, and a second, parallel one for things they are good at
  -- is how two vocabularies drift apart. The coach's own sentences carry the
  -- specifics; this carries the structure.
  strength_areas TEXT[] NOT NULL DEFAULT '{}',

  -- Revisions. A finalized report is never edited; it is superseded by a new
  -- draft that starts as a copy. SET NULL so deleting an old revision cannot
  -- take the current one with it.
  revision_of UUID REFERENCES player_reports(id) ON DELETE SET NULL,
  revision    INT NOT NULL DEFAULT 1,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ,

  -- A final report has been sent to somebody. It must know when.
  CONSTRAINT player_reports_final_has_timestamp
    CHECK (status <> 'final' OR finalized_at IS NOT NULL)
);

-- The player profile's Reports tab, which is the only list anyone opens.
CREATE INDEX IF NOT EXISTS idx_player_reports_player
  ON player_reports (player_id, team_id, report_date DESC);
CREATE INDEX IF NOT EXISTS idx_player_reports_team
  ON player_reports (team_id, status);
CREATE INDEX IF NOT EXISTS idx_player_reports_coach
  ON player_reports (coach_id);

-- ----------------------------------------------------------------------------
-- 2. Development priorities
-- ----------------------------------------------------------------------------
-- The structured half of the report, and the reason this feature is worth
-- modelling properly rather than storing three paragraphs of prose.
--
-- Each row is one thing the coach wants the player to work on next, tied where
-- possible to the SAME problem_taxonomy the prescription engine and the drill
-- map already use. That is what makes a future question like "what are 8U
-- coaches actually working on this autumn" answerable without re-parsing
-- English. No such analytics are built here, and none should be until there is
-- a product decision about who may see aggregated data about children.
CREATE TABLE IF NOT EXISTS player_report_focus_areas (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID REFERENCES player_reports(id) ON DELETE CASCADE NOT NULL,

  -- The catalogued problem, when the coach picked one. SET NULL rather than
  -- CASCADE: retiring a taxonomy entry in 2027 must not silently delete a
  -- priority out of a report a family already has. `label` below is what the
  -- report actually says, so the row survives losing its slug intact.
  problem_slug TEXT REFERENCES problem_taxonomy(slug) ON DELETE SET NULL,

  -- One of the seven areas from lib/focusAreas.ts. Denormalized on purpose:
  -- it is the unit any future aggregation would group by, it is derivable
  -- from the slug today but not from a slug that has been retired, and a
  -- priority the coach typed freehand has an area but no slug.
  focus_area TEXT
             CHECK (focus_area IS NULL OR focus_area IN (
               'hitting', 'pitching', 'throwing', 'fielding',
               'catching', 'baserunning', 'athleticism'
             )),

  -- What the report calls it. Snapshotted from problem_taxonomy.label at the
  -- time, or typed by the coach.
  label      TEXT NOT NULL,

  -- What the coach typed, before any help. Kept because it is the evidence
  -- that the approved wording below says the same thing — if a rewrite ever
  -- drifts from a coach's meaning, this is the only way to see it.
  coach_notes      TEXT,
  -- What the coach approved. This is what the parent reads.
  approved_content TEXT,

  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_player_report_focus_report
  ON player_report_focus_areas (report_id, sort_order);
-- The index a future aggregation would need. Cheap now, awkward to add later.
CREATE INDEX IF NOT EXISTS idx_player_report_focus_problem
  ON player_report_focus_areas (problem_slug) WHERE problem_slug IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 3. Recommended drills
-- ----------------------------------------------------------------------------
-- The coach chose these from the BenchCoach library. Nothing here is invented:
-- drill_id points at a real curated row, and `snapshot` is a copy of the
-- handful of fields the report actually prints.
--
-- WHY BOTH. drill_id is the live link — it is what lets a future feature say
-- "this drill has been recommended 40 times" and what the app follows when the
-- coach opens the drill. `snapshot` is what the report SAYS. Those must be
-- allowed to differ: the library gets re-curated, titles get fixed, a video
-- gets replaced, and a report a parent received in September must not quietly
-- become a different document in March.
--
-- Only the printed fields are copied, not the whole row. Duplicating 38
-- columns per drill per report would mean every future column silently arrives
-- unpopulated in old snapshots, which is worse than not having it.
CREATE TABLE IF NOT EXISTS player_report_drills (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  report_id UUID REFERENCES player_reports(id) ON DELETE CASCADE NOT NULL,

  -- Which priority it addresses. SET NULL so removing a priority from a draft
  -- leaves the drill in the report rather than deleting a coach's selection
  -- out from under them; the UI then shows it as a general recommendation.
  focus_area_id UUID REFERENCES player_report_focus_areas(id) ON DELETE SET NULL,

  -- SET NULL, never CASCADE. A drill retired from the library in 2027 must not
  -- delete itself out of a 2026 report. The snapshot keeps the report whole.
  drill_id UUID REFERENCES drill_resources(id) ON DELETE SET NULL,

  -- { drill_name, description, focus, video_url, video_label, channel,
  --   reps_guidance, frequency_guidance } — everything the PDF prints.
  snapshot JSONB NOT NULL,

  -- "Recommended because: ground-ball fundamentals". Built from the taxonomy
  -- and the drill's own metadata, never by a model — a sentence explaining why
  -- a drill helps is exactly the kind of thing that sounds right and is wrong.
  recommendation_reason TEXT,

  -- Did BenchCoach suggest this one, or did the coach go and find it? Worth
  -- knowing before anyone claims the recommendations are good.
  source TEXT NOT NULL DEFAULT 'recommended'
         CHECK (source IN ('recommended', 'manual')),

  -- The coach can drop the video and keep the drill. Some families should not
  -- be sent to YouTube, and that is the coach's call, not ours.
  include_video BOOLEAN NOT NULL DEFAULT TRUE,

  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One drill once per report. Reordering changes sort_order, not membership.
  UNIQUE (report_id, drill_id)
);

CREATE INDEX IF NOT EXISTS idx_player_report_drills_report
  ON player_report_drills (report_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_player_report_drills_drill
  ON player_report_drills (drill_id) WHERE drill_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. updated_at
-- ----------------------------------------------------------------------------
-- search_path is pinned empty. A trigger function that inherits the caller's
-- search_path can be made to resolve a different NOW() by anyone who can set
-- one, and Supabase's own linter flags it. Nothing here needs a schema —
-- pg_catalog is always implicitly first — so the safe setting is also the
-- simplest one.
CREATE OR REPLACE FUNCTION bc_touch_player_report()
RETURNS TRIGGER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_player_reports_touch ON player_reports;
CREATE TRIGGER trg_player_reports_touch
  BEFORE UPDATE ON player_reports
  FOR EACH ROW EXECUTE FUNCTION bc_touch_player_report();

-- ----------------------------------------------------------------------------
-- 5. Row Level Security
-- ----------------------------------------------------------------------------
-- The API routes use the service role and are guarded by lib/authz.ts, so
-- these policies are what protects the browser client — the Reports tab reads
-- the list directly, the same way the roster page reads players.
--
-- The model matches migration 034 exactly, because the two enforcement points
-- must not disagree about who may do what:
--
--   READ    any member, including a viewer.
--   WRITE   admin and above ('decide').
--
-- Authoring is deliberately NOT 'record'. A contributor is a parent helping
-- with the book; recording that a kid struck out is a fact about tonight.
-- Writing a development document about a child, under the head coach's name,
-- to that child's family, is not — it is a decision about the season, and it
-- belongs to the people who own the team.
--
-- Every statement is guarded so this file can run against a database where
-- migration 034's helpers are missing.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'bc_team_at_least') THEN
    RAISE NOTICE 'bc_team_at_least() not found — run migration 034 first, then re-run this file to install the player-report policies.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE player_reports            ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE player_report_focus_areas ENABLE ROW LEVEL SECURITY';
  EXECUTE 'ALTER TABLE player_report_drills      ENABLE ROW LEVEL SECURITY';

  -- ---- player_reports -----------------------------------------------------
  EXECUTE 'DROP POLICY IF EXISTS "Members read player reports" ON player_reports';
  EXECUTE $p$
    CREATE POLICY "Members read player reports" ON player_reports
      FOR SELECT USING (bc_team_at_least(team_id, 'viewer'))
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS "Admins write player reports" ON player_reports';
  EXECUTE $p$
    CREATE POLICY "Admins write player reports" ON player_reports
      FOR INSERT WITH CHECK (bc_team_at_least(team_id, 'admin'))
  $p$;

  -- A finalized report is frozen. The USING clause is the important half: it
  -- decides which rows may be updated AT ALL, so a row that is already final
  -- is invisible to UPDATE no matter what the new values say.
  --
  -- Note that this also means finalizing itself cannot be done through the
  -- browser client, which is correct: /api/player-reports/[id]/finalize uses
  -- the service role and takes the context and drill snapshots in the same
  -- transaction-shaped sequence. There is deliberately no way to flip a report
  -- to final without going through that.
  EXECUTE 'DROP POLICY IF EXISTS "Admins edit draft player reports" ON player_reports';
  EXECUTE $p$
    CREATE POLICY "Admins edit draft player reports" ON player_reports
      FOR UPDATE
      USING (bc_team_at_least(team_id, 'admin') AND status = 'draft')
      WITH CHECK (bc_team_at_least(team_id, 'admin'))
  $p$;

  -- Deleting a report a family may already have is not a thing the app offers.
  -- Drafts, which nobody has seen, can be thrown away.
  EXECUTE 'DROP POLICY IF EXISTS "Admins delete draft player reports" ON player_reports';
  EXECUTE $p$
    CREATE POLICY "Admins delete draft player reports" ON player_reports
      FOR DELETE USING (bc_team_at_least(team_id, 'admin') AND status = 'draft')
  $p$;

  -- ---- children -----------------------------------------------------------
  -- Both child tables inherit their parent's access and its draft rule, so
  -- there is no way to edit a finalized report by editing its pieces.
  EXECUTE 'DROP POLICY IF EXISTS "Members read report focus areas" ON player_report_focus_areas';
  EXECUTE $p$
    CREATE POLICY "Members read report focus areas" ON player_report_focus_areas
      FOR SELECT USING (EXISTS (
        SELECT 1 FROM player_reports r
        WHERE r.id = report_id AND bc_team_at_least(r.team_id, 'viewer')
      ))
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS "Admins write report focus areas" ON player_report_focus_areas';
  EXECUTE $p$
    CREATE POLICY "Admins write report focus areas" ON player_report_focus_areas
      FOR ALL USING (EXISTS (
        SELECT 1 FROM player_reports r
        WHERE r.id = report_id
          AND bc_team_at_least(r.team_id, 'admin')
          AND r.status = 'draft'
      ))
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS "Members read report drills" ON player_report_drills';
  EXECUTE $p$
    CREATE POLICY "Members read report drills" ON player_report_drills
      FOR SELECT USING (EXISTS (
        SELECT 1 FROM player_reports r
        WHERE r.id = report_id AND bc_team_at_least(r.team_id, 'viewer')
      ))
  $p$;

  EXECUTE 'DROP POLICY IF EXISTS "Admins write report drills" ON player_report_drills';
  EXECUTE $p$
    CREATE POLICY "Admins write report drills" ON player_report_drills
      FOR ALL USING (EXISTS (
        SELECT 1 FROM player_reports r
        WHERE r.id = report_id
          AND bc_team_at_least(r.team_id, 'admin')
          AND r.status = 'draft'
      ))
  $p$;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Documentation
-- ----------------------------------------------------------------------------
COMMENT ON TABLE  player_reports IS
  'Player development reports a coach writes and shares with a family as a PDF. Finalized rows are immutable — edits create a new revision.';
COMMENT ON COLUMN player_reports.context IS
  'Team/season/age/coach names as at finalization, so an old report still reads correctly after the team is renamed.';
COMMENT ON COLUMN player_reports.strength_areas IS
  'Focus areas from lib/focusAreas.ts. Structured strengths without inventing a second skill taxonomy.';
COMMENT ON TABLE  player_report_focus_areas IS
  '1-3 development priorities per report, tied to problem_taxonomy where the coach picked a catalogued problem.';
COMMENT ON TABLE  player_report_drills IS
  'Drills the coach selected from the BenchCoach library. snapshot preserves what the report printed; drill_id is the live link and may go null if the drill is retired.';

-- ----------------------------------------------------------------------------
-- Review
-- ----------------------------------------------------------------------------
-- Reports written, by type and status:
--   SELECT report_type, status, count(*) FROM player_reports
--   GROUP BY 1, 2 ORDER BY 1, 2;
--
-- What coaches are actually working on (the shape a future league view would
-- take — NOT built, and not to be built without a decision about who may see
-- aggregated data about children):
--   SELECT f.focus_area, f.label, count(*)
--   FROM player_report_focus_areas f
--   JOIN player_reports r ON r.id = f.report_id
--   WHERE r.status = 'final'
--   GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 20;
--
-- Reports still pointing at drills that have since been retired — the snapshot
-- means these still render correctly, so this is curiosity, not an alarm:
--   SELECT count(*) FROM player_report_drills WHERE drill_id IS NULL;
