# Crew probe account (users.is_probe): where it is excluded, 3 Nov 2026

The crew lobby-probe signs in as ONE account on PROD (`crew-probe@sportsvyn.invalid`, created by
`scripts/crew-probe-account.mjs`). Migration 150 adds `users.is_probe boolean NOT NULL DEFAULT false`. The
account never enters a contest, plays a game, registers a push token or has a deliverable address
(`.invalid`, `email_opted_out_at` set, `morning_email` false), so there are three layers: nothing to count,
nobody to mail, and a filter wherever the users table itself is read.

Order of rollout: migration 150 on PROD BEFORE this branch deploys. The changed queries name `is_probe`; on a
database without the column they error (the morning audience, the broadcast roster, the admin overview, the
Pulse stats script).

## Changed (filter added)

| Place | What it is | Change |
|---|---|---|
| lib/email/morningAudience.js `morningAudience` | the Morning email audience (regular half) | `AND NOT u.is_probe` |
| lib/email/morningAudience.js `testAccountRoster` | house/owner test roster | `AND NOT u.is_probe` around the OR |
| lib/email/nbaOpener.js (Group B roster) | NBA opener recipients | `AND NOT u.is_probe` |
| scripts/broadcast.mjs (roster query) | launch/broadcast recipients | `AND NOT is_probe` |
| lib/email/morningSend.js (2 queries) | finisher count and top-3 handles in the morning mail | `AND NOT u.is_probe` (belt: the probe has no runs) |
| lib/admin/reads.js `overviewStats` | admin "users total / today" card | `WHERE NOT is_probe` |
| lib/auth/welcomeEmail.js (admin panel read) | "users with no welcome ledger row" | `AND NOT u.is_probe` (the probe never got a welcome mail and would show forever) |
| docs/crew/sportsvyn-stats (17 clauses) | Pulse: new_users, seen_users, active_users, sessions, played/finish/streak/pickem/weekly/draft counts | `NOT coalesce(is_house,false)` became `NOT (coalesce(is_house,false) OR is_probe)`; `sessions` now joins `users_v` and excludes the probe |
| migrations/150 `crew_stats.users_v` | the view the stats script reads | `is_probe` appended (CREATE OR REPLACE VIEW, guarded by `to_regclass`, grants kept) |

`docs/crew/sportsvyn-stats` is the installed script (no build step). `docs/crew/sportsvyn-stats.in` is an older
draft that reads base tables and does not match it; it is not installed and was left alone.

## Judged not to need it

- Entry-based boards and fields: lib/games/leaderboard.js, lib/games/read.js, lib/games/lobbyV3.js (season
  boards), lib/daily/boards.js, lib/daily/seasonBoardLeaderboards.js, lib/daily/entries.js, lib/weekly/live.js,
  lib/boards/live.js, lib/results/*, lib/eplWeekly5/board.js, lib/october/board.js, lib/run/board.js,
  lib/six/entry.js, lib/draft/entry.js, lib/leagues/*, lib/fantasy/leagueShare.js, app/daily/[date]/card/route.js.
  All join `users` FROM `contest_entries` / `daily_board_runs` / `puzzle_entries` / league membership. The probe
  has none, so it is never a row or a field size. (It is the same reason a person who never played is not on a board.)
- Push audiences (lib/push/*): built from `device_tokens` and `push_choice`; the probe never registers a token.
- Single-user reads by id (lib/you, lib/account, lib/onboarding, lib/auth/ageGateDb, emailOtp, widget/session,
  app/api/me, handle actions, lib/house/accounts): the signed-in user's own row, not a count.
- lib/admin/reads.js `findUsers` / `userUsage`: admin lookup by handle or email; finding the probe there is useful.
- scripts that name users by id or address only (rc-reconcile-dryrun lists every user for a DEV/PROD dry run,
  handle-force-rename, push-sentinel, daily-board-run-sentinel, dev-orphan-sweep): operator tools, not counts.
- crew_stats views other than users_v (scripts/crew-reader-grants.mjs and migration 143): they count runs,
  entries, sessions-by-user and leagues; the probe has no runs or entries, and `sessions` is filtered in the
  stats script through `users_v.is_probe`. crew_reader's column grant on `users` is recomputed from the
  catalog on each `crew-reader-grants.mjs --apply`, so `is_probe` becomes readable there on the next run
  (it is not an identity column, so it is not in EXCLUDED_COLUMNS).
- `retention-status` counts `sessions` rows by age (an overdue-pruner signal, not a people count); one
  long-lived probe session is a single row.

## Tests

lib/email/probeExclusion.test.mjs (DEV sentinels: a new person is in the morning audience, a new probe is
not; source checks that every changed reader names the flag, and that every Pulse query reading `users_v`
does). scripts/crewProbeAccount.test.mjs covers the account script on DEV.
