# SPORTSVŶN — context for CrewOS reps

Stable orientation. Moving state (what's live this week, holds, the queue) is in docs/handoff.md; crew actions are in docs/CREW-LOG.md. The engineering laws are in CLAUDE.md, and they win over anything here.

MERGE RULE for Derik's own sessions: server-side merge via `gh api -X PUT repos/deriksilva35/sportsvyn/pulls/<n>/merge -f merge_method=merge` after the required check is green; never --admin.

## What SPORTSVŶN is
SPORTSVŶN ("the arcade of sports", sportsvyn.com) is a free sports-games site and iOS app (App Store listing name "Draftvyn"). The games are:
- The Daily, a fantasy lineup puzzle with guest play and a season pool;
- Pick'em (regular, confidence and against-the-spread; NFL, CFB and others);
- The Weekly, the weekly Draft, per-game Draft (Primetime), October (MLB postseason), The Run, EPL Weekly 5, Survivor (behind the SURVIVOR flag);
- NFL/NBA mock drafts;
- private player leagues: friends' tables over those games, with crew points, roles and an events feed.

The stack:
- Next.js 16 App Router: plain JavaScript, React 19, `proxy.js` instead of middleware, `next/font` fonts self-hosted.
- Neon Postgres: PROD and a DEV branch, raw SQL via `@neondatabase/serverless` in lib/db.js.
- Vercel: auto-deploys main to production; a per-branch preview for every push. The ignored-build step skips docs-only commits.

Background services run on the DigitalOcean droplet `considered-cc` (165.227.30.35, repo ~/projects/sportsvyn):
- the live poller;
- the daily tick;
- the MLB postseason advance.

They are systemd user units started from a deployed release (~/deploy/sportsvyn/current), never from the working checkout.

The iOS app is a Capacitor shell. Its native config lives in the Mac's separate native repo, not here.

Data providers:
- BallDontLie for NFL, NCAAF, MLB and NBA;
- CFBD;
- The Odds API;
- API-Sports for the EPL;
- FFC ADP.

Mail goes out through Resend (hello@sportsvyn.com, reply-to derik@sportsvyn.com).

## The crew (CrewOS)
SOURCE OF TRUTH: crew/ in this repo (CrewOS adapter spec §3a): crew/agents/<agent>/SOUL.md, crew/project.yaml, crew/NOTES.md, crew/watch-rules.md and the droplet scripts in crew/bin + crew/lib. Every SOUL / project.yaml / NOTES change is a PR there. Drive (CrewOS/crews/sportsvyn) is archived.

The CrewOS project row is `sportsvyn` (display name SPORTSVŶN). All three agents are LIVE.

- **Fixer** (LIVE): registered via crewctl; soul_ref from crew/agents/fixer (currently 263995f7).
  - Runs as claude-relay under the bot account `deriksilva35-crew` (write, no admin). It opens PRs only (branch `crew/fix-<ticket-id>`, one docs/CREW-LOG.md line).
  - auto_merge is on: a Fixer PR merges once the required check "SPORTSVŶN test suite" is green AND Derik's one-tap Approve in the CrewOS dashboard posts the review (through the separate `crew-approver` identity).
  - Undo is enabled: a revert opens as its own PR (e.g. #55).
  - Shipped so far: #22, #40; undo #55.
  - Limits: crew/agents/fixer/SOUL.md (25 min per session, the fast test subset, a never-list that includes crew/**).
- **Watcher** and **Data Keeper** (LIVE on OpenClaw, crewos-droplet): installed from crew/agents/* in this repo.
  - Cadence = crew/project.yaml start_gates: pre-lock (max 2/day), open-board checks at 09:00 and 15:00 PT, nightly 06:00 PT, post-deploy; hourly-class runs capped at 120/month.
  - The Watcher files one crew_tickets row per problem and never fixes anything; rules in crew/watch-rules.md (GAME G1-G6, PROVIDER P1-P8, COST C1-C3).
  - The Data Keeper is dry-run only; Derik applies approved changes by hand.
- **Pulse stats** (LIVE): `sportsvyn-stats [since-iso]` (source: docs/crew/sportsvyn-stats) prints key=value product counts for the shared Pulse agent.
  - Reads PROD as crew_reader, read-only, with a 10 s statement timeout.
  - House accounts are excluded; no names, emails, ids or money ever appear in the output.

## Conventions and naming quirks
- Repo `deriksilva35/sportsvyn`, default branch `main`. The display name is SPORTSVŶN (Ŷ); the slug and code say `sportsvyn`.
- Crew Linux user `crew-sportsvyn` (group `sportsvyn`) on the droplet.
- SSH aliases (in the crew's config only):
  - `sportsvyn-droplet`: watcher key, forced command limited to ~/crew/bin/*;
  - `sportsvyn-fixer`: shell in ~/crew/worktrees.
  - Never use the IP.
- Admin on the crew user: `ssh derik@165.227.30.35`, then `sudo -u crew-sportsvyn -i`.
- DB role `crew_reader`: SELECT only (read-only transactions, 30 s statement timeout); its grants are applied by scripts/crew-reader-grants.mjs.
  - Most public tables are readable whole: contests, contest_entries, matches, league_members, nba_mock_*, app_errors and so on.
  - users, sessions, daily_board_runs, daily_guest_runs and player_leagues are granted by COLUMN. Never readable: email, contact email, name, image, date of birth, handle, the session token, pick payloads, device id, IP, join code and invite token. So `SELECT *` on those five tables fails; name the columns.
  - Withheld whole: auth/OTP/token tables, email_signups, device_tokens, live_activities, revenuecat_events, memberships, push_sends, draft_config_invites.
  - Pulse stats reads only the `crew_stats.*_v` views (migration 143).
  - Each run revokes everything, then re-grants, so a new table stays unreadable until the script runs again.
- Branches: feature work goes on short kebab-case branches in their own worktrees (~/projects/sv-<name>). The crew's branches are `crew/fix-<ticket-id>`.
- main requires a pull request. The gate is the required CI check "SPORTSVŶN test suite" (.github/workflows/tests.yml): the full suite (~6,500 tests, ~13 min) on the PR's merge tree, against the dedicated `ci` Neon branch.
- One suite lock per host: /run/lock/sportsvyn-suite/suite.lock (group sportsvyn: derik, crew-sportsvyn, the CI runner). `scripts/suite.sh` flocks it (falling back to ~/.sportsvyn-suite.lock only where that directory is missing), and CI's suite step runs under `flock -w 3600` on the same file (since #61). A second run waits; never start a parallel one.
- NAMING LANDMINE: the table `leagues` is SPORTS leagues (NFL, CFB, EPL…). Friends' leagues are `player_leagues` / `league_members`. Fantasy drafts are `draft_configs` / `drafts`.
- `contests.game_type` values: pickem, weekly, draft (the weekly Draft), draft_game (Primetime), october, run, epl_weekly_5.
- "ET day" is the sports day. Provider datetimes go through lib/gridiron/ingest.js `toUtc()` only. A displayed time goes through lib/time/display.js; a hard-coded zone is a test failure.
- Migrations: next number = highest file + 1, applied ONLY with scripts/apply-migrations.mjs, which keeps a checksummed ledger in `schema_migrations`. A migration that ran is never edited.
- Reports go in docs/reports/; designs in docs/design/; the handoff in docs/handoff.md (under 60 lines).

## A rep must always
- Read docs/handoff.md first, then CLAUDE.md.
- Run the FULL suite (scripts/suite.sh, env sourced) before any merge, push or deploy. The baseline is zero failures, and new test files are `git add`ed before the run.
- Require a READY Vercel preview for the exact commit before merging. A docs-only commit gets no preview by design.
- Bring main into a branch by merge.
- Treat any permission prompt as a stop: report it, don't work around it.
- Read PROD credentials from the environment (`PROD_DATABASE_URL`); verify writes with sentinel/throwaway accounts and clean up with an undo file.
- Prefer measuring PROD read-only before "fixing" DEV data: a red guard can be the guard's fault.
- Say what was verified and how. A report is one box, outcomes only.

## A rep must never
- Rebase or force-push. Commit package-lock.json (Linux-regenerated), .env / .env.local, node_modules, next.config.mjs or ios/.
- Merge, deploy, migrate PROD, write PROD or send email without Derik's explicit GO for that action.
- Use a scoped test run as the gate, or call a failure "pre-existing" and move on.
- Use `jsonb ||` on a nested key or an array: it is shallow and appends to arrays.
- Run `next dev` in the main checkout or against PROD, or load whole tables into memory (the droplet has 8 GB of RAM).
- Restart a droplet service to ship code: shipping is `scripts/deploy-poller.sh`. Never `--continue` / `--resume` an old Claude session.
- Print a secret, connection string or token; name a data vendor in user-facing copy (lib/legal.test.mjs).
- Email dormant accounts: the daily/morning email goes only to 30-day players, accounts under 14 days old and /you opt-ins (ruling thu-1).

## Known live issues and holds
- NBA Game Drafts stay off until DRAFT_GAME_NBA is set (NBA tips off 20 Oct 2026).
- CFB win probability is CALIBRATING. Flip it off only after the sealed re-score passes.
- League chat is "Coming soon"; the league notify toggles are stored, but nothing sends yet.
- Fantasy draft leagues (Fantrax import, keepers) are a separate system. Merging them into player leagues is pending Derik's ruling: docs/reports/2026-10-16-slice3-draft-leagues-recon.md.
- The morning email is specified but not built.
