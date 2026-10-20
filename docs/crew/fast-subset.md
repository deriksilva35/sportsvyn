# Fixer fast subset: the repo-wide guards

**Run time: 126 s wall, 41 files, 408 tests, 0 fail** (droplet, main 3820ed4, env sourced, 20 Oct 2026).

Each of these tests walks the tree (app/, components/, lib/, sometimes scripts/ and services/) or a
registry, so a rule broken in ONE file fails it no matter which directory the PR touched. The Fixer
runs every one of them on every PR, plus the tests next to the files it changed. The full suite is
still GitHub's "SPORTSVŶN test suite" check.

Run (from the repo root, env sourced):

    set -a && . ./.env.local && set +a
    node --test $(grep -E '^[a-z].*\.test\.mjs' docs/crew/fast-subset.md | cut -d' ' -f1)

app/tokens.test.mjs - hex census / colour ratchet (lib/brand/hexBaseline.json); no file gains a colour literal
app/darkParity.test.mjs - dark page resolves as origin/main; declare intent in lib/brand/parity-intent.json, reset after merge
lib/time/zoneGuard.test.mjs - no hardcoded zone / "PT" clock outside the ALLOW list
lib/time/timeTbdGuard.test.mjs - every kickoff render honours the TBD flag
lib/legal.test.mjs - no user-facing string names a data vendor
lib/auth/ageGateDob.test.mjs - age gate: DOB is read only through the gate
lib/auth/ageGateDoors.test.mjs - age gate: every app/ door and server action is gated, counted
lib/daily/guestRuns.test.mjs - daily_board_runs reader guard (every reader classified) + only guestRuns.js names the guest table
lib/bdl/census.test.mjs - every BDL key reader goes through the one door
lib/cfbd/clientCensus.test.mjs - every CFBD call goes through the client
lib/admin/adminActionsCensus.test.mjs - every admin action is gated
lib/admin/gate.test.mjs - admin cross-game read touches only tables that migrations create
lib/clientGraph.test.mjs - no 'use client' file imports server-only code
lib/jsxCommentSpace.test.mjs - JSX comment spacing (a hydration/text-node trap)
lib/util/scoresOf.test.mjs - census: no hand-rolled score shape outside scoresOf
lib/brand/fontsLocal.test.mjs - no file imports next/font/google
lib/brand/cardFont.test.mjs - every ImageResponse route registers the card font
lib/email/suppression.test.mjs - every sender checks the suppression list
lib/settle/voidAllReaders.test.mjs - every settle reader handles a void
lib/gridiron/kickoffGuard.test.mjs - no raw provider datetime parse outside ingest.js
lib/gridiron/teamOrder.test.mjs - away/home order everywhere a matchup renders
lib/soccer/roundLabel.test.mjs - round labels come from the one helper
lib/seo/routes.test.mjs - every app route is in the sitemap/robots decision
lib/scores/leagueScoreboards.test.mjs - every league page has a scoreboard wired
lib/leagues/joinByCode.test.mjs - join codes are resolved in one place
lib/fantasy/attribution.test.mjs - data attribution on every fantasy surface
lib/fantasy/teardown.test.mjs - every fixture prefix has a teardown
lib/games/playRegistry.test.mjs - registry entries: unique marks, flags, hrefs
lib/mlb/lineups.test.mjs - no America/ zone in playRegistry
app/games/how-it-works/howItWorks.test.mjs - every flagged registry game is listed (FLAGGED)
app/dailyBlue.test.mjs - only the Daily banner reads --tok-daily
app/roomBars.test.mjs - room bar CSS rule across every sheet
app/surface.test.mjs - surface rules across app/ and components/ JS
app/sim/draft/errorBoundary.test.mjs - error boundaries route back to the room
components/games/confirmCard.test.mjs - confirm card is the only confirm; no hardcoded-zone clocks on game surfaces
components/team/teamMark.test.mjs - TeamMark has only its named users (ALLOWED)
components/appstore/appBanner.test.mjs - the app banner flag ships dark everywhere
components/scores/scoresV2.test.mjs - score card rules across app/ and components/
components/sim/appleIapCard.test.mjs - one buy path; the iap prop is never defaulted on
components/sim/joinByCode.test.mjs - every join-by-code caller uses the one action
components/sim/membershipCopy.test.mjs - no em/en dashes in funnel copy, across app/components/lib
