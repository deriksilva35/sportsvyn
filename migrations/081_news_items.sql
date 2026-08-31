-- 081_news_items.sql — THE WIRE. One table for every headline the product
-- emits, whether it came from our own numbers or from somebody else's feed.
--
-- NO BODY COLUMN, ON PURPOSE, and a test enforces it. This is a WIRE, not a
-- syndication: a headline, a link, and who said it. Storing article bodies
-- would change what this table is and what rights it needs, and a nullable
-- body column is how that happens by accident six months from now.
--
-- dedupe_hash IS THE LOAD-BEARING COLUMN. Four of the six data-native emitters
-- need no history table at all because of it: the emitter recomputes a
-- deterministic key from what it observed, and a UNIQUE index makes the second
-- computation a no-op. A 15-minute cron re-reading the same is_current odds row
-- emits once. Get the key wrong and the wire either duplicates or goes silent,
-- so every emitter's key is spelled out in its own file and pinned by test.
--
-- team_ids IS AN ARRAY because most events concern two clubs - a line move and
-- a final both do - and some concern none. A GIN index makes "everything about
-- this team" one query, which is what a team page will ask for.

CREATE TABLE IF NOT EXISTS news_items (
  id                 bigserial PRIMARY KEY,
  league_id          integer REFERENCES leagues(id),
  team_ids           integer[] NOT NULL DEFAULT '{}',
  -- The emitter or ingest that produced this row. Not a display category:
  -- what a surface SHOWS is a rendering decision made later.
  lane               text NOT NULL,
  headline           text NOT NULL,
  url                text,
  source             text NOT NULL,
  -- WHEN IT HAPPENED vs WHEN WE SAW IT, kept apart. A club feed's pubDate can
  -- be hours old on first sight, and an injury row can carry no date at all,
  -- so published_at is NULLABLE and seen_at never is. A surface that sorts by
  -- published_at must decide what to do with a null; one that sorts by seen_at
  -- is always ordered.
  published_at       timestamptz,
  seen_at            timestamptz NOT NULL DEFAULT now(),
  dedupe_hash        text NOT NULL,
  payload            jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- RELAY 2. The AI take is not written this relay; the column exists so relay
  -- 2 is an UPDATE rather than a migration, and so a row with no take is
  -- visibly a row nobody has taken yet.
  take               text,
  take_generated_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_items_dedupe_hash_key UNIQUE (dedupe_hash)
);

CREATE INDEX IF NOT EXISTS news_items_teams_idx ON news_items USING gin (team_ids);
-- The wire's own ordering: newest first, and the retention sweep reads it too.
CREATE INDEX IF NOT EXISTS news_items_seen_idx ON news_items (seen_at DESC);
CREATE INDEX IF NOT EXISTS news_items_league_seen_idx ON news_items (league_id, seen_at DESC);
CREATE INDEX IF NOT EXISTS news_items_lane_idx ON news_items (lane, seen_at DESC);

-- ---------------------------------------------------------------------------
-- The club feeds. THIRTY-TWO ROWS, ONE PER NFL CLUB.
--
-- THE TEAM IS THE FEED, NOT THE ITEM. No club item carries a machine-readable
-- team - media:keywords is editorial categories - so team_ids is assigned from
-- the row we polled. That is cleaner than parsing and cannot be wrong.
--
-- THE NATIONALS ARE NOT HERE AND WERE NOT ATTEMPTED. ESPN answers its RSS
-- endpoints with 202 and a ZERO-BYTE body - a bot wall, not a feed - and
-- NFL.com's feed paths return an HTML error page. Both are unavailable without
-- a licensed feed, and neither is worth a scraper.
--
-- COLLEGE HAS NO ROW HERE. The /rss/news pattern is an NFL club-site
-- convention; ramblinwreck.com/rss/news is a 404. CFB stays lane 1 until a
-- college source exists.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS news_feeds (
  id            serial PRIMARY KEY,
  league_id     integer NOT NULL REFERENCES leagues(id),
  team_id       integer REFERENCES teams(id),
  name          text NOT NULL,
  url           text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_polled_at timestamptz,
  last_ok_at    timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT news_feeds_url_key UNIQUE (url)
);
