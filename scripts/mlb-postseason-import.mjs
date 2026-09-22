// scripts/mlb-postseason-import.mjs - the bracket into matches, with its rounds.
// DRY RUN BY DEFAULT.
//
//   set -a && . ./.env.local && set +a
//   node scripts/mlb-postseason-import.mjs --prod 2026            # dry run
//   node scripts/mlb-postseason-import.mjs --prod --apply 2026    # Monday
//   node scripts/mlb-postseason-import.mjs --apply --backtrack 2025   # DEV fixture
//
// ON --apply IT ALSO OPENS THE ROUND'S PICK'EM BOARD, which is the relay's
// own instruction: "Round 1 board created by the Monday postseason import."
// It is the right owner because a round board can only be built once its
// series exist, and this is the job that makes them exist - a separate cron
// would be a second thing to remember at 9am on the one Monday it matters.
// ensureSeriesBoard refuses a round that is not whole, so running this on the
// Tuesday cannot open a half-formed Division board.
//
// It runs again on every day of October as the bracket fills in, so it lives
// here rather than in a scratchpad.
//
// ─────────────────────────────────────────────────────────────────────────
// THE PROVIDER WE IMPORT GAMES FROM DOES NOT CARRY THE ROUND.
// ─────────────────────────────────────────────────────────────────────────
// Measured before a line of this was written: the 2025 postseason comes back
// as 47 rows whose only round-ish field is season_type: "postseason". No
// round, no series number, no game-in-series. So the games come from one
// provider and the ROUND comes from somewhere else, and this script has two
// somewheres:
//
//   --statsapi (DEFAULT, and the Monday path). The second provider's own
//   gameType - F / D / L / W - asked per DAY, which is the only way that feed
//   answers. A per-game fact from the competition's own schedule, no
//   inference. Games it cannot place are REFUSED, named, and left unstaged.
//
//   --backtrack (a FINISHED bracket only). Derives the rounds from the shape
//   of the tournament: the World Series is the one series whose clubs come
//   from different leagues, and every other round is a walk backwards from it.
//   Exact on a completed bracket, and it REFUSES - returns nothing, stages
//   nothing - on one still being played. This is how the 2025 fixture gets its
//   rounds, because the second provider only answers for today.
//
// NEITHER SOURCE GUESSES. A game whose round cannot be established is written
// with a NULL stage and printed in the refusal list. lib/mlb/series.js scopes
// on `stage IS NOT NULL`, so such a game is absent from the bracket rather
// than grouped under a blank round - visible as a hole, never as a wrong slot.

import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { writeMlbMatches, slugsFor, gameDay } from '../lib/mlb/schedule.js';
import { stageFromGameType, stagesByBacktrack, STAGES, SERIES_IN_ROUND, STAGE_LABEL } from '../lib/mlb/postseason.js';
import { ourAbbr, statsApiEnabled } from '../lib/mlb/statsapi.js';
import { ensureSeriesBoard } from '../lib/mlb/seriesPickem.js';
import { ensureOctoberDays } from '../lib/october/create.js';

const args = process.argv.slice(2);
const PROD = args.includes('--prod');
const APPLY = args.includes('--apply');
const BACKTRACK = args.includes('--backtrack');
const seasons = args.filter((a) => !a.startsWith('--'));
if (!seasons.length) { console.error('REFUSE: name a season, e.g. 2026'); process.exit(1); }

const url = PROD ? process.env.PROD_DATABASE_URL : process.env.DATABASE_URL;
if (!url) { console.error('REFUSE: database url missing in env'); process.exit(1); }
const sql = neon(url);
console.log(`TARGET ${new URL(url).host} | FP ${crypto.createHash('sha256').update(url).digest('hex').slice(0, 12)} | ${APPLY ? 'APPLY' : 'DRY RUN'} | stage from ${BACKTRACK ? 'BACKTRACK' : 'statsapi'}`);

