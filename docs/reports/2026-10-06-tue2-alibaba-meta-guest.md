# tue-2 droplet window, 6 Oct 2026 - Alibaba rule, Meta recon, Daily Option A

## 1. Alibaba rule (LIVE, published 16:26Z)
- Rule: `alibaba-market-challenge`, id `rule_alibaba_market_challenge_vaoGuY`.
  path eq /market AND geo AS number eq 45102 -> challenge. Rule A
  (forged-referer-all-paths, Deny) and Rule B (market-filter-crawl, Log) untouched.
- Made with `vercel firewall rules add ... ; vercel firewall publish` (the MCP
  firewall read 404s on this project; the CLI works).
- Match count: query it any time with
    vercel metrics vercel.request.count --since 1h --group-by waf_rule_id --group-by waf_action -f "asn_id eq '45102'" -g 1h
  First 14 minutes: 240 challenged. First full hour (16:26-17:26Z): 360 challenged, 0 after 17:00Z.
- Context: AS45102 also trips managed_bot_protection (log): 5,160 requests in the
  hour before, across all paths, not just /market.

## 2. meta-externalagent recon, last 24h (read-only, nothing blocked)
- 799,083 requests, all from AS "Facebook, Inc.", bot_verified=pass.
- Top paths: /market 224,514; /terms 69,266; /methodology 67,222; /privacy 65,322;
  /signin 57,391; /leagues 36,493; /rankings 36,474; /sim 36,308; /scores 35,785;
  /games 35,683.
- Cache: HIT 513,310 (64%), MISS 275,194 (34%), STALE 9,919, PRERENDER 579.
  Status: 200 764,237; 202 27,681; 404 7,165.
- robots.txt: it does NOT obey it. 0 fetches of /robots.txt in 24h (our own
  robots.txt, served live, disallows /sim /my /account /you /admin /signin /app
  /age /join /market/props). It hit /signin 57,391 times and /sim 36,308 times
  (all MISS, all disallowed). Googlebot/semrush/oai-searchbot fetched robots.txt
  ~35/36/10 times in the same window.
- Not blocked, per the brief. Candidates for Derik: a rule on bot_name
  meta-externalagent for the Disallow prefixes (/sim, /signin, ...), or a
  challenge/deny on the whole bot.

## 3. Daily Option A - see docs/handoff.md and branch daily-guest-play
