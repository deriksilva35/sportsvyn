# Drive card replay, and what it found (drive-3, 9 Nov 2026)

Route: `/admin/replay/<slug>?play=<provider_play_id>` or `?at=<ISO>` (admin Basic Auth via proxy.js, noindex, three
SELECTs, no writes). It mounts the same `CardFace`; `lib/gridiron/replay.js` truncates the plays, rebuilds the current
drive's summary and calls the live `driveCardFor` / `driveStripFor` with `now` = the play's `created_at` + 1 s.
A play list with a replay link per play and prev/next sits under the card.

Games (PROD, read-only SELECT, copied to DEV as sentinel rows `zz-replay-*`, removed afterwards, undo file
`test-tmp/undo-dev-replay.jsonl`): NFL `nfl-2026-reg-w9-cle-no` (CLE away, NO home), CFB `cfb-2026-reg-w10-oregon-ohio-state`
(ORE away, OSU home). (c) is the TD play itself and (d) the FG play itself (the card right after it).

Shots: `/tmp/claude-1000/-home-derik-projects-sportsvyn/af6e3a16-ede5-42c8-ac8f-76b4f57f9e73/scratchpad/drive3/` -
nfl-a-mid, nfl-b-rz, nfl-c-td, nfl-d-fg, cfb-a-mid, cfb-b-rz, cfb-c-td, cfb-d-fg (.png, 390 px, 2x).

## Per-shot check (expected from the play log alone vs the rendered SVG attributes)

Columns: LOS (yards to goal -> expected x / rendered x), distance and first-down line x, drive plays / yards / time
vs the log, red zone, flash. Score is away|home as rendered.

| shot | state | LOS | distance, first-down x | drive | red zone | flash | score |
|---|---|---|---|---|---|---|---|
| nfl-a-mid | 2Q 12:32 2nd & 8 · NO 29 | 29 -> 113.58 / 113.58 ok | 8 -> fd 89.42 / 89.42 ok | plays 7 (log 7) ok; yds 29 ok; top 2:36 ok | rz none ok | no flash | 0|3 |
| nfl-b-rz | 1Q 10:04 2nd & 13 · CLE 15 | 15 -> 282.7 / 282.7 ok | 13 -> fd 321.96 / 321.96 ok | plays 5 (log 5) ok; yds 48 ok; top 2:24 ok | rz tint ok | no flash | 0|0 |
| nfl-c-td | 4Q 0:58 Touchdown · Saints | 0 -> 328 / 328 ok | - -> fd - / - ok | plays 6 (log 6) ok; yds 55 ok; top 0:50 ok | rz none ok | flash TD on right (home attacks right) ok | 13|16 |
| nfl-d-fg | 3Q 2:26 Field goal · Saints | 0 -> 328 / 328 ok | - -> fd - / - ok | plays 13 (log 13) ok; yds 54 ok; top 6:30 ok | rz none ok | flash FG on right (home attacks right) ok | 6|6 |
| cfb-a-mid | 1Q 15:00 2nd & 9 · ORE 46 | 46 -> 189.08 / 189.08 ok | 9 -> fd 216.26 / 216.26 ok | plays 6 (log 6) ok; yds 29 ok; top - (cfb: stored only) | rz none ok | no flash | 0|0 |
| cfb-b-rz | 2Q 15:00 4th & 2 · OSU 15 | 15 -> 71.3 / 71.3 ok | 2 -> fd 65.26 / 65.26 ok | plays 11 (log 11) ok; yds 60 ok; top - (cfb: stored only) | rz tint ok | no flash | 0|14 |
| cfb-c-td | 4Q 7:13 Touchdown · Ohio State | 0 -> 328 / 328 ok | - -> fd - / - ok | plays 10 (log 10) ok; yds 93 ok; top 3:48 (cfb: stored only) | rz none ok | flash TD on right (home attacks right) ok | 38|22 |
| cfb-d-fg | 2Q 11:26 Field goal · Oregon | 0 -> 26 / 26 ok | - -> fd - / - ok | plays 12 (log 12) ok; yds 60 ok; top 4:54 (cfb: stored only) | rz none ok | flash FG on left (away attacks left) ok | 3|14 |

Expected values: LOS = the play's end_yards_to_goal (NFL) or yards_to_goal - yards_gained; first-down line = LOS - distance
in the attack direction, x = 26 + 3.02 * (yards from the left goal line); drive plays = snaps of the drive's offense up to the
cut excluding timeouts, end-of-period rows and kickoffs; drive yards = start yards-to-goal - LOS (TD: start; FG: start - the
kick's line); NFL time = game clock from the drive's first snap to the cut play. All 8 shots match after the fixes below.

## Card bugs the replay found, fixed here (tests in driveCard.test.mjs and replay.test.mjs)

1. Drive plays/yards counted stoppage rows. CFB files the defense's timeout, End Period and the drive-opening kickoff
   (under the receiving team) inside a drive, with their own yard line. OSU-ORE drive 12 read "10 plays - -31 yds" and drive 1
   "1 play - 0 yds". `driveTotals` now counts snaps only (no stoppage types, no kickoffs, only the drive's own offense).
2. FG drive yards: `yards_gained` on a field goal is the kick (27), so derived yards ran past the goal line
   ("13 plays - 81 yds" for 63 -> the 9). A kick no longer moves the offense: 54.
3. CFB time of possession: CFB play clocks are drive-granular (every play of a drive carries the drive's clock), so a time
   derived from them was "0:00" mid-drive and wrong otherwise. CFB (`game.leagueSlug === 'cfb'`) never derives a time; the
   stored CFBD duration or nothing. NFL is unchanged (real clocks).
4. Scoring-drive yards: the flash line now states the geometry the band already draws: TD = start to the goal line, FG = start to
   the kick's line. CFBD's envelope said 80 for OSU's 93-yard drive from the 7.

## Unsettled

- NFL stored drive envelopes (lib/gridiron/plays.js reconstructDrives, NOT changed): `yards` for a made field goal runs to the
  goal line or to an arbitrary BDL end spot (CLE-NO r12 stored 63, true 54; r5 58, true 35; r2 stored 3). The live card reads
  the stored value whenever the envelope exists, so a live FG flash can show these. Fix belongs in the ingest (use the kick's
  start line); replay derives instead, so it shows the true number.
- CFB play clocks are drive-granular in the data, so a mid-drive CFB card's game clock is the drive's start clock, not the snap's.
- A CFB mid-drive replay has plays and yards but no time (see 3); CFBD's own partial duration at that moment is not stored.
- Flash on stoppage rows: a timeout or penalty row stored in the same poll as a TD (same created_at) still flashes for 35 s,
  exactly as live. Replaying such a row shows the flash.
- Out-of-order feed rows (CFB duplicate TD rows, play_number not monotonic) are shown as stored.
