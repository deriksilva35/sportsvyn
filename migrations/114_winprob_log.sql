-- 114_winprob_log.sql - every live win-probability the poller computes, kept.
--
-- WHY A TABLE. Both models ship under a condition: the NFL one by override,
-- labelled "Calibrating" until our own 2026 results validate it; the CFB one
-- in SHADOW, displayed only if it passes a blind re-score on 2026 weeks 5-8
-- (model/winprob/GATE-cfb.md). Neither judgement can be made from what the
-- card showed - a card holds one number and forgets it. This holds every one,
-- with the inputs that produced it, so the calibration can be scored against
-- final results without reconstructing a single play.
--
-- ONE ROW PER STATE CHANGE, not per poll. The poller writes a row when the
-- inputs move (a new snap, a score, a clock tick into a new second of the
-- model's own time); an idle poll on an unchanged state writes nothing.
--
--   match_id    the game
--   ts          when the poller computed it
--   play_seq    the newest play the state was read from (plays.id), or NULL
--               when the state came from the score and clock alone
--   p_home      the model's output, 0-1, full precision - the card rounds,
--               the log does not
--   inputs      the model's state and prior exactly as passed to predict()
--   model_version  e.g. sportsvyn-winprob-nfl@1.0.0 - a refit is a new version
--               and the two must never be scored together
--   sport       'nfl' | 'cfb'
--
-- IDEMPOTENT: CREATE ... IF NOT EXISTS throughout.

CREATE TABLE IF NOT EXISTS winprob_log (
  id             BIGSERIAL PRIMARY KEY,
  match_id       INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  play_seq       BIGINT,
  p_home         DOUBLE PRECISION NOT NULL CHECK (p_home >= 0 AND p_home <= 1),
  inputs         JSONB NOT NULL,
  model_version  TEXT NOT NULL,
  sport          TEXT NOT NULL CHECK (sport IN ('nfl', 'cfb'))
);

-- A game's curve, in order - the scoring query and the card's history read this.
CREATE INDEX IF NOT EXISTS winprob_log_match_ts ON winprob_log (match_id, ts);
