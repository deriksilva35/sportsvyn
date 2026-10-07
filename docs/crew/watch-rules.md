# Watcher rules

The rules the crew Watcher runs. Every SQL rule is a single read-only
Postgres SELECT that returns rows ONLY when the rule fires (zero rows = quiet).
Each query was run against DEV to validate syntax and column names; DEV is
stale (its pollers do not run), so DEV returns zero rows for most, which proves
the query parses, not that PROD is healthy. The scripts run them against PROD
read-only (`PROD_DATABASE_URL`, see "Running them" at the end).

Conventions used throughout:
- "ET day" = `(ts AT TIME ZONE 'America/New_York')::date`. CLAUDE.md forbids
  ad-hoc `AT TIME ZONE` for PROVIDER datetime conversion in app code (use
  `easternLocalToUtc()` there). These are monitoring queries over STORED
  timestamptz columns (day bucketing, the same pattern as `windowFor()` in
  lib/pickem/create.js), not provider-string conversion, so they are fine here.
  Do not copy them into app code.
- Grace windows: a game 60 s late to go `live` is normal BDL latency
  (memory: live-trigger-needs-a-grace-window), so lock/provider rules wait 10
  minutes or one hour as stated.
- Severity: `page` = wake Derik / push; `warn` = in the next report; `info`.

## Mapping: rule -> ~/crew/bin script

| Rule | Section | Script |
|------|---------|--------|
| G1 next lock passed, game unstarted | game-watch | `provider-health --game` |
| G2 card cannot be completed | game-watch | `provider-health --game` |
| G3 00:00 ET kickoff without TBD flag | game-watch | `provider-health --game` |
| G4 board unsettled 6 h after last final | game-watch | `provider-health --game` |
| G5 retention job not ok | game-watch | `retention-status` |
| P1 BDL NFL | provider | `provider-health` |
| P2 BDL NCAAF | provider | `provider-health` |
| P3 BDL MLB | provider | `provider-health` |
| P4 BDL NBA | provider | `provider-health` |
| P5 CFBD | provider | `provider-health` |
| P6 Odds API | provider | `provider-health` |
| P7 API-Sports EPL | provider | `provider-health` |
| P8 FFC ADP | provider | `provider-health` |
| C1 Vercel usage | cost | `cost-watch` |
| C2 Neon compute | cost | `cost-watch` |
| C3 Odds API credits vs month pace | cost | `cost-watch` |

`app-errors`, `vercel-errors`, `cf-top` and `latest-deploy` are log/deploy
readers and have no rule in this file (no threshold is defined for them here).

---

# game-watch

## G1 - next lock in the past with an unstarted game

- Meaning: an open, unsettled board has a game whose kickoff passed more than
  10 minutes ago while the match is still `status = 'scheduled'` and is not a TBD
  game. The pick is sealed by the match row's CURRENT kickoff plus status
  (lib/mlb/kickoffTbd.js `isGameLocked`, lib/pickem/view.js), so a game past
  kickoff but still `scheduled` means the poller did not flip it: the card shows
  it as locked while the feed says it has not started (or the kickoff is wrong).
