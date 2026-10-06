# Handoff - droplet relay tue-5, 6 Oct 2026 ~21:45Z

## Live (PROD)
- main 82b04ac (merge of daily-guest-play a80f068). Vercel deployed it ~21:09Z. Migrations 130+131
  already on PROD. Poller unchanged (1cd19ef), not redeployed: nothing the poller runs changed.
- Signed-out Daily play (Option A) is live: /daily/board 200 with Start, no sign-in redirect.
  Cold launch /sim?shell=sim-app -> 307 /games -> 200 (Play).
- Late-claim note: a closed-day receipt whose run has late_claim shows
  "Saved to your streak. Today's board had already closed."
  (app/daily/board/page.js, pinned by app/daily/board/lateClaimNote.test.mjs).
- Full suite before merge: 6206 / 0 fail on a80f068 (env sourced, new test git-added).
  Merge brought only docs from main on top; code tree identical to the tested branch.
- Firewall unchanged (meta block, alibaba challenge, forged-referer deny, market-filter-crawl log).

## Rulings (settled, do not raise again)
- A second guest play after clearing cookies is ACCEPTED (6/IP/hour cap is the only limit).

## Not exercised live
- Signed-in Daily on PROD was not clicked through: no sentinel session available here and no
  real account is to be used. Covered by the suite (claim, existing-run, closed receipt paths).
  PROD read check: daily_board_runs 88 rows, 0 late_claim; daily_guest_runs 0 rows.

## Queue
1. FCS abbreviation fill; 9 colourless CFB schools; morning email gameOfTheDay.
2. Branch daily-guest-play can be deleted (merged); worktree ~/projects/sv-guest-play has a copied .env.local (gitignored).

## Notes
- /app (dead-copy path) 307s to /signin; pre-existing, binary starts at /sim.
- Lint: 2 pre-existing errors DailyRoom.js / HandleClaim.js, also red on main.
- scripts/gridiron-backfill.mjs untracked, not mine.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Review the 30-min PROD error result in the report; then FCS abbreviation fill.
