# Handoff - droplet relays sun-1/2 + mon-1/2/3, Mon 19 Oct 2026 (clock ~19:00Z)

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

## HOLDING FOR GO - morning email v2 (mon-3 + jerseys addendum)
- Branch morning-email @ 6094fd8, worktree ~/projects/sv-morning. Suite 6538/0 on 6094fd8;
  preview READY on dcb811b (6094fd8 = dcb811b + one test file). Migration 146 is on DEV ONLY.
- Counts follow /scores (only not_needed excluded); "*" = an only-if-needed playoff game.
- Pictures: /og/email/{hero/<date>,chip/<slug>,tile/<game>}.png, 2x, public cache, no reader in a
  URL, alt text = matchup + time. They serve on the preview (200 image/png).
- Layout: hero image + Make your picks + mock link (no repeated headline); lineup grid; Daily;
  1x3 tiles; game chip + Also tonight; week; YOUR MOVE pills; lock-screen preview. PT first.
- Lead order: NFL primetime > opener > playoff > rivalry > closest line.
- NBA jerseys: all 30 live in the branch (Higgsfield remover, not rembg). BDL letters all match.
  NYK/WAS outlined. TeamMark + email chips use them.
- Test as TUESDAY sent 18:36Z to derik@sportsvyn.com (Resend 01a15573), pictures inline (cid:).
  Second test address still pending.
- OPEN: PROD has Tue's NBA tips at 3:00 / 7:00 / 9:30 PM ET (fed 17:52Z). The email reads
  them as stored; 3 PM looks wrong.
- GO ORDER for Tue 20 Oct 15:00Z: (1) 146 on PROD; (2) merge + deploy; (3) MORNING_EMAIL=on in
  Vercel production; (4) after 15:00Z check sync_runs source 'morning-email'.
- Details: docs/reports/2026-10-19-mon3-morning-email.md

## Queue
1. Morning email GO (order above).
2. tue-2 (after the morning email is live): league 'draft done' state for linked leagues; at GO
   mark league 11 done, note "Drafted in person". Branch league-draft-done.
2. 20 Oct: docs/launch-oct20 checks 6-13. Mon 19 Oct: first live CFB 25 reminder. Mon 26 Oct:
   CFB win-prob re-score prompt.
3. Slice 4 (slow league draft) when Derik says. 2027: Fantrax import attaches (decisions.md).

## Next step
Morning email GO before Tue 15:00Z; then tue-2 (draft done).
