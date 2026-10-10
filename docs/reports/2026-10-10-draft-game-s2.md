# Per-game Draft S2 - fri-1, branch draft-game-s2 (DEV only, HOLDING-FOR-GO)

## Built
- SETTLE (lib/draftGame/settle.js). Live and final are one computation.
  - Each player's PPR comes from THAT game's nfl_player_game_stats; a seat scores its best 3 of 4.
  - A player with no stat row did not play: 0 points, shown as "did not play".
  - On a 3rd/4th tie, the EARLIER pick counts.
  - Places are competition ranks: ties share the higher place.
  - "Top N%" = rank among everyone who drafted the game, rounded up, never 0%.
  - A board settles once the game is final, its box has 10+ rows, and 3.5 h have passed since
    kickoff. postponed/cancelled settles VOID: the room is kept, nobody scores.
  - Unfinished rooms are completed at settle. Settle is idempotent.
- CRON /api/cron/draft-game-settle runs at 4-59/10, every 10 minutes clear of :17 and :33.
  It is NOT behind the switch: a board that exists always settles.
- ROOM PAGE PHASES: pre / drafting / waiting / live / final / void. The navy header has a lime
  eyebrow: "PHI @ JAX · SUN 6:30 AM PDT", then "LIVE 14-10" / "FINAL 27-24".
  - Drafting: "Round N of 4 · your pick" and "Best 3 of 4 count", 4 seat tiles (You lime,
    Bot A/B/C navy, with name and N/4).
  - The pool: every row shows a position chip, name, "TEAM · proj N" and a "Draft" pill;
    drafted rows are faded and show the drafter.
- RESULT: big points, "points · 2nd of 4", and "Top N% of everyone who drafted this game"
  (final only; "Nobody else drafted this game yet" when alone).
  - Your 4 players with stat line and points; the uncounted one is faded "not counted".
  - "The room" ranking; "Share" (lime, text only) and "Draft another game".
- LIST: "Draft one game." plus the subline.
  - A lime chip per ET game day: "NFL · Sunday · 1 of 13 drafted".
  - Rows: matchup bold, kickoff (reader's zone) under it, a "Draft" pill (navy) or a
    "Your draft" pill (outline).
- LOBBY: registry row 'nfl-draft-game' "Game Drafts · N of M", flagged on DRAFT_GAME_BOARDS
  (hidden while off; its read checks the switch itself, as Survivor's does).
- The switch is ON for Vercel preview (DEV data) and stays 'off' on production.
  .env.local is untouched: the droplet services read it.

## Tests
- settle.test.mjs (pure): best 3; a no-show scores 0 and two no-shows count one at 0; the
  earlier pick wins a tie; shared places; the percentile; a whole room; void and phases.
- settle.db.test.mjs (own 'dgsettletest-' league, players and users):
  - live scores from the box as it stands, and it is not_final before the whistle;
  - final waits out the grace, then settles best 3 with the percentile;
  - a second settle is 'already';
  - a postponed game settles void.
- Guards updated for real changes:
  - dark parity: 259 declared intent entries for the game.css restyle (S1's file);
  - volt contrast: .dgm-eyebrow / .dgm-big sit on .dgm-hd (navy);
  - how-it-works: Game Drafts is a second flagged game.
- Full suite:
  - f5b1bfb: 6381/6384. The 3 reds were those guards.
  - 41ceece: 6384/6384.
  - 508ae48 (copy fix): 6384/6384 (728 s, under the lock). This is the head held for GO.

## Preview (41ceece, DEV data, switch on)
Shots in docs/reports/2026-10-10-draft-game-s2/, from a throwaway sentinel:
- 01 list: two day chips, 13 + 1 games.
- 02 room: "Round 1 of 4 · your pick", tiles Bot A/B/C 1/4 and You 0/4, 3 faded rows with
  drafters.
- 03 after one pick.
- 04 list: "1 of 13 drafted" and the "Your draft" pill.
- 05 result: NE @ SEA · FINAL 10-13, 18.9 points, 2nd of 4, a stat line per player, the 4th
  faded "not counted", the room ranking, Share / Draft another game.
- 06 lobby: "Game Drafts" in YOUR MOVE, with "1 of 14 set" in the NFL card.
Two shot notes:
- The 05 shot was taken before the lone-drafter copy fix, so it still reads "Top 100%". The
  fix is in 508ae48.
- DEV has only 60 stat rows for NE @ SEA, so two of the four "did not play"; PROD has the
  full box.

## DEV state left
- 15 draft_game boards on real DEV matches: 14 for week 5 and 60728 (NE @ SEA, settled).
- Sentinel user 123882 (dgshot-*@example.invalid) with rooms on 60714 and 60728.
- Remove after GO (list first, undo file).

## At merge (GO)
- No migration: 136 is already on PROD.
- Reset lib/brand/parity-intent.json to {"changes": []} in a follow-up commit right after the
  merge (memory: parity intent goes stale on merge).
- Production keeps DRAFT_GAME_BOARDS=off, so no boards and no lobby row. Turning it on is
  Derik's call: set it 'on' on Vercel production and redeploy. The :33 cron then makes boards
  within the hour, and settle runs every 10 minutes.
