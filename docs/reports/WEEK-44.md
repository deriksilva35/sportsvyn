# SPORTSVŶN — week 44 (2026-10-26 to 2026-10-29, partial: filed Thursday)
Crew ran 58 times · 0 capped · 2 stuck · $1.16 (−$0.87 vs last week: 71 runs, $2.03) · proof runs: 2

Plainly: A busy week. A wording fix in the follow-limit code went live after one false start, the crew's tooling on the server was reinstalled at Derik's request, and the missing game-check script was restored so the nightly checks now cover the games again. One repeat reinstall request is waiting on Derik, and one live-game alert from Wednesday is still open.

## Fixed
- Comment at lib/follows.js:15 said THREE teams per league vs FOLLOW_CAP_PER_LEAGUE → corrected (PR #60, merged 10-26; ticket 90827016 closed 10-26). The first merge (PR #40) was undone 10-26 (deliverable c70b906f, reverted); the re-relay (87af578a) published 10-27. Two further undo requests on 87af578a (10-27) were cancelled before the runner took them.
- SETUP: game-watch script missing on droplet, G1-G6 not evaluable (ticket 6032bf49) → restored; closed 10-29 via ops card 26eb5ce4. Watcher has reported "G1-G6 clean/quiet" on every run since 10-28 13:33.
- SETUP: board-state printed no SUMMARY line (ticket 21986e4a, open since 10-21) → closed 10-28.
- Injuries provider stale ~21 days (ticket 16dfae18, open since 10-22) → closed 10-28.
- Vercel production 5xx on / (ticket 8b0dc772, 10-27) → closed 10-28.
- crew/ reinstalled at 362fd73e (ops cards 2ed4ccf9, f9c1495b, efd950f3 approved 10-28; ticket 9f55defe closed 10-28 via ed54ebfe).

## Added
- daily-season-backfill-2000-2001: 1119 rows (Data Keeper, deliverable 57e9a74b, approved 10-26). Data Keeper runs 10-27, 10-28, 10-29 report "dup-skipped vs approved 57e9a74b".

## In the Outbox / waiting on Derik
- Reinstall SPORTSVŶN crew/ at 3cb72dd8 (ops card 9de1f194) · waiting 0 days · a repeat of 9d169f62, which Derik rejected 10-29 ("dont want").
- Ticket a637378d · G1: NBA Oct 28 ORL@TOR still scheduled 11 min past kickoff (severity live, new 10-28) · needs a ruling: real feed problem or expected lag?

## Sent back or rejected
- Reinstall crew/ at 3cb72dd8 (9d169f62) · "dont want" · Fixer re-filed it as 9de1f194 at 09:20 (now waiting).
- Reinstall crew/ at 1812a0b4 (af92f06a) · "CH-5 proof — box already restored" · no follow-up.
- Roll back crew/ to 362fd73e (ae52b6b8) · "rollback proof — dry run only" · no follow-up.

## Failed, capped or stuck
- SPORTSVŶN Fixer · undo-merge c70b906f · stuck 10-26 14:00 · 1 of 2 attempts (done 15:35) · revert PR checks failed (brief daa685dc: nbaOpener.test.mjs on shared CI data); Derik re-ran the job, green.
- SPORTSVŶN Fixer · relay 8a0fe2c3 · stuck 10-27 18:00 · 1 attempt, no retry seen, no deliverable row with that id · my read: relay push with lock_wait 0 (10-28 daily note); check what ticket it belonged to.
- SPORTSVŶN Watcher · run_events errors: vercel.com timeout 10-26 06:01 (partial scan, cost pace unknown); board-state no SUMMARY 10-26 15:41 (deduped to 21986e4a); not_found:script 10-28 15:11 (game-watch, since fixed). Partial scans (G1-G5 not evaluated) on every run 10-26 → 10-28 12:31.
- Proof runs (not crew failures): Watcher proof:ops2b-test ×2 stuck 10-26 17:24.

## Decisions Derik made this week (now in agent memory)
- Undo of PR #40 failed its checks → re-ran the failed job (attempt 2 green 15:21; nbaOpener.test.mjs on shared CI data)
- Test question from OPS-2b → yes
- Reinstall crew/ from main through the crew shell → done at 362fd73e; 9f55defe closed via ops cards
- Reinstall at 1812a0b4 → reject · Roll back to 362fd73e → reject · Reinstall at 3cb72dd8 → reject ("dont want")

## Recommendations
- Fixer: never re-file an ops card Derik rejected the same day (9de1f194 duplicates 9d169f62); treat a reject as final unless the ticket changes.
- Watcher: when a check script is missing, file the SETUP ticket on the first partial scan, not after two days (6032bf49 was filed 10-28; partials began 10-26).
- Watcher: Vercel billing timeout leaves "cost pace unknown"; add a fallback (last known pace) so the line is never blank.
- Ticket a637378d (live) needs a ruling from Derik: real or feed lag.

## Spend
| Agent | Runs | Cost | Cap | Note |
|---|---|---|---|---|
| SPORTSVŶN Watcher | 36 (+2 proof) | $1.05 | $0.75/run · $35/mo | MTD $2.91 |
| SPORTSVŶN Fixer | 18 | $0.00 | — | 2 stuck |
| SPORTSVŶN Data Keeper | 4 | $0.11 | $0.30/run · $10/mo | MTD $0.28 |
| Project | 58 (+2 proof) | $1.16 | $35/mo | Console workspace sportsvyn $0.75 MTD |
