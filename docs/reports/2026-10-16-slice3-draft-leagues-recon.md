# Slice 3: draft leagues into player leagues - recon (fri, 16 Oct 2026, read-only)

Nothing built. PROD read with SELECT only, through `neon(process.env.PROD_DATABASE_URL)`.
PROD ledger is at 144 (`schema_migrations` max = 144, 144 rows), so the next migration is 145.

## 0. The finding that shapes everything

A "draft league" today is not a shared draft. It is a shared CONFIG (a Fantrax league's teams,
slots and keepers) from which every member runs their OWN private mock against bots, sitting at
a franchise of their choice:
- `startLeagueDraftFor` (lib/fantasy/drafts.js:740-779) writes a `drafts` row owned by the
  caller (`finalizeStart({ ...config, user_id: userId }, ...)`, :775).
- Runs are private by ruling (2 Sep): `myLeagueRuns` scopes on the viewer
  (lib/fantasy/leagueShare.js:310-327).

So "move draft leagues into player leagues" is really about MEMBERSHIP, INVITES and a HOME for
the Fantrax league. The real multi-human draft is Slice 4 and needs new tables either way.

PROD holds exactly ONE Fantrax league.

## 1. What each system stores

### Player leagues (073, 122, 133/134, 144)
| Table | Purpose | Key columns |
|---|---|---|
| player_leagues | the league | owner_id, join_code (6 chars, UNIQUE), invite_token (12 chars), span, scoring, format (table/guillotine), max_members 2-100, late_joins, starts_at, pick_format* (073:23, 122:5-60, 133) |
| league_members | who is in | (league_id, user_id) PK, role member/co_admin, notify_* (073:31, 144) |
| player_league_games | which PUBLIC games count | PK (league_id, game_type, sport) (122:77-81) |
| player_league_eliminations | guillotine chops | (league_id, user_id), period_key (122:87) |
| league_events | feed and history: join, period_winner, took_first, chopped | UNIQUE (league, kind, user, period_key) (144:38) |
| league_removals | removed members are refused at the door | (league_id, user_id), removed_by (144:51) |

Standings are DERIVED on read from public contests: `lib/leagues/results.js:93-106` reads
`contest_entries` over `(game_type, sport)` pairs. Roles: `owner_id` plus `league_members.role`.
Permissions are in lib/leagues/members.js `canAct`.

### Draft leagues (046, 055, 083, 084, 085, 104, 105)
| Table | Purpose | Key columns |
|---|---|---|
| draft_configs | league facts | user_id (importer = owner), source (fantrax/manual/tracker/preset/launch), external_league_id, teams jsonb (slot, fantraxTeamId, isMine, minors, adds), roster_slots, scoring_format, draft_date, pool_source, default_sort (046:54, 083, 104) |
| draft_config_members | who is in, and which FRANCHISE they hold | PK (config_id, user_id), role owner/member, fantrax_team_id; partial UNIQUE (config_id, fantrax_team_id) (085:45-58) |
| draft_config_invites | expiring codes | code (8 chars) UNIQUE, expires_at (+14 d), max_uses 12, uses, revoked_at (085:59-70) |
| draft_config_keepers | keepers as pre-made picks | (config_id, round, pick_in_round), fantrax_team_id, fantrax_player_id, adp; UNIQUE (config, team, round) (083:120, 084) |
| drafts | one run, ONE human | user_id NOT NULL (046:70), config_id CASCADE (085), pick_position, user_seat (084), mode sim/tracker (055), turn_deadline_at (105) |
| draft_picks | the picks | UNIQUE (draft_id, overall_pick), picked_by user/ai/logged, is_keeper (046:83, 055, 083) |
| draft_boards | the board frozen at start | draft_id PK, rows jsonb (105:49) |
| draft_reads, sim_player_pool | post-draft reads; the Fantrax pool (source='fantrax') | 048, 046/083 |

