-- 038_user_dashboards.sql
-- Per-user My Sportsvyn dashboard layout. ONE row per user, a single JSONB
-- column. (The join-table design was rejected; this is the one-table build.)
--
-- layout is an ordered JSON array of panel objects, for example:
--   [{"id":"today"},{"id":"market","w":12}]
-- Array position = render order. Presence in the array = active (panel shown).
-- "w" is an optional per-panel width override (column span); absent means use
-- the code registry's default span for that panel. No row for a user means
-- fall back to the code registry's default active set -- a panel is opt-out by
-- absence, opt-in by presence.
--
-- Stores the FULL resolved active list, not deltas. When a new default-on panel
-- ships, existing customized users get it via a one-line JSONB-append migration
-- at that time, so a new default still reaches people who have already
-- customized their layout.
--
-- Reversible: DROP TABLE user_dashboards. No backfill - users with no row use
-- the code default until they first customize.

create table if not exists user_dashboards (
  user_id    integer primary key references users("id") on delete cascade,
  layout     jsonb not null,
  updated_at timestamptz not null default now()
);
