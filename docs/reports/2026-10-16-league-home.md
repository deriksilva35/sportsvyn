# League home - Leagues Phase 1, slices 1-2 (droplet thu-4, 16 Oct 2026)

Branch `leagues-home` (worktree ~/projects/sv-leagues-home). HOLDING FOR GO: not merged, nothing on PROD.

## What was built
- /leagues/[id] per the approved mock (artifact "League home: standings, chat, members"):
  - header: date + LIVE eyebrow, INVITE, the name, "<games> · <span> · <scoring> · N members";
  - tiles: YOU (place) · LEAD +margin over 2nd when 1st ("Tied" when tied) else BACK OF 1ST · TODAY
    (THIS WEEK in a weekly league);
  - tabs STANDINGS · TODAY · CHAT ("Coming soon") · MEMBERS; ?tab=week still lands on Today;
  - period chips Season · This week · the last two final days (weekly league: the last two weeks;
    a daily/weekly-span league: its last three buckets), ?period=;
  - rows: rank, name + ▲/▼ (jade/terra) since the previous period, "N days played · best X",
    YESTERDAY (or the date / LAST WK), TOTAL; en-US thousands separators, one decimal at most;
  - "Latest in the league": the three newest league_events, plus "Open chat →".
- Members tab: invite code + Share link, Owner / Co-admin badges, the ⋯ menu (Make / Remove co-admin,
  Remove from league), the three notify toggles (stored only), Leave league (not for the owner).
- All-games ("crew") leagues: game chips (All games · each game), crew points 10/8/6/5/4/3 per
  game-week by finish (ties share the higher place, 7th+ 0, only FINAL weeks award), explainer,
  "This week's leaders"; a game chip shows that game's own table.

## Data (migration 144_league_home.sql - applied on DEV only)
- league_members + role ('member'|'co_admin'), notify_chat/results (default on), notify_joins (off).
- league_events (join | period_winner | took_first | chopped), UNIQUE (league, kind, user, period_key),
  every writer ON CONFLICT DO NOTHING. Backfills joins and existing chops.
- league_removals: a removed member is refused at the door ("You were removed from this league").
- Writers: createLeague (owner's line), joinByInvite, settleGuillotine (chopped), and
  /api/cron/leagues-tick -> settleAllLeagueEvents (period winners, took 1st; finished buckets only).

## Permissions (lib/leagues/members.js canAct, re-checked in SQL on every write)
- owner: make/unmake co-admin, remove anyone but themself; cannot leave.
- co-admin: remove plain members only. member: leave only.

## Gates
- Suite: 6503/0 on 83c4858; final tree in the handoff. New tests: lib/leagues/leagueHome.test.mjs (12).
- Vercel preview READY for 21153d4 (later commits pushed; see handoff).
- Shots: 390x844 @2x against DEV with a seeded league (sentinels, torn down after: 0 left).
  scrollWidth == 390 on all nine views (standings, today, chat, members + menu, a day chip,
  this week, crew all, crew Daily, crew Pick'em).
- The real tick writer on seeded data wrote 14 + 5 events; a re-run wrote 0.

## Before PROD (needs GO)
1. Apply 144 to PROD BEFORE the merge deploys: leagueDetail reads m.role and the create CTE
   writes league_events - without 144 every league page 404s and league creation fails.
2. Merge (suite + READY preview on the exact merge commit).

## Decisions taken (say if any is wrong)
- Crew points apply to EVERY multi-game league (they were rank points). PROD has 8 leagues,
  none multi-game, so no existing table changes.
- A removed member stays out until the row in league_removals is deleted (no UI to let them back).
- "League settings" button from the mock is not built (no settings page exists).
- Feed times show the date (e.g. "Oct 14"), not a clock time.
