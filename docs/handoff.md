# Handoff - droplet relay wed-7, 8 Oct 2026

## Live (PROD)
- main = ecca1e9 (guest-secret 5701a3b + ats-s3) + docs. Vercel prod READY at ecca1e9; droplet
  services current=ecca1e9, previous=d1d39f3.
- Guest play WORKS: guest tokens sign with DAILY_GUEST_SECRET (48 chars, prod + preview).
  Verified signed out on sportsvyn.com: start 200 -> 8/8 -> run 200 -> "Sign in to keep your streak".
- AUTH_SECRET rotated (was < 16 chars; now 48, prod + preview). Database sessions, so sign-ins
  should survive. /api/auth/* and /signin answer 200.
- S3 ATS live: league Pick'em format ATS (NFL/CFB); one lock note over two switch offers.
- +30 min (07:50Z): Vercel runtime errors none new; droplet journals 0 error lines; poller active.

## Needs Derik
- PROD DB access was refused this session by the permission classifier ("Production Reads"), so:
  (a) the probe's unused guest row (7 Oct 02:48Z) and this relay's completed guest row
      (8 Oct ~07:20Z) are still in daily_guest_runs - delete, or allow a PROD-write relay;
  (b) app_errors was not read (Vercel + journals used instead);
  (c) magic-link sign-in was NOT proven end to end. Quickest proof: sign in once on
      sportsvyn.com yourself; or allow PROD writes for the sentinel verification_token round trip.
- From wed-4: Neon "ci" branch/key, Cloudflare token, move mini keys. PROD crew_reader role.

## Queue
1. Watch 13 Oct 13:23Z: CFB/NFL boards REGULAR; TBD rows carry kickoff_tbd. 20 Oct 13:23Z
   CONFIDENCE; 20 Oct 10:52Z NBA board; 22 Oct NBA thin night shows the copy.
2. TICKET (wed-7 item 4, not started): tests that mutate real DEV boards must use their own
   fixtures. Receipt: an S3-era suite run set a REAL DEV week-5 Pick'em board to void_all and the
   builder reset it by hand. Find the test (grep suite writers of contests/board/void_all that
   select by week/sport rather than by a fixture prefix), give it a sentinel board created in
   before() and torn down in after(), and assert in after() that no non-fixture board changed.
3. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- `vercel env pull` returns sensitive vars EMPTY - a length check from a pull proves nothing.
- Headless Chromium here needs LD_LIBRARY_PATH=~/projects/travault/scripts/vendor/chromium-libs/
  usr/lib/x86_64-linux-gnu (libasound missing); playwright at ~/.npm/_npx/705bc6b22212b352.
- Two suites cannot overlap (lock); SV_SUITE_WAIT=1800 when another gate may hold it.
- Report: docs/reports/2026-10-08-wed7.md. Scheduled: CFBD quota wiring not before 12 Oct;
  CFB win-prob re-score 26 Oct.

## Next step
Derik: the three PROD-access items above. Then queue item 2 (the DEV-board test ticket).
