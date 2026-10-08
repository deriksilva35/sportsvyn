# Oct 20 readiness: recon + DEV rehearsal (Thu 8 Oct 2026, read-only on PROD, nothing committed)

## 1. What creates the boards, and when
| Board | Job | File:line | Trigger |
|---|---|---|---|
| NFL + CFB Pick'em | Vercel cron `/api/cron/pickem-board` -> `ensurePickemBoard` | vercel.json:69 (`23 13 * * *`), app/api/cron/pickem-board/route.js:53, lib/pickem/create.js:273 | daily 13:23Z (9:23 ET). Board opens_at = Tue 9:00 ET (13:00Z) before the slate's first kickoff, so Tue 13 Oct and Tue 20 Oct 13:23Z create; a failed day retries next day (opens_at is anchored, so a late retry keeps its format). Last PROD run 7 Oct 13:23Z. |
| NBA day board | Vercel cron `/api/cron/nba-schedule` -> `nbaPickemTick` -> `ensureNbaDayBoard` | vercel.json (`52 * * * *`), app/api/cron/nba-schedule/route.js:71, lib/nba/dayPickem.js:174,372 | hourly at :52; board opens at 06:00 ET (OPEN_ET, dayPickem.js:50) or first tip if earlier, so the first create is the 06:52 ET (10:52Z) tick of each game day. Last PROD run 8 Oct 00:52Z. |
Poller/daily-tick are NOT involved; this is all Vercel cron.

REGULAR vs CONFIDENCE is a date constant on the board's opens_at, not a flag: `CONFIDENCE_START = 2026-10-20T04:00Z` (lib/pickem/confidence.js:34), `stampsConfidence(sport, opensAt)` for nfl/cfb/nba. Football stamps at create.js:307, NBA at dayPickem.js:134/185. Stamp is on contests.meta.scoring at INSERT; open boards never change.
- 13 Oct 13:00Z < 20 Oct 04:00Z: REGULAR. 20 Oct 13:00Z >= start: CONFIDENCE. NBA 20 Oct opens 10:00Z: CONFIDENCE.
- Verified with the real `boardPlan` against PROD (SELECT only): NFL 13 Oct -> wk 6, 14 games, opens 13 Oct 13:00Z, confidence=false. NFL 20 Oct -> wk 7, 14 games, opens 20 Oct 13:00Z, true. CFB 13 Oct -> week key 42, 15 games, false. CFB 20 Oct -> week key 43, 17 games, true.

## 2. Schedule data on PROD
- NFL: wk 5 (15), wk 6 (14: Thu 16 Oct + 12 Sun + MNF), wk 7 (14), wk 8 (14). All have teams and real kickoff times, none TBD.
- CFB: 13-17 Oct 62 games incl. 52 on Sat 17 Oct; 20-24 Oct 56 games incl. 44 on Sat 24 Oct. AP-filtered boards: 15 games (13 Oct) and 17 (20 Oct).
- NBA: 1200 REG games 20 Oct 2026 -> 12 Apr 2027, all 'scheduled', no TBD. Per ET day: 20 Oct 3, 21 Oct 11, 22 Oct 2, 23 Oct 12, 24 Oct 8, 25 Oct 7, 26 Oct 9, 27 Oct 4, 28 Oct 12, 29 Oct 3, 30 Oct 10, 31 Oct 7, 1 Nov 4, 2 Nov 15.
- NBA 20 Oct has exactly 3 games (the minimum, passes). 22 Oct has 2 and 29 Oct has 3. 22 Oct will correctly get no board.
- GAP: CFB kickoffs still at the unflagged midnight-ET placeholder: 41 games 12-28 Oct (5 on 17 Oct, 36 on 24 Oct). In the planned boards: 3 of 15 (13 Oct board), 15 of 17 (20 Oct board). Today only; times normally post within days.

## 3. DEV rehearsal (real code: ensurePickemBoard, ensureNbaDayBoard, pickemBoardView, ConfidenceBoard via renderToString)
Suite lock (sv-crew, since 01:09Z) cleared 01:22Z before any write. DEV had no player_leagues, so rollover was a no-op.
Created (ids 57819-57822), all deleted afterwards (0 contests left, 0 entries); no matches/teams seeded.
1. PASS stamp: NFL now=13 Oct -> board 57819 wk 6, meta {} (REGULAR). NFL now=20 Oct -> 57820 wk 7, meta.scoring=confidence. NBA 20 Oct -> 57821 (3 games) confidence; NBA 21 Oct -> 57822 (11 games) confidence, day_board true. NBA 20 Oct at 09:52Z -> before-open.
2. PASS rank sheet: pickemBoardView phase living, scoring confidence, default ranks 14..1 (NFL) and 11..1 (NBA); ConfidenceBoard renders 14 and 11 rows with chips 14..1 / 11..1. (Signed-out render, so no Save button; the signed-in save path is covered by confidenceBoard/confidenceFlow tests.)
3. PASS thin slate: NBA 22 Oct (2 games, real DEV data) -> `thin-slate`, no contest row written.
`node scripts/dev-orphan-sweep.mjs` lists 3799 pre-existing fixture rows (simtest-* users etc., 5 Oct); none from this rehearsal.
Not rehearsed on DEV: CFB create (same insert line, create.js:307; the AP filter differs). Only the PROD read-only plan covers CFB.

## 4. Missing / risks
| Item | Size | Needed by |
|---|---|---|
| Placeholder CFB kickoffs: non-MLB TBD is only honoured via a stored flag, so a still-unset game locks at 00:00 ET the morning of its date, and in confidence it sorts first and takes the biggest default rank. Fix: set kickoff_tbd for gridiron placeholders at ingest (or isKickoffTbd for CFB). Check first on Mon 12 Oct whether the 3 are resolved. | M, 3-5 h | 20 Oct (15 of 17 affected today); 13 Oct only if 3 stay unset |
| Nothing for 22 Oct 2-game NBA night: confirm the lobby/pickem page copy for 'no board' (not checked) | S, 1 h | 20 Oct (first no-board night is 22 Oct) |
| Watch items, no build: 13 Oct 13:23Z both football boards REGULAR; 20 Oct boards confidence; 20 Oct 10:52Z NBA board | S, 0.5 h | 13 / 20 Oct |
No schedule data or cron changes are missing.
