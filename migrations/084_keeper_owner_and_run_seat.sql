-- 084: keepers key on their OWNER, and a draft records the seat chosen for the run.
--
-- THE DEFECT (recon, 2 Sep). draft_config_keepers placed a keeper by SEAT:
-- team_slot + pick_in_round, both copied from Fantrax's draft order at import,
-- unique on (config_id, round, pick_in_round). That is a statement about one
-- particular seating. The moment the person starting a run sits somewhere
-- other than the imported seat, "round 12, pick 11" is somebody else's cell -
-- and keeperSeed's consistency check would either throw or, worse, draw the
-- keeper in the old column as if nothing had moved.
--
-- A KEEPER'S ROUND IS THE KEEPER'S. ITS COLUMN IS WHEREVER ITS OWNER SITS THIS
-- RUN. So the durable key is (owner, round): fantrax_team_id is the owner, the
-- same id draft_configs.teams carries for every seat, and the cell is derived
-- at draft time from (round, the run's seat for that owner) through the snake.
--
-- team_slot AND pick_in_round STAY, AS THE PROVIDER'S STATEMENT. They are what
-- Fantrax said at import and they still gate the import (a keeper whose
-- pick_in_round disagrees with its team's slot means the provider's order moved
-- under us - refused at import, keeperSeed.providerSeatConflicts). Nothing
-- reads them to place a cell any more.
--
-- BACKFILL IS EXACT, NOT GUESSED: team_slot -> teams[slot].fantraxTeamId on the
-- same config row. Measured before writing: 41 rows on each of DEV (cfg 6661)
-- and PROD (cfg 225), 0 rows without a team at their slot, 0 owners with two
-- keepers in one round - so the new unique cannot fail on existing data.
--
-- drafts.user_seat: the seat the person CHOSE for this run, or NULL when they
-- took the default (a league's imported seat; a tracker's typed seat). It is
-- an audit column: pick_position remains the seat every reader derives from,
-- and equals user_seat whenever user_seat is set. Existing rows are NULL and
-- render exactly as they did - their picks are already persisted by overall.

ALTER TABLE draft_config_keepers ADD COLUMN IF NOT EXISTS fantrax_team_id text;

UPDATE draft_config_keepers k
   SET fantrax_team_id = t->>'fantraxTeamId'
  FROM draft_configs c, jsonb_array_elements(c.teams) t
 WHERE c.id = k.config_id
   AND (t->>'slot')::int = k.team_slot
   AND k.fantrax_team_id IS NULL;

ALTER TABLE draft_config_keepers ALTER COLUMN fantrax_team_id SET NOT NULL;

-- One keeper per owner per round. Two keepers by one team in one round would
-- need two picks in that round (a traded pick), which a re-seated snake cannot
-- express - refused loudly at import rather than placed on a guess.
ALTER TABLE draft_config_keepers
  ADD CONSTRAINT draft_config_keepers_owner_round_key UNIQUE (config_id, fantrax_team_id, round);

CREATE INDEX IF NOT EXISTS idx_draft_config_keepers_owner
  ON draft_config_keepers (config_id, fantrax_team_id, round);

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS user_seat integer;