const [league] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
if (!league) { console.error('REFUSE: no mlb league row - run mlb-league-import first'); process.exit(1); }

const BDL = 'https://api.balldontlie.io';
async function fetchPostseason(season) {
  const key = process.env.BDL_API_KEY;
  if (!key) throw new Error('BDL_API_KEY missing in env');
  const res = await fetch(`${BDL}/mlb/v1/games?seasons[]=${season}&postseason=true&per_page=100`,
    { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`BDL ${res.status} on /mlb/v1/games`);
  return (await res.json())?.data ?? [];
}

/** statsapi's rounds for the days this slate actually spans. One call a day. */
async function stagesFromStatsApi(rows) {
  if (!statsApiEnabled(process.env)) {
    console.error('REFUSE: MLB_STATSAPI is not on, and it is where the round comes from.');
    console.error('        Use --backtrack for a finished bracket, or set the flag.');
    process.exit(1);
  }
  const days = [...new Set(rows.map(gameDay).filter(Boolean))].sort();
  const byKey = new Map();
  for (const d of days) {
    const j = await (await fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${d}&hydrate=team`)).json();
    let n = 0;
    for (const dd of j?.dates ?? []) {
      for (const g of dd?.games ?? []) {
        const stage = stageFromGameType(g?.gameType);
        if (!stage) continue;
        // THE SAME JOIN THE PROBABLES USE, and the same three-club alias:
        // AZ/ARI, CWS/CHW, ATH/OAK. Without it three clubs' games go unstaged
        // and look like games the feed had not published yet.
        const a = ourAbbr(g?.teams?.away?.team?.abbreviation);
        const h = ourAbbr(g?.teams?.home?.team?.abbreviation);
        if (!a || !h) continue;
        const key = `${g.officialDate ?? dd.date}:${a}@${h}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ gamePk: String(g.gamePk), stage, gameDate: g.gameDate ?? null });
        n += 1;
      }
    }
    console.log(`  statsapi ${d}: ${n} postseason games`);
  }
  const out = new Map(); const missed = [];
  for (const r of rows) {
    const key = `${gameDay(r)}:${up(r?.away_team?.abbreviation)}@${up(r?.home_team?.abbreviation)}`;
    const hits = byKey.get(key) ?? [];
    // A DOUBLEHEADER IS TWO GAMES UNDER ONE KEY, and in October both halves
    // are the SAME round, so unlike the probables join there is nothing to
    // disambiguate - but only when they agree. If they do not, we do not
    // understand the day and the games stay unstaged.
    const stages = [...new Set(hits.map((x) => x.stage))];
    if (stages.length === 1) out.set(String(r.id), stages[0]);
    else missed.push({ id: r.id, key, stages });
  }
  return { out, missed };
}

const up = (v) => String(v ?? '').trim().toUpperCase();

/** The backwards walk, on the whole season's rows. A finished bracket only. */
function stagesFromBacktrack(rows) {
  const by = new Map();
  for (const r of rows) {
    const pair = [up(r?.away_team?.abbreviation), up(r?.home_team?.abbreviation)].sort().join('-');
    if (!by.has(pair)) by.set(pair, []);
    by.get(pair).push(r);
  }
  const groups = [...by.entries()].map(([pair, gs]) => {
    gs.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return {
      key: pair,
      firstDate: gs[0].date,
      rows: gs,
      teams: [
        { id: up(gs[0].away_team?.abbreviation), league: gs[0].away_team?.league ?? null },
        { id: up(gs[0].home_team?.abbreviation), league: gs[0].home_team?.league ?? null },
      ],
    };
  });
  const stages = stagesByBacktrack(groups);
  if (!stages) {
    console.error('REFUSE: the backwards walk could not place this bracket.');
    console.error('        It needs exactly one cross-league series (the World Series),');
    console.error('        which means a FINISHED postseason. Use --statsapi while it is');
    console.error(`        being played. Series seen: ${groups.length}.`);
    process.exit(1);
  }
  const out = new Map();
  for (const g of groups) for (const r of g.rows) out.set(String(r.id), stages.get(g.key));
  return { out, missed: [] };
}

