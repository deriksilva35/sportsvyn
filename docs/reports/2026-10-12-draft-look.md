# The Draft look - preview checks and the mock comparison (mon-2 item 2) - 12 Oct 2026

Branch draft-look, main merged in (7d2bf4e). Preview of the room: 16cbd0d / 414efa7.
Fixture: a dgshot weekly contest + two throwaway sentinels on DEV (removed after the shots).

## Shots (sent): Players (search + chips), armed row "Confirm", My team, Board, a result
- Players: navy header (THE DRAFT · NFL WEEK · BEST 6 OF 8 COUNT, "Round 2 of 8 · your pick",
  the clock right in lime), 12-seat strip scrolling sideways (You lime), Players / My team / Board /
  Auto, search, chips All QB RB WR TE, rows "HOU · ADP 21 · proj 14.9".
- Armed: the row turns lime with "Confirm"; a second tap picks.
- My team: YOUR TEAM · 2 OF 8, PROJ 36.6; slots QB RB1 RB2 WR1 WR2 WR3 TE FLEX with empties by
  round; "Still need a QB, a RB, a WR and a TE." / "Your next pick: 28".
- Board: round x seat grid, your column lime, the next empty cell outlined.
- Result (/results/draft/<id>, a settled week): 53.7 points · 6th of 12 · top 50%; your eight with
  reach / at-ADP and "not counted" for the two below the best six; the room 1st-12th; Share /
  Back to The Draft.

## Fixed in this pass
- The result screen sat flush against the phone edges (no side gutter): .drm-result-wrap.

## Against the mock (Per-game Draft canvas, screens 4-5) - differences, not fixed
1. Header: the mock's is full-bleed and holds the seat strip; ours is a rounded card with the
   strip below it (the Game Drafts look it shares).
2. Tabs: the mock underlines the active tab; ours are pills, plus a fourth "Auto" tab.
3. Armed row: the mock tints the row pale lime and makes the button a lime "Confirm" pill; ours
   fills the whole row lime with "Confirm" as text.
4. The mock's footer hint ("Tap a player, then Confirm. Your team so far: ...") is not there.
5. My team: the mock shows filled slots by POSITION played ("WR J. Chase · CIN vs PIT · round 1",
   projected per player); ours shows the roster slots (RB1, WR1, ...) with name + team.
None of these is a defect; each is a look choice. Say which to match before ship.

## Suite
Full suite 6430/6430 on 7d2bf4e (main merged in). Ship window: before week 7 drafting gets busy.
