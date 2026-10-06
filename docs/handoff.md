# Handoff - droplet relay tue-6, 6 Oct 2026 (recon, no code)

## Live (PROD)
- Unchanged since tue-5: main has daily-guest-play (82b04ac) deployed; poller 1cd19ef; migrations through 131.

## This window
- READ-ONLY recon of Confidence Pick'em + league formats (REGULAR|CONFIDENCE|ATS):
  docs/reports/2026-10-06-confidence-recon.md. No code, no DB writes.
- Headlines: rank goes in a NEW contest_entries.ranks column (never inside lineup); scoring mode is stamped on
  the board (contests.meta.scoring) so open contests stay put; max is PER ENTRY not per board; MLB out;
  NFL/CFB next fresh weeks open 13 OCT (before NBA 20 Oct); NBA has no odds feed (ATS NFL/CFB only first);
  leagues read e.score today, so S1 must keep REGULAR leagues on wins.

## Open questions for Derik (report, section "Decisions")
1. NFL/CFB start 13 Oct or 20 Oct?  2. unpicked game in max?  3. rank all or subset?
4. season standings / share card W-L or points?  5. NBA 2-game nights?  6. league "total" normalise?

## Queue
1. Confidence S1 build on a GO + the six answers. 2. FCS abbreviation fill; 9 colourless CFB schools;
   morning email gameOfTheDay.

## Notes
- Lint: 2 pre-existing errors DailyRoom.js / HandleClaim.js, also red on main.
- scripts/gridiron-backfill.mjs untracked, not mine. A recon agent made and deleted a temp .q-tmp.mjs (clean).
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
HOLDING-FOR-DERIK: answers to the six questions, then S1.
