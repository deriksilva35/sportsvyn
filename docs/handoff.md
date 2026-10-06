# Handoff - droplet relay tue-4, 6 Oct 2026 ~20:00Z

## Live (PROD)
- main: docs-only commits on top of 3d6d4de (pushed this window). Code unchanged. Poller 1cd19ef.
- PROD DB now has migrations 130 + 131 (applied via apply-migrations.mjs, ledgered, objects verified:
  daily_guest_runs, uq_daily_guest_runs_claim_day, idx_daily_guest_runs_ip, daily_board_runs.late_claim
  NOT NULL default false, daily_guest_runs.claimed_day). Pre-check: daily_guest_runs did not exist on
  PROD, so 0 rows could violate the unique index. daily_board_runs 88 rows, 0 late. Nothing on PROD
  reads the new objects until the branch deploys. Undo steps are in the 131 header.
- Firewall unchanged: meta-externalagent-block (rule_meta_externalagent_block_28B5Jy, deny),
  alibaba-market-challenge (challenge), forged-referer (deny), market-filter-crawl (log).
  Alibaba still hitting /market (726 challenged 17:59-18:59Z): no retirement of rule A.

## Branch daily-guest-play  (pushed, 896dddd; HELD, not merged)
- Preview: https://sportsvyn-2gqlmiec3-deriksilva35s-projects.vercel.app  (Ready, exact SHA).
  Behind Vercel Authentication (open it logged in to Vercel). Preview DB = DEV
  (ep-rough-mouse), which has 130+131. Signed-out /daily/board renders 200 with Start, no sign-in
  redirect (checked with `vercel curl`). Guest play against a 130+131 DB: yes.
- Full suite on 896dddd: 6204 / 0 fail (env sourced, new tests git-added).
- tue-4 rulings built: late claims count in streak + played/main/perfect/best boards; only the
  closed day's own board/field/counts/league day/push exclude them (late_claim).
  HARD RULE: guest submit UPDATE carries `now() < closes_at` at the write; claim requires
  completed_at < closes_at; start refused at/after close. Tests pin start, straddling submit,
  forged post-close completed_at, and the source guard.
- Ship order now: deploy only (migrations done). Merge needs your GO.

## Open questions for Derik
- Cookie clearing gives a second guest play (6/IP/hour cap only). Accept?
- A late claimer sees no note on /daily/board for the closed day. Add "saved to your streak"?

## Queue
1. Your preview review -> GO to merge daily-guest-play + deploy.
2. FCS abbreviation fill; 9 colourless CFB schools; morning email gameOfTheDay.

## Notes
- Lint: 2 pre-existing errors DailyRoom.js / HandleClaim.js, also red on main.
- No dev servers, no killed runs. scripts/gridiron-backfill.mjs untracked, not mine.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
HOLDING-FOR-GO: merge daily-guest-play.
