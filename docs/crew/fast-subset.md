# Fixer fast subset: the repo-wide guards

**Run time: 120 s wall, 43 files, 423 tests, 0 fail** (droplet, main 4f8c13a + wed-1b, env sourced, 20 Oct 2026). voltContrast + legacyRedirect added after wed-1b's CI caught the first.

Each of these tests walks the tree (app/, components/, lib/, sometimes scripts/ and services/) or a
registry, so a rule broken in ONE file fails it no matter which directory the PR touched. The Fixer
runs every one of them on every PR, plus the tests next to the files it changed. The full suite is
still GitHub's "SPORTSVŶN test suite" check.

Run (from the repo root, env sourced):

    set -a && . ./.env.local && set +a
    node --test $(grep -E '^[a-z].*\.test\.mjs' docs/crew/fast-subset.md | cut -d' ' -f1)

app/tokens.test.mjs - hex census / colour ratchet (lib/brand/hexBaseline.json); no file gains a colour literal
app/darkParity.test.mjs - dark page resolves as origin/main; declare intent in lib/brand/parity-intent.json, reset after merge
app/voltContrast.test.mjs - no --tok-action/--tok-accent text on a light ground, every tracked CSS file (ON_DARK_ANCESTOR for navy cards)
lib/time/zoneGuard.test.mjs - no hardcoded zone / "PT" clock outside the ALLOW list
lib/time/timeTbdGuard.test.mjs - the literal "Time TBD" lives in lib/time/display.js only
lib/legal.test.mjs - no user-facing string names a data vendor
lib/auth/ageGateDob.test.mjs - age gate: only the gate names date_of_birth; no reader selects the whole users row
lib/auth/ageGateDoors.test.mjs - age gate: every app/ door and server action is gated, counted
lib/daily/guestRuns.test.mjs - daily_board_runs reader guard (every reader classified) + only guestRuns.js names the guest table
lib/bdl/census.test.mjs - every BDL key reader goes through the one door
lib/cfbd/clientCensus.test.mjs - every CFBD call goes through the client
lib/admin/adminActionsCensus.test.mjs - every admin action is gated
lib/admin/gate.test.mjs - admin gate; the cross-game read touches only tables the migrations create
lib/clientGraph.test.mjs - no client component reaches a server-only door
lib/jsxCommentSpace.test.mjs - no JSX in app/, components/, lib/ loses a space to a comment
lib/util/scoresOf.test.mjs - the coerce-then-filter score shape lives in one file only
lib/brand/fontsLocal.test.mjs - no file imports next/font/google
lib/brand/cardFont.test.mjs - no ImageResponse route fetches its font through import.meta.url
lib/email/suppression.test.mjs - every send path checks the suppression list first
lib/settle/voidAllReaders.test.mjs - every reader in lib/ treats a void_all contest as VOID
lib/gridiron/kickoffGuard.test.mjs - no raw provider datetime parse outside ingest.js
lib/gridiron/teamOrder.test.mjs - gridiron away-first, soccer home-first, across app/ and components/
lib/soccer/roundLabel.test.mjs - no file spells Matchweek/Gameweek/Matchday by hand; only roundLabel.js
lib/seo/routes.test.mjs - every private app route declares noindex
lib/scores/leagueScoreboards.test.mjs - no route under a league mounts a scoreboard (walks app/)
lib/leagues/joinByCode.test.mjs - no join by league id, in lib, actions or UI
lib/fantasy/attribution.test.mjs - every ADP surface single-sources the attribution constant
lib/fantasy/teardown.test.mjs - no shipped surface still sells a paid feature
lib/games/playRegistry.test.mjs - registry entries: unique marks, flags, hrefs
lib/mlb/lineups.test.mjs - no America/ zone in playRegistry
app/games/how-it-works/howItWorks.test.mjs - every flagged registry game is listed (FLAGGED)
app/dailyBlue.test.mjs - only the Daily banner reads --tok-daily
app/roomBars.test.mjs - every fixed/sticky bottom rule in any sheet is a listed room bar
app/surface.test.mjs - no data-surface="paper" attribute or selector anywhere
app/sim/draft/errorBoundary.test.mjs - no test file hides under a [dynamic] segment (node --test would skip it)
components/games/confirmCard.test.mjs - confirm card is the only confirm; no hardcoded-zone clocks on game surfaces
components/team/teamMark.test.mjs - TeamMark has only its named users (ALLOWED)
lib/you/legacyRedirect.test.mjs - nothing in the tree links into the /my and /account redirects
components/appstore/appBanner.test.mjs - the app banner flag ships dark everywhere
components/scores/scoresV2.test.mjs - no score-card class is redefined in any other sheet
components/sim/appleIapCard.test.mjs - one buy path; the iap prop is never defaulted on
components/sim/joinByCode.test.mjs - every join-by-code caller uses the one action
components/sim/membershipCopy.test.mjs - no em/en dashes in funnel copy, across app/components/lib
