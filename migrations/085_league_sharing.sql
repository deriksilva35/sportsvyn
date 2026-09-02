-- 085: league sharing - a config has members, an owner mints invite codes, a
-- member claims a franchise.
--
-- THE TIE TODAY IS ONE COLUMN. draft_configs.user_id (046) is the importer, and
-- every read of a league is a WHERE user_id = <caller> (drafts.js getMyLeagues,
-- startLeagueDraftFor). Nothing is wrong with that for one person; it simply
-- has no word for a second. This adds the word.
--
-- LEAGUE FACTS ARE SHARED, RUNS ARE PERSONAL. The config row, its teams jsonb
-- and draft_config_keepers are the league as Fantrax states it - read by every
-- member, written by the owner's import alone. A run (drafts.user_id NOT NULL,
-- its picks, its Read) belongs to whoever started it, exactly as before; two
-- members' runs of one league are two drafts rows and never touch.
--
-- ONE MEMBER PER FRANCHISE, DECIDED BY THE INDEX. The partial unique on
-- (config_id, fantrax_team_id) is the whole race policy: two members tapping
-- the same team at the same moment produce one claim and one
-- 'franchise_taken', in commit order, with no application lock. NULL is
-- "unclaimed" and any number of members may be that.
--
-- INVITES ARE GATES, NOT IDENTITY. A code expires (14 days), caps its uses (12,
-- one league's worth) and can be revoked; config_id is the identity, so a dead
-- code freeing its string is fine. Eight characters from the same
-- no-lookalike alphabet the player leagues use (lib/leagues/core.js), because
-- this one also gets read aloud off a phone in a group chat.
--
-- OWNER DELETION DELETES THE LEAGUE (draft_configs.user_id ON DELETE CASCADE,
-- unchanged). That is the opposite of player_leagues' SET NULL and deliberate:
-- an imported league is a copy of the owner's Fantrax data under the owner's
-- credentials, and their account leaving takes their data with it.
--
-- AND A MEMBER'S RUN OF IT GOES TOO. drafts.config_id was a plain FK (no
-- action), which was harmless while every run of a config belonged to the
-- config's owner - the users cascade took both. With members it is a trap: an
-- owner whose league holds one member run could not delete their account
-- (deleteAccountFor's users DELETE would fail on drafts_config_id_fkey), and
-- SET NULL would leave that member a room that crashes on config.roster_slots.
-- So the FK becomes ON DELETE CASCADE: a run is a run OF a league, and when
-- the league is gone so is the run. Configs are deleted by exactly one path
-- (the owner's account), so this cascade fires only then.
--
-- drafts.hidden_from_league: a member may hide one of their own completed runs
-- from the league's mocks list. Default visible; never read by the room.

CREATE TABLE IF NOT EXISTS draft_config_members (
  config_id        integer     NOT NULL REFERENCES draft_configs(id) ON DELETE CASCADE,
  user_id          integer     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             text        NOT NULL CHECK (role IN ('owner', 'member')),
  fantrax_team_id  text,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (config_id, user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS draft_config_members_franchise_key
  ON draft_config_members (config_id, fantrax_team_id) WHERE fantrax_team_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS draft_config_members_user_idx ON draft_config_members (user_id);

CREATE TABLE IF NOT EXISTS draft_config_invites (
  id          serial      PRIMARY KEY,
  config_id   integer     NOT NULL REFERENCES draft_configs(id) ON DELETE CASCADE,
  code        text        NOT NULL UNIQUE,
  created_by  integer     REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT now() + interval '14 days',
  max_uses    integer     NOT NULL DEFAULT 12,
  uses        integer     NOT NULL DEFAULT 0,
  revoked_at  timestamptz
);

CREATE INDEX IF NOT EXISTS draft_config_invites_config_idx ON draft_config_invites (config_id);

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS hidden_from_league boolean NOT NULL DEFAULT false;

ALTER TABLE drafts DROP CONSTRAINT IF EXISTS drafts_config_id_fkey;
ALTER TABLE drafts ADD CONSTRAINT drafts_config_id_fkey
  FOREIGN KEY (config_id) REFERENCES draft_configs(id) ON DELETE CASCADE;

-- BACKFILL: every config that has an owner gets its owner row. The owner's
-- franchise is the teams entry marked isMine (the importer's own seat, recorded
-- at import); configs without a teams list (tracker, manual) get NULL.
INSERT INTO draft_config_members (config_id, user_id, role, fantrax_team_id)
SELECT c.id, c.user_id, 'owner',
       (SELECT t->>'fantraxTeamId' FROM jsonb_array_elements(COALESCE(c.teams, '[]'::jsonb)) t
         WHERE (t->>'isMine')::boolean IS TRUE LIMIT 1)
  FROM draft_configs c
 WHERE c.user_id IS NOT NULL
ON CONFLICT (config_id, user_id) DO NOTHING;
