# Handoff - droplet relays sun-1/2 + mon-1/2, Mon 19 Oct 2026 (clock ~17:00Z)

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
- Rulings logged in docs/decisions.md (new): expired /join stays dead (copy shipped); bots switch
  stored now, used from slice 4; MUST-DO before the 2027 keeper import: the import attaches to the
  same league (also in memory).

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

## HOLDING FOR GO - morning email (sun-2, mon-1 + addendum)
- Branch morning-email @ 05b4738, worktree ~/projects/sv-morning. Suite 6530/0, preview READY
  on 05b4738. Migration 146 (users.morning_email) is on DEV ONLY.
- Body to the thu-1 spec, each module hidden when empty: 0 opener HERO (SEASON_OPENERS: NBA;
  default none), 1 headline, 2 yesterday's Daily (answer, played with house excluded, top 3),
  3 Daily button, 4 the week grid, 5 game of the day (playoff > rivalry > closest line; the opener
  league on hero days), 6 free to play x3, 7 YOUR MOVE (players), 8 spotlight rotation (the app on
  opener days; Get the app only without an iOS token), 9 footer. No coins. The privacy policy has
  one line about it.
- Tests sent to derik@sportsvyn.com: 15:05Z (sun-2 body); 15:55Z (mon-1, as Monday); 16:34:49Z
  (as TUESDAY: "NBA opening night: 3 games tonight - make your picks", Resend 01a15504...). All
  three reached Resend; 15:05 and 15:55 were confirmed delivered by webhook. Mail lands in Google
  Workspace (MX aspmx.l.google.com). The droplet's Resend key is send-only (no lookups). The second
  test address from Derik is still pending (owner addresses only).
- Tue's NBA board is built ~10:52Z Tue; the confidence line shows only once it exists.
- GO ORDER for Tue 20 Oct 15:00Z: (1) 146 on PROD; (2) merge + deploy; (3) MORNING_EMAIL=on in
  Vercel production; (4) after 15:00Z check sync_runs source 'morning-email'.

## Queue
1. Morning email GO (order above).
2. tue-2 (after the morning email is live): league 'draft done' state for linked leagues; at GO
   mark league 11 done, note "Drafted in person". Branch league-draft-done.
2. 20 Oct: docs/launch-oct20 checks 6-13. Mon 19 Oct: first live CFB 25 reminder. Mon 26 Oct:
   CFB win-prob re-score prompt.
3. Slice 4 (slow league draft) when Derik says. 2027: Fantrax import attaches (decisions.md).

## Next step
Morning email GO before Tue 15:00Z; then tue-2 (draft done).
