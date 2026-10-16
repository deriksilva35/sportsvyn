# Handoff - droplet relay thu-4, Fri 16 Oct 2026

## Live (PROD) - main a36fd8a (deployed ~05:39Z 16 Oct); poller unchanged (93a36a4)
- LEAGUE HOME LIVE (Leagues P1 slices 1-2, thu-4 GO): migration 144 on PROD (ledgered; 13 join
  lines backfilled), merge a36fd8a (suite 6503/0; preview = 1a75766's READY, the merge added docs only).
- Verified on sportsvyn.com at 390: Laces Out shows the eyebrow, tiles, 4 tabs, standings,
  "Latest in the league"; join via /j, Leave, create, join by code, owner menu make co-admin +
  remove all worked. Throwaways 354/355 + test league 9 deleted (undo in scratchpad), 0 left;
  Laces Out back to its 2 members.
- FOLLOW-UP: in the light theme the BACK OF 1ST tile truncates a long value ("44,21..."):
  shrink .lh .lv-tile-v for long values. Report: docs/reports/2026-10-16-league-home.md.
- Arcade email 15 Oct: 292 sent; 286 delivered, 4 bounced, 0 complaints/unsubs, no real clicks.

## Needs Derik
- League home decisions (in the report): crew points replace rank points in multi-game leagues
  (PROD had 0 of 8); removed members stay out (no undo UI); no "League settings" button.
- Leagues P1 questions (sun-4): total points model, bots in 4-7 team leagues, live sync, K/DST.
- Unclaimed guest rows from wed-7/mon-4/5; Neon "ci" key; Cloudflare token; crew_reader password.

## Queue
1. Tile truncation fix (above). Confirm leagues-tick (hourly :25; first run on new code 06:25Z) writes ok.
2. Chat slice (the CHAT tab is "Coming soon"; notify toggles are stored, nothing sends yet).
3. 20 Oct: docs launch-oct20 checks 6-13 (NBA Game Drafts stay OFF until DRAFT_GAME_NBA).
4. Mon 19 Oct: first live CFB 25 reminder send - verify it. Mon 26 Oct: CFB win-prob re-score.
5. Morning email (another session may be on it: add gameOfTheDay). Draft look wk6 room (Mac).
6. TICKET: suite tests mutating real DEV boards use own fixtures. FCS abbreviations, CFB colours.

## Notes
- Screenshot method: next dev from the worktree on a fresh port; sentinel users need handle,
  onboarded_at AND date_of_birth (else /age/check); session row + authjs.session-token cookie;
  chromium needs LD_LIBRARY_PATH to the scratchpad libasound (scratchpad is gone after /clear).
- Multi-game leagues must be created with scoring 'rank' (settings validator refuses 'total').
- DEV has no leagues of its own; tests and seeds make and remove them.

## Next step
Fix the tile truncation; then the chat slice when Derik picks it.
