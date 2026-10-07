# tue-9 (October DS fixes) + tue-8 status, 6-7 Oct 2026

## Shipped: main 6127471 (Vercel production; preview Ready; full suite 6218/6218 on that tree)
A. Stranded card. 2-game slate, cap 3, LAD@ATL live, entry 34592 held 3 from MIL@SD -> two slots
   unfillable. lib/october/rules.js capLifted(): if the open games' remaining room under the cap
   cannot cover the empty slots, the cap does not refuse. Verified on PROD data with the shipped
   rule: entry 34592 bat3/bat4 from MIL@SD -> OK. Test: lib/october/strandedCard.test.mjs.
B. Clock 00:00 / "9:00 PM PDT". Board 42 froze MIL@SD at kickoff_at 2026-10-06T04:00Z (a
   placeholder: 9 PM PDT the NIGHT BEFORE; the slug was even 10-06 while the game is 10-07 01:30Z).
   rules.js already took the later live time, but entry.js built nextLock.kickoffAt/msAway from
   the frozen next.kickoff_at. Now nextLockClock(next) uses the effective first pitch.
   sportsvyn.com at 00:18Z: "01 hours 11 minutes", "MIL @ SD · 9:30 PM ET" (= 6:30 PT).
C. Unposted bats read "<POS> · projected"; Bullpen summary "Bullpen · 38 arms, both clubs"
   (38 = every non-probable arm on both active rosters; the "+" is the <details> marker).
D. Box score batting table in batting order. BDL box rows have NO batting-order field and their
   `position` is the roster default (Thomas LF, Acuna RF). Source used: matches.metadata.lineups
   (BDL /lineups: order + this game's position). Subs: plays text "X hit for Y" / "X ran for Y"
   -> PH/PR, indented directly under the man replaced (chains too). BDL sends NO defensive-
   replacement event, so an unnamed sub sits at the foot of his club with his roster position.
   Proposal if that matters: a defensive-sub source (MLB statsapi boxscore battingOrder "101",
   "102" codes) - needs a provider decision since BDL is the only MLB provider now.
   Live check LAD@ATL: Betts..E. Hernandez 1-9; ATL Baldwin..Kim; Tellez PH under Kim, Hicklen PR
   under Tellez.
Poller: none of the changed modules are imported by the droplet services; no poller deploy.
DEV sweep: my killed tue-8 run left contest 54790 + 5 sentinel-winprob live matches + 4 users,
which failed 10 tests (six replay, cfbPlaysAll). Deleted with undo file (53 rows):
scratchpad sweep-undo.jsonl (session 08939bc1).

## tue-8
1. Season table: pct = total earned / total max for everyone (regular board: wins / graded games).
   Test added (mixed regular + confidence user, 4/7 = 57.1). Commit d9f83b2 on confidence-s1.
2. scripts/gridiron-backfill.mjs moved to ~/scratch/ (not deleted, not committed).
3. PROD: zero pickem boards opening >= 20 Oct exist -> no entries, nothing to stamp (creation stamps).
4-5. HELD: confidence-s1 rebased onto main (b8d03d9, pushed; parity intent reset to empty in it).
   The full-suite gate run on it was DENIED by the permission classifier ("Git Destructive",
   most likely tripped by the preceding force-with-lease push of the rebased branch). Not retried.
   Migration 132 NOT applied to PROD; nothing of S1 is live.
