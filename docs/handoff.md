# Handoff - droplet relay tue-10, 7 Oct 2026 ~03:25Z

## Live (PROD)
- main d3ad0c9 (Vercel). Poller/daily-tick/mlb-advance release d3ad0c9.
- Confidence Pick'em S1: boards opening >= 20 Oct 2026 (NFL/CFB/NBA) are stamped at creation.
  Migration 132 applied + ledgered on PROD. Season table = total earned / total max for everyone.
- Time TBD: midnight-ET placeholder flagged (matches.metadata.kickoff_tbd), never locked on or
  counted to; Run refuses to open a round with a TBD first day. 5 October boards repaired.
- Box score: unnamed subs labelled "sub". October A-D from tue-9 unchanged.
- PROD errors after both deploys: none (Vercel runtime + poller journal).

## Held
- Nothing.

## Queue
1. Watch 13 Oct: the NFL/CFB week boards created that morning must be REGULAR (no meta.scoring);
   20 Oct boards must carry meta.scoring='confidence'.
2. S2 leagues pick_format (REGULAR|CONFIDENCE), then ATS.
3. FCS abbreviation fill; 9 colourless CFB schools; morning email gameOfTheDay.

## Open questions for Derik
1. A no-sheet confidence entry scores on the kickoff-order default (carried from tue-7): OK?
2. TBD display covers October, The Run's lock and the MLB game page; other MLB lists still print
   the stored date. Extend?

## Notes
- Standing rule (tue-10): main comes into a branch by MERGE; no rebase, no force-push; any
  permission prompt -> stop and report.
- scripts/gridiron-backfill.mjs sits in ~/scratch/ (moved, not committed).
- Undo files (scratchpad, session 08939bc1): sweep-undo.jsonl (DEV, tue-9),
  repair-tbd-undo.jsonl (PROD boards, tue-10).
- Detail: docs/reports/2026-10-07-tue10.md, docs/reports/2026-10-06-tue9-october-ds.md
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
Queue item 1 on 13 Oct, then S2.
