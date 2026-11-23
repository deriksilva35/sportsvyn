# SPORTSVŶN — week 47 (2026-11-16 to 2026-11-22)
Crew ran 35 times · 0 capped · 0 stuck · $1.23 (+$0.20 vs last week)

Plainly: The Watcher checked the board four times a day and it stayed clean until the weekend, when it flagged four new feed problems: frozen Premier League matches on Saturday and Sunday and a sports-data provider that started refusing baseball requests. The Data Keeper asked twice about an approved backfill that was never applied and Derik said not now both times. Eighteen tickets are still sitting unresolved, the oldest from late October.

## Fixed
- none
## Added
- none
## In the Outbox / waiting on Derik
- none
## Sent back or rejected
- none
## Failed, capped or stuck
- none (2 run_events errors: game-watch G6 exit 1 on epl-40346, 11-22; both tied to ticket 326c4242, the run finished done)
## Decisions Derik made this week (now in agent memory)
- Apply or reject backfill 60919d73 (approved 11-12, not applied)? (brief 60e3ed9c, 11-16) → Not now
- Apply 60919d73 by hand on the droplet? (brief 9c0c4ed1, 11-20) → Not now
- Derik merged PR #109 (CLAUDE.md: merge commits only) on 11-22
## Recommendations
- New tickets this week, all status new: 893ce878 EPL 24708 frozen 91 min (11-21); 681b0ba3 five EPL matches frozen 61 min at half-time (11-21); 32e3d098 BDL MLB plays/lineups endpoints returning 401 (11-22); 326c4242 EPL 40346 frozen 31 min (11-22). The 401 is a credential or plan issue on the provider, not a feed stall; check the BDL key.
- 14 older tickets are still status new (7 live G1/G6 feed tickets from 10-28 to 11-08, 3 board-unsettled "soon", f8b2b862 latest-deploy setup exit 2). None recurred as new fingerprints this week except the EPL freeze family. Close the stale ones or rule on the G6 freeze rule so the Watcher stops filing it per match.
- Data Keeper has asked about 60919d73 twice and got "Not now" twice; have it stop asking until the ticket or deliverable changes (one question per problem).
- Vercel billing read timed out on the nightly run 11-18 and 11-20 (cost pace unknown both nights). Same as prior weeks; a shorter timeout or a cached read would do.
## Spend
| Agent | Runs | Cost | Cap | Note |
|---|---|---|---|---|
| SPORTSVŶN Watcher | 28 | $1.00 | $0.75/run · $35/mo | 13 done · 15 nothing; 4 tickets |
| SPORTSVŶN Data Keeper | 7 | $0.23 | $0.30/run · $10/mo | 7 done; backfill dup-skipped daily |
| Project | 35 | $1.23 | $45/mo | $4.01 month to date (9%) |
