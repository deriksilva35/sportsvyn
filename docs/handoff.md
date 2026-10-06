# Handoff - droplet relay tue-7, 6 Oct 2026 (Confidence Pick'em S1 built, HOLDING-FOR-GO)

## Live (PROD)
- Unchanged: main 802c9d0-ish (daily-guest-play), poller 1cd19ef, migrations through 131. Nothing of S1 is on PROD.

## Held
- Branch confidence-s1 @ 5812a90 (pushed; Vercel preview Ready for that commit). DEV only.
  Migration 132 (contest_entries.ranks, max_score) applied to DEV, NOT PROD.
- Full suite 6238/6238 on that tree. Detail: docs/reports/2026-10-06-confidence-s1.md.

## What S1 does
- Boards opening >= 20 Oct 2026 (NFL, CFB, NBA) are stamped meta.scoring='confidence'; earlier open boards never change.
- Rank every game, sheet pre-filled 1..N kickoff order (latest = 1), up/down, one "Save picks"; locked game's pick and
  number frozen; void/tie off earned AND max; unpicked stays in max; points of max ranks every board and the season.
- NBA night with < 3 games: no board. REGULAR leagues still score wins. MLB untouched.

## Queue
1. On GO: `node scripts/apply-migrations.mjs --status` on PROD (env sourced), apply 132, merge, deploy; confirm
   the 13 Oct NFL/CFB boards are REGULAR and the 20 Oct ones confidence (meta.scoring).
2. S2 leagues pick_format (REGULAR|CONFIDENCE), then ATS. FCS abbreviation fill; 9 colourless CFB schools; morning email gameOfTheDay.

## Open questions for Derik
1. Entry with no saved sheet scores on the kickoff-order default (its max = default sheet's): OK?
2. Season standings = points/max over confidence boards, wins/played for players with none: OK?
3. DEV's ledger shows 126, 127 pending though their objects exist (backfill gap on DEV only; not touched).

## Notes
- scripts/gridiron-backfill.mjs untracked, not mine; it trips lib/cfbd/clientCensus.test.mjs, so the gate ran with it
  moved aside (restored). Someone should route it through lib/cfbd/client.js or leave it out of the tree.
- Lint: PickemBoard.js (Date.now purity) and PickemHero.js errors pre-existing, files untouched.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
HOLDING-FOR-GO.
