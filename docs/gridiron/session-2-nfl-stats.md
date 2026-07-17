# Gridiron Session 2 - NFL player + 2025 stat layer (branch `gridiron-session-2`)

DEV DB only. Parts B-D of the relay (migration 049, player ingest, 2025 stat
backfill, name-match). Part E/F (wire the readers, tests, push) is the Mac
session - this doc is the handoff.

## What shipped

- **migrations/049_nfl_players_and_stats.sql** - `nfl_players`,
  `nfl_player_game_stats`, and repoints `sim_player_pool.matched_player_id`
  from `players(id)` to `nfl_players(id)`.
- **lib/gridiron/nflStatsSync.js** - `syncNfl2025()` (per-game stat backfill +
  player upsert from the stat stream), `ingestAllPlayers()` (full roster sweep),
  synthetic DST identity creation.
- **lib/gridiron/nameMatch.js** - `normalizeName()`, `ffcPosition()`,
  `matchPoolIdentities()`.

## Run summaries (DEV)

| step | result |
|---|---|
| migration 049 | applied (8 statements); both tables created; pool FK now -> `nfl_players` |
| stat backfill (`syncNfl2025`) | swept 187 pages of `/nfl/v1/stats?seasons[]=2025`; **18,632** stat rows, **1,882** players, **0 skipped** (all 285 games matched, all players resolved) |
| roster sweep (`ingestAllPlayers`) | 117 pages of `/nfl/v1/players`; **11,665** players upserted (gives identities to rookies / injured-all-season with no 2025 line) |
| DST identities | **32** synthetic per-team defenses (`is_team_defense = true`, `bdl_player_id` NULL) |
| name-match | **218 / 218** identities matched, **0 unmatched, 0 ambiguous**; all **717** pool rows written |

Final table state: `nfl_players` 11,697 (11,665 real + 32 DST) · `nfl_player_game_stats`
18,632 rows (17,777 REG + 855 POST across 285 games) · `sim_player_pool` 717/717 matched.

`timeResolvedFromFallback`: N/A for this path - no provider datetime is parsed
(stats attach to already-ingested `matches`), so the ingest.js timezone boundary
does not apply.

## Match rate: 218 of 218

Unmatched list: **empty.** First pass matched 200/218; the 18 misses were all
resolved:
- **Washington Defense** - pool uses FFC code `WAS`, `teams` uses BDL `WSH`.
  Fixed with a `TEAM_ABBR_ALIAS` (`WAS -> WSH`, plus a defensive `JAC -> JAX`).
- **17 players** (Aiyuk, Tank Dell, and rookies/injured e.g. Mendoza, Jeremiyah
  Love, Jordyn Tyson...) had no 2025 stat line, so they were absent when
  `nfl_players` was sourced from the stat stream. The full roster sweep gave them
  identities; they now match but have **zero stat rows** (correct - the room shows
  them with no 2025 stats). Count of matched-with-no-stats identities: **17**.

Correctness checks (all pass): 0 team mismatches between pool team and matched
player's current team; all 14 suffix players (Jr/Sr/II/III/IV) resolved to the
right identity; all 18 DEF point to their own team's DST (0 point to a non-defense).

## What the Mac session (Part E) needs - exact names

### Join path
`sim_player_pool.matched_player_id` -> `nfl_players.id`. For a real player,
stats are `nfl_player_game_stats WHERE nfl_player_id = <id>`. For a DST
(`nfl_players.is_team_defense = true`), see the aggregation recipe below.

### `nfl_player_game_stats` columns -> hard-contract keys
Column is snake_case; the contract key (what scoring.js / statView.js consume) is
camelCase. `getPlayerSeasonStats` sums the columns across a player's game rows and
emits the keys:

| column | key | | column | key |
|---|---|---|---|---|
| `pass_cmp` | passCmp | | `rec_td` | recTd |
| `pass_att` | passAtt | | `fumbles_lost` | fumblesLost |
| `pass_yds` | passYds | | `fgm` | fgm |
| `pass_td` | passTd | | `fga` | fga |
| `pass_int` | int | | `fg_long` | fgLong |
| `rush_att` | rushAtt | | `xp` | xp |
| `rush_yds` | rushYds | | `sacks` | sacks |
| `rush_td` | rushTd | | `def_int` | defInt |
| `tgt` | tgt | | `fr` | fr |
| `rec` | rec | | `def_td` | defTd |
| `rec_yds` | recYds | | | |

- **`xpAtt` is intentionally absent** - BDL `/nfl/v1/stats` has no extra-point-
  attempts field and scoring.js consumes XP makes only. Do not look for an
  attempts column.
- **`sacks` is `numeric`** (half-sacks like 43.0 / 2.5 are real); every other
  column is `integer`. Nulls mean the player recorded nothing in that category.

### DST derived stats (no materialized DST rows)
A team defense's line is derived by aggregating its team's defensive player rows:

```sql
-- season line for the DST identity np (is_team_defense = true)
SELECT sum(s.sacks) sacks, sum(s.def_int) def_int, sum(s.fr) fr, sum(s.def_td) def_td
FROM nfl_player_game_stats s
WHERE s.team_id = np.team_id;               -- group by s.match_id for per-game
```
scoring.js treats DST as **partial** (sacks / defInt / fr / defTd only), so no
points/yards-allowed is stored. `def_td = interception_touchdowns +
fumbles_touchdowns` (set at ingest).

### Regular season vs postseason
Stat rows cover **both** phases. `matches.season_phase` is `'REG'` (17,777 rows)
or `'POST'` (855). Filter `JOIN matches m ON s.match_id = m.id WHERE m.season_phase
= 'REG'` if the season view should exclude playoffs. (Un-filtered season totals
currently include playoff games - e.g. Stafford shows 20 games.)

### Position vocab
`nfl_players.position` is FFC vocab (QB/RB/WR/TE/PK/DEF); BDL `K` is normalized to
`PK`, defenses are `DEF`. `bdl_position` keeps the raw BDL abbreviation. Note the
roster sweep also brought in ~7,700 positionless historical entries
(`position` blank/`UNK`); harmless (they never match a fantasy position) - prune if
you want a leaner table.

## Notes / decisions
- **Migration number 049** was the next free number on this branch's base
  (2bbb112, highest was 048). Mac `main` is a descendant of 2bbb112; if its 5 lead
  commits added migrations >= 049, renumber this file on merge.
- Scope was constrained to new files + `lib/gridiron/*` + this report - no
  `lib/fantasy/*` or `components/sim/*` file was touched (the reconciliation plan).
- `normalizeName()` is a pure function (de-accent, lowercase, de-punctuate,
  de-suffix) - a good unit-test target for the Part E suite.
