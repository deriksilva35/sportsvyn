-- 039_user_dashboards_scope.sql
-- Adds a `scope` dimension to user_dashboards so one user can own more than a
-- single saved layout. Today every row is the 'my' board (the My Sportsvyn
-- home dashboard); `scope` leaves room for future boards (e.g. a per-
-- competition layout) without a second table.
--
-- Change:
--   * new column `scope text not null default 'my'` — existing rows adopt 'my'.
--   * PRIMARY KEY swaps from (user_id) to composite (user_id, scope).
--   * the users("id") ON DELETE CASCADE foreign key is UNTOUCHED. We drop only
--     the PRIMARY KEY constraint (user_dashboards_pkey), which is independent
--     of the FK constraint, so cascade-on-user-delete still holds after the
--     swap.
--
-- Reversible: DELETE FROM user_dashboards WHERE scope <> 'my'; then
--   ALTER TABLE user_dashboards DROP CONSTRAINT user_dashboards_pkey;
--   ALTER TABLE user_dashboards ADD PRIMARY KEY (user_id);
--   ALTER TABLE user_dashboards DROP COLUMN scope;

alter table user_dashboards
  add column if not exists scope text not null default 'my';

alter table user_dashboards
  drop constraint user_dashboards_pkey;

alter table user_dashboards
  add primary key (user_id, scope);
