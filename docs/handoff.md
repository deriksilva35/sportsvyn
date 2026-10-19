# Handoff - droplet relays sun-1 + sun-2, Mon 19 Oct 2026 (clock ~01:10Z)

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
  - Off: only 1 of 4 members has claimed a franchise (3 show "Open"). The draft date reads
    "Mon Sep 7" (ET of the stored 8 Sep UTC time).
- Rulings logged in docs/decisions.md (new): expired /join stays dead (copy shipped); bots switch
  stored now, used from slice 4; MUST-DO before the 2027 keeper import: the import attaches to the
  same league (also in memory).
- Earlier: bounce suppression, /scores Top 25 placement, crew_reader column grants, docs/context.md.

## IN PROGRESS - morning email (sun-2; thu-1 recipients ruling)
- Branch morning-email, worktree ~/projects/sv-morning (not yet committed at this handoff).
  Migration 146 (users.morning_email) on DEV only.
- Built: audience (30-day play OR <14 d OR /you ON; dormant nothing; bounces suppressed), once per
  user per ET day ledger, cron 15:00Z + watchdog, MORNING_EMAIL kill switch (OFF), preview at
  /admin/morning-email, scripts/morning-email.mjs (--count / --preview / --test), /you switch.
- PROD audience today (read-only): 43 = 38 active + 5 new. The draft body is pending Derik's
  content spec.
- Target: test send to derik@sportsvyn.com by Mon 19 Oct 20:00Z; first send Tue 20 Oct 15:00Z only
  after GO (needs 146 on PROD, merge, MORNING_EMAIL=on).

## Queue
1. Morning email: tests, suite, preview, test send; then GO.
2. 20 Oct: docs/launch-oct20 checks 6-13. Mon 19 Oct: first live CFB 25 reminder. Mon 26 Oct:
   CFB win-prob re-score prompt.
3. Slice 4 (slow league draft) when Derik says. 2027: Fantrax import attaches (decisions.md).

## Next step
Finish and test-send the morning email (sun-2).
