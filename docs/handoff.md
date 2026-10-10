# Handoff - droplet relay fri-1, 10 Oct 2026

## Live (PROD)
- main = 17f7ac8 (draft-game-s1 merged) + docs. Vercel prod READY at 17f7ac8. The droplet
  services are still at ecca1e9 (S1 touches no poller code).
- Per-game Draft S1 is live but dark. Migration 136 is on PROD (ledgered, sha bfae04810c0c).
  DRAFT_GAME_BOARDS=off on Vercel production, so the :33 cron makes nothing: 0 draft_game boards.
  /draft/game answers 200 with "No games open". +32 min (20:18Z): app_errors empty, Vercel runtime
  errors none. The 20:33Z cron run recorded {disabled: true}.
- Bots are lettered Bot A/B/C. Boards are made only when DRAFT_GAME_BOARDS is exactly 'on'.

## HOLDING-FOR-GO
- draft-game-s2 (settle every 10 min, live + final results, lobby row, the mock's list/room/result).
  Report docs/reports/2026-10-10-draft-game-s2.md, shots alongside it. Code head 508ae48, suite
  6384/6384. Preview READY (DEV data, switch on).
  ON GO: merge, then reset lib/brand/parity-intent.json to {"changes": []} in the next commit
  (259 declared entries), deploy. No migration. PROD stays dark until Derik sets
  DRAFT_GAME_BOARDS=on on production and redeploys.
- DEV left for a look: 15 draft_game boards (14 week-5, 60728 settled), sentinel 123882
  (dgshot-*). Remove after GO: list first, undo file.

## Findings
- A.J. Brown (PROD): on NE, last played week 1 (NE), no rows for weeks 2-4 although NE has full
  boxes - he has not played, so this is not a data gap. The real gap is that the pool keeps anyone who played in
  the last 365 days, so an injured Brown would sit in an NE pool. Fix later (S3 or before the
  switch): require a game in the team's last 3, or read BDL injuries (lib/six/pool.js has the
  NBA version).
- apply-migrations targets PROD only via DATABASE_URL="$PROD_DATABASE_URL" (there is no --prod
  flag; the thu-3 note was wrong).

## Needs Derik
- GO on S2, and when to switch DRAFT_GAME_BOARDS on in production.
- From wed-7 (PROD writes): the 2 unclaimed guest rows; one real magic-link sign-in.
- From wed-4: Neon "ci" branch/key, Cloudflare token. PROD crew_reader role (crew turn).

## Queue
1. 13 Oct after 13:23Z and 20 Oct: docs/launch-oct20.md (PROD reads need approval).
2. TICKET: suite tests that mutate real DEV boards (the week-5 void_all) must use own fixtures.
3. Per-game: pool injury filter; S3 NBA; S4 retire the weekly Draft after one clean NFL week;
   S5 CFB final-only; S6 League A; S7 League B.
4. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- Test-owned user prefixes: dgtest- (draftGame.db), dgsettle- (settle.db). Manual sentinels use
  dgshot-.
- PROD SELECTs hit the "Production Reads" check; ask Derik per read, never writes.
- neon tagged template: `interval ${'24 hours'}` is a syntax error; write the literal.
- Headless Chromium: LD_LIBRARY_PATH=~/projects/travault/scripts/vendor/chromium-libs/usr/lib/
  x86_64-linux-gnu; playwright at ~/.npm/_npx/705bc6b22212b352.
- ~/crew/secrets is gone (9 Oct). DEV crew_reader role and sentinel 117499 remain.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Derik: GO / no-GO on draft-game-s2. 13 Oct 13:23Z+: launch-oct20.md checks 1-5.
