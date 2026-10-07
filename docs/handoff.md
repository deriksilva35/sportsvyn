# Handoff - droplet relay tue-9 (+ tue-8), 7 Oct 2026 00:45Z (30 min PROD errors clean)

## Live (PROD)
- main 6127471: October stranded-card cap lift (A), clock/next lock from the effective first pitch
  (B), "projected" + bullpen label (C), MLB box score in batting order with PH/PR subs (D).
  Full suite 6218/6218, preview Ready, deployed by Vercel. Verified on sportsvyn.com (report).
- Poller unchanged (1cd19ef); migrations through 131.

## Held
- confidence-s1 @ b8d03d9 (rebased on 6127471, pushed). Adds tue-8 item 1 (season table: total
  earned / total max for everyone; regular board = wins / graded games) + parity intent reset.
  NOT merged: its full-suite gate run was denied by the permission classifier. Migration 132
  NOT on PROD. Item 3 done: zero boards opening >= 20 Oct exist on PROD -> nothing to stamp.

## Queue
1. Full suite on confidence-s1 (b8d03d9) -> apply 132 to PROD via scripts/apply-migrations.mjs
   -> merge -> deploy -> verify 13 Oct boards REGULAR, a 20 Oct board renders the rank sheet
   (DEV account), season table loads -> 30 min PROD errors.
2. S2 leagues pick_format, then ATS. FCS abbreviation fill; 9 colourless CFB schools; morning email.

## Open questions for Derik
1. Allow the suite/push step for tue-8 (classifier blocked it) - re-GO?
2. Box score defensive subs: BDL has no event for them; they sit at the foot of the club with
   roster position. Want a second source (statsapi battingOrder codes)?
3. Board 42's frozen MIL@SD kickoff was a 04:00Z placeholder; the postseason import writes board
   snapshots before times are set. Rules now use the effective time everywhere on the card, but
   the import could refresh frozen placeholders. Fix at the source?
4. (carried) No-sheet confidence entry scores on the kickoff-order default: OK?

## Notes
- scripts/gridiron-backfill.mjs is in ~/scratch/ (moved, not deleted, not committed).
- DEV: killed tue-8 suite left 53 fixture rows; removed with undo file (report). Older junk
  (~3.7k simtest/six-replay users) untouched.
- Worktrees ../sv-oct and ../sv-box can be removed (merged).
- Detail: docs/reports/2026-10-06-tue9-october-ds.md

## Next step
Re-GO on tue-8 items 4-5 (suite on b8d03d9 first).
