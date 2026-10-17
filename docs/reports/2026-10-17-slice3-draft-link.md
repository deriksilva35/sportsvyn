# Leagues slice 3, option B - draft league linked to a player league (fri-3, 17 Oct 2026)

Branch `leagues-draft-link` (worktree ~/projects/sv-draft-link). HOLDING FOR GO: nothing on PROD.
Spec: docs/reports/2026-10-16-slice3-draft-leagues-recon.md (option B) + rulings fri-3.

## Built
- Migration 145_league_draft_link.sql (DEV only):
  - draft_configs.league_id -> player_leagues (ON DELETE SET NULL, CHECK fantrax only, partial index);
  - player_leagues.kind ('games'|'fantasy') and bots_on (default false).
- lib/leagues/draftLink.js:
  - linkConfigToNewLeague: the one-step move, ONE statement, dry run by default.
  - draftCounts: members, claims, keepers + an md5 of every keeper row, invites, drafts, picks,
    reads; must be identical before and after.
  - linkChecks: members_missing 0, same owner, size = teams, linked, kind fantasy.
  - joinDoor: where an old /join link goes.
  - loadDraftHome: the Draft tab's data.
  - setBotsOn: owner only.
- Access through the league (lib/fantasy/leagueShare.js, drafts.js):
  - memberRole and getMyLeagues admit members of the linked league.
  - claimFranchise writes the member's own row on first claim.
  - The draft side's createInvite / redeemInvite / leaveLeague / kickMember are refused for a
    linked config: the league is the only door.
  - A league leave or removal deletes the draft claim row, so the two membership tables agree.
    The owner's row is never touched.
- /join/<code> redirects:
  - a league member goes to /leagues/<id>?tab=draft (live or dead code);
  - a non-member goes to /j/<league token> only while the old code is still live;
  - a dead code renders as before, naming the league.
- League home: a DRAFT tab, shown only when a draft is linked.
  - It opens on DRAFT when the league plays no games; with games beside the draft, STANDINGS and
    TODAY return and crew points apply.
  - Tiles: YOUR PICK / TEAMS / KEEPERS.
  - Status: the draft date, teams, scoring and keepers, plus "Empty seats: bots fill them / stay
    empty" with the owner's toggle.
  - Your team, or a claim picker; the board (12 franchises, manager, keepers by round); your
    private mocks; "Run a mock draft" goes to /sim.
  - Members show franchise names. /leagues cards wear "Fantasy draft". The /sim card gains
    "Open league".
- scripts/link-draft-league.mjs: `--config <id> [--prod] [--apply]`.
  - Refuses `--prod` unless DATABASE_URL is PROD_DATABASE_URL, and the reverse.
  - Prints before/after counts, the checks, and the undo.
- Mock and tracker rooms stay out: the plan refuses them and a DB CHECK enforces it.

## Tests
lib/leagues/draftLink.test.mjs (8, DB) covers:
- the plan;
- the door;
- the move (dry run writes nothing; apply links once; draft side unchanged);
- the DB CHECK;
- members and roles across both tables (claim-on-insert, the claim race, closed draft doors,
  leave and removal drop the claim, a removed member is refused);
- the /join redirects;
- size = teams;
- the rail and the Draft tab data.

Source pins updated: rail, getMyLeagues WHERE, the /sim card's two doors, age-gate count 56,
the page's `asked` tab.

## DEV proof
- Demo league "The Longest Yard (demo)": 12 teams, 4 members, 3 claims, 10 keepers.
  - Linked with the real script: dry run, then apply. Wrote 1 league, 4 members, 4 join lines
    and 1 link. Draft side identical, keepers hash included; checks ok.
- Screenshots at 390 (arcade face), scrollWidth 390 on every view: docs/reports/shots-2026-10-17-slice3/.
  - Owner Draft tab; Members with franchise names; /leagues; /sim "Open league"; an unclaimed
    member's claim picker.
  - The claim was written, and after a reload the tab reads "Pick 2 · The Replacements".
- Seed torn down: 0 left.

## PROD - the GO order
1. Apply 145 on PROD (ledger): `DATABASE_URL=$PROD_DATABASE_URL node scripts/apply-migrations.mjs 145_league_draft_link.sql`.
   Merging first BREAKS every league page and /sim: leagueDetail reads l.kind and getMyLeagues
   reads c.league_id.
2. Merge leagues-draft-link (suite + preview on the merge commit), deploy.
3. Dry run, then apply:
   - `DATABASE_URL="$PROD_DATABASE_URL" node scripts/link-draft-league.mjs --config 225 --prod`
   - then `... --prod --apply`.
   - Expected: 1 league, 4 members (users 1, 74, 5, 15), 4 join lines, 1 link. 41 keepers,
     4 invites, 24 drafts and 1,944 picks unchanged.
4. Check: /leagues/<new id> as a member, /sim "Open league", an old /join code.

## Decisions taken (say if wrong)
- A dead /join code does not become a live door. Only a live code walks a non-member into the league.
- bots_on is stored and shown now; it governs the shared league draft (slice 4). A member's
  private mock still fills every other seat with bots.
- Not built: 3e, where next season's import attaches to the same league by external_league_id.
- Not built: "Latest in the league" on a draft-only league (no standings tab to hold it).
