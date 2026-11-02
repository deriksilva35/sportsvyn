# SPORTSVŶN — week 44 (2026-10-26 to 2026-11-01)
Crew ran 91 times · 0 capped · 2 stuck · $2.15 (+$0.12 vs last week: 71 runs, $2.03) · proof runs: 2

Plainly: A busy week. The crew's install on the droplet was reinstalled and the game checks (G1–G6) started working again on Oct 28; since then the Watcher has filed seven live tickets about games that stay "scheduled" after kickoff or freeze mid-match. One small comment fix landed after an undo-and-redo. Nothing is waiting on Derik in the Outbox, but the seven game-feed tickets need someone to look at the poller.

## Fixed
- Comment at lib/follows.js:15 said THREE teams per league, cap is 5 → PR #40 merged 10-23, undone via revert PR #55 (checks failed first, merged on retry 10-26), redone as PR #60, merged 10-26 (ticket 90827016 closed).
- crew/ on the droplet behind main → reinstalled at 362fd73e (deliverable approved 10-28, ticket 9f55defe closed 10-28).
- game-watch script missing on droplet (G1–G6 not evaluable) → ticket 6032bf49 closed 10-29; G1–G6 evaluated from 10-28 15:40 PT onward.
- board-state printed no SUMMARY line (ticket 21986e4a) → closed 10-28. Injuries provider stale ~21 days (ticket 16dfae18) → closed 10-28. Vercel 5xx on / (1 in 60 min) → closed 10-28.

## Added
- daily-season-backfill-2000-2001: 1119 rows (Data Keeper, approved 10-26, 57e9a74b); daily runs since report dup-skip.

## In the Outbox / waiting on Derik
- none

## Sent back or rejected
- Reinstall crew/ at 1812a0b4 · "CH-5 proof — box already restored" · proof, no action.
- Roll back crew/ to 362fd73e · "rollback proof — dry run only" · proof.
- Reinstall crew/ at 3cb72dd8 (×2, 10-29 and 10-30) · "dont want" / "No note" · Fixer re-offered after rejection; recommend it stop re-offering a rejected target.
- Reinstall crew/ at d19ce47c · "proof (CH-6b)" · proof.

## Failed, capped or stuck
- SPORTSVŶN Fixer · undo-merge c70b906f · 10-26 14:00 stuck · revert PR #55 failed the SPORTSVN test suite (nbaOpener.test.mjs on shared CI data); re-run green 15:21, merged on retry. CI flake, not a code bug.
- SPORTSVŶN Fixer · relay 8a0fe2c3 · 10-27 18:00 stuck · stopped to ask Derik to reinstall crew/ from main; brief answered 10-28 ("Done: 362fd73e"). Expected stop.
- SPORTSVŶN Watcher · 6 run_events of kind error: vercel.com timeout ×2 (partial scan, cost pace unknown), not_found:script ×1 (game-watch, 10-28), G1 hit ×1, G6 regression ×1, board-state no SUMMARY ×1.

## Decisions Derik made this week (now in agent memory)
- Undo of PR #40 failed checks → "re-run the failed job" (brief 10-26).
- OPS-2b test question → "Yes" (ignore).
- Reinstall crew/ from main → done at 362fd73e, ticket 9f55defe closed (brief 10-28).
- Reinstall at 3cb72dd8 → rejected twice ("dont want").

## Recommendations
- Seven live game-feed tickets opened 10-28..11-01, same two signatures: G1 "past kickoff still scheduled" ×3 (ORL@TOR 10-28, NBA 10-31, BOS-ORL/BKN-IND 11-01) and G6 "live match frozen" ×4 (EPL 24683, 5 EPL at HT, 19 CFB, EPL 24691). Watch rule fired (same signature 3+ runs): the score poller is not flipping or updating; one fix, not seven.
- Fixer: do not re-offer a reinstall target Derik already rejected (3cb72dd8 offered twice).
- Watcher: Vercel billing/cost-pace timed out 2 nights; "cost pace unknown" all week — the cost-watch trigger lost 10-09 (registration note) still needs re-issuing.
- Data Keeper: 7 runs, log_line missing on 10-26 run; sign every run.

## Spend
| Agent | Runs | Cost | Cap | Note |
|---|---|---|---|---|
| SPORTSVŶN Watcher | 65 (+2 proof) | $1.92 | $0.75/run · $35/mo | 7 tickets filed |
| SPORTSVŶN Data Keeper | 7 | $0.23 | $0.30/run · $10/mo | 1 approved deliverable |
| SPORTSVŶN Fixer | 19 | $0.00 | — | 2 stuck |
| Project | 91 | $2.15 | $35/mo | Console workspace sportsvyn $0.06 Nov MTD |
