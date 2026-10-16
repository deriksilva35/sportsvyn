# Handoff - droplet relay fri-1, Fri 16 Oct 2026 (clock ~17:45Z)

## Live (PROD) - main 806e810 (deployed ~17:38Z); poller unchanged (93a36a4)
- TILE FIX: the tiles read fmtTile (lib/leagues/home.js): 912.4 · 1,569 · 44.2K · 312K · 1.2M,
  at most 5 characters before a sign. On sportsvyn.com (arcade face, 390 wide) Laces Out's
  BACK OF 1ST shows "44.2K" in 90 of 90px (was "44,21..."). Suite 6504/0; preview READY on 627c6c4
  (the merge's tree is identical). Throwaway removed, 0 left; app_errors 0 after the deploy.
- LEAGUE HOME (thu-4) live since ~05:39Z; migration 144 on PROD. leagues-tick on the new code:
  the 06:25Z run backfilled 62 period-winner lines (Sep 9 - Oct 15); all 10 later runs wrote 0;
  no duplicate keys, no errors, no alerts. No took_first lines yet (no lead changes).
- Arcade email (15 Oct): 292 delivered, 5 bounced, 0 complaints/unsubs, 0 real clicks,
  0 recipients back on the site.

## Morning email - RULING thu-1 (recipients), recorded in memory
- Send ONLY to: (a) any game action in the last 30 days, (b) accounts created in the last 14 days,
  (c) "Morning email" ON at /you (default OFF for everyone else). Dormant accounts get nothing.
- The email is NOT built on this host (no branch, no template). Expected first-day count, PROD
  read-only: 41 (37 active + 4 new; (c) = 0 until the toggle exists; 2 bounced before; 16 Apple relay).

## Slice 3 recon (read-only) - docs/reports/2026-10-16-slice3-draft-leagues-recon.md
- RECOMMEND B: keep the draft tables, link draft_configs.league_id -> player_leagues, + a league
  kind. 4.5-6 d. A (draft as a game inside the league) is 9-13 d: rewrites leagueShare, and every
  player_league_games reader must skip a contest-less game; the key 'draft' is already taken.
- PROD: 1 Fantrax league (225 THE LONGEST YARD: 4 members, 41 keepers); manual 245 / tracker 78 /
  preset 4 / launch 2 are single-reader rooms and stay out. Zero-loss backfill = 1 league,
  4 members, 4 join lines, 1 link, in one transaction, draft-side counts unchanged.
- Slice 4: the room is still single-human (drafts.user_id NOT NULL). The draft look
  (components/draftRoom/*, roomLook.js) and the Game Drafts guarded writes carry over.
  Slow draft 8-10 d, then live 5-6 d.
- Open for Derik: fantasy-only league or games beside the draft? Does /join stay as a redirect?
  max_members = teams_count?

## Queue
1. Derik picks A or B + the three open questions -> slice 3 build (next migration 145).
2. Chat slice (CHAT is "Coming soon"; the notify toggles are stored, nothing sends).
3. Morning email build under the thu-1 recipient ruling (+ gameOfTheDay in widget feed v1).
4. 20 Oct: docs/launch-oct20 checks 6-13. Mon 19 Oct: first live CFB 25 reminder. Mon 26 Oct:
   CFB win-prob re-score prompt.
5. TICKET: suite tests mutating real DEV boards use own fixtures. FCS abbreviations, CFB colours.

## Notes
- Shots: the headless browser is now chromium_headless_shell-1248 (another session upgraded it).
  ARCADE_THEME=on in `next dev` reproduces the live face. Sentinels need handle, onboarded_at
  and date_of_birth.
- The Vercel MCP web-analytics calls returned 404 today; `npx vercel api /v1/query/web-analytics/...`
  works.

## Next step
Derik: A or B for slice 3 (recommend B) and the three open questions.
