# Per-game Draft S1 - thu-3, branch draft-game-s1 (DEV only, HOLDING-FOR-GO)

## What is built
- Migration 136_contests_match_id.sql:
  - contests.match_id (FK matches, no cascade);
  - UNIQUE idx_contests_match (game_type, match_id);
  - idx_contests_week narrowed to rows with no match_id.
  - Applied and ledgered on DEV (sha bfae04810c0c). NOT on PROD.
- lib/draftGame/rules.js (pure):
  - 4 seats, 4 rounds, a snake order, BEST 3 COUNT, a 30 s clock;
  - slot-free bots that pick from the top 3 by projection, weighted 60/30/10 and seeded per
    (contest, your seat, pick);
  - auto-pick takes the top projection;
  - the lock is kickoff, or any status off 'scheduled';
  - the copy constants.
- lib/draftGame/pool.js:
  - both teams' QB/RB/WR/TE with a final game in the last 365 days (no K, no DST);
  - projection = average PPR over the last 8 games;
  - floor 0.5, cap 30, refused under 20.
- lib/draftGame/create.js:
  - game_type 'draft_game'. A board opens 72 h before kickoff and locks_at = kickoff.
  - The hourly run creates what is due and moves locks for games whose kickoff changed.
  - INSERT ON CONFLICT DO NOTHING on the unique index.
- lib/draftGame/room.js:
  - one contest_entries row per reader per game, holding meta.room {seat, picks, deadline};
  - the room is replayed from its picks;
  - writes are guarded on the pick count;
  - a read applies expired clocks, and a read after kickoff completes the room;
  - lineup.players is written when the room fills.
- Cron /api/cron/draft-game-board runs hourly at :33 (vercel.json). It is not on PROD until merged.
- Pages /draft/game (list) and /draft/game/[id] (room), with actions in app/actions/draftGame.js
  (age-gated). Not linked from the lobby yet (S2).
- scripts/dev-orphan-sweep.mjs also lists contests on fixture matches by match_id.

## Tests
- lib/draftGame/rules.test.mjs, pool.test.mjs and draftGame.db.test.mjs: 19 tests.
  - pool size per game: every DEV 2026 week-5 game has a pool of at least 20, both teams, players
    only. Measured 26-30 across 29 games in weeks 5-6.
  - bots never stall: 60 boards x 4 seats always fill 16 picks.
  - lock at kickoff: the boundary is `>=`; no start after kickoff; an open room completes at
    kickoff; a pick after kickoff is refused.
  - one board per game: a second create races to the first; a raw duplicate INSERT is refused
    by idx_contests_match; two games in one week make two boards.
  - also covered: the clock (auto-pick, chained deadlines), best 3 of 4, the copy, the list
    count, and a moved kickoff moving its lock.
- Full suite:
  - c33b052: 6367/6372. The 5 reds were all guards on new files: colour literals x2, the
    age-gate door count, a cron minute clash with the watchdog, and a stale noindex. All fixed
    in 558d8d5.
  - 558d8d5: 6372/6372.
  - ca7d0e3: 6372/6372 (779 s, under the lock). This is the gated code head; later commits add only docs and shots.

## Preview (DEV data)
- Previews are READY for c33b052, 558d8d5 and ca7d0e3. Shots from ca7d0e3 are in
  docs/reports/2026-10-09-draft-game-s1/:
  - 01-list.png
  - 02-room-your-pick.png ("Round 1 of 4 · your pick")
  - 03-room-after-pick.png ("Round 2 of 4 · your pick", the bots answered, 27 s on the clock)
- The preview runs found 2 bugs, both fixed in ca7d0e3:
  1. "Draft" on the list did not open the room: push and refresh together, the refresh
     cancelled the push.
  2. The list said "0 of 4 picked" after the clock had auto-picked. It now applies expired
     clocks to the count, read-only.
- Copy against the brief: "Draft one game." / "Four drafters, four picks each. Your best three
  score. Over when the game ends." / "Round N of 4 · your pick" / "Best 3 of 4 count" /
  "Pool: both teams' players." All 5 match exactly.
  - Additions not in the brief: "Locks at kickoff · <time>" under the matchup, "Draft" and
    "Resume · N of 4 picked" buttons, the "Ns to pick" clock, and "No games open to draft right
    now. Boards open three days before kickoff."
  - The mock itself is not in the repo (docs/design/mocks has no per-game file), so the layout
    is mine. It uses the Draft page's shell and tokens.
- DEV state left: board 60104 (PHI @ JAX, match 5652, pool 30) for a look before GO, and DEV
  sentinel user 122851 (dgshot-*@example.invalid) with its room on 60104. Both can go.

## Notes for Derik
- PHI's DEV pool has no A.J. Brown (Smith, Wicks, Hollywood Brown are there). That is DEV
  nfl_players data, the team or position on his row; check on PROD before S2.
- Bots are labelled by seat number ("Bot 4" next to "You" at seat 3). Say if you want them
  numbered 1-3.
- ~/crew/secrets is gone (removed 9 Oct), so the old DEV sentinel was unavailable; a throwaway
  one was made for the shots.
- AT MERGE (GO): apply 136 on PROD with apply-migrations.mjs --prod. The cron then starts making
  NFL boards within the hour (14 for week 6). The pages are reachable by URL only.
