# Crew log - one line per crew action, newest last
- 2026-10-22 thu-3: CI skips the suite for docs-only changes (docs/**, crew/README.md, root *.md); the required check "SPORTSVŶN test suite" still reports, as a one-step pass on ubuntu-latest. Everything else, crew/bin and crew/lib included, runs the full suite.
- 2026-10-22 thu-3 proof: this docs-only PR (docs/CREW-LOG.md only) took the skip path of "SPORTSVŶN test suite".
- 2026-10-22 thu-3 follow-up: crew/agents/**, crew/project.yaml and crew/NOTES.md now count as docs for the CI suite skip (crew/bin/** and crew/lib/** stay code); proved by the crew/agents/README.md PR.
- 2026-10-22 crew/ made canonical; Drive archived (CrewOS adapter spec 3a)
- 2026-10-22 crew day-1 fixes: Watcher v1.5.2, Data Keeper v1.5.1, Fixer v1.5.1, project.yaml v1.5.3
- 2026-10-22 fri-2: any file a test reads is code to CI; crew/README.md and 7 docs/ files the tests read left the docs-only list; lib/testing/ciDocsOnly.test.mjs guards it.
- 2026-10-24 sat-1: provider-health reads provider_errors_v (a 401/403 within 15 min = stale, stalest=cfbd:scoreboard:401); rule G6 frozen live game on live_matches_v; the poller stamps metadata.live_changed_at and records provider_error in sync_runs. Run crew-reader-grants on PROD to create the views.
- 2026-10-26 mon-4: docs/context.md crew section refreshed to the live state (Fixer, Watcher, Data Keeper live; repo canonical).
CREW-LOG sportsvyn-watcher nightly run 0fac6820-7c6b-422e-90c7-34c6d46ed805: 0 new tickets, 2 deduped, partial scan (vercel timeouts, G1-G5 not evaluated)
CREW-LOG watcher 09:00 open: 2 known tickets evidence-appended, 0 new, partial scan
2026-10-26 · Watcher · no log line · run 9954fe18
CREW-LOG watcher board-open: ad8dcfb clean, 0 app/vercel errors, locks_in:118, no new tickets
CREW-LOG sportsvyn-watcher deploy-changed: app 0 vercel 0 deploy BUILDING, board locks_in:19, no new tickets
CREW-LOG watcher 16:00 PT board-prelock: 3 scripts clean, board-state no SUMMARY, G1-G5 unverified
CREW-LOG sportsvyn-watcher deploy-changed dpl_AoF8Aq6sf6wtt1HqSU5Qne1KFkEW clean; 0 new tickets; partial scan
CREW-LOG watcher nightly dcf9a8bc: 0 new tickets, 2 deduped, partial scan
2026-10-26 · Watcher · no log line · run 076ea497
2026-10-26 · Watcher · no log line · run 35934854
2026-10-26 · Watcher · no log line · run fa933927
2026-10-26 · Watcher · no log line · run 734d7392
CREW-LOG sportsvyn-watcher done hits=1 tickets=8b0dc772 deploy=dpl_FnBin5StSFq2TWH8WdZ7S3a9ZDZU
CREW-LOG nightly sportsvyn-watcher: 0 new hits, 2 deduped, partial scan G1-G5
CREW-LOG nightly 2026-10-27 deploy dpl_DhjBdj6p READY bde529d clean; app/vercel errors 0; providers ok except injuries (16dfae18); cost pace unknown
CREW-LOG watcher board-open 09:01 PT: app 0, 5xx 0, deploy bde529d clean, board open, G1-G5 not evaluated, no tickets
CREW-LOG sportsvyn-watcher prelock run 7261a3dd-f009-4fd5-bb34-f32e24799f4d: app-errors ok, vercel-errors ok, latest-deploy READY dpl_DhjBdj6p, board-state locks_in:118, no tickets
CREW-LOG 2026-10-27 15:40 PT sportsvyn-watcher deploy-changed dpl_B1gh a6595c7 clean; partial scan
CREW-LOG sportsvyn-watcher c0d52c37-51d2-400b-97cb-a526b567f6d4: app/vercel clean, deploy a6595c7 clean, provider injuries stale (16dfae18), board-state no SUMMARY (21986e4a), G1-G5 skipped
CREW-LOG sportsvyn-watcher cron nightly: 0 hits, app 0, 5xx 0, providers ok, deploy dpl_B1ghe clean, partial scan noted
CREW-LOG board-open 09:00 PT: 4 scripts ok, G1-G5 skipped (partial), 0 new tickets
CREW-LOG sportsvyn-watcher cron: 7 scripts ok, 0 hits, board open (SETUP 21986e4a evidence appended), partial scan G1-G5
CREW-LOG sportsvyn-watcher deploy-changed dpl_BdJBr6QMxqEv5j4BUrvCu1Q8d1mn clean; board open; partial scan (G1-G5 skipped)
CREW-LOG 2026-10-28 11:41 PT watcher deploy-changed run 0bc9360f-2e7a-4276-bdfc-62c20ac84a04: latest-deploy dpl_4exPc...(READY) clean; app-errors 0; vercel-errors 0; board open; G1-G5 not evaluated (no reader access) partial scan; 0 tickets
CREW-LOG deploy-changed run 153ecdab: 0 errors, 0 5xx, deploy READY, board open, G1-G5 skipped (partial)
CREW-LOG sportsvyn-watcher deploy-changed clean dpl_CwL8 board open
CREW-LOG watcher deploy-changed: app 0 err, vercel 0 5xx, G1-G6 clean, board open, no tickets
CREW-LOG sportsvyn-watcher board-prelock locks_in=119 deploy=dpl_CwL8 hits=0 STATUS=done
CREW-LOG deploy-changed dpl_Fbaq3vfw7sVZXmEnb5reAQmviQNc: app/vercel clean, game-watch setup ticket
CREW-LOG watcher board-prelock 16:00 PT: 4 scripts ok, G1-G6 clean, 0 tickets, locks_in:58
2026-10-28 · Watcher · 5 scripts, G1-G6 quiet · runs 114db0ab
2026-10-28 · Watcher · 8 scripts, G1 hit ORL@TOR still scheduled, ticketed · runs 15ceb37b
2026-10-28 · Watcher · 4 scripts + game-watch, G1-G6 quiet · runs d3c59703
2026-10-28 · Watcher · 5 triggered checks, G1-G6 quiet · runs 0eb930c0
2026-10-29 · Watcher · 7 scripts, G1-G6 quiet, board open · runs 5be04e7c
2026-10-29 · Watcher · 5 scripts, G1-G6 quiet · runs eb19fe1e
2026-10-29 · Watcher · 5 scripts, G1-G6 quiet · runs 7068b00a
2026-10-29 · Watcher · 5 scripts, G1-G6 quiet · runs 8ea6cb27
2026-10-26 · Data Keeper · no log line · run 85d58df8
CREW-LOG data-keeper 2026-10-27 job=daily-season-backfill-2000-2001 would_change=1119 dedupe=skip
CREW-LOG daily-season-backfill-2000-2001 dup-skipped vs approved 57e9a74b
CREW-LOG data-keeper 2026-10-29 daily-season-backfill-2000-2001 dup-skipped
2026-10-29 · Watcher · deploy d19ce47 clean, G1-G6 quiet · runs d62e411c
trigger=manual trigger_reason=run_now; app-errors, vercel-errors, latest-deploy, board-state, game-watch all clean (SUMMARY ok); board open; deploy dpl_HAkw... READY d19ce47; G1-G6 ok; no tickets; nightly PROVIDER/COST not run (manual trigger); log_line: 2026-10-29 · Watcher · triggered scan clean, board open, no tickets · runs 3f81eb6d
2026-10-29 · Watcher · deploy 03f76e2 clean; app/vercel 0 errors; G1-G6 clean · runs b47619fa
2026-10-29 · Watcher · manual run: app 0 errors, 5xx 0, deploy 03f76e2 clean, G1-G6 0, board open · runs 43cac0ff
2026-10-29 · Watcher · deploy run clean: app/vercel 0 errors, G1-G6 clear, board open · runs 0e517d57
2026-10-29 · Watcher · pre-lock (locks_in:119): deploy e6c7b0c clean, app/vercel errors 0, G1-G6 clean · runs 4bd095a8
2026-10-29 · Watcher · manual run: 4 scripts + game-watch clean, locks_in 42m, no tickets · runs cba9ceb9
2026-10-29 · Watcher · pre-lock board run, all triggered rules clean, no tickets · runs e4767294
CREW-LOG data-keeper 2026-10-30 daily-season-backfill-2000-2001 would_change=1119 dup-skip 57e9a74b
2026-10-30 · Watcher · nightly: app/vercel errors 0, G1-G6 clean, deploy e6c7b0c clean, providers ok · runs 5fee14e6
2026-10-30 · Watcher · Board-open 09:00 scan clean: app/vercel errors 0, deploy e6c7b0c clean, G1-G6 all 0, no new tickets · runs 1c84c8db
2026-10-30 · Watcher · deploy dpl_5EyPge5XNW1 clean, app/vercel 0 errors, G1-G6 clean, no tickets · runs 359e794d
2026-10-30 · Watcher · deploy dpl_2jogFi clean; app/vercel/game-watch no hits · runs 4725d307
2026-10-30 · Watcher · pre-lock board run (locks_in:119): app/vercel errors 0, deploy dpl_2jogFiPg READY, G1-G6 clean · runs 7976e63d
2026-10-30 · Watcher · deploy 9e6abb1 clean; app/vercel errors 0; G1-G6 clear; board locks in 109m · runs 2058b7a7
2026-10-30 · Watcher · board pre-lock (locks_in:118), 0 hits across app-errors, vercel-errors, G1-G6, deploy clean · runs b6ba3c29
CREW-LOG data-keeper daily-season-backfill-2000-2001 dry-run ok would_change=1119 dup-skip 57e9a74b
2026-10-31 · Watcher · nightly: 8 checks ran, EPL match 24683 frozen 31 min filed (86ac6b2b) · runs e8f3d69a
2026-10-31 · Watcher · board-open: EPL G6 5 matches frozen at HT, filed c6b8f12f · runs 54b7c2a5
2026-10-31 · Watcher · pre-lock board run clean: G1-G6 zero hits, 0 errors, no new deploy · runs dfb36029
2026-10-31 · Watcher · board run: 19 live CFB matches frozen 106-181 min (G6), filed 83d3faf1; app/vercel clean · runs 767d0d20
2026-10-31 · Watcher · board prelock 119m; G6 16 cfb frozen dedupe 83d3faf1; no new tickets · runs 20267484
2026-10-31 · Watcher · deploy dpl_EoRPKK clean; G1 NBA 10-31 games unflipped, ticketed · runs e54c344d
2026-10-31 · Watcher · deploy-changed: G1 OKC-HOU still scheduled, deduped 0cc9b2f0; app/vercel clean · runs e8695c49
2026-10-31 · Watcher · deploy 0038930 clean; app/vercel errors 0; G1-G6 clean · runs 7aed3908
CREW-LOG data-keeper 2026-11-01 daily-season-backfill-2000-2001 ok would_change=1119 dup-skip
2026-11-01 · Watcher · nightly: 8 scripts ok, 0 hits, no new tickets · runs 83af19d3
2026-11-01 · Watcher · board-open: G6 EPL 24691 frozen 32m filed; app/vercel clean · runs 6a8fce16
2026-11-01 · Watcher · prelock 119m: app, vercel, G1-G6 clean; no new tickets · runs 1ba61d95
2026-11-01 · Watcher · board run: G1 hit on 2 NBA 11-01 games (ticket 9ca94186-7764-4edb-9eb1-8ee14e2b48e1), app/vercel/deploy clean · runs 7d288701
2026-11-01 · Watcher · G1 still-scheduled regression on 11-01 NBA games, deduped to 9ca94186 · runs c394981d
2026-11-01 · Watcher · deploy 60fad9f clean: app/vercel errors 0, G1-G6 clear, board open · runs ed836765
