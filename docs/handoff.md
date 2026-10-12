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
- DRAFT LOOK (7c81af0) shipped as built. ACCEPTED differences vs the mock (screens 4-5): header is a
  rounded card with the seat strip below it; pill tabs + an Auto tab; armed row fills lime with
  Confirm as text; no footer hint line; My team lists slots (RB1, WR1) not positions played.
  NOT YET SEEN LIVE: PROD week 5 locked 9 Oct and week 6 is not open, so no room could be opened -
  look at a real room when week 6 opens.
- NBA mock v2 + saved setups (sport column since 140; NFL settings in nfl_mock_settings, 141).
- Game Drafts primetime only (BOARDS on, NBA off). Test prefixes dgtest-, dgnba(test)-; shots dgshot-.

## TUE 13 OCT - still owed (the games had not been played when tue-1 ran)
1. Sunday review of the 14 Game Draft boards: all settled? spot-check 3 rooms (best 3, no-shows
   0); app_errors since Sat 10 Oct 21:52Z.
2. Weekly Draft week 6 settled clean.
4. docs/launch-oct20.md checks 1-5 after the 13:23Z board job.

## Needs Derik
- Leagues (sun-4 report):
  - P1 total points: every drafted player, or the best N per week?
  - Bots in 4-7 team leagues?
  - LIVE sync: polling or SSE?
  - K/DST in the presets?
  - Sizes: P1 22-28 d; P2 25-35 d; P3 12-18 d.
- From wed-7 (PROD writes): the 2 unclaimed guest rows; one real magic-link sign-in. Plus 3 mon-4/5 verification guest runs (unclaimed, on no board).
- From wed-4: Neon "ci" key, Cloudflare token, PROD crew_reader role.

## Queue
1. 20 Oct: launch-oct20.md checks 6-13. NBA Game Drafts stay OFF until DRAFT_GAME_NBA flips.
2. After 20 Oct: leagues P1 (slow draft first). (draft-look shipped mon-5.)
3. Per-game S5 CFB final-only.
4. TICKET: suite tests that mutate real DEV boards (the week-5 void_all) must use own fixtures.
5. FCS abbreviation fill, 9 colourless CFB schools, morning email gameOfTheDay.

## Notes
- PROD SELECTs hit the "Production Reads" check; ask Derik per read, never writes.
- neon: `interval ${'..'}` is a syntax error; route files export no helpers; card fonts via readFileSync.
- DEV: draft contest id 55759 (week 99, made 7 Oct by a test) shadows the current weekly contest;
  the orphan sweep lists 3,779 old test users. Listed only, nothing deleted (list + undo first).

## Next step
When week 6 opens: open a weekly room on PROD and confirm the draft look. Tue 13 Oct: items 1, 2, 4.