- Severity: `page` if minutes_past > 30, else `warn`.
- Covers every board whose `board` jsonb elements carry a `match_id`: football
  Pick'em (nfl/cfb), October (mlb), EPL Weekly 5. Series boards (`series_key`)
  and boards with no `match_id` (weekly lineups, run, draft) are not match-locked
  and are not covered. MLB games sitting on the midnight-ET placeholder are
  skipped (that is G3's job; `isKickoffTbd` treats them as TBD).

```sql
SELECT c.id AS contest_id, c.game_type, c.sport, c.season_year, c.week,
       m.id AS match_id, m.slug, m.status, m.kickoff_at,
       round(extract(epoch FROM (now() - m.kickoff_at)) / 60)::int AS minutes_past
  FROM contests c
  CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(c.board) = 'array' THEN c.board ELSE '[]'::jsonb END) AS g(e)
  JOIN matches m ON m.id = (g.e->>'match_id')::int
  JOIN leagues l ON l.id = m.league_id
 WHERE c.settled = false
   AND c.opens_at <= now()
   AND g.e ? 'match_id'
   AND m.status = 'scheduled'
   AND (m.metadata->>'kickoff_tbd') IS DISTINCT FROM 'true'
   AND NOT (l.slug = 'mlb' AND (m.kickoff_at AT TIME ZONE 'America/New_York')::time = TIME '00:00')
   AND m.kickoff_at <= now() - interval '10 minutes'
 ORDER BY m.kickoff_at
 LIMIT 50;
```

Confirm: open the match (`/games/<slug>`), check the provider's own scoreboard
and `sync_runs` for `gridiron-games` / `mlb-schedule` / `plays-live`. A real
fire means the poller is behind. False positives: a game delayed on the
provider side (weather, a delayed start) that is genuinely still scheduled, in
which case the card correctly stays pickable; compare against the provider's
status before paging.

## G2 - a card that cannot be completed

- Meaning (precise): a board that is opened, unsettled and NOT yet at its first
  lock (`now() < locks_at`) but has no pickable game, or whose `board` points at
  a `match_id` that no longer exists in `matches`. Pickable = the match exists,
  `status = 'scheduled'`, and either TBD or kickoff in the future (the lock rule
  of lib/mlb/kickoffTbd.js `isGameLocked`, inverted). Such a card cannot be
  filled in by anyone: all its games are cancelled/postponed/moved off
  `scheduled` before the first lock, the board is empty, or a dangling id would
  break the settle (`boardResults` refuses a missing match).
- Why not "entries remain incomplete": lib/pickem/entry.js does not require a
  complete sheet (a no-pick is scored 0), so incomplete entries are a normal
  state, not a fault. After the last kickoff every game is unpickable by
  design, so that condition is excluded by the `now() < locks_at` clause.
- Severity: `page` when `pickable = 0` and the board has been open over 12 h;
  `warn` for dangling ids only.
- Covered: boards with `match_id` elements, i.e. football Pick'em, October,
  EPL Weekly 5. NOT covered (no "complete" notion in SQL, or no match ids):
  Pick'em series/day boards (`series_key`), The Run rounds, weekly lineups,
  Survivor, Daily. Say so rather than inferring them.

```sql
WITH b AS (
  SELECT c.id, c.game_type, c.sport, c.season_year, c.week, c.opens_at, c.locks_at,
         count(g.e) FILTER (WHERE g.e ? 'match_id') AS games,
         count(g.e) FILTER (WHERE g.e ? 'match_id' AND m.id IS NULL) AS dangling,
         count(g.e) FILTER (WHERE g.e ? 'match_id' AND m.status = 'scheduled'
                              AND ((m.metadata->>'kickoff_tbd') = 'true' OR m.kickoff_at > now())) AS pickable,
         bool_or(g.e ? 'series_key') AS is_series
    FROM contests c
    LEFT JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.board) = 'array' THEN c.board ELSE '[]'::jsonb END) AS g(e) ON true
    LEFT JOIN matches m ON m.id = CASE WHEN g.e ? 'match_id' THEN (g.e->>'match_id')::int END
   WHERE c.settled = false
     AND c.opens_at <= now()
     AND c.game_type IN ('pickem', 'october', 'epl_weekly_5')
   GROUP BY c.id
)
SELECT id AS contest_id, game_type, sport, season_year, week, opens_at, locks_at,
       games, pickable, dangling,
       CASE WHEN dangling > 0 THEN 'dangling match_id' ELSE 'no pickable game before lock' END AS why
  FROM b
 WHERE NOT COALESCE(is_series, false)
   AND (dangling > 0 OR (now() < locks_at AND pickable = 0))
 ORDER BY id;
```

Confirm: open the lobby card and the board in the app; check each game's status
in `matches`. False positives: a freshly created board whose games are all TBD
is pickable (counted); a board opened minutes before a provider reschedule can
flicker for one poll. Dangling ids after a `mlb/resync` that deleted a
rescheduled game are real and need a rebuild of the board. Note: DEV's October
boards are 2025 fixtures left unsettled with `locks_at` in the past, so they do
not fire here; they would fire G4 only if their matches were all final.

## G3 - kickoff at 00:00 ET without the TBD flag

- Meaning: an upcoming match whose `kickoff_at` is exactly midnight
  America/New_York and `metadata.kickoff_tbd` is not true. BDL has no TBD field;
  it sends the date at midnight ET (lib/mlb/kickoffTbd.js). The ingest is meant
  to store `kickoff_tbd = true` for that instant; a row without the flag will
  lock the pick at midnight and show a wrong clock.
- Window: only kickoffs in the next 72 hours. Measured on DEV, 344 far-out CFB
  (320, to 28 Nov) and NFL (24, late-season) rows sit at midnight ET with no flag;
  they are the schedule's "date only" placeholders (CFBD start-time-TBD, flex
  weeks) and are normal until a time posts. Only an imminent one can lock a
  pick wrongly, so only those fire. A CFB/NFL row inside 72 h is real news.
