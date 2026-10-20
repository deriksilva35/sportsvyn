# coins-2 Part B build (B1-B5, B7) - branch coins-drum, HELD for review + GO

Everything is behind COINS=on (Vercel: Preview, branch coins-drum only). Production is untouched.

## B1 migrations (DEV only, ledgered)
- 147_coins_drum.sql: coin_weeks, arcade_points UNIQUE(user, contest_key, event), coin_mint, drum_prizes,
  drum_entries, drum_winners. Coins in hand = minted - dropped, never stored.
- 148_coin_mint_seq.sql: coin_mint.seq UNIQUE(user, seq). The mint's advisory lock degrades to unlocked
  when its connection fails; seq makes a racing second mint a no-op. (147 already ran on DEV, so the
  change is a new file per the ledger rule. PROD gets 147 + 148 together at the dual GO.)

## B2 the mint (lib/coins/mint.js, cron /api/cron/coins-mint 7 * * * *)
- Reads contests settled in the last 8 days (eligible, not void-all) + Daily boards past closes_at.
  Ranks the scored field with competitionRank; ties share a place; pickem by score/max_score; DNF out.
- Out of field and points: house, @example.invalid sentinels, Daily guests, late claims. Under 10: nothing.
- Points: 25 per finish + ONE best tier (win 250 / top 3 150 / top 10% 100 / top 25% 50); first play
  in a week 100; 3-week streak 50 (at 3, 6, 9...). Points go to the week the contest settled in; a
  drawn week's late settlement pays into the open week.
- Coins: cumulative points - 100 x coins ever, whole hundreds, cap 10 a week, the rest carries.
- Eligible games (rules s3): daily, weekly, draft, pickem nfl/cfb/mlb, run, october. NOT yet: NBA day
  Pick'em, Primetime Draft, EPL Weekly 5 - the rules list them as "announced later" (lib/coins/rules.js
  ELIGIBLE, one line each to add).

## B3 The Drum (/coins, POST /api/coins/drop)
- Header (week, Close countdown, auto-drop note, in-hand), a card per drum (tile, title, coins in,
  "about 1 in N per coin", your SV chips, -/+), HOW YOU EARNED THEM + meter, small print, sticky bar,
  confirm sheet (DROP THEM / Change it). Steppers only add; minus takes back only this visit's plan.
- Drop: server-validated, one guarded INSERT run SERIALIZABLE (a two-tab race spends each coin once).
  No un-drop endpoint; a test walks app/ and lib/ for any UPDATE/DELETE of drum_entries.
- 18+ by date of birth (read only inside lib/auth/ageGateDb.js adultUserIds), not house, not an owner
  address. Minors and NULL DOB: coins shown, "18+ TO WIN", no steppers, never auto-dropped.

## B4 Play strip (/games): navy card + meter bar "N points to next coin", signed in + flag only.

## B5 the close (lib/coins/close.js, cron coins-close Tue 16:00Z + 17:00Z)
- Closes only weeks whose closes_at (Tue 09:00 PT, DST-aware) has passed; drawn_at claimed once.
- Order: mint, auto-drop in-hand coins of eligible players into the lowest drum, seed = last NFL final
  of the week "AWAY n - HOME n" (fallback: any final, then "WEEK id"), draw (sha256 counter stream +
  Fisher-Yates per drum; first `count` tickets win), claim + winners in one transaction, next week
  opens with the default prizes, push (coins-won / coins-result waves) + email (once per user per week).
- Reveal /coins/results/<week>: your result, winners per drum (handle; state arrives with B6), coins,
  players, seed, "Check it" = /api/coins/draw/<week> (tickets, order, method; account ids stripped).
- Dry run: scripts/coins-close.mjs (default), and /coins/results/dry-run draws the OPEN week as if it
  closed now, writing nothing.

## B7 /coins/rules: Rules v0.1 text, point table rendered from lib/coins/rules.js; placeholders visible.

## B6 not started (as ordered): Tremendous stub + first-win sheet + merch queue + W-9 flag.

## Gates
- Tests: lib/coins/{mint,drum,close}.test.mjs (pure + DEV fixtures in 1998 weeks, each file tears
  down only its own weeks). Guards updated with reasons: age-gate doors 15 -> 16, census feed routes
  (+coins-close), zone allowlist (lib/coins/week.js + the four "9:00 am PT" labels), app tab bar list
  (.cn-bar), daily_board_runs classification (mint = board-scoped), navArcade (/games strip prop).
- next build clean (worktree node_modules is a hardlink copy: Turbopack refuses a symlink).
- eslint: zero problems in changed files; the tree's 34 are pre-existing, in untouched files.
- No screenshots from the droplet (headless Chrome lacks libasound here): the preview is the review.

## For review on the preview
- DEV has almost no play this week, so The Drum shows no steppers. To give your DEV account coins:
  node scripts/coins-dev-seed.mjs --user <your DEV id> --coins 4   (DEV only; --undo removes them)