for (const season of seasons) {
  const rows = await fetchPostseason(season);
  console.log(`\n${season}: ${rows.length} postseason games from the schedule feed`);
  if (!rows.length) {
    console.log('  nothing to import - the bracket is not set yet.');
    continue;
  }
  const { out: stageById, missed } = BACKTRACK
    ? stagesFromBacktrack(rows)
    : await stagesFromStatsApi(rows);

  const slugs = slugsFor(rows);
  const counts = {}; const series = new Map();
  for (const r of rows) {
    const st = stageById.get(String(r.id)) ?? null;
    counts[st ?? '(unstaged)'] = (counts[st ?? '(unstaged)'] ?? 0) + 1;
    if (!st) continue;
    const k = `${st}:${[up(r.away_team?.abbreviation), up(r.home_team?.abbreviation)].sort().join('-')}`;
    series.set(k, (series.get(k) ?? 0) + 1);
  }

  console.log('\n  round                games   series');
  for (const st of STAGES) {
    const n = counts[st] ?? 0;
    const s = [...series.keys()].filter((k) => k.startsWith(`${st}:`)).length;
    const want = SERIES_IN_ROUND[st];
    const flag = s === 0 ? '' : s === want ? ' ok' : `  << expected ${want}`;
    console.log(`  ${STAGE_LABEL[st].padEnd(20)} ${String(n).padStart(5)}   ${String(s).padStart(6)}${flag}`);
  }
  if (counts['(unstaged)']) console.log(`  ${'(unstaged)'.padEnd(20)} ${String(counts['(unstaged)']).padStart(5)}`);

  console.log('\n  series');
  for (const [k, n] of [...series].sort()) console.log(`    ${k.padEnd(26)} ${n} games`);
  if (missed.length) {
    console.log('\n  COULD NOT PLACE (left unstaged, absent from the bracket):');
    for (const m of missed) console.log(`    ${m.key}  statsapi said ${JSON.stringify(m.stages)}`);
  }

  if (!APPLY) { console.log('\nDRY RUN ONLY.\n'); continue; }
  const res = await writeMlbMatches(sql, league.id, rows, stageById);
  console.log(`\nAPPLIED  inserted ${res.inserted} | updated ${res.updated} | refused ${res.refused.length}`);
  if (res.refused.length) console.log(`  refused: ${res.refused.map((r) => r.slug ?? r.id).join(', ')}`);
  void slugs;

  // OCTOBER'S DAYS. One contest per postseason date that has games - the
  // relay's item 6, and this is the right owner for the same reason the round
  // boards are: a day's card can only be built once its games exist, and this
  // is the job that makes them exist.
  console.log('\n  october days');
  for (const d of await ensureOctoberDays(Number(season))) {
    console.log(`    ${d.day}  ${d.created ? `CREATED id=${d.id} · ${d.games} games · first pitch ${String(d.firstPitch).slice(11, 16)}Z` : `${d.reason}${d.id ? ` id=${d.id}` : ''}`}`);
  }

  // THE ROUND BOARDS, in bracket order. Every round that is WHOLE gets one;
  // the rest say why not and are tried again next run, which is how the
  // Division board opens on the Thursday without anybody doing anything.
  console.log('\n  round boards');
  for (const st of STAGES) {
    const b = await ensureSeriesBoard({ stage: st, season: Number(season) });
    const how = b.created ? `CREATED id=${b.id} · ${b.series} series · max ${b.maxPoints} · locks ${b.locksAt.slice(0, 16)}`
      : b.id ? `exists id=${b.id}`
        : `${b.reason}${b.have != null ? ` (${b.have} of ${b.want})` : ''}`;
    console.log(`    ${STAGE_LABEL[st].padEnd(20)} ${how}`);
  }
}
