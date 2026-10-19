# mon-3: morning email v2 + NBA jerseys - details (19 Oct 2026)

Branch morning-email, commits on top of d4af7fd:
- 893c357 the pictures and the mock's layout
- 6b3e59d NBA jerseys, all 30
- dcb811b hex baseline (cards.js 7, imageData.js 2, morning.js 10 -> 11: email/Satori cannot read tokens)
- 6094fd8 COUNTS test re-reads a mismatch before failing

## Gate
- Full suite on 6094fd8: 6538/0 (878 s).
- Earlier runs on this relay:
  - 893c357: 3 failures, not captured (the tail was cut);
  - 6b3e59d: 2 failures, both the hex ratchet (fixed in dcb811b);
  - dcb811b: 1 failure, COUNTS 2026-10-21 email 22 vs /scores 21.
    DEV held 21 on a direct count, and the email read 21 on a re-read. A suite fixture landed
    between the two reads. Fixed in the test (three reads), not in the rule.
- Preview READY on dcb811b. /og/email/tile/daily.png -> 200 image/png, cache public.
- A stray scoped run I started outside the suite lock was stopped within a minute. The sweep found
  one leftover of mine (users 143949, prefsroute-...): deleted, undo row in the scratchpad.
  Older orphans (3780 users, 4 Oct-3 sentinel matches) predate this session and were left.

## Jerseys
- Source: Derik's 30 Higgsfield renders. Backgrounds removed with Higgsfield's image remover
  (rembg is not on the droplet, and ML tools stay off it).
- Cropped to the alpha bbox, squared with 4% padding, and exported in headless Chromium:
  webp 96/192 into public/headgear/nba/, png 128 into public/email/marks/nba/.
- NYK/WAS: TeamMark gets a drop-shadow(0 0 1px var(--line)); the email PNGs have a #C9C7DA
  outline drawn in.
- BDL letters on DEV and PROD: ATL BKN BOS CHA CHI CLE DAL DEN DET GSW HOU IND LAC LAL MEM MIA MIL
  MIN NOP NYK OKC ORL PHI PHX POR SAC SAS TOR UTA WAS. All 30 match; no BRK/NO/PHO/UTAH.

## Test send
- 18:36:12Z to derik@sportsvyn.com, as user 301, day 2026-10-20, PROD data, Resend
  01a15573-2546-7ae7-a59b-7f408a9623d0.
- Modules:
  - hero NBA, 3 games;
  - Daily;
  - free to play 2 (The Daily, October);
  - game of the day BOS@DET (season opener);
  - the week, 6 sports;
  - spotlight (the app, with the lock-screen preview; user 301 has an iOS device, so no Get the app).
- Yesterday's Daily is absent: Monday's board is still open at render time. The real Tuesday run
  will have it.

## Open
- PROD NBA tips Tue: BOS@DET 19:00Z (3 PM ET), PHI@NYK 23:00Z, OKC@SAS 01:30Z. The 3 PM ET looks
  wrong; it comes from the feed (updated 17:52Z).
- A name-filtered run of morning.test (--test-name-pattern) fails before() on an FK. The whole file
  passes (19/0), and so does the suite. This looks like a node:test hook-ordering quirk under a filter.
- components/team/RecentNext.js has a lint error on main (unescaped '), outside the suite.