### What each has that the other lacks
| Concept | Player leagues | Draft leagues |
|---|---|---|
| Franchises / Fantrax team ids | none: a member is a person, not a team | teams jsonb plus the claim column; claims race on the partial unique |
| Keepers | none | draft_config_keepers |
| Draft boards / runs | none (the weekly Draft is a public contest) | drafts, draft_picks, draft_boards |
| Roles | owner, co_admin, member; remove, leave, notify prefs | owner, member; the owner can kick, a member can leave |
| Invites | permanent 6-char code plus a resettable 12-char token at /j/; late_joins, starts_at, max_members | 8-char code at /join/: one live code, 14 days, 12 uses |
| History | league_events, eliminations, removals | runs only (private), import timestamp |
| Standings / scoring | derived from contests | none |
| External sync | none | Fantrax import (lib/fantrax/import.js:418, the one writer). It always INSERTs a new config; there is no re-sync or upsert (:562-588) |

## 2. The two options

**A. A draft_config becomes a "draft" game inside a player_league.** The league's members, roles
and invites replace draft_config_members and draft_config_invites; the config is one game of the
league. **B. Keep the draft tables and link each config to a player_league** (nullable FK). The
league is the door and the home, and the draft tables stay the engine.

| | Option A | Option B |
|---|---|---|
| Migrations | game-instance table (player_league_games' PK (league_id, game_type, sport) cannot hold a config id; the key `draft` is TAKEN by the public weekly Draft, gameTypes.js:14); league_members.fantrax_team_id + partial unique copied from 085; backfill of members and claims; later, drop draft_config_members/invites | 145: `draft_configs.league_id` FK ON DELETE SET NULL (indexed, CHECK NULL or source='fantrax'); `player_leagues.kind` 'games' or 'fantasy' (the phased report's column) |
| Code touched | REWRITE leagueShare.js (336 lines) and its test (493 lines, about 10 source pins at :438-470); getMyLeagues (drafts.js:98-129); startLeagueDraftFor access (:740-760); import.js:576; app/join/[code]; components/sim/{JoinClaim, LeagueShare, MyLeagues, JoinByCode}; app/actions/league.js; lib/account.js; scripts/crew-reader-grants.mjs; plus results.js, table.js, crew.js, home.js and settings.js must skip a non-contest game | ADD one `OR league member` arm to memberRole/canReadConfig (leagueShare.js:45-63) and getMyLeagues' WHERE (drafts.js:108); claimFranchise (:115-135) INSERTs on first claim; lib/leagues/members.js removeMember/leaveLeague drop the claim row; /join redirect; league home kind branch (app/leagues/[id], home.js, table.js); import attaches by external_league_id; MyLeagues "Open league" link; backfill script |
| Size | 9-13 days | 4-6 days |
| Owner-row invariant (leagueShare.test:87-123) | moves to league_members; its source pins go red by design | holds unchanged: owner rows untouched, config.user_id stays the importer |
| Invite redemption | semantics change: an expiring 12-use 8-char code vs a permanent 6/12-char key with max_members, late_joins and starts_at refusals; old /join/ links need a map | the league's /j/ door becomes the only door for linked configs; createInvite refused for them; /join redirects |
| getMyLeagues | rewritten | additive |
| Fantrax sync | the import must create or attach a league and write league_members | the import attaches to a league; the owner row stays as is |
| /sim routes | lobby card changes | additive link |
| Keeper carry-over | unchanged in storage (per config) | improves: next season's import attaches to the same league |
| Biggest risk | a draft game inside CONTEST standings with nothing to score; every reader of player_league_games must ignore it | two membership tables can disagree; owner_id vs config.user_id must match |

Today there is no keeper carry-over between seasons: the import always INSERTs a new config, with
no upsert or re-sync (import.js:562-588). Keepers are import-time facts of one config.

In B, the league home for kind='fantasy' shows a Draft panel (franchises and claims, keepers per
team, the draft date, LeagueStart, your runs) and hides the standings tabs.

## 3. Moving PROD with zero loss

### PROD counts (16 Oct)
| source | configs | owner rows | other members | keepers | invites (live) | runs (users) |
|---|---|---|---|---|---|---|
| fantrax | 1 | 1 (claimed) | 3 (0 claimed) | 41 | 4 (0 live; last expired 16 Sep, 4 uses) | 24 (3) |
| manual | 245 | 165 | 0 | 0 | 0 | 245 |
| tracker | 78 | 62 | 0 | 0 | 0 | 72 |
| preset / launch (system) | 4 / 2 | - | - | - | - | 125 / 90 |

