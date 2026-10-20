# Handoff - droplet relays sun-1/2 + mon-1..6, Mon 19 Oct 2026 (clock ~23:30Z)

## Live (PROD) - main 2c36373 (deployed ~00:55Z); poller unchanged (93a36a4)
- SLICE 3 LIVE (sun-1 GO): migration 145 on PROD (ledgered, checksum = DEV); merge 2c36373
  (suite 6517/0, preview READY on 2c36373); THE LONGEST YARD moved = player league 11.
  - Move: 1 league, 4 members (users 1/74/5/15), 4 join lines, 1 link. Draft side identical
    before/after: members 4, claims 1, keepers 41 (hash e7e21d38...), invites 4, drafts 24,
    picks 1944, reads 7. Checks ok.
  - Player leagues 9->10, members 14->18, events 78->82. Manual 245 / tracker 78 / preset 4 /
    launch 2 configs untouched and unlinked.
  - Checked on sportsvyn.com at 390 as user 1 (30-min session, deleted):
    - /leagues/11 opens on DRAFT: 12 teams, 41 keepers, "Pick 12 · RuDiCkUlOuS", 7 mocks;
    - Members names your franchise;
    - old /join/53XUHXVR (expired) lands on /leagues/11?tab=draft;
    - /sim loads with "Open league"; mock room /sim/draft/585 loads; no page errors.
  - Off: 1 of 4 members has claimed a franchise; the draft date reads "Mon Sep 7" (ET of 8 Sep UTC).
- Rulings in docs/decisions.md: expired /join stays dead; bots switch from slice 4; 2027 import attaches.

## CFB 25 WEEK 8 LIVE (mon-2)
- content/power/cfb-2026-w8.md + EDITOR_FILES line, merge a4cc9c2 (suite 6517/0, preview READY on
  6ad2ee0 = same tree). All 25 names resolve to exactly one team (Miami = MIA 48148).
- Published with publish({league:'cfb', apply:true}) from main against PROD (week 7's path): edition
  157 replaced the model-only 156 from the 15:00Z cron. Ranks 1-25 = the list.
  cfb25-reminder dry run: "would do nothing: file-exists".
- Checked at 390:
  - /rankings?league=cfb: the SPORTSVYN POWER block reads 1 Ohio State ▲4, 2 Miami, 3 BYU ▲5;
    the AP block above it leads with Miami.
  - Scores rank badges show AP ranks, not the Sportsvyn 25.
  - Top 25 chip: first in the conference row, lime when on.

## MORNING EMAIL LIVE from Tue 20 Oct 15:00Z (mon-4 GO)
- 146 on PROD (ledgered 19:41Z, sha f9836721b353 = DEV). main 83ff36f = morning-email merged with
  main (suite 6538/0 on 83ff36f, preview READY on 83ff36f), production READY on sportsvyn.com.
- MORNING_EMAIL=on in Vercel production (set before the build). Cron 0 15 * * * registered on
  dpl_24u77CSYTLYFm769pnGx1SgCSYMz. /og/email/chip + /tile serve 200 image/png on sportsvyn.com.
- PROD dry run as Tue: audience 44 (40 active, 4 new); subject "NBA opening night: 3 games tonight
  - make your picks"; lead = NBA opener hero (3 games, confidence board not built yet).
- STILL OPEN: Tue's first NBA tip stored as 3:00 PM ET (12 PT); the email prints it as stored.
- Second test address dropped. Step 7 (after 15:00Z): report sent/skipped/bounced, Resend, app_errors.

## NBA OPENER TO THE FULL LIST LIVE for Tue 20 Oct (mon-6 GO)
- main 0038f93 (nba-opener merged; suite 6546/0 on 0038f93; preview READY on 8792f49 = same code;
  prod READY dpl_Fy5ctpXpfHrDfccCRfunLa6FaKW6). BROADCAST_NBA_OPENER=on in Vercel prod.
- Cron /api/cron/nba-opener 5-45 15 20 10 *: 50 per firing, after A's run finishes; stop on
  complaints > 1 or B hard bounces > 5% (stop row + alert). Mon probe: decision wrong-day (flag on).
- Mon 23:30Z count as Tue: A 43, B 252 (one account aged out of A). Report: docs/reports/mon-5-nba-opener.md.
- After Tue: remove BROADCAST_NBA_OPENER from Vercel (code refuses other days anyway).
- 20:12Z reboot was a manual `sudo reboot` (derik, pts/9), no OOM; timers and poller back.

## COINS + THE DRUM built, HELD (coins-2) - branch coins-drum @ a45851c, NOT merged
- B1-B5 + B7 done behind COINS=on (Vercel Preview, branch coins-drum only); B6 not started.
- Migrations 147 + 148 on DEV only (ledgered). PROD needs dual GO.
- Suite 6563/0 on a45851c; next build clean; preview READY sportsvyn-57mkxw52x (/coins, /coins/rules,
  /coins/results/dry-run all 200). Report: docs/reports/coins-2-build.md (on the branch).
- AT MERGE: parity-intent.json carries 2 entries (apptab .cn-bar) - reset to {"changes": []} right after.
- Review data: scripts/coins-dev-seed.mjs --user <DEV id> --coins 4 (DEV only).

## PR WORKFLOW (tue-2, standing)
- Every change lands via a PR into main. The GitHub check "SPORTSVŶN test suite" IS the full suite
  (no separate local full run); locally run touched tests + eslint while building.
- Merge on green CI + Vercel preview READY for the PR head, merge commit, no rebase; no admin
  bypass unless a relay says "bypass OK". Then wait for production READY on the merge commit.
- Reconciled with "THE SUITE IS THE WHOLE SUITE" in CLAUDE.md: the CI run is that suite, pre-merge.

## Queue
0. mon-6 step 5, Tue ~16:00Z: A and B sent/skipped/bounced/complained, stop rule, opens + clicks
   (sync_runs morning-email sends by summary.why, resend-webhook rows, email click rows). Short box.
1. Morning email step 7 after Tue 15:00Z (sync_runs, ledger, Resend, app_errors).
2. tue-2 (after the morning email is live): league 'draft done' state for linked leagues; at GO
   mark league 11 done, note "Drafted in person". Branch league-draft-done.
2. 20 Oct: docs/launch-oct20 checks 6-13. Mon 19 Oct: first live CFB 25 reminder. Mon 26 Oct:
   CFB win-prob re-score prompt.
3. Slice 4 (slow league draft) when Derik says. 2027: Fantrax import attaches (decisions.md).

## Next step
Tue ~16:00Z: morning email + NBA opener report (queue 0 + 1); then tue-2 (draft done).
