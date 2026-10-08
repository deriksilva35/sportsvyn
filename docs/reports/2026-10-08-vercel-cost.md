# Vercel cost recon, 8 Oct 2026 (read-only, nothing changed)

Sources: Vercel billing charges API (FOCUS), `vercel metrics` (prod env, project sportsvyn), `vercel firewall` (read), app/market/** and Next 16 docs.
Days are Pacific (07:00Z boundaries). Billing is TEAM-wide (7 projects: sportsvyn, vc, travault, golff-*, skry, banner); the API gives no per-project split, so sportsvyn's share is unknown. Metrics are sportsvyn only.
Window of this report: 08 Oct 01:13Z. PT Oct 7 is still open (18:13 PT) and Oct 7 billing is partial.

## 1. Billed cost by day (USD, team-wide)
Day:     Sep30  Oct1  Oct2  Oct3  Oct4  Oct5  Oct6  Oct7(partial)
Total:   18.51 21.73 14.46 10.77  5.64 15.51 14.50  2.94
Oct 1-6 (complete days): 82.61 -> 13.77/day. Oct 1-7 incl. partial: 85.55.
Does NOT match the prior "$61 by day 7 / $271 pace" (different cut or scope; not reconciled). On the Oct 1-6 average, 31 days = ~$427; on Oct 1-3 + 5 (the 4 clean pre-change days) = $15.6/day = ~$484. Neither is trustworthy as a forecast, see section 3.
Caveats: Oct 4 is missing Pro / v0 Seats / Speed Insights Plus / CDN Requests lines (looks incomplete, not a quiet day). Fixed per-day lines are 1/30 until Oct 3 and 1/31 from Oct 5.

Line items, $ per day (Sep30 Oct1 Oct2 Oct3 Oct4 Oct5 Oct6 Oct7p):
- Observability Events   6.89 7.01 4.27 2.91 1.89 7.63 7.77 0.45   (largest line)
- Build CPU Minutes      0.66 2.81 1.19 0.85 2.59 2.23 1.25 0.36
- CDN Requests           3.09 3.25 2.31 1.90 0    0    0    0      (zero from Oct 4, cause unknown)
- Fluid Active CPU       1.86 1.88 1.12 0.70 0.50 1.53 1.45 0.07
- Fast Origin Transfer   1.51 1.69 1.17 0.60 0.41 1.18 1.21 0.05
- ISR Writes             1.35 1.83 1.50 1.16 0    0.11 0.05 0      (market-diet 4 Oct)
- ISR Reads              0.24 0.33 0.34 0.25 0    0.03 0.02 0
- Function Invocations   0.47 0.48 0.27 0.14 0.11 0.57 0.55 0.02
- Fluid Provisioned Mem  0.25 0.25 0.16 0.16 0.09 0.22 0.22 0.03
- Fixed: Pro .65-.67, v0 Seats .97-1.00, Speed Insights Plus .32-.33  (~$1.95/day = ~$60/mo)
- Fast Data Transfer, Image Optimization, Blob, Firewall: $0 every day.
Billed lines do not track usage day for day (e.g. Observability Events 7.77 on Oct 6 while requests had halved; Oct 3 Fluid CPU 0.70 with the most CPU-ms of the week). Billing appears to lag usage by roughly a day. Judge the fix on the Oct 9-10 bills, not Oct 6-7.

## 2. Top routes (sportsvyn prod, Oct 1 07:00Z - Oct 8 01:00Z, `vercel metrics`)
By Active CPU ms (sum): /signin 7.68M, /player/[slug] 6.69M, /scores 6.17M, /market 5.46M, /sim 4.10M, /games 3.65M, /leagues 2.73M, /rankings 2.61M, /market/props/[slug] 1.61M, /market.segments/_tree 1.60M, /match/[slug] 1.38M.
By invocations: /signin 139.9k, /scores 94.0k, /games 91.5k, /rankings 90.5k, /leagues 90.3k, /sim 89.4k, /player/[slug] 78.8k, /market/props/[slug] 13.2k, /market 10.4k, cron plays-live 9.9k, /match/[slug] 9.3k, cron epl-live 9.0k.
By duration GB-h: cron plays-live 6.7, cron gridiron-games 5.4, /market 4.9, /market _tree.segment 1.8, cron gridiron-odds 1.3.
By Fast Origin Transfer: /market 9.97 GB, /market _tree.segment 2.9 GB, /player/[slug] 0.6 GB, then <0.35 GB each.
By edge bytes out (FDT): /market 103 GB (of ~134 GB), static assets next.
Ranked mainly by CPU-ms, tie-broken by invocations. Top 3: /signin, /player/[slug], /scores.
The six near-identical counts (~90k each: /signin /scores /games /rankings /leagues /sim) are the site-header links walked by one crawler (Meta). /player/[slug] had a single 34.9k burst at Oct 3 12:00Z.
/market invocations are ISR regenerations, not reader hits (1.77M hits in 5 days, 93% cache HIT).

## 3. Before / after 6 Oct
Firewall (read-only, live config): enabled, 4 custom rules, 0 IP blocks, attack mode off, system mitigations active.
  1 forged-referer-all-paths  Deny      Enabled
  2 market-filter-crawl       Log       Enabled
  3 alibaba-market-challenge  Challenge Enabled
  4 meta-externalagent-block  Deny      Enabled
The rules exist and are firing: in the 29 h from 6 Oct 20:00Z, 134,202 requests were denied by meta-externalagent-block and 4,062 challenged by alibaba-market-challenge.

Requests/day (all, incl. firewall-denied), Sep30..Oct7: 675k 702k 616k 748k 563k 568k 325k 97k.
Hourly: ~24k/h until 6 Oct ~17:30Z, ~8k/h to 7 Oct 00Z, ~3k/h overnight 7 Oct, 5-8k/h daytime 7 Oct (the 7-8k/h is mostly the denied Meta requests, which still arrive).
Function invocations/day: 127k 130k 103k 156k 109k 165k 82k 7k.   Active CPU ms/day: 9.3M 9.5M 8.8M 11.9M 8.0M 7.8M 4.0M 0.58M.
ISR write units/day: 338k 458k 375k 289k 138k 27k 11k 0.9k.   ISR read units/day: 602k 822k 849k 622k 480k 78k 40k 0.5k.
FDT out GB/day: 22.4 22.6 29.5 30.3 15.7 4.2 1.8 0.06.   FOT GB/day: 3.8 5.0 4.1 3.5 1.6 0.5 0.2 0.05.

Who the traffic was (120 h Oct 1 07:00Z - Oct 6 07:00Z, requests): meta-externalagent 2.38M of ~3.3M (72%), Alibaba ASN 388k (/market, 387k), googleother 195k, shapbot 175k, amazonbot 47k.
Window after (29 h from Oct 6 20:00Z): Meta 134k (all denied), Alibaba 4.1k (challenged), Google 0.4k, Amazon 6.7k.
Route function invocations, before (120 h) vs after (29 h): /signin 124k -> 0; /scores 84k -> 694; /games 82k -> ~0; /rankings 81k -> ~0; /leagues 81k -> ~0; /sim 79k -> ~0; /player/[slug] 75k -> 2.2k. Everything else is crons and live match pages.
Per-line billed cost before/after: NOT yet visible. Oct 5 vs Oct 6 look the same in billing (15.5 vs 14.5, Observability Events 7.63 vs 7.77) while usage fell 2-3x; Oct 7 is partial. Re-run on Oct 9-10 data.
Run-rate estimate (assumption, not measured): fixed ~$1.95 + build ~$1.5 + usage lines at the Oct 7 load of ~5% of Oct 1-3 => ~$4.5-7/day => ~$140-215/month. Observability Events could be higher because denied requests still arrive (~110k/day); whether denied requests are billed as events is unknown from the tools.

## 4. /market: the filed force-static fix is ALREADY SHIPPED
app/market/page.js has had `export const dynamic = 'force-static'; export const revalidate = 60;` since b2f248a (28 Sep), widened by 817263c market-diet (4 Oct, props rows moved to /api/market/props, filters via pushState). The Mon 28 Sep "decide after the bill" item is stale.
What it does today: no cookies()/headers()/searchParams in the page. URL filters via useSearchParams in MarketClient (prerender = unfiltered board), shell via document.cookie client-side, header via GlobalHeaderClient + /api/session (no-store fetch). Data from lib/market/cachedReads (60 s). Per Next 16 docs force-static makes cookies(), headers() and useSearchParams() return empty on the server, which is why those reads were moved client-side; no per-user content is in the static HTML. Staleness: up to 60 s of line movement (plus SWR). Sign-in state appears after hydration (/api/session), brief header flash.
Not static: /market/props/[slug] is force-dynamic and reads params/searchParams (13.2k invocations, 1.6M CPU-ms in the week). /nfl/market and /cfb/market reuse MarketView.
Measured: /market 1.77M requests in 5 days, 93% HIT; 9.8k invocations are ISR regenerations (~540 ms CPU, ~725 KB origin transfer each, ~81/h incl. segment variants). ISR writes fell ~85% after Oct 4. In the post-block 29 h, /market used 26 s of CPU total. Residual /market cost is ~nil; the pre-fix load was Meta (1.13M of /market's requests) and Alibaba (387k).
Verdict: nothing left to do on force-static. Optional: revalidate 60 -> 300 would cut regenerations 5x (est. <$0.3/day) at the price of 5-minute-old lines; not recommended without Derik's call on freshness.

## 5. Recommendation (estimates; $ are rough and flagged)
1. Keep both firewall rules; do nothing else this week. Check Oct 9-10 billing for the real drop. Expected effect already in place: roughly $8-12/day (~$250-350/mo) vs the Oct 1-3 level, mostly Observability Events, CDN, ISR, Fluid CPU, FOT (estimate from usage ratio, not from billing).
2. Ask whether denied requests (~110k/day, Meta still hammering) bill as Observability Events; if so add robots.txt Disallow for meta-externalagent so it backs off (est. $0-2/day, unknown).
3. Build CPU Minutes ($0.66-2.81/day, avg ~$1.5 = ~$45/mo): 352 commits since Oct 1, 18 docs-only. No ignoreCommand in vercel.json. Add an ignoreCommand for docs/ and handoff-only changes (est. $5-15/mo). Needs Derik to approve a Vercel/vercel.json change.
4. Observe /player/[slug] (single 34.9k burst Oct 3) and /match/[slug]; both force-dynamic. If bursts return, ISR them (est. $1-3/mo today).
5. Fixed seats: v0 Seats ($0.97/day = ~$30/mo) and Speed Insights Plus ($0.32/day = ~$10/mo) are $40/mo of non-usage cost; cancel if unused (decision for Derik).
6. Crons (plays-live every minute, gridiron-games every 5 min) are the top duration users now but sub-dollar per day.

## Not available / unknown
- Per-project billing split; billing quantities per line (only costs in the summary; the record sample is first/last 100 only).
- Why CDN Requests billed $0 from Oct 4; whether Oct 4 is incomplete.
- Observability schema MCP call returned 404; used `vercel metrics` CLI instead.