- The one league is id 225 "THE LONGEST YARD", owner user 1, 12 teams, draft_date 8 Sep (past).
- Its members are users 1, 74, 5 and 15. Users 1 and 74 are already in player leagues.
- Its runs: 24 drafts, 1,944 picks (380 of them keepers), 7 draft_reads, 0 draft_boards.
- The 4 uses vs 3 non-owner members means one person joined and later left or was kicked.
- Player leagues on PROD: 8 leagues, 13 members, 8 game rows (all daily/all), 75 events,
  0 removals.

### Which become player leagues
- Only `source='fantrax'`: today, one league.
- manual and tracker configs are ONE reader's draft room. They have no franchise to claim and
  no other member, they are never listed by getMyLeagues (drafts.js:108), and 96 of them have
  no owner row by design (the CLAUDE.md leagueShare ruling). One user holds 32.
- Turning them into leagues would mint about 323 one-member leagues into /leagues. It would
  write rows the product never creates (the exact trap the leagueShare lesson records), and it
  would gain nothing: there is nobody to invite. They stay as they are.

### Backfill steps (Option B; one script, dry run by default, then `--prod --apply`)
1. BEFORE: record the counts for config 225:
   - draft_configs = 1, draft_config_members = 4, keepers = 41, invites = 4;
   - drafts = 24, draft_picks = 1944, draft_reads = 7;
   - player_leagues = 8, league_members = 13, league_events = 75.
2. Apply 145 through scripts/apply-migrations.mjs (never a console paste).
3. In ONE transaction:
   - INSERT a player_leagues row: name = config name, owner_id = config.user_id,
     kind = 'fantasy', a fresh join_code and invite_token, max_members = teams_count,
     late_joins true.
   - INSERT league_members for every draft_config_members user (the owner included; role
     'member', as createLeague writes the owner). ON CONFLICT DO NOTHING.
   - INSERT league_events 'join' for each, at joined_at.
   - UPDATE draft_configs SET league_id = <new> WHERE id = 225 AND league_id IS NULL.
   - Do not touch draft_config_members, keepers, invites, drafts or picks.
4. AFTER: every draft-side count above is identical, and player_leagues = 9, league_members = 17,
   league_events = 79. Also check:
   - every draft_config_members user of 225 has a league_members row (anti-join = 0);
   - the owner is the same on both sides;
   - the leagueShare owner-row invariant (fantrax, missing = 0) is still green;
   - getMyLeagues(1, 74, 5, 15) each still return config 225;
   - /leagues lists the new league for all four.
5. Run on DEV first against a fixture fantrax config. DEV holds real-looking configs; list them
   before any write (memory: "DEV deletes: list first").

Under Option A the same steps also copy the claim (1 row) and move the invite rows, and the
"zero loss" check must add claims (1) and keep the 4 invite rows readable for the redirect.

