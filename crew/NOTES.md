v1.6 · Oct 22 2026 · REPO IS CANONICAL (crew/ in the sportsvyn repo; Drive archived) · watcher v1.5.1 · data-keeper v1.5 · fixer v1.5 · project.yaml v1.5.2 · budget option c · rung 2 · Watcher at v1.2 · Data Keeper v1.3 · stats script v1.0 (in repo)

## Schema pass (one pass once crew_tickets, briefs and tasks exist; then registration)

User, alias, paths
- Crew runs as Linux user `crew-sportsvyn`; the mini reaches it via SSH alias `sportsvyn-droplet` (never the IP). All files: replace `watcher@droplet` / `ssh droplet` with the alias.
- Paths move to /home/crew-sportsvyn/crew/{bin,worktrees,secrets,data}. The Oct 7 setup (wed-4) put the ~/crew/bin scripts, ~/crew/secrets, the two mini keys and the DEV sentinel creds under Derik's own user. The two keys and their private halves were removed Oct 8; the rest was listed then. At registration, keys and scripts are re-created under crew-sportsvyn.
- Repo access: crew-sportsvyn gets its own clone of github.com/deriksilva35/sportsvyn on the droplet via a read-only GitHub deploy key scoped to this repo (Fixer worktrees come from that clone; the Fixer's PRs need a separate push path, decided at registration). It must not read Derik's ~/projects tree, which holds the other six repos.

DECISION: suite lock across users
- One lock for Derik's sessions (user derik) and the Fixer (user crew-sportsvyn); per project, never global.
- Mechanism: flock on /run/lock/sportsvyn-suite/suite.lock. Directory owned root:sportsvyn, mode 2770 (setgid, so the lock file stays group sportsvyn). Group `sportsvyn` contains derik and crew-sportsvyn. /run/lock is cleared at boot, so a systemd-tmpfiles entry recreates the directory: `d /run/lock/sportsvyn-suite 2770 root sportsvyn -`.
- scripts/suite.sh takes that path (umask 002), replacing ~/.sportsvyn-suite.lock; the "suite busy: <who> since <time>" message stays. Neither user's home holds the lock.
- CrewOS may shift Fixer suite runs if they overlap the Godot jobs (3b).

DECISION: tokens (isolation lives in the script)
- Vercel tokens are account-wide and cannot be scoped to one project. The isolation is in the script: vercel-errors and cost-watch in crew-sportsvyn's ~/crew/bin are hardcoded to the SPORTSVŶN Vercel project id and return only that project's data. The token sits in crew-sportsvyn's ~/crew/secrets (chmod 700); the Watcher never sees it, only script output.
- Cloudflare: same pattern. cf-top is hardcoded to the sportsvyn.com zone; token in ~/crew/secrets; the Watcher sees only output.

Where things run (3c)
- Watcher: stays on the mini (read-only role + forced-command scripts). No change.
- Data Keeper: holds DEV write creds and its approved command writes PROD, so it moves to the droplet as a forced-command script under crew-sportsvyn; the mini invokes it and reads the run back. The dashboard's Approve replay also executes there.
- Fixer: works in droplet worktrees over SSH as crew-sportsvyn.

Rows
- Data Keeper queue: docs/crew/data-queue.md is replaced by `tasks` rows (agent_id = data-keeper, kind = data, payload = {job, script, scope}). Takes the oldest highest-priority `new` task, sets `taken`, sets `done` with result_ref = deliverable id. Only on its 02:00 PT run; a new task never starts a daytime run. Seed the current queue (season pool backfill 2000-2001 then 1997-1999; team colours re-check) by script.
- Fixer trigger: "ticket set to fix it" becomes crew_tickets status `approved`. Its outcomes map to statuses: PR opened = `pr-open`, product question = `needs-ruling`, can't reproduce = `cannot-reproduce`, cap hit or blocked = `stuck`. Its one question is the needs-ruling status, not a brief.
- Watcher and Data Keeper's one question becomes a `briefs` row with options (not a ticket, not a NEEDS DERIK line only).
- Watcher dedupe: open-tickets.md can be replaced by a query on crew_tickets (rule_id + key, status not closed); keep the memory file only if the schema has no key column.

After-decision lines (Outbox)
- Data Keeper already has them; align the wording to 00a: Send back = redo per Derik's note and file a new deliverable; Reject = drop the task (tasks status `dropped`) and record why in memory.

Also
- project.yaml: add `linux_user: crew-sportsvyn`, `ssh_alias: sportsvyn-droplet`, `lock_path: /run/lock/sportsvyn-suite/suite.lock`, and replace the `where_things_go` block with the 00a list (adds briefs and the needs-ruling route).
- Registration: this pass happens when SPORTSVŶN's turn comes, then registration.

## Stats script (for the shared Pulse agent) - v1.0

Source of truth: the repo, docs/crew/sportsvyn-stats (commit 76997a3), verified against the PROD schema Oct 13 2026. bin/sportsvyn-stats.README in this folder says how to install. Usage: `sportsvyn-stats [since-iso]`; default since = 24 h ago; malformed argument -> error=bad_since, exit 2. Output key=value only; no names, emails, ids or money. A failing query prints key=NA and counts toward errors=. Read-only transaction, 10 s statement timeout. House accounts (5) are excluded everywhere.

Install prerequisites (CrewOS): postgresql-client on the project droplet (psql is not installed today); crew_reader SELECT on users, sessions, daily_board_runs, daily_guest_runs, contests, contest_entries, nba_mock_drafts, nba_mock_setups, player_leagues, league_members (the verification run used the owner role).

Definitions (as verified)
- new_users: accounts created in the window.
- seen_users: accounts with any sign-in or game action in the window.
- active_users: distinct signed-in people with a game action (Daily run, contest entry created). Mocks are anonymous, so they are not in this number.
- sessions: auth sessions created or renewed in the window (30-day sessions; expires >= since + 30 days).
- guest_runs / guest_claims: signed-out Daily runs started / guest runs claimed into an account.
- played, by mode = a real game action in the window (contest entries counted by created_at, since lock/settle jobs touch updated_at):
  daily (runs started, signed-in + guest) · pickem · weekly (Weekly game) · draft (weekly Draft) · gamedraft (primetime Game Drafts) · other_contest (October, The Run, EPL) · mock_nfl / mock_nba (finished mocks, one table with a sport column) · leagues (created).
- how they played, one per mode: daily_finish_pct (runs with picks submitted / runs started) · daily_streak3_users (accounts on a 3+ edition Daily streak now, ET) · pickem_complete_pct (sheets picking every game on the board) · weekly_complete_pct and draft_complete_pct (all 6 slots filled; 6 is hardcoded, revisit if rosters change) · gamedraft_avg_pts · mock_a_grade_pct (mocks graded A+/A/A-) · mock_setups_saved · leagues_avg_members.
- contests.game_type values on PROD: pickem, weekly, draft, draft_game, october, run, epl_weekly_5.

Changed from v0.2 (tell Pulse): keys added seen_users, weekly_played, weekly_complete_pct, other_contest_played; mock_auto_pct replaced by mock_a_grade_pct (no auto-finish column exists).

First PROD run, since = 7 days ago (errors=0): new_users 8, seen_users 14, active_users 10, sessions 15, guest_runs 13, guest_claims 1, daily_played 24, daily_finish_pct 62.5, daily_streak3_users 1, pickem_played 2, pickem_complete_pct 50.0, weekly_played 1, weekly_complete_pct 100.0, draft_played 0, gamedraft_played 4, gamedraft_avg_pts 28.1, other_contest_played 1, mock_nfl_played 0, mock_nba_played 1, mock_a_grade_pct 0.0, mock_setups_saved 0, leagues_created 0.

## Fixer v1.3 decisions (Oct 20 2026)

Crew side built (CrewOS report): crew-sportsvyn has a fresh clone, the relay scripts and sportsvyn-suite (scripts/suite.sh under SV_SUITE_ENV=crew against the ci Neon branch, first run 6,551/6,552 in 13m16s). relay-sandbox runs tests in bubblewrap with only the ci env visible; model rounds have Read/Grep/Glob/Edit/Write only, no execution, no network.

DECISION: budget = option (c)
- 25 min wall clock per session, enforced by CrewOS. The relay runs a FAST SUBSET (the new test + test files of changed modules + repo guard tests), at most 2 runs per session.
- No full suite in a Fixer session. The PR's required CI check ("SPORTSVŶN test suite") is the full run; branch protection on main already requires it.
- Red CI: CrewOS may start ONE follow-up session on the same branch with the CI log; red again = stuck.
- Why: a local full run would duplicate CI's 13 min and hold the shared suite lock that Derik's sessions use. (a) and (b) both spend that time twice.
- To create at registration: docs/crew/fast-subset.md listing the repo guard tests (hex census, zone guard, legal/census, age gate and any other repo-wide guards) so the subset catches what usually breaks.

DECISION: fix_allowed_paths (rung 2), v1.4 after CREW-1's glob check
- Allowed: app/**/*.{js,jsx,css}, components/**, lib/**, test/**, tests/**, **/*.test.mjs, docs/CREW-LOG.md.
- Never (wins over allow), fitted to the real tree: migrations/**, lib/migrations/**, **/*.sql; app/api/cron/**, vercel.json, lib/pollers/**, lib/cronCircuitBreaker.js, services/**; app/api/revenuecat/**, app/api/stripe/**, lib/stripe*, lib/appleIap.js, lib/membership.js, app/actions/membership.js, app/api/webhooks/**; coins (pending merge) lib/coins/**, app/coins/**, app/api/coins/**, lib/tremendous*; auth.js, proxy.js, app/api/auth/**, lib/auth/**, app/api/session/**, app/actions/emailOtp.js; lib/email/**, lib/emails/**, lib/resend.js, app/api/email/**, app/og/email/**, lib/push/**, app/api/push/**, app/api/**/send*/**; app/admin/**, lib/admin/**; .github/**, .env*, package.json and lockfiles, next.config.*; scripts/**, docs/crew/**, CLAUDE.md, docs/handoff.md, docs/decisions.md.
- Dropped as matching nothing: db/migrations/**, lib/cron/**, lib/revenuecat/**, auth.config.js, middleware.js, capacitor.config.*, ios/**, android/**, lib/drum/** (the iOS app lives in its own repo). The coins globs stay on purpose until coins-drum merges, then get re-checked.
- v1.4.1: lib/stripe* matches lib/stripeClient.js but not lib/stripe/x.js, so lib/stripe/** and lib/tremendous/** were added; every prefix glob is now paired with its folder form.
- Rule going forward: any new folder that sends, pays, authenticates, schedules or migrates joins the never-list before the Fixer works near it.

DECISION: rung 2 = PR only
- Output is a PR Derik merges by hand after green CI. No auto-merge, merge queue or self-approval until the two-key approver exists. SPORTSVŶN has real users.

Fixer statuses (v1.3 uses the schema names): approved -> pr-open | needs-ruling | cannot-reproduce | stuck. The fixed final message gains a CI line.
Archived: fixer SOUL v1.2, v1.3, v1.4 and NOTES v1.3, v1.4, v1.5 in _archive/.

## Repo canonical (Oct 22 2026, CrewOS adapter spec §3a)
- crew/agents/<agent>/SOUL.md, crew/project.yaml and crew/NOTES.md in the sportsvyn repo are the source of truth. CrewOS records agents.soul_ref = path + commit SHA of what is installed.
- Every SOUL or project.yaml change is a PR to crew/ in this repo (CI green, Derik merges). Never a Drive re-issue.
- Drive CrewOS/crews/sportsvyn/ is archived: all prior versions in _archive/, plus a one-line README pointing at the repo.
- Versions at the move: watcher v1.5.1, data-keeper v1.5, fixer v1.5 (alias sportsvyn-fixer, model claude-sonnet-5-5, never-list v1.4.1), project.yaml v1.5.2.

## Day 1 fixes (Oct 22 2026)
- Final-message template made literal (4 of 12 Watcher runs drifted from the fixed shape): Watcher v1.5.2.
- Watcher cadence moved from hourly-while-open to pre-lock (once per distinct lock time, max 2/day) plus open at 09:00 and 15:00 PT; that caps at 120/month instead of spending it by day 10.
- watch-rules.md moved into crew/ (crew/watch-rules.md); CrewOS installs it into the Watcher workspace at docs/crew/watch-rules.md.
- Fixer never-list gains crew/** (Fixer v1.5.1): it never edits SOULs, project.yaml, NOTES or the crew scripts.
- Data Keeper final message gains an APPLY line (Data Keeper v1.5.1).
- Versions: watcher v1.5.2, data-keeper v1.5.1, fixer v1.5.1, project.yaml v1.5.3.

## thu-1 (Oct 28 2026)
- Watcher v1.5.3: rule 1 exempts board-state from the SUMMARY-line rule by name (it prints one state line, open | locks_in:<m> | closed, for the poller), so its format is never a SETUP ticket. board-state itself unchanged; a test pins its output.
- dispatch refuses (exit 2, nothing run) any name not on its ALLOWED list of the eight crew scripts, as the host copy already did; the list now lives in the repo's dispatch.

## thu-4 (Oct 29 2026)
- game-watch: the Watcher's G1-G6 read path. Five new crew_stats views (g1_lock_unstarted, g2_card_incomplete, g3_kickoff_midnight_untbd, g4_board_unsettled, g5_retention_not_ok) hold each rule's SQL from watch-rules.md; G6 reads live_matches_v. `game-watch` (no arguments) prints `G<n> <severity> <key> <detail>` per firing row, then `SUMMARY game-watch g1..g6 status`. dispatch ALLOWED is now ten names and refuses any argument to game-watch. Watcher v1.5.4. PROD needs `scripts/crew-reader-grants.mjs --prod --apply` before the script can read there.
