-- 107_alert_prefs_league_scope.sql — NFL RED ZONE: a third alert scope.
--
-- THE PROBLEM THIS SOLVES. The score events already exist: the poller fires
-- one for every live match and looks for an audience, and on a Sunday most of
-- those dispatches log "audienceEmpty" and are thrown away. What was missing
-- was any way to BE in that audience without following one of the two teams.
--
-- AND THERE WAS NO WORKAROUND, checked before this migration was written.
-- audienceFor() admits a device via user_team_follows or a MATCH-scoped row; a
-- TEAM-scoped row only supplies preferences to somebody a follow already
-- admitted. Follows are capped at five per league (FOLLOW_CAP_PER_LEAGUE), so
-- "just follow all 32" is not reachable. The scope is the feature.
--
-- scope_id IS THE LEAGUE ID for this scope, the same way it is the team id for
-- 'team' and the match id for 'match'. NFL is 15332 on PROD. It is still not a
-- foreign key, for the reason the original table comment gives: one column
-- cannot reference three tables, and every read constrains the scope first.
--
-- EVERY EXISTING COLUMN KEEPS ITS MEANING, which is the point of widening this
-- table rather than adding another. master gates the five triggers; score,
-- kickoff, quarter, close and final_only each mean here exactly what they mean
-- on a team row. That is what makes "red zone, but only close games" a switch
-- later instead of a second migration.
--
-- THE LEAGUE ROW ADMITS TO EVERY EVENT, NOT ONLY SCORES. A red-zone
-- subscriber is in the audience for finals too, with their own final_only
-- switch deciding - so a reader who turns scores off still gets results.
--
-- BACKWARD-COMPATIBLE IN BOTH DIRECTIONS, which is what makes the dual-go
-- window safe: every existing row satisfies the widened CHECK, and no code
-- writes 'league' until the merge lands.

ALTER TABLE alert_prefs DROP CONSTRAINT IF EXISTS alert_prefs_scope_check;
ALTER TABLE alert_prefs
  ADD CONSTRAINT alert_prefs_scope_check
  CHECK (scope IN ('team', 'match', 'league'));

COMMENT ON COLUMN alert_prefs.scope_id IS
  'teams.id when scope=team, matches.id when scope=match, leagues.id when scope=league. Not a foreign key: one column cannot reference three tables, and every read constrains the scope first.';

-- The ledger learns the third arm. 096 set this to 'both | follow | match'.
-- 'league' is written ONLY when the league row is the sole admission: a
-- subscriber who also follows one of the two teams keeps the older, more
-- specific label, so no existing audience_via value changes meaning.
COMMENT ON COLUMN push_sends.audience_via IS
  'How the device entered the audience - both | follow | match | league. league only when the league-scoped row was the sole admission. NULL for rows written before migration 096.';
