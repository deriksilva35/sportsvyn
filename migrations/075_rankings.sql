-- 075_rankings.sql - AP Top 25 and the Coaches Poll.
--
-- TWO TABLES, NOT ONE WITH A poll COLUMN. They are field-identical today
-- (probed: rank, teamId, school, conference, firstPlaceVotes, points on both),
-- so a shared table is tempting. They are refused it because they have
-- different JOBS: AP drives Pick'em's inclusion rule and every rank badge on
-- the platform, the Coaches Poll drives nothing and is display-only. A shared
-- table makes "which poll?" a WHERE clause that every future reader must
-- remember to write, and the first one that forgets silently picks games off
-- the wrong poll. Separate tables make the wrong poll unreachable by name.
--
-- AND NOT THE EXISTING ranking_* TABLES. Those model Sportsvyn's own editorial
-- composite - 30+ columns of editorial/sites/user weights, blurbs, methodology
-- versions, publishing status. An AP poll is 25 immutable rows a week from a
-- third party. Storing it there would mean thirty null columns per row and
-- would entangle a factual feed with an editorial pipeline.
--
-- RANK IS NOT UNIQUE. The 2026 week 1 AP poll ties USC and BYU at #14 and skips
-- #15 outright. A UNIQUE index on (season, week, rank) would have rejected the
-- very first real import. The team is what is unique within a week.

CREATE TABLE IF NOT EXISTS ap_rankings (
  id                 BIGSERIAL PRIMARY KEY,
  season             INTEGER NOT NULL,
  week               INTEGER NOT NULL,
  season_type        TEXT NOT NULL DEFAULT 'regular',
  team_id            INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rank               INTEGER NOT NULL,
  points             INTEGER,
  first_place_votes  INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ap_rankings_week_team_uniq UNIQUE (season, week, season_type, team_id)
);

CREATE TABLE IF NOT EXISTS coaches_rankings (
  id                 BIGSERIAL PRIMARY KEY,
  season             INTEGER NOT NULL,
  week               INTEGER NOT NULL,
  season_type        TEXT NOT NULL DEFAULT 'regular',
  team_id            INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  rank               INTEGER NOT NULL,
  points             INTEGER,
  first_place_votes  INTEGER,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT coaches_rankings_week_team_uniq UNIQUE (season, week, season_type, team_id)
);

-- The read the Rankings page issues: one poll, one week, in rank order.
CREATE INDEX IF NOT EXISTS ap_rankings_week_idx
  ON ap_rankings (season, season_type, week, rank);
CREATE INDEX IF NOT EXISTS coaches_rankings_week_idx
  ON coaches_rankings (season, season_type, week, rank);

-- The read the INCLUSION RULE issues, once per board build: "is this team
-- ranked in this week". Team-first, because that is the direction the EXISTS
-- clause in slateFor() looks it up.
CREATE INDEX IF NOT EXISTS ap_rankings_team_idx
  ON ap_rankings (team_id, season, week);