- Severity: `warn`; `page` if the kickoff is within 24 h.
- Monitoring query, not app code (see conventions).

```sql
SELECT m.id AS match_id, l.slug AS league, m.slug, m.status, m.kickoff_at,
       (m.kickoff_at AT TIME ZONE 'America/New_York') AS kickoff_et,
       m.metadata->>'kickoff_tbd' AS kickoff_tbd
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
 WHERE m.status = 'scheduled'
   AND m.kickoff_at > now()
   AND m.kickoff_at < now() + interval '72 hours'
   AND (m.kickoff_at AT TIME ZONE 'America/New_York')::time = TIME '00:00'
   AND (m.metadata->>'kickoff_tbd') IS DISTINCT FROM 'true'
 ORDER BY m.kickoff_at
 LIMIT 50;
```

Confirm: `SELECT metadata FROM matches WHERE id = <id>`; check the next
`mlb-schedule` / `gridiron-games` run wrote the row. False positives: a real
kickoff at exactly 00:00 ET (very rare); a CFB game whose time is still TBA the
week of the game (the provider has not posted it yet; the card then locks on the
placeholder, so treat it as a real fire for Pick'em boards).

## G4 - board unsettled 6 h after its last final

- Meaning: a contest is not settled although every game on its board is
  terminal (`final`, or not played: `cancelled` / `not_needed`, lib/mlb/status.js)
  and the latest final is more than 6 h old. The settle jobs should have closed it
  (this fires well before the watchdog's 48 h stale-contest alarm,
  lib/ops/cronWatchdog.js `staleContests`).
- Final timestamp: `metadata.detail.final_seen_at` (the poller's flip time) when
  present, else `matches.updated_at` (final_seen_at covers only part of the
  rows, lib/wire/finals.js). If `updated_at` was bumped later by an unrelated
  write the fire is later than 6 h, never earlier.
- Severity: `warn`; `page` once 24 h past.
- Covered: boards with `match_id` elements (football Pick'em, October, EPL
  Weekly 5). Series/day boards and lineups have no per-game status to read here.
  Pick'em football settle runs only Sun-Tue (`pickem-settle`), so a late final
  can legitimately wait; check the settle schedule before paging.

```sql
WITH b AS (
  SELECT c.id, c.game_type, c.sport, c.season_year, c.week, c.settles_at,
         count(*) AS games,
         count(*) FILTER (WHERE m.status = 'final') AS finals,
         count(*) FILTER (WHERE m.status IN ('final', 'cancelled', 'not_needed')) AS terminal,
         max(COALESCE((m.metadata->'detail'->>'final_seen_at')::timestamptz, m.updated_at))
             FILTER (WHERE m.status = 'final') AS last_final
    FROM contests c
    CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(c.board) = 'array' THEN c.board ELSE '[]'::jsonb END) AS g(e)
    JOIN matches m ON m.id = (g.e->>'match_id')::int
   WHERE c.settled = false
     AND g.e ? 'match_id'
   GROUP BY c.id
)
SELECT id AS contest_id, game_type, sport, season_year, week, settles_at, games, finals,
       last_final, round(extract(epoch FROM (now() - last_final)) / 3600)::int AS hours_since_last_final
  FROM b
 WHERE games > 0
   AND terminal = games
   AND finals > 0
   AND last_final < now() - interval '6 hours'
 ORDER BY last_final;
```

Confirm: `SELECT settled, settles_at, meta FROM contests WHERE id = <id>`; read the
`pickem-settle` / `october-settle` / `weekly-settle` rows in `sync_runs` for a
refusal reason (a game that is final but missing a score, a void-cutoff wait).
False positives: a settle job that runs only on a weekday window (see above);
a board whose `settles_at` is deliberately later.

## G5 - retention job not ok

- Meaning: `/api/cron/data-retention` (daily 09:43 UTC, lib/ops/dataRetention.js,
  app/api/cron/data-retention/route.js) records each run in `sync_runs`
  (`source = 'data-retention'`, `kind` = `apply` or `dry-run`, `ok`,
  `finished_at`, `error`) through `recordRun`. Fires when there is no run, the
  latest run is not ok, or the latest run started more than 26 h ago.
  `skipped-locked` decisions are ignored (another run held the lock).
- A run still in flight (`ok = false`, `finished_at IS NULL`, under 10 min old,
  maxDuration is 300 s) is not a failure.
- Severity: `page` when the latest run is not ok or older than 50 h; else `warn`.
- Note: the job DRY-RUNS unless `RETENTION_APPLY=on`; a `dry-run` kind is a
  healthy run. Whether deletes are happening is a separate question (the kind).

```sql
WITH r AS (
  SELECT id, kind, ok, started_at, finished_at, left(error, 200) AS error
    FROM sync_runs
   WHERE source = 'data-retention' AND kind IN ('apply', 'dry-run')
   ORDER BY started_at DESC
   LIMIT 1
)
SELECT r.id AS run_id, r.kind, r.ok, r.started_at, r.finished_at, r.error,
       round(extract(epoch FROM (now() - r.started_at)) / 3600)::int AS hours_since_start,
       CASE WHEN r.id IS NULL THEN 'no run recorded'
            WHEN r.ok IS NOT TRUE THEN 'last run not ok'
            ELSE 'last run older than 26h' END AS why
  FROM (SELECT 1) x
  LEFT JOIN r ON true
 WHERE r.id IS NULL
    OR (r.ok IS NOT TRUE AND NOT (r.finished_at IS NULL AND r.started_at > now() - interval '10 minutes'))
    OR (r.ok AND r.started_at < now() - interval '26 hours');
```

Confirm: read the row's `error`, then the Vercel function log for
`/api/cron/data-retention`. Also check `cron-watchdog` (which watches the same
job on its own schedule). False positive: a skipped cron tick on a deploy day.
On DEV it fires with "no run recorded" (the job does not run there) - expected.

---

# provider

Pattern for P1-P5, P7: count rows written in the previous ET day and the current
ET day for the feed's table; fire when `yesterday_rows > 0 AND today_rows = 0`.
Because a feed legitimately goes quiet on days with no games, each game-fed rule
adds an expectation gate, `due_today`: games in that league whose kickoff was
more than 1 hour ago today (ET). No game due, no fire. That gate is how the
queries stay quiet in the off-season and on rest days. Rows written are measured
with `updated_at` (every upsert in lib/gridiron/sync.js and lib/mlb/*.js sets
`updated_at = now()`), so a feed that is up but sees no change is quiet only
when no game is due. P2 and P5 use a 7-day lookback instead of "yesterday"
because the CFB slate is Saturday-heavy.

Season state on 7 Oct 2026 (what each rule does today):

| Feed | Table / column | State on 7 Oct 2026 | Why the query is safe |
|------|----------------|---------------------|-----------------------|
| P1 BDL NFL | matches (nfl, `bdl_game_id`) `updated_at` | in season | fires only if a game kicked >1 h ago and nothing wrote today |
| P2 BDL NCAAF | cfb_live_player_lines `updated_at` | in season (Sat live) | 7-day lookback + gate; quiet Sun-Thu |
| P3 BDL MLB | matches (mlb, `bdl_game_id`) `updated_at` | postseason | quiet when no game is due |
| P4 BDL NBA | matches (nba, `bdl_game_id`) `updated_at` | OUT of season (opens ~20 Oct) | `yesterday_rows = 0` and `due_today = 0` -> no rows |
| P5 CFBD | matches (cfb, `cfbd_game_id`) `updated_at` | in season | 7-day lookback + gate |
| P6 Odds API | odds_markets `fetched_at` | in season (futures + in-season sports) | needs rows yesterday; quiet before 03:00 ET |
| P7 API-Sports EPL | matches (epl, `api_sports`) `data_provider_synced_at` | in season (international-break weeks have no fixtures) | gate `due_today` |
| P8 FFC ADP | sim_player_pool `snapshot_date` | runs daily all year (no season gate in the route) | evaluated after 12:00 UTC only |

Severity for all P rules: `warn`; `page` if two consecutive checks fire or a
game is live right now. Confirm each by reading the feed's most recent
`sync_runs` rows (`SELECT source, kind, ok, started_at, left(error,200) FROM
sync_runs WHERE source = '<source>' ORDER BY started_at DESC LIMIT 5`), then the
provider's own status page / a manual call. Sources: gridiron-games (nfl, cfb),
mlb-schedule + plays-live (mlb), nba-schedule (nba), cfb-live-lines,
refresh-odds / gridiron-odds, epl-live / epl-fixtures, adp-snapshot.

## P1 - BDL NFL

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today)
SELECT 'bdl-nfl' AS feed,
       count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today - 1) AS yesterday_rows,
       count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today) AS today_rows,
       count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour') AS due_today
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  CROSS JOIN d
 WHERE l.slug = 'nfl' AND m.external_ids ? 'bdl_game_id'
HAVING count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today - 1) > 0
   AND count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today) = 0
   AND count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour') > 0;
```

## P2 - BDL NCAAF (live box-score lines)

The BDL CFB feed writes only while a game is live (lib/cfb/bdlLive.js ->
`cfb_live_player_lines`), mostly Saturdays, so "yesterday" is widened to the
previous 7 ET days.

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today),
x AS (
  SELECT (SELECT count(*) FROM cfb_live_player_lines p, d
           WHERE (p.updated_at AT TIME ZONE 'America/New_York')::date BETWEEN d.today - 7 AND d.today - 1) AS prior_7d_rows,
         (SELECT count(*) FROM cfb_live_player_lines p, d
           WHERE (p.updated_at AT TIME ZONE 'America/New_York')::date = d.today) AS today_rows,
         (SELECT count(*) FROM matches m JOIN leagues l ON l.id = m.league_id, d
           WHERE l.slug = 'cfb' AND m.status IN ('live', 'final')
             AND (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
             AND m.kickoff_at <= now() - interval '1 hour') AS due_today
)
SELECT 'bdl-ncaaf' AS feed, prior_7d_rows, today_rows, due_today
  FROM x
 WHERE prior_7d_rows > 0 AND today_rows = 0 AND due_today > 0;
```

## P3 - BDL MLB

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today)
SELECT 'bdl-mlb' AS feed,
       count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today - 1) AS yesterday_rows,
       count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today) AS today_rows,
       count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour'
                          AND (m.metadata->>'kickoff_tbd') IS DISTINCT FROM 'true') AS due_today
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  CROSS JOIN d
 WHERE l.slug = 'mlb' AND m.external_ids ? 'bdl_game_id'
HAVING count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today - 1) > 0
   AND count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today) = 0
   AND count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour'
                          AND (m.metadata->>'kickoff_tbd') IS DISTINCT FROM 'true') > 0;
```

## P4 - BDL NBA

Out of season until about 20 Oct 2026: no rows yesterday and no game due, so it
returns nothing. It starts guarding itself on opening night.

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today)
SELECT 'bdl-nba' AS feed,
       count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today - 1) AS yesterday_rows,
       count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today) AS today_rows,
       count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour') AS due_today
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  CROSS JOIN d
 WHERE l.slug = 'nba' AND m.external_ids ? 'bdl_game_id'
HAVING count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today - 1) > 0
   AND count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today) = 0
   AND count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour') > 0;
```

## P5 - CFBD

CFB games (ids, schedule, finals) come from CFBD (`external_ids.cfbd_game_id`,
gridiron-games every 5 minutes). 7-day lookback because the CFB slate is
Saturday-heavy.

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today)
SELECT 'cfbd' AS feed,
       count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date BETWEEN d.today - 7 AND d.today - 1) AS prior_7d_rows,
       count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today) AS today_rows,
       count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour') AS due_today
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  CROSS JOIN d
 WHERE l.slug = 'cfb' AND m.external_ids ? 'cfbd_game_id'
HAVING count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date BETWEEN d.today - 7 AND d.today - 1) > 0
   AND count(*) FILTER (WHERE (m.updated_at AT TIME ZONE 'America/New_York')::date = d.today) = 0
   AND count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour') > 0;
```

(The CFBD quota alarm is separate: lib/ops/cfbdQuota.js. Do not duplicate it.)

## P6 - Odds API

`refresh-odds` runs hourly, `gridiron-odds` every 15 minutes, futures daily at
09:00 UTC, so any day with a covered sport in season has rows. No game gate;
instead the rule is evaluated only from 03:00 ET so it cannot fire at midnight
before the first refresh. False positive: a Vercel cron outage that also stops
`sync_runs` (cross-check C3 and the cron-watchdog).

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today)
SELECT 'odds-api' AS feed,
       count(*) FILTER (WHERE (o.fetched_at AT TIME ZONE 'America/New_York')::date = d.today - 1) AS yesterday_rows,
       count(*) FILTER (WHERE (o.fetched_at AT TIME ZONE 'America/New_York')::date = d.today) AS today_rows
  FROM odds_markets o
  CROSS JOIN d
 WHERE o.fetched_at >= now() - interval '3 days'
HAVING extract(hour FROM (now() AT TIME ZONE 'America/New_York')) >= 3
   AND count(*) FILTER (WHERE (o.fetched_at AT TIME ZONE 'America/New_York')::date = d.today - 1) > 0
   AND count(*) FILTER (WHERE (o.fetched_at AT TIME ZONE 'America/New_York')::date = d.today) = 0;
```

## P7 - API-Sports EPL

```sql
WITH d AS (SELECT (now() AT TIME ZONE 'America/New_York')::date AS today)
SELECT 'api-sports-epl' AS feed,
       count(*) FILTER (WHERE (m.data_provider_synced_at AT TIME ZONE 'America/New_York')::date = d.today - 1) AS yesterday_rows,
       count(*) FILTER (WHERE (m.data_provider_synced_at AT TIME ZONE 'America/New_York')::date = d.today) AS today_rows,
       count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour') AS due_today
  FROM matches m
  JOIN leagues l ON l.id = m.league_id
  CROSS JOIN d
 WHERE l.slug = 'epl' AND m.external_ids ? 'api_sports'
HAVING count(*) FILTER (WHERE (m.data_provider_synced_at AT TIME ZONE 'America/New_York')::date = d.today - 1) > 0
   AND count(*) FILTER (WHERE (m.data_provider_synced_at AT TIME ZONE 'America/New_York')::date = d.today) = 0
   AND count(*) FILTER (WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = d.today
                          AND m.kickoff_at <= now() - interval '1 hour') > 0;
```

(API-Sports also feeds NFL fixtures under `apisports_game_id`; that key is not
the EPL feed and is excluded by the `api_sports` / `epl` filter.)

## P8 - FFC ADP

`adp-snapshot` writes `sim_player_pool` once a day at 11:00 UTC; `snapshot_date`
is the UTC calendar day (app/api/cron/adp-snapshot/route.js), and the route has
no season gate, so this feed is always "in season". Evaluated only from 12:00 UTC
(the run takes about 70 s) so it cannot fire in the morning before the cron.

```sql
SELECT 'ffc-adp' AS feed,
       count(*) FILTER (WHERE snapshot_date = (now() AT TIME ZONE 'UTC')::date - 1) AS yesterday_rows,
       count(*) FILTER (WHERE snapshot_date = (now() AT TIME ZONE 'UTC')::date) AS today_rows
  FROM sim_player_pool
 WHERE snapshot_date >= (now() AT TIME ZONE 'UTC')::date - 1
HAVING extract(hour FROM (now() AT TIME ZONE 'UTC')) >= 12
   AND count(*) FILTER (WHERE snapshot_date = (now() AT TIME ZONE 'UTC')::date - 1) > 0
   AND count(*) FILTER (WHERE snapshot_date = (now() AT TIME ZONE 'UTC')::date) = 0;
```

---

# cost

These are API reads, not SQL (C3 has an optional SQL cross-check). Each rule
fires when the projected month-end usage exceeds the allowance:

    projected = used_so_far / elapsed_fraction_of_month
    fire when projected > allowance
    (elapsed fraction = (now - month_start) / (month_end - month_start);
     require elapsed >= 3 days before judging, projections swing early in the month)

Severity: `warn` at projected > 100% of allowance, `page` at projected > 120%
or already used >= 90%. Allowances are read from the plan/limits endpoint where
one exists, otherwise from the `cost-watch` config file (do not hard-code them
in the script).

## C1 - Vercel usage

- Source: Vercel REST API, billing charges for the team:
  `GET https://api.vercel.com/v1/billing/charges?teamId=<team>&from=<month start ISO>&to=<now ISO>`
  (usage-based charge lines in the FOCUS cost format: service name, consumed
  quantity, billed cost). Auth: `Authorization: Bearer $VERCEL_TOKEN`. Sum by
  service (Function Invocations, Fast Data Transfer, Edge Requests, Fluid/Active
  CPU, etc.) and compare each service's month-to-date quantity with the plan's
  included allowance. The same data is available through the Vercel MCP tool
  `list_billing_charges`.
- Rule: per service, month-to-date quantity projected to month end > the
  plan's included amount (or total billed overage projected > a configured
  dollar budget).
- Caveat: the exact response shape and included-quantity numbers were not
  verifiable from this repo (no Vercel usage client exists in lib/); the script
  author must check the response against the live API before trusting field
  names.

## C2 - Neon compute

- Source: Neon API consumption history:
  `GET https://console.neon.tech/api/v2/consumption_history/projects?from=<month start>&to=<now>&granularity=daily&project_ids=<id>`
  (account-level: `/consumption_history/account`). Auth:
  `Authorization: Bearer $NEON_API_KEY`. Fields per period include
  `compute_time_seconds` and `active_time_seconds` plus storage and transfer
  figures.
- Rule: month-to-date compute hours (compute_time_seconds / 3600) projected to
  month end > the plan's included compute hours (configured). The CI Neon branch
  "ci" shares the project's allowance, so it is part of the same total.
- Caveat: consumption endpoints need a paid Neon plan; verify access and the
  field names with one manual call first.

## C3 - Odds API credits vs month pace

- Source (primary): the vendor's response headers. A free `GET
  https://api.the-odds-api.com/v4/sports?apiKey=$ODDS_API_KEY` costs 0 credits
  and returns `x-requests-used` and `x-requests-remaining` (also
  `x-requests-last`). This is exactly what the app does: `fetchUsage()` in
  lib/theOddsApi.js (called by app/api/cron/odds-budget and
  lib/gridiron/oddsBudgetRun.js) and `planOf()` in lib/gridiron/oddsBudget.js.
  Allowance = used + remaining (100,000 on 1 Oct 2026); never typed. The
  vendor window is the UTC calendar month.
- Rule: `projected = used / elapsed_fraction`, fire when `projected > used +
  remaining`. The app's own alarm pushes once at 50 / 70 / 90 % of plan
  (THRESHOLDS in lib/gridiron/oddsBudget.js); this rule is the pace
  projection, which fires earlier than a threshold when the burn is too fast.
- SQL cross-check (read-only) from the latest `budget` snapshot any odds run
  stored this month, for when the vendor call is unavailable. Returns a row
  only when the projection exceeds the plan:

```sql
WITH last AS (
  SELECT (summary->'budget'->>'requests_used')::numeric      AS used,
         (summary->'budget'->>'requests_remaining')::numeric AS remaining,
         started_at
    FROM sync_runs
   WHERE summary->'budget'->>'requests_used' IS NOT NULL
     AND ok = true
     AND started_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
   ORDER BY started_at DESC
   LIMIT 1
), m AS (
  SELECT last.*,
         extract(epoch FROM (last.started_at - (date_trunc('month', last.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')))
           / extract(epoch FROM ((date_trunc('month', last.started_at AT TIME ZONE 'UTC') + interval '1 month') AT TIME ZONE 'UTC'
                                  - (date_trunc('month', last.started_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'))) AS elapsed
    FROM last
)
SELECT used, remaining, used + remaining AS plan, started_at AS read_at,
       round(elapsed::numeric, 3) AS elapsed_fraction,
       round(used / elapsed) AS projected_month_end
  FROM m
 WHERE elapsed >= 0.1
   AND used / elapsed > used + remaining;
```

  Confirm with the live headers (one free call). False positives: spend can be
  front-loaded (futures/props), so the projection over-reads early in the month
  (hence the 0.1 elapsed-fraction minimum); a plan change mid-month changes
  `used + remaining`.

---

# Running them

SQL rules run read-only against PROD with `PROD_DATABASE_URL` from the
environment (never inline, never on a command line). Each query is a plain
SELECT; run it inside a read-only transaction or role as belt and braces, and
prove the guard with a failed write probe through the same driver (CLAUDE.md:
"A read-only guard is proven only by a failed write probe"). Rows returned =
rule fired. Evaluate each rule at most every 15 minutes; G1 is the only one that
benefits from a tighter cadence during live slates. Append one line per crew
action to docs/CREW-LOG.md.