### Routes and redirects
- app/sim/**: `/sim` (lobby, MyLeagues card), `/sim/account`, `/sim/history`, `/sim/tracker`,
  `/sim/draft/[id]` (DraftRoom, RankedRoom or TrackerRoom; page.js:72-130), `/sim/draft/[id]/card`.
- Invites: `/j/[code]` (player league: 6-char code or 12-char token, plus opengraph-image) and
  `/join/[code]` (draft league, 8 chars; inviteCode.js:15, :41).
- Option B redirects:
  - `/join/<code>` for a linked config: 307 to `/leagues/<id>?tab=draft` for a member, or to
    `/j/<invite_token>` for a non-member. Zero draft invites are live on PROD, so this catches
    only stale links, which today say "expired".
  - `/sim/draft/[id]` runs stay put. The /sim card keeps Start and adds "Open league".
  - `/j/` must keep refusing 8-char keys so the code spaces stay apart (code.js:54-58 does).

## 4. Slice 4 (live and slow league drafts): what carries over

### The room is still not multi-human safe (CONFIRMED on current main)
- `drafts.user_id NOT NULL`, one owner (046:70). Every read and settle is scoped
  `AND user_id = ${userId}`: getDraft (drafts.js:347-352), settleExpiredTurn (:968-970).
- persistTurn (:1084-1100) has no pick-count guard. Only UNIQUE (draft_id, overall_pick) stops a
  double write, as an uncaught error. The engine has ONE isUser seat (engine.js:227); advanceAi
  runs bots up to it. The clock is lazy on the owner's read, with no sweep for unread seats.
- Game Drafts (lib/draftGame/room.js:46-60) has the right WRITE pattern: replay from picks, a
  write guarded on the pick count read, sweepClock on read. It is still one human per entry, so
  it is a pattern, not a room.
- The phased report's row 8 stands. A league room needs its own tables: league_drafts,
  league_draft_picks UNIQUE (draft, overall) with picked_by user/auto/bot, league_seats,
  optimistic writes and a sweep cron.

### What carries over
- The draft look (merged 7c81af0): components/draftRoom/{RoomHeader, SeatStrip, PoolRow,
  DraftResultView}.js (props-only) and lib/draft/roomLook.js, used by components/draft/RankedRoom.js
  (273 lines) and components/draftGame/GameDraftRoom.js. RankedRoom is the closest template
  (12-seat scrolling strip, Players / My team / Board, arm-then-confirm, server deadline). Its
  header still hardcodes the weekly copy, and its actions call app/actions/sim.
- Also reusable: lib/fantasy/roomFlags.js; lib/draft/deadline.js; lib/fantasy/board.js buildBoard;
  lib/fantrax/keeperSeed.js (overallFor/seatFor: keepers as pre-made picks in the owner's
  column); engine.autoPick for no-shows; ourBoard / frozenBoard for the pool.
- Stays behind: DraftRoom.js (1,280 lines, about 25 source-pinning tests), TrackerRoom.js and the
  per-user drafts tables.
- Under B, a Slice 4 league draft keys on player_leagues.id. A Fantrax league's seats come from
  the draft_config_members claims and its keepers from draft_config_keepers.

## 5. Recommendation: Option B

Why:
- It is half the size.
- It touches no standings code, keeps every tested invariant (owner row, claim race, runs
  private, members never write facts) green without rewording them, and moves one league with
  a reversible link (set league_id NULL).
- Option A pays 9-13 days to fold a franchise-and-keeper model into a contest-standings model
  that has nothing to score for it, and it renames the claim race onto a table that never had
  one.
- The player league becomes the door and the home; the draft tables stay the engine. That is
  the same split Slice 4's new tables will need.

### Slice plan
| Slice | Work | Days |
|---|---|---|
| 3a | migration 145 (league_id link, player_leagues.kind); kind-aware validator; DB tests | 1 |
| 3b | access through the league (memberRole, canReadConfig, getMyLeagues); claim-on-insert; remove and leave hooks drop the claim; tests incl. a "two tables agree" DB test | 1.5 |
| 3c | league home for kind='fantasy': Draft panel (franchises, claims, keepers, draft date, Start, my runs); standings tabs hidden; /sim card "Open league" | 1-1.5 |
| 3d | backfill script (dry run, --prod --apply, before/after counts); /join redirect; DEV run, then PROD | 0.5-1 |
| 3e | import attaches to a league by external_league_id (next-season keepers land in the same league) | 0.5-1 |
| Total Slice 3 | | 4.5-6 |
| 4a | slow league draft: tables, seats, guarded picks, autopick, sweep cron, "you're up" push, room in the draft look | 8-10 |
| 4b | live draft: lazy clock plus 2-3 s polling, presence, cron backstop | 5-6 |

### Top risks
1. Two membership tables (league_members vs draft_config_members) drift. A league removal must
   delete the claim row. Pin it with a DB test, and test that /join for a linked config cannot
   add a member who bypasses league_removals.
2. A fantasy-kind league running through code that assumes games: 122's `no_games` validator,
   results.js and table.js with zero pairs, crew points, the leagues-tick cron. Every reader of
   player_league_games needs a kind check or an empty-safe path.
3. Owner identity across two columns (player_leagues.owner_id vs draft_configs.user_id): the
   import writes the owner, the league home lets an owner remove people, and there is no
   transfer on either side. Assert equality at link time and refuse a link that would split
   them.

Open for Derik:
- (a) a fantasy-kind league with no other games, or allow public games beside the draft;
- (b) whether the old /join/ door closes for linked configs or keeps working as a redirect;
- (c) max_members = teams_count for a fantasy league.
