# Drive card fixes (drive-4, 9 Nov 2026)

Branch `drive-4` (from main 6a1adb0a). Five items from the replay's findings.

## 1. NFL drive yards for a made field goal
`reconstructDrives` now ends a field-goal drive at the KICK LINE (`driveYardsFor` in lib/gridiron/plays.js:
start - the kick row's start_yards_to_endzone). BDL's end spot for the kick is the goal line or an arbitrary
number (CLE@NO r12 stored 63, true 54; r2 stored 3, true 51). CLE@NO r12 now 54 everywhere.

Recompute: `scripts/recompute-nfl-drives.mjs` (stored plays only, no BDL fetch; dry run by default; `--apply` writes
one UPDATE per changed final game, one game in memory at a time, undo JSONL of the old envelopes in
`test-tmp/undo-recompute-nfl-drives-<target>-<ts>.jsonl`; idempotent, read-back after apply). Only `envelope.yards`
of Field-goal drives can change: playCount / clocks / result do not read the kick, plays.drive_* carry no yards,
win-probability inputs read each play's own yards_to_goal. So nothing else is recomputed.

PROD dry run (SELECT only, season 2026): 135 final games scanned, 447 Field-goal drives, ALL 447 change, in 131 games.
DEV: 3 drives in 1 game; applied (read-back 0 left). Apply on PROD (parent, after merge):

    set -a && . ./.env.local && set +a && node scripts/recompute-nfl-drives.mjs --prod --apply

Replay derivation, live card and the stored envelope now agree for CLE@NO (r12: 54 in all three; the shots below read
a DEV copy of the game with the recomputed envelopes).

## 2. CFB clock "Q1 15:00" mid-drive
Cause: CFBD /live/plays carries ONE clock per drive on every play (the drive's start) except the drive's last play
(and a period's last row), which carries the clock it ended on. The sentence has no "(08:21)" prefix (that is the
historical /plays shape), only scoring plays state "clock 03:25". `wallClock` is per play but plays.* does not keep it.
So plays.clock is the feed's value, NOT an ingest bug, and no backfill can repair it (the per-play clock is not in
what we stored; nothing to dry-run). The LIVE card is unaffected: its period/clock come from matches.metadata.live_state
(poller / CFBD scoreboard), never a play row, and driveCardFor reads no play clock (test).
Replay: `lib/gridiron/cfbClock.js` spreads the drive's clock between its start and end by position, per drive and
period, and uses a scoring sentence's stated clock as an exact anchor; estimated plays are marked `clockEst` and the
replay play list shows `~` after their clock. The card shows the clock of that play (estimate between the drive's
start and end), exact on a drive's first and last play and on scores.

## 3. NFL last-play text
`nflPlayText` / `footballPlayText(league, text)` in lib/gridiron/playText.js: strips "(Shotgun)", "(No Huddle, Shotgun)",
"(No Huddle)", "(Punt|Run|Field Goal formation)" and a leading "(2:46)" / "(:10)" clock. No jersey numbers exist in NFL
text ("Timeout #1 by KC" is a timeout count and is kept). Club codes, measured on all 2026 NFL play text on PROD:
BLT->BAL, CLV->CLE, ARZ->ARI, HST->HOU, LA->LAR, WAS->WSH (the rest already match ours). Applied on the board card
(driveStripFor), game page card and drive strip (gamePageArcadeView), replay, NFL game page Last play + drive chart,
and the Live Activity's lastPlay (liveLine, league passed by the poller and both game pages). CFB's board card now
gets cfbPlayText too (it was only cleaned on the game page).

## 4. Linescore columns
`table-layout: fixed`, every period column (Q1-Q4 and OT) 3em, T 3.5em, code column takes the rest
(app/scores/scoresV4.css, arcade-gated, so no dark-parity intent). Measured at 390 px: header and row cell right edges
are identical per column in every shot.

## 5. Goal line
DriveCard draws the ball first and the first-down line and LOS over it; the dot is kept inside the field of play
(one radius in from each goal line). Extra frame nfl-e-goalline shows 2nd & Goal at the 2.

## The 8 frames (390 px, 2x), `scratchpad/drive4/`
`/tmp/claude-1000/-home-derik-projects-sportsvyn/af6e3a16-ede5-42c8-ac8f-76b4f57f9e73/scratchpad/drive4/`
nfl-a-mid, nfl-b-rz, nfl-c-td, nfl-d-fg, cfb-a-mid, cfb-b-rz, cfb-c-td, cfb-d-fg (+ nfl-e-goalline), .png; measured values in check.json.
Rendered from PROD rows copied read-only into DEV as zz-replay-* (ids mapped to DEV teams, NFL envelopes recomputed);
removed afterwards (2 matches, 411 plays), undo/ids file test-tmp/undo-dev-replay-drive4.jsonl.

| shot | LOS x | first-down x | drive | red zone | flash | clock now shown | last-play text |
|---|---|---|---|---|---|---|---|
| nfl-a-mid | 113.58 ok | 89.42 ok | 7 plays, 29 yds, 2:36 ok | none ok | none | Q2 12:32 | D.Sampson right end to NO 29 for 2 yards (C.Young). |
| nfl-b-rz | 282.7 ok | 321.96 ok | 5, 48, 2:24 ok | tint ok | none | Q1 10:04 | T.Shough left end to CLE 15 for -3 yards (G.Delpit). (was "(No Huddle, Shotgun) ... CLV 15") |
| nfl-c-td | 328 ok | - | 6, 55, 0:50 ok | none | TD right ok | Q4 0:58 | A.Estime left tackle for 2 yards, TOUCHDOWN. ... (no "(Shotgun)") |
| nfl-d-fg | 328 ok | - | 13, 54 (was 63), 6:30 | none | FG right ok | Q3 2:26 | C.Smyth 27 yard field goal is GOOD, ... |
| cfb-a-mid | 189.08 ok | 216.26 ok | 6, 29, no time (CFB) ok | none | none | Q1 12:14 (was 15:00, estimate) | B.Jackson rush middle for 1 yard gain to the Oregon46 (...) |
| cfb-b-rz | 71.3 ok | 65.26 ok | 11, 60, no time | tint ok | none | Q2 11:53 (was 15:00, estimate) | D.Raiola pass complete short right to J.Lott caught at ... |
| cfb-c-td | 328 ok | - | 10, 93, 3:48 (stored) | none | TD right ok | Q4 3:25 (stated in the TD sentence, exact) | L.Fahey pass complete short middle to J.Smith ... TOUCHDOWN, clock 03:25 ... |
| cfb-d-fg | 26 ok | - | 12, 60, 4:54 (stored) | none | FG left ok | Q2 11:26 (stored, exact) | G.Hurych field goal attempt from 33 yards GOOD ... |

## Unsettled
- CFB mid-drive clocks are estimates (the feed has none per play); marked `~` in the replay list only, the card shows
  the estimated number as a plain clock.
- The cfb-c-td last-play sentence runs three plays together (TD + penalty + next play, one CFBD row); thu-2's cleaner does not split it.
- Replay/live drive "yards" for a FG flash use the kick line already; the stored envelope is now consistent with it once the PROD recompute is applied.
