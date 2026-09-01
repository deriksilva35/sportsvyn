-- ============================================================================
-- 083_fantrax_import.sql — a second source for the player pool, and the
-- league-shaped things an imported draft needs.
--
-- NUMBER ASSIGNED AT TRANSCRIPTION TIME: 082 is the highest in the tree, so
-- this is 083. Scanned the target objects in DEV first: sim_player_pool has no
-- `source`, draft_configs has none of the four columns, draft_picks has no
-- is_keeper, and draft_config_keepers does not exist.
--
-- THE ONE IDEA RUNNING THROUGH ALL OF IT: the pool has always had exactly one
-- source, so nothing needed to say which. Fantrax makes that untrue, and every
-- column here exists to keep two sources from being mistaken for each other.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. sim_player_pool.source
--
-- DEFAULT 'ffc' AND NOT NULL, so the 1,564 existing rows become explicitly
-- FFC-sourced rather than implicitly so. There is no 'unknown' state and never
-- was one - every row in the table today came from FFC's ADP feed, and saying
-- so costs nothing and removes a question a reader would otherwise have to
-- answer by reading the ingest.
-- ---------------------------------------------------------------------------
ALTER TABLE sim_player_pool ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'ffc';

-- THE UNIQUE KEY GAINS source, AND THIS IS THE POINT OF THE WHOLE MIGRATION.
-- Without it, a Fantrax player whose fantraxId collides with an FFC id on the
-- same snapshot/format/teams would UPSERT OVER an unrelated player - and both
-- id spaces are short opaque strings ("074xr" vs "6162"), so a collision is a
-- coincidence away rather than impossible. The two sources must be able to
-- describe the same slate without touching each other's rows.
ALTER TABLE sim_player_pool
  DROP CONSTRAINT IF EXISTS sim_player_pool_snapshot_date_scoring_format_teams_count_ff_key;
ALTER TABLE sim_player_pool
  ADD CONSTRAINT sim_player_pool_snapshot_format_teams_player_source_key
  UNIQUE (snapshot_date, scoring_format, teams_count, ffc_player_id, source);

-- THE LOOKUP INDEX IS LEFT ALONE, and that is a measured choice rather than a
-- deferral - see the migration's foot for the EXPLAIN that decided it.

-- ---------------------------------------------------------------------------
-- 2. draft_configs — what an imported league carries that a made-up one does not
--
-- external_league_id  the Fantrax leagueId. NOT unique: the same league
--                     re-imported for a second user is a second config, and
--                     the same league across two seasons is two configs.
-- teams               the league's real teams, [{ name, id, slot }]. jsonb
--                     rather than a table because it is read whole, written
--                     whole and never joined - the same argument team_labels
--                     on drafts already makes.
-- draft_date          Fantrax's scheduled draft time. Distinct from
--                     drafts.started_at, which is when somebody opened the
--                     room; a league can have a draft date and no draft.
-- pool_source         which pool this config's draft should draw from. It is
--                     NOT the same fact as draft_configs.source: source says
--                     where the CONFIG came from ('manual', 'tracker',
--                     'fantrax'), pool_source says which player universe the
--                     draft runs against. An imported Fantrax league might
--                     still want to draft off FFC ADP.
-- ---------------------------------------------------------------------------
ALTER TABLE draft_configs ADD COLUMN IF NOT EXISTS external_league_id text;
ALTER TABLE draft_configs ADD COLUMN IF NOT EXISTS teams jsonb;
ALTER TABLE draft_configs ADD COLUMN IF NOT EXISTS draft_date timestamptz;
ALTER TABLE draft_configs ADD COLUMN IF NOT EXISTS pool_source text NOT NULL DEFAULT 'ffc';

CREATE INDEX IF NOT EXISTS idx_draft_configs_external
  ON draft_configs (external_league_id) WHERE external_league_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2b. drafts.pool_source — the provenance freeze was one column short.
--
-- drafts ALREADY freezes pool_snapshot_date, pool_scoring_format and
-- pool_teams_count on the row, deliberately: a custom config can be mapped onto
-- a NEARBY snapshot pair, so what the draft actually ran against is not always
-- what its config asked for, and every resume reads these three rather than the
-- config. Source is the fourth member of that tuple and was missing.
--
-- FOUND BY WIRING, NOT BY DESIGN: the five getPoolAt calls that rebuild a
-- draft's pool read draft.pool_* and would have loaded the FFC pool for a
-- Fantrax draft. rebuildState would then throw "persisted player not in pool"
-- on the first resume - which is at least loud, but only after the draft was
-- started and lost.
-- ---------------------------------------------------------------------------
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS pool_source text NOT NULL DEFAULT 'ffc';

