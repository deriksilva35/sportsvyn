# Handoff - droplet relay wed-6, 8 Oct 2026

## Live (PROD)
- main = d1d39f3 (cfb-tbd + cfb-tbd-2) + docs. Vercel production at d1d39f3; droplet services
  current=d1d39f3, previous=8a1cd78.
- CFB Time TBD: 245 future CFB games flagged kickoff_tbd (41 in 12-28 Oct); flag rewritten every
  sync. 13 Oct board plan: 15 games, 3 TBD (ranks 1-3 if confidence; 13 Oct is REGULAR).
  20 Oct plan: 17 games, 15 TBD -> ranks 1-15. CFB game page prints "Time TBD".
- NBA thin night copy live. Docs-only commits now skip Vercel builds (ignoreCommand).
- app_errors after the d1d39f3 deploy: 0 rows at +21 min and at +30 min; poller active.

## Held - HOLDING-FOR-GO
- ats-s3 @ 3b12af1 (main merged, suite 6353/6353, pushed). Rulings match the code. Held for:
  duplicate lock note on the league page, a DEV week-5 board voided by a suite run and reset by
  hand, the builder's lock slips; preview for 3b12af1 not yet checked. Shots on the branch.
- PROD crew_reader role (crew turn).

## Needs Derik
- AUTH_SECRET: CONFIG. Guest play has never worked on PROD (1 guest start ever, failed; reproduced
  by probe). auth() works, so the var is present - most likely < 16 chars. Recommend a dedicated
  DAILY_GUEST_SECRET (>= 32 chars) on Vercel prod+preview + a one-line guestRuns.js change; or
  lengthen AUTH_SECRET (may sign people out).
- S3: GO after the nits above (or say ship as is).
- From wed-4: Neon "ci" branch/key, Cloudflare token, move mini keys.

## Queue
1. Watch 13 Oct 13:23Z: CFB/NFL boards REGULAR; TBD rows carry kickoff_tbd. 20 Oct 13:23Z
   CONFIDENCE; 20 Oct 10:52Z NBA board; 22 Oct NBA thin night shows the copy.
2. Find the suite test that voids a non-fixture DEV board (S3 builder's report).
3. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- Two suites cannot overlap (lock); pass SV_SUITE_WAIT=1800 when a builder is also gating.
- A builder's DEV fixture writes outside the lock break other gates - say so in its brief.
- Reports: docs/reports/2026-10-08-wed6.md (+ wed5, vercel-cost, oct20-readiness).
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Derik: AUTH_SECRET choice; S3 GO. Then: preview 3b12af1, merge ats-s3, deploy, 30-min app_errors.
