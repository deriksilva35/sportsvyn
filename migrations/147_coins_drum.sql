-- 147_coins_drum.sql - COINS + THE DRUM, the weekly drawing (coins-2, Rules v0.1;
-- spec docs/design/coins-drum-spec.md).
--
-- A WEEK opens Tue 09:00:00 PT and closes the next Tue 08:59:59 PT (the Close);
-- the drawing runs at the Close. Play earns ARCADE POINTS (one row per user,
-- contest and event - the UNIQUE key is the idempotence of the hourly mint job,
-- lib/coins/mint.js); every 100 points mints a COIN (coin_mint) into the week.
-- Coins are DROPPED into a week's prize drums (drum_entries); a drop is final.
--
-- COINS IN HAND = minted - dropped, computed, NEVER STORED: one number that two
-- tables already hold cannot disagree with itself.
--
-- UNDO: DROP TABLE drum_winners, drum_entries, drum_prizes, coin_mint, arcade_points, coin_weeks;

CREATE TABLE IF NOT EXISTS coin_weeks (
  id          serial PRIMARY KEY,
  opens_at    timestamptz NOT NULL UNIQUE,
  closes_at   timestamptz NOT NULL,
  -- The published seed, "AWAY n - HOME n" of the week's last NFL final.
  seed_text   text,
  -- What the reveal page publishes: per drum coins, players, the shuffled order.
  draw        jsonb,
  drawn_at    timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at > opens_at)
);

-- contest_key: 'contest:<contests.id>', 'daily:<daily_boards.id>', or
-- 'week:<coin_weeks.id>' for the week events (first play, 3-week streak).
CREATE TABLE IF NOT EXISTS arcade_points (
  id          bigserial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contest_key text NOT NULL,
  event       text NOT NULL,
  points      integer NOT NULL CHECK (points > 0),
  week_id     integer NOT NULL REFERENCES coin_weeks(id),
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, contest_key, event)
);
CREATE INDEX IF NOT EXISTS idx_arcade_points_user_week ON arcade_points (user_id, week_id);

CREATE TABLE IF NOT EXISTS coin_mint (
  id          bigserial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_id     integer NOT NULL REFERENCES coin_weeks(id),
  qty         integer NOT NULL CHECK (qty > 0),
  source      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_coin_mint_user_week ON coin_mint (user_id, week_id);

CREATE TABLE IF NOT EXISTS drum_prizes (
  id          serial PRIMARY KEY,
  week_id     integer NOT NULL REFERENCES coin_weeks(id) ON DELETE CASCADE,
  prize_key   text NOT NULL,
  title       text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('gift_card', 'merch')),
  value_cents integer NOT NULL CHECK (value_cents > 0),
  count       integer NOT NULL CHECK (count > 0),
  UNIQUE (week_id, prize_key)
);

CREATE TABLE IF NOT EXISTS drum_entries (
  id          bigserial PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_id     integer NOT NULL REFERENCES coin_weeks(id),
  prize_key   text NOT NULL,
  qty         integer NOT NULL CHECK (qty > 0),
  dropped_at  timestamptz NOT NULL DEFAULT now(),
  auto        boolean NOT NULL DEFAULT false,
  FOREIGN KEY (week_id, prize_key) REFERENCES drum_prizes (week_id, prize_key)
);
CREATE INDEX IF NOT EXISTS idx_drum_entries_week ON drum_entries (week_id, prize_key);
CREATE INDEX IF NOT EXISTS idx_drum_entries_user_week ON drum_entries (user_id, week_id);

CREATE TABLE IF NOT EXISTS drum_winners (
  id          bigserial PRIMARY KEY,
  week_id     integer NOT NULL REFERENCES coin_weeks(id),
  prize_key   text NOT NULL,
  user_id     integer NOT NULL REFERENCES users(id),
  -- The winning ticket's position in the published shuffle of that drum.
  coin_index  integer NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'sent', 'forfeit')),
  fulfil_ref  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (week_id, prize_key, coin_index),
  FOREIGN KEY (week_id, prize_key) REFERENCES drum_prizes (week_id, prize_key)
);
CREATE INDEX IF NOT EXISTS idx_drum_winners_user ON drum_winners (user_id);