-- ---------------------------------------------------------------------------
-- 3. draft_picks.is_keeper
--
-- FALSE FOR EVERY EXISTING ROW, which is true: nothing in this app has ever
-- made a keeper pick. A boolean rather than a nullable one because "we do not
-- know whether this was a keeper" is not a state any pick can be in - either
-- the importer said so or it did not.
-- ---------------------------------------------------------------------------
ALTER TABLE draft_picks ADD COLUMN IF NOT EXISTS is_keeper boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 4. draft_config_keepers — the keepers as the LEAGUE states them, before any
--    draft exists.
--
-- A SEPARATE TABLE FROM draft_picks BECAUSE THE LIFETIMES DIFFER. A keeper is
-- a property of the league's configuration: it is known weeks before anybody
-- opens a room, it survives a draft being abandoned and restarted, and the
-- same config can seed many drafts. draft_picks rows belong to one draft and
-- die with it. Folding these in would mean either a draft_picks row with a
-- null draft_id or a keeper that vanishes when a practice draft is deleted.
--
-- team_slot IS THE SEAT, 1-based, not a Fantrax team id. The engine thinks in
-- seat indices (pick_position, order[]), and an import has to land the keeper
-- on a seat before it can mean anything. The Fantrax teamId that produced it
-- lives in draft_configs.teams alongside its slot.
--
-- fantrax_player_id AND player_name AND position ARE ALL STORED, deliberately
-- denormalized: 18 of 76 rostered players in the probe league have no NFL
-- identity at all (devy), so a keeper cannot be required to resolve to a pool
-- row. The name is what the reader sees whether or not the crosswalk lands.
--
-- UNIQUE (config_id, round, pick_in_round) - one keeper per slot in the draft
-- grid. Two keepers on one pick is not a thing a draft can express.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS draft_config_keepers (
  id                serial      PRIMARY KEY,
  config_id         integer     NOT NULL REFERENCES draft_configs(id) ON DELETE CASCADE,
  team_slot         integer     NOT NULL,
  round             integer     NOT NULL,
  pick_in_round     integer     NOT NULL,
  fantrax_player_id text        NOT NULL,
  player_name       text        NOT NULL,
  position          text        NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT draft_config_keepers_slot_key UNIQUE (config_id, round, pick_in_round)
);

CREATE INDEX IF NOT EXISTS idx_draft_config_keepers_config
  ON draft_config_keepers (config_id, round, pick_in_round);

-- ---------------------------------------------------------------------------
-- 5. The two ffc_player_id columns now carry more than FFC ids.
--
-- THE RENAME TO external_player_id IS QUEUED, NOT DONE. It touches both tables,
-- every reader in lib/fantasy/, the engine's pool mapping and the tests that
-- pin them; doing it inside the migration that adds the second source would
-- make one change impossible to review. The comment is the interim contract.
-- ---------------------------------------------------------------------------
COMMENT ON COLUMN sim_player_pool.ffc_player_id IS
  'The external id from the row''s pool source: an FFC player id when source=''ffc'', a Fantrax fantraxId when source=''fantrax''. Rename to external_player_id is queued.';
COMMENT ON COLUMN draft_picks.ffc_player_id IS
  'The external id from the draft''s pool source: an FFC player id for an FFC pool, a Fantrax fantraxId for an imported league. Rename to external_player_id is queued.';

-- ---------------------------------------------------------------------------
-- 4b. draft_config_keepers.adp / team — the keeper's market price, frozen at
--     import, because the pool no longer carries him.
--
-- THE POOL IS THE DRAFTABLE UNIVERSE. A Fantrax league's ADP feed lists every
-- player, rostered or not, and the importer now excludes the ones the league
-- already holds (playerInfo status T = taken, WW = on waivers) - measured, 58
-- of the 469 draftable rows. The keepers are inside that 58. The engine still
-- needs each keeper's ADP to freeze adp_at_pick on his pick and his team for
-- the roster panel, so both ride on the keeper row, read from the same ADP
-- feed row the pool writer just declined to store. NULL when the feed had no
-- row for him; the pick then freezes a null, which is what "no market price"
-- means, rather than a zero that would grade as the reach of the century.
-- ---------------------------------------------------------------------------
ALTER TABLE draft_config_keepers ADD COLUMN IF NOT EXISTS adp numeric;
ALTER TABLE draft_config_keepers ADD COLUMN IF NOT EXISTS team text;
