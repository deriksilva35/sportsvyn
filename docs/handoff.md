# Handoff - droplet relay mon-7, Mon 12 Oct 2026 (clock ~19:00Z)

## Live (PROD) - main = see git log; Vercel auto-deploys web; poller unchanged (93a36a4)
- TOP 25 (mon-7, merge b6ab7f7): the Top 25 chip (Scores, CFB days only) already existed; it now REMEMBERS
  the choice (cookie sv_top25, URL wins, off-tap clears it; lib/scores/top25Memory.js). AP rank badges
  were already on Scores cards and the CFB game header (as '#5' in the meta line); added: AP badge on
  the front-page CFB band slate rows (SlateRow ranks prop). Not visible signed-out on PROD, so unseen live.
  Preview-verified by curl (cookie narrows 52->13 cards, ?top25=0 overrides, no-CFB day hides chip).
  No screenshot: no browser on the droplet - take it on the Mac. 'Lobby strip' was read as that band.
- NEW MOCKS START ON /mock/nfl (tue-0, 889d8d9): Play-tab practice tile, You tab, Draft again, the /nfl
  card CTA (was a 404 to /sim/setup), /sim?preset= (redirect). /sim's setup form is replaced by a "New
  mock draft" card (NFL / NBA); /sim keeps Resume, leagues + keepers, join, tracker, history, record
  line. /mock/nfl gains SFLX, "2QB / Superflex", "The Draft (8 rounds)", league preset "The Draft
  practice" and Full auto. Report: docs/reports/2026-10-12-sim-entry.md.
- THE DAILY LOCK-IN (d63e2bb, migration 142): choosing a team commits, a placed pick is final,
  cards sealed until a team is chosen. Server-enforced: POST /api/daily/{board,guest}/{choose,pick},
  run.steps (lib/daily/lockIn.js); submit grades the steps. Runs started before deploy (steps NULL)
  keep the submit-all path. House personas play through the steps. Verified on sportsvyn.com as a
  guest, incl. 409s for back-out, uncommitted-team pick, changed pick, re-used team.
- NFL MOCK at /mock/nfl (cb68017, migrations 140 + 141): NBA engine + NFL kit; in season the bots
  and auto-draft pick by SVP + need; ADP column "Preseason ADP (Sep 9)" (in-season boards shrink).
  PROD pool built 08:00Z (249); cron 12:51Z daily. MOCK DRAFT doors -> /mock/nfl; /sim kept as is.
- DRAFT LOOK (7c81af0) shipped; NOT YET SEEN LIVE - check a real room when week 6 opens.
- NBA mock v2 + saved setups (sport column since 140; NFL settings in nfl_mock_settings, 141).
- Game Drafts primetime only (BOARDS on, NBA off). Test prefixes dgtest-, dgnba(test)-; shots dgshot-.

## Tue 13 Oct additions (mon-8, mon-9, tue-2)
- CFB SV25 week 7 is Derik's list: content/power/cfb-2026-w7.md + its EDITOR_FILES line (lib/rankings/editorFiles.js). Each new week: write cfb-2026-w<N>.md, add the line, publish('cfb').
- CFB 25 REMINDER (ef1c9a7): Mon 13:00Z + 15:30Z retry (/api/cron/cfb-25-reminder[-late]) emails "CFB 25 due - week N" if the file is missing; once per week via sync_runs. Dry run: node scripts/cfb25-reminder.mjs [--prod] [--week N]. First live send Mon 19 Oct, UNVERIFIED.
- CREW STATS (tue-4/5, 6044e2d): migration 143 = schema crew_stats (11 *_v views); crew_reader reads views only (also revoked: users, sessions, daily_guest_runs, daily_board_runs, revenuecat_events, memberships, push_sends, draft_config_invites - tue-6, 245e8b5). docs/crew/sportsvyn-stats reads crew_stats.*_v. Re-grant: scripts/crew-reader-grants.mjs --prod --apply (no password needed for the existing role). OPEN: one run AS crew_reader on PROD (needs its password; owner cannot SET ROLE).

## TUE 13 OCT - checked (tue-1, 18:30-22:00Z)
- Game Drafts: boards 58-71 (14, incl. Mon night 71) all settled, none void, 10 entries all scored; 10/10 rooms
  recomputed: counted = best 3, no-shows (8) score 0. Board 78 (Thu 15 Oct) open. app_errors since Sat: 0 rows.
- Weekly Draft + Weekly wk5 settled clean (4/4 scored each). Wk6 boards open (draft 4 entries, weekly 3).
- launch-oct20 checks 1-4 PASS (13:23:43Z, nfl wk6 14 games #80, cfb wk42 16 games #79 vs 15 planned, REGULAR,
  lines frozen, 0 TBD, locks = last kickoff). Check 5: pages 200, 'straight up' copy, no 'Time TBD'/'12:00 AM'.
- Lock-in since deploy: guest 3 runs/3 with steps/1 finished/1 claimed; signed-in 2/1/2. Mocks since Mon: 0.
- NOT DONE: room render + screenshot of the new draft look (needs sign-in + a browser: do it on the Mac);
  409 counts and share-card failures (Vercel runtime logs returned nothing for the window).

## Needs Derik
- Leagues (sun-4 report): P1 total points = every drafted player or best N/week? bots in 4-7 team leagues? LIVE sync polling or SSE? K/DST in presets? sizes P1 22-28 d, P2 25-35 d, P3 12-18 d.
- From wed-7 (PROD writes): the 2 unclaimed guest rows; one real magic-link sign-in. Plus 3 mon-4/5 verification guest runs (unclaimed, on no board).
- From wed-4: Neon "ci" key, Cloudflare token. crew_reader exists on PROD; a run AS it needs its password (owner cannot SET ROLE).

## Queue
1. 20 Oct: launch-oct20.md checks 6-13. NBA Game Drafts stay OFF until DRAFT_GAME_NBA flips.
2. After 20 Oct: leagues P1 (slow draft first). (draft-look shipped mon-5.)
3. Per-game S5 CFB final-only.
4. TICKET: suite tests that mutate real DEV boards (the week-5 void_all) must use own fixtures.
5. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- neon: `interval ${'..'}` is a syntax error; route files export no helpers; card fonts via readFileSync.
- DEV: draft contest id 55759 (week 99, made 7 Oct by a test) shadows the current weekly contest;
  the orphan sweep lists 3,779 old test users. Listed only, nothing deleted (list + undo first).

## Next step
Open a weekly wk6 room signed in (Mac) and confirm the draft look. 20 Oct: launch-oct20 checks 6-13.
