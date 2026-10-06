# Handoff - droplet relay tue-3, 6 Oct 2026 ~19:00Z

## Live (PROD)
- main 3d6d4de (unchanged; this handoff is the only new main commit). Poller release 1cd19ef.
- Firewall (4 custom rules, all published):
  - meta-externalagent-block  rule_meta_externalagent_block_28B5Jy  DENY, UA contains
    meta-externalagent, site-wide, published ~17:58Z. facebookexternalhit untouched.
  - alibaba-market-challenge  rule_alibaba_market_challenge_vaoGuY  CHALLENGE (/market + AS45102)
  - forged-referer-all-paths (Deny), market-filter-crawl (Log) unchanged.
  - Counts: vercel metrics vercel.request.count --since 1h --group-by waf_rule_id
    --group-by waf_action [-f "asn_id eq '45102'"] -g 1h   (CLI works; MCP firewall read 404s)
- Alibaba is NOT quiet: it returned after 17:30Z (172 challenged 17:30-17:59, 331 in 17:44-18:14).
  The "zero for 24h" clock has not started. Rule A retirement: not yet.

## Branch daily-guest-play  (pushed, a488505, preview READY for that exact SHA)
- Preview: sportsvyn-c0el3w209-deriksilva35s-projects.vercel.app. NOT merged. NO PROD migration.
- Full suite on a488505 (env sourced, new files git-added): 6200 / 0 fail. eslint clean on touched files.
- Rulings built (tue-3):
  1. Claim after the ET close -> run saved to the account (entry + streak) but flagged
     daily_board_runs.late_claim; board-scoped reads skip it (todayLeaderboard, played count,
     band top, history tops, league day, morning push). Account aggregates (streak, own history,
     main/perfect/played/best boards) still include it - say so if you want those excluded too.
  2. One claim per account per ET day (claim day, not edition day); newest edition first;
     second refused 'one claim per day'; unique index (claimed_by, claimed_day) settles races.
  3. Age screen at claim: unchanged.
- Migrations: 130 (daily_guest_runs) and 131 (late_claim + claimed_day + unique index) are on DEV
  only, ledgered. PROD has 129. Order for ship: apply 130, 131 to PROD via apply-migrations.mjs,
  THEN deploy.
- Guard added: guestRuns.test classifies every file naming daily_board_runs as board- or
  account-scoped; a new reader fails the suite until classified. zoneGuard pin for guestRuns.js 1 -> 2.
- Preview caveat: if Preview env points at PROD DB, guest play will error there (no 130/131).
  Check which DB Preview uses before judging the preview.

## Open questions for Derik
- Account aggregates and late claims (above): keep included?
- Cookie clearing gives a second guest play (6/IP/hour cap only). Accept?
- Late claimer sees nothing on /daily/board for the closed day (lands on today's rules card).
  Want a "saved to your streak" note?
- Alibaba: still hitting /market; keep challenge rule.

## Queue
1. Your review of the preview -> GO for PROD migrations 130+131, deploy, merge.
2. FCS abbreviation fill; 9 colourless CFB schools; morning email gameOfTheDay.

## Notes
- Lint: 2 pre-existing errors DailyRoom.js / HandleClaim.js (set-state-in-effect), also red on main.
- No dev servers started this window. No killed test runs.
- Scheduled: CFBD quota wiring not before 12 Oct; CFB win-prob re-score 26 Oct.

## Next step
HOLDING-FOR-GO: PROD migrations 130+131, deploy, merge of daily-guest-play.
