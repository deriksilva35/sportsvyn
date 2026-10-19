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

## HOLDING FOR GO - morning email (sun-2; thu-1 recipients ruling)
- Branch morning-email @ 22d9e3f, worktree ~/projects/sv-morning. Suite 6522/0 on 22d9e3f.
- Migration 146 (users.morning_email; NULL = the rule decides) is on DEV ONLY.
- Built:
  - audience: played 30 d OR account < 14 d OR ON at /you; OFF at /you never; unsubscribed,
    house, owner and hard-bounced excluded;
  - a ledger row before each send, so each reader gets one mail per ET day;
  - MORNING_EMAIL=on kill switch (OFF): an off cron firing records skipped-off;
  - /api/cron/morning-email at 0 15 * * *, plus a watchdog entry;
  - /admin/morning-email preview; scripts/morning-email.mjs --count / --preview / --test
    (owner addresses only);
  - /you Morning email switch (PUT /api/me/morning-email, age-gated).
  - The owner list moved to lib/email/owners.js.
- Draft body (lib/emails/morning.js): today's Daily, your yesterday (score, place of N), game of
  the day, boards locking today, unsubscribe. The content spec was not on the droplet; Derik
  reviews it in the test.
- PROD audience 19 Oct 01:00Z (read-only): 43 = 38 active + 5 new.
- TEST SENT 19 Oct 15:05:02Z to derik@sportsvyn.com (Resend 01a154b1-d121-7e3e-b42c-175b67781cb2), as
  user 1. Subject "Cleveland Guardians at Tampa Bay Rays today - and a new Daily"; blocks: Daily,
  game of the day, 5 locking today (user 1 had no Daily yesterday). Audience at send: 44 (40 + 4).
- GO ORDER for Tue 20 Oct 15:00Z: (1) 146 on PROD; (2) merge + deploy; (3) set MORNING_EMAIL=on in
  Vercel production; (4) after 15:00Z check sync_runs source 'morning-email' (sent / failed).

## Queue
1. Morning email: Derik reviews the 15:05Z test, then GO (order above).
2. 20 Oct: docs/launch-oct20 checks 6-13. Mon 19 Oct: first live CFB 25 reminder. Mon 26 Oct:
   CFB win-prob re-score prompt.
3. Slice 4 (slow league draft) when Derik says. 2027: Fantrax import attaches (decisions.md).

## Next step
Derik reviews the test mail; GO for Tuesday 15:00Z (order above).
