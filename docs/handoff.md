# Handoff - droplet relay wed-5, 8 Oct 2026

## Live (PROD)
- main = ca7825f (crew-setup merged) + docs. Vercel production READY at ca7825f.
- Droplet services deployed: current=ca7825f, previous=0ce3057 (deploy-poller.sh proof ok).
- PROD migration 135 app_errors ledgered. Write path proven by sentinel through the deployed
  release; 30 min after deploy app_errors = 0 rows, poller active.
- Firewall (6 Oct): Meta deny + Alibaba challenge firing; invocations/day ~130k -> ~7k.

## Held - HOLDING-FOR-GO
- ats-s3 @ 469ecde (S3 ATS, NFL/CFB, spread frozen at board creation, push/no-line = void).
  Full suite 6341/6341 under the lock. No migration. NOT yet: preview check, browser pass,
  DB-backed freeze test on a football board (~30 min). Design: docs/reports/2026-10-08-ats-s3.md
  on the branch. Decisions for Derik: (1) no spread at open = void? (2) boards created before
  deploy carry no frozen line -> ATS counts from the first board after deploy (vs backfill);
  (3) frozen line shown only in ?league= view; national view shows the live line.
- PROD crew_reader role: still held for the crew turn (step 2 of wed-4's list). Until then
  ~/crew/bin/app-errors works only with --dev.

## Needs Derik
- AUTH_SECRET: set on production AND preview. Single error came from PRODUCTION dpl_6gSox (efc050f),
  POST /api/daily/guest/start, 7 Oct 03:31Z. Throws when unset OR <16 chars; checking the length
  needs a decrypt - your call.
- Neon "ci" branch + CI_DATABASE_URL secret (or a Neon API key); Cloudflare token; move mini keys.
- Vercel: billing lags ~1 day; judge the firewall saving on the 9-10 Oct bills. Optional: ignoreCommand
  for docs-only builds (~$5-15/mo); Seats/Speed Insights ~$40/mo if unused.

## Queue
1. CFB placeholder kickoffs (M, 3-5 h, before 20 Oct): 41 CFB games 12-28 Oct sit at midnight ET
   without kickoff_tbd -> lock at 00:00 ET and take the top default confidence rank. 3 of 15 on the
   13 Oct board, 15 of 17 on 20 Oct. Re-check Mon 12 Oct.
2. NBA no-board night copy (S, ~1 h, before 20 Oct): 22 Oct has 2 games -> thin-slate; page copy unchecked.
3. Watch: 13 Oct 13:23Z boards REGULAR; 20 Oct 13:23Z boards CONFIDENCE; 20 Oct 10:52Z NBA board.
4. /market fix is already shipped (b2f248a, 817263c) - drop it from the recon list.
5. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- MODULE_TYPELESS_PACKAGE_JSON warning per service start (lib/ops/appErrors.js); harmless.
- Reports: docs/reports/2026-10-08-{wed5,vercel-cost,oct20-readiness}.md
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Derik: decisions on ATS (1-3) and GO; then preview + freeze test + browser pass, merge ats-s3.
Build the CFB placeholder-kickoff fix before 20 Oct.
