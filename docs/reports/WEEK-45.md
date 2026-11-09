# SPORTSVŶN — week 45 (2026-11-02 to 2026-11-08)
Crew ran 47 times · 1 capped · 0 stuck · $1.48 (-$0.67 vs last week)

Plainly: The Watcher kept the contest board under watch all week and the site itself stayed healthy. The live-score feed froze a few times during Premier League matches, and a few older contests still have not been settled; those tickets are waiting on someone to look. The season back-fill dry run was approved, and a small code-comment fix landed.

## Fixed
- oddsMatches.js: header predicate omits the content-excluded league filter (comment only) → comment fixed (PR #97, merged 2026-11-05; ticket 5a6708ee closed)
## Added
- daily-season-backfill-2000-2001 dry run: 1119 rows, approved 11-07 (Data Keeper, deliverable d24f20ec); duplicate of 57e9a74b approved last week
## In the Outbox / waiting on Derik
- none
## Sent back or rejected
- none
## Failed, capped or stuck
- SPORTSVŶN Watcher · 11-08 06:30 · board pre-lock run capped (G6 fired on 4 frozen EPL matches, filed ticket c6aeb59c, then hit its per-run cap) · 1 run · my read: ticket filing plus the full G1-G7 scan ran over the $0.75/4-min budget; the finding itself is valid (run a15ff14c)
## Decisions Derik made this week (now in agent memory)
- Approve oddsMatches.js comment fix → approved 11-05 (deliverable 43d21f15)
- Approve daily-season-backfill-2000-2001 (1119 rows) → approved 11-07 (deliverable d24f20ec)
- Approve database change 151_crew_migrate_proof → approved 11-07 (deliverable 8c7a5171)
## Recommendations
- Live-feed tickets: 9 live-severity tickets from the Watcher are still new (G1 still-scheduled: a637378d, 0cc9b2f0, 9ca94186; G6 frozen EPL: 86ac6b2b, c6b8f12f, 83d3faf1, bfcbd0fb, b63d5787, c6aeb59c). Same signature across the week: the poller/live feed, not nine separate bugs. One ruling: fix the poller or mark G6/G1 as known during these windows.
- Board-unsettled tickets 61c58f8f, f4bfcc37 (contests 143, 145) and 038aaded (contest 118) are open since 11-02/11-03 with no owner; settle or close.
- Ticket f8b2b862: trigger latest-deploy exits 2 (setup) since 11-05; deploy runs did succeed on 11-05 and 11-07, so either close it or fix the setup path.
- Watcher: Vercel billing read still times out ("cost pace unknown" 11-04, 11-05, 11-08); the C1 cost check has been unjudged since October. Set a Vercel budget or drop the check.
- Data Keeper: four of seven runs re-ran a dry run that was already approved (dup-skip 57e9a74b); once applied, retire the job or point it at the next season.
## Spend
| Agent | Runs | Cost | Cap | Note |
|---|---|---|---|---|
| SPORTSVŶN Watcher | 35 | $1.25 | $35.00/mo | 4% of cap; 7 cron, 23 board, 5 deploy; 1 capped |
| SPORTSVŶN Data Keeper | 7 | $0.23 | $10.00/mo | dry run approved 11-07 |
| SPORTSVŶN Fixer | 5 | $0.00 | — | PR #97 merged |
