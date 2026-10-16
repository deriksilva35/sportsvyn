# Handoff - droplet relay thu-4, Fri 16 Oct 2026

## Live (PROD) - main e1d6856 (unchanged this relay); poller unchanged (93a36a4)
- Arcade email sent 15 Oct to 292 (0 failed). Next-day read: 286 delivered, 4 bounced,
  0 complaints, 0 unsubscribes, no real clicks (8 clicks in 0.06 s from one address = a link scanner).

## HOLDING FOR GO - leagues-home (Leagues P1 slices 1-2)
- Branch leagues-home @ 1a75766, worktree ~/projects/sv-leagues-home. Suite 6503/0 and Vercel
  preview READY on 1a75766 (sportsvyn-67q0xild3). The merge commit needs its own suite + preview.
- Report: docs/reports/2026-10-16-league-home.md; shots in docs/reports/shots-2026-10-16-league-home/
  (390 wide, DEV seed, scrollWidth 390 on all nine views; seed torn down, 0 left).
- Built: league home per the approved mock (eyebrow, tiles YOU / LEAD or BACK OF 1ST / TODAY,
  STANDINGS · TODAY · CHAT (soon) · MEMBERS, period chips, ▲/▼, days played · best, YESTERDAY,
  TOTAL, "Latest in the league"); Members tab (code + Share link, Owner/Co-admin, ⋯ menu,
  notify toggles stored, Leave); crew points for multi-game leagues (10/8/6/5/4/3, ties share).
- Migration 144_league_home.sql (roles + notify on league_members, league_events, league_removals)
  is on DEV ONLY.
- GO ORDER: apply 144 to PROD FIRST (`scripts/apply-migrations.mjs` with PROD), then merge.
  Merged without 144, every league page 404s (leagueDetail reads m.role) and create fails.

## Needs Derik
- GO for leagues-home (above). Decisions taken, in the report: crew points replace rank points
  in every multi-game league (PROD has 0 such leagues of 8); removed members stay out (no undo
  UI); no "League settings" button (no page exists); feed shows dates, not clock times.
- Leagues P1 questions (sun-4): total points model, bots in 4-7 team leagues, live sync, K/DST.
- Unclaimed guest rows from wed-7/mon-4/5; Neon "ci" key; Cloudflare token; crew_reader password.

## Queue
1. After GO: 144 on PROD, merge leagues-home, confirm a league page and the leagues-tick run.
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
Derik's GO on leagues-home -> 144 on PROD -> merge with a READY preview on the merge commit.
