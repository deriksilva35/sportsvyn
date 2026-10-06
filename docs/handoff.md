# Handoff - droplet relay tue-2, 6 Oct 2026 ~17:10Z

## Live (PROD)
- main 7e4f906 (unchanged this window). Poller release 1cd19ef; no redeploy needed.
- Firewall: NEW rule alibaba-market-challenge (rule_alibaba_market_challenge_vaoGuY),
  path eq /market AND AS45102 -> challenge, published 16:26Z. Rule A (forged
  referer, Deny) unchanged. Rule B (market-filter-crawl) still LOG.
  Match count: vercel metrics vercel.request.count --since 1h --group-by waf_rule_id
  --group-by waf_action -f "asn_id eq '45102'" -g 1h
- Recon: docs/reports/2026-10-06-tue2-alibaba-meta-guest.md (meta-externalagent
  ignores robots.txt: 799k hits/24h, 0 robots fetches, 57k on disallowed /signin).

## HELD: Daily Option A, branch daily-guest-play (worktree ~/projects/sv-guest-play)
- Commits c776a32, 354a62b, a03bbb3 on top of main 7e4f906. Not pushed.
- Full suite on a03bbb3: 6194 / 0 fail (with env). Preview build NOT done
  (no push, so no Vercel preview): the preview gate is still ahead.
- Migration 130_daily_guest_runs.sql applied to DEV ONLY (ledgered). PROD has
  129. Apply to PROD via apply-migrations.mjs BEFORE the deploy.
- Design: guest runs live in daily_guest_runs, never in daily_board_runs, so
  boards/streaks/beat-% cannot see them (test walks the tree: only guestRuns.js
  names the table). Device = signed sv_gd cookie; one play per device per board;
  start capped 6 new plays/IP/hour; signed start token (HMAC, AUTH_SECRET).
  Claim = one CTE statement on page load after sign-in (and POST
  /api/daily/guest/claim); expires 00:00 PT after the edition's ET date.
  A signed-in start on a device that already used its guest play is refused.
- /games no longer bounces a signed-out app launch to /signin (web code, not the
  iOS shell, so no Mac relay). Lobby Daily PLAY goes straight to /daily/board.
  Other tabs (/sim, /weekly, /draft...) keep their sign-in guard.
- DEV check done on a throwaway dev server (killed): signed-out page -> start ->
  forged/no-cookie token 401 -> submit -> reveal (no best roster on the wire) ->
  second start 409 -> reload shows result + "Sign in to keep your streak" ->
  sentinel signed-in load auto-claimed (#1, run on account) -> re-claim refused.
  Sentinel user/session/guest rows removed.

## Open questions for Derik
- LATE CLAIMS: expiry is midnight PT, ~3h after the ET close, so a claim can add
  a run to a board that already closed (rank/beat-% for that day shift after the
  reveal and the 9:00 push). Allow, or expire claims at the ET close?
- Cookie clearing gives a second guest play, bounded only by the 6/IP/hour cap.
  A cleared-cookie replay can be claimed. Accept, or tighten?
- Guests play without the age screen; the age gate runs at claim. OK?
- Block Meta's crawler (rule on bot_name meta-externalagent)? Not done.
- Carried: F2 mock sender (done in 7e4f906), iOS share tap, MCP trim, DEV leak.

## Queue
1. Option A: your review, then PROD migration 130, push, preview Ready, merge.
2. FCS abbreviation fill; the 9 colourless CFB schools; morning email gameOfTheDay.

## Scheduled checks
- Firewall day-2 + Rule B decision: Tue 14:17Z (passed; not actioned this window).
- CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Notes
- Lint: 2 pre-existing errors in components/daily/DailyRoom.js and HandleClaim.js
  (set-state-in-effect), untouched; also red on main.
- DEV sweep lists 3,783 older fixture rows (simtest-share-* etc.), none mine.
- Dev servers started: 1 (port 3917), killed.

## Next step
Fresh session: read this file; get Derik's answers on the open questions.
