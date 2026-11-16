# SPORTSVŶN — week 46 (2026-11-09 to 2026-11-15)
Crew ran 38 times · 0 capped · 0 stuck · $1.03 (-$0.45 vs last week)

Plainly: A clean week on the live site. The Watcher checked every night and around every board open, pre-lock and deploy — 31 times — and found no errors, no frozen games and nothing to ticket. The Data Keeper found the same gap every night (1,119 missing 2000-2001 season rows); Derik approved the dry run but said "not now" to applying it, so it stays unapplied. Derik shipped the live drive card and Pick'em ranking himself.

## Fixed
- none by the crew. Derik merged his own fixes: drive card replay + four card fixes (PR #102, merged 2026-11-09), drive card details (PR #103, merged 2026-11-09)
## Added
- Live drive card: field strip, drive lines, scoring moment; NFL plays every 30 s (Derik, PR #101, merged 2026-11-09)
- Pick'em: "Rank by win %" chip on confidence boards (Derik, PR #105, merged 2026-11-09)
- Watcher and Data Keeper now write a PLAINLY line (ruling 00d) (Derik, PR #106, merged 2026-11-11)
- daily-season-backfill-2000-2001 dry run: 1,119 rows would change, rows_before=0 (Data Keeper, deliverable 60919d73, approved 2026-11-12; re-found 11-09 … 11-15 and not re-filed, runs af95f672 … bb5efe3e)
## In the Outbox / waiting on Derik
- none in the Outbox. Open PR #107 "crew: soul_refs -> 5bce9697; pin the Data Keeper job script's dry-run default" (Derik, opened 2026-11-12) · open 4 days
## Sent back or rejected
- none
## Failed, capped or stuck
- none
## Decisions Derik made this week (now in agent memory)
- Apply backfill d24f20ec by hand (DATABASE_URL=$PROD_DATABASE_URL node scripts/footballdb-import.mjs 2000-2001 --apply)? → "Not now" (brief 29545c73, 2026-11-11)
- Approve the 2000-2001 backfill dry run (1,119 rows) → approved 2026-11-12 (deliverable 60919d73)
## Recommendations
- 14 tickets are still status new from 10-28 to 11-08 (9 live-feed freezes G1/G6: a637378d, 86ac6b2b, c6b8f12f, 83d3faf1, 0cc9b2f0, bfcbd0fb, 9ca94186, b63d5787, c6aeb59c; 3 board-unsettled: f4bfcc37, 61c58f8f, 038aaded; 1 setup: f8b2b862 trigger latest-deploy exits 2). None recurred this week. Close the ones the live-feed work already covered, or hand the rest to the Fixer.
- Data Keeper: the 2000-2001 backfill is approved but unapplied; either apply it (PR #107 pins the script's dry-run default) or tell the Data Keeper to stop re-checking that job nightly.
- Watcher 11-15 nightly noted "retention overdue"; check the retention job before it becomes a ticket (run bd80c726).
- Merge or close PR #107 (open since 11-12) before it trips the 5-day rule on Tuesday.
## Spend
| Agent | Runs | Cost | Cap | Note |
|---|---|---|---|---|
| Watcher | 31 | $0.83 | $35.00/mo | 7 nightly + 24 board/deploy runs, 0 tickets; $2.33 month to date |
| Data Keeper | 7 | $0.20 | $10.00/mo | same backfill found nightly, 1 deliverable; $0.45 month to date |
