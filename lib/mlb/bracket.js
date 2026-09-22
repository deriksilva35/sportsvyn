// lib/mlb/bracket.js - the twelve, and the eleven series between them.
//
// THE SHAPE IS A RULE OF THE COMPETITION, not a thing to read off the games:
//
//   Six clubs a league. 1 and 2 have a BYE.
//   Wild Card    3 v 6   and   4 v 5        best of 3
//   Division     1 v winner(4/5)            best of 5
//                2 v winner(3/6)
//   Championship the two Division winners   best of 7
//   World Series the two leagues' champions best of 7
//
// Verified against 2025 rather than remembered: AL 1 TOR played NYY (the 4/5
// winner) and AL 2 SEA played DET (the 3/6 winner); NL 1 MIL played CHC and NL
// 2 PHI played LAD. The pairing is 1-with-WC2 and 2-with-WC1, and it is easy
// to get backwards.
//
// A SLOT IS FILLED FROM WHICHEVER SOURCE KNOWS. In order:
//   1. the SERIES, once games for it exist - it carries the real record
//   2. the SEEDS, once standings have them - "3 CLE v 6 DET", no games yet
//   3. a decided earlier series, which advances its winner into the next slot
//   4. nothing, and the slot says so
//
// NO WORLD CUP HELPERS. The group/knockout code in this tree builds a
// sixteen-slot single-elimination tree from stage names that mean something
// else ('final' there is the World Cup final), pairs by group letter, and has
// no concept of a bye or of a series. Sharing it would mean teaching it four
// baseball-only rules to save one loop.
//
// PURE. buildBracket() takes what it is given; getBracket() is the query.

import { sql } from '../db.js';
import { seriesFor, seriesKey } from './series.js';
import { STAGE_LABEL, BEST_OF } from './postseason.js';

export const LEAGUES = Object.freeze(['American', 'National']);
export const LEAGUE_LABEL = Object.freeze({ American: 'American League', National: 'National League' });

/** The wild-card pairings, and which one each bye seed inherits. */
const WC_PAIRS = Object.freeze([{ slot: 'wc1', high: 3, low: 6 }, { slot: 'wc2', high: 4, low: 5 }]);
const DIVISION_PAIRS = Object.freeze([{ slot: 'ds1', bye: 1, from: 'wc2' }, { slot: 'ds2', bye: 2, from: 'wc1' }]);

/** What the empty slots say, and why they say a day. */
export const TBD = 'TBD · set Sunday';

/**
 * @param series  shapeSeries() output for one season
 * @param seeds   [{ teamId, abbreviation, name, league, seed }]
 */
export function buildBracket({ series = [], seeds = [] } = {}) {
  const seedByLeague = new Map(LEAGUES.map((l) => [l, new Map()]));
  for (const s of seeds) {
    if (!seedByLeague.has(s.league)) continue;
    if (s.seed >= 1 && s.seed <= 6) seedByLeague.get(s.league).set(Number(s.seed), s);
  }
  const byKey = new Map(series.map((s) => [s.key, s]));

  const columns = { wild_card: [], division: [], championship: [], world_series: [] };
  const wonBy = new Map();   // slot id -> the club that advanced out of it

  for (const league of LEAGUES) {
    const seedOf = seedByLeague.get(league);

    for (const p of WC_PAIRS) {
      const slot = fill({
        id: `${league}:${p.slot}`, stage: 'wild_card', league, byKey,
        sides: [side(seedOf.get(p.high), p.high), side(seedOf.get(p.low), p.low)],
      });
      if (slot.winner) wonBy.set(`${league}:${p.slot}`, slot.winner);
      columns.wild_card.push(slot);
    }

    for (const p of DIVISION_PAIRS) {
      const bye = side(seedOf.get(p.bye), p.bye, true);
      // THE OPPONENT IS A RESULT, NOT A SEED. Until the wild card is decided
      // it is named by where it comes from - "Winner 4/5" - which is a true
      // sentence, unlike any club's name would be.
      const from = WC_PAIRS.find((w) => w.slot === p.from);
      const advanced = wonBy.get(`${league}:${p.from}`)
        ?? { placeholder: `Winner ${from.high}/${from.low}` };
      const slot = fill({
        id: `${league}:${p.slot}`, stage: 'division', league, byKey,
        sides: [bye, advanced],
      });
      // THE BYE DOES NOT TRAVEL. It is a fact about the Division round - this
      // club did not have to play a wild card - and carrying it forward put
      // "(bye)" next to Toronto in the World Series, which is nonsense by the
      // time they have played eleven postseason games.
      if (slot.winner) wonBy.set(`${league}:${p.slot}`, { ...slot.winner, bye: false });
      columns.division.push(slot);
    }

    const lcs = fill({
      id: `${league}:lcs`, stage: 'championship', league, byKey,
      sides: [
        wonBy.get(`${league}:ds1`) ?? { placeholder: 'Division winner' },
        wonBy.get(`${league}:ds2`) ?? { placeholder: 'Division winner' },
      ],
    });
    if (lcs.winner) wonBy.set(`${league}:lcs`, { ...lcs.winner, bye: false });
    columns.championship.push(lcs);
  }

  columns.world_series.push(fill({
    id: 'world_series', stage: 'world_series', league: null, byKey,
    sides: [
      wonBy.get('American:lcs') ?? { placeholder: 'AL champion' },
      wonBy.get('National:lcs') ?? { placeholder: 'NL champion' },
    ],
  }));

  const champion = columns.world_series[0].winner ?? null;
  return {
    columns,
    champion,
    // HAS THE BRACKET ACTUALLY BEEN SET? A seed is a live, provisional number
    // all season - it moves on a Tuesday night in August and it will move
    // again - so twelve seeds is NOT the same fact as twelve clubs being in.
    // The bracket is set when POSTSEASON GAMES EXIST, which is the only
    // evidence that anybody has stopped playing for them.
    set: series.length > 0,
    // THE TWELVE, for the page's own head count. Seeds we hold, not clubs we
    // hope for: before the standings land this is empty and the page says so.
    seeded: LEAGUES.flatMap((l) => [...seedByLeague.get(l).values()]).length,
    liveCount: Object.values(columns).flat().filter((s) => s.status === 'live').length,
  };
}

/** One side of a slot, from a seed or from nothing. */
function side(seed, number, bye = false) {
  if (!seed) return { placeholder: null, seed: number, bye };
  return {
    teamId: seed.teamId, abbreviation: seed.abbreviation, name: seed.name,
    colors: seed.colors ?? null, seed: number, bye,
  };
}

/**
 * Attach the real series to a slot when one exists, and let it overrule the
 * seeds: the games are what happened, the seeds are only what was expected.
 */
function fill({ id, stage, league, sides, byKey }) {
  const [a, b] = sides;
  const key = (a?.abbreviation && b?.abbreviation)
    ? seriesKey(stage, a.abbreviation, b.abbreviation) : null;
  const s = key ? byKey.get(key) : null;

  const teams = s
    // THE SERIES' OWN ORDER WINS - game 1's host first - and the seed numbers
    // ride along from whichever side matches.
    ? s.teams.map((t) => ({
      teamId: t.id, abbreviation: t.abbreviation, name: t.name, wins: t.wins,
      colors: t.colors ?? null,
      seed: [a, b].find((x) => x?.teamId === t.id)?.seed ?? null,
      bye: [a, b].find((x) => x?.teamId === t.id)?.bye ?? false,
      winner: s.winner === t.id,
    }))
    : [a, b].map((x) => ({
      teamId: x?.teamId ?? null, abbreviation: x?.abbreviation ?? null,
      name: x?.name ?? null, colors: x?.colors ?? null, wins: null, seed: x?.seed ?? null,
      bye: x?.bye ?? false, winner: false, placeholder: x?.placeholder ?? null,
    }));

  return {
    id, stage, league,
    label: STAGE_LABEL[stage],
    bestOf: BEST_OF[stage],
    key: s?.key ?? key,
    // SCHEDULED IS NOT THE SAME AS UNSET. A slot with both clubs known and no
    // games yet is 'scheduled'; a slot still waiting on an earlier result is
    // 'empty', and only an empty one says TBD.
    status: s?.status ?? (teams.every((t) => t.teamId != null) ? 'scheduled' : 'empty'),
    record: s?.record ?? null,
    nextGame: s?.nextGame ?? null,
    games: s?.games ?? [],
    teams,
    winner: s?.winner ? teams.find((t) => t.teamId === s.winner) ?? null : null,
  };
}

/** The bracket for a season: the series we hold and the seeds we hold. */
export async function getBracket(season) {
  const [series, seedRows] = await Promise.all([
    seriesFor(null, season),
    sql`
      SELECT tr.team_id, tr.playoff_seed AS seed, tr.conference AS league,
             t.abbreviation, COALESCE(t.short_name, t.name) AS name,
             t.color_primary AS c1, t.color_secondary AS c2
        FROM team_records tr
        JOIN leagues l ON l.id = tr.league_id AND l.slug = 'mlb'
        JOIN teams t ON t.id = tr.team_id
       WHERE tr.season = ${season} AND tr.season_type = 'regular'
         AND tr.playoff_seed BETWEEN 1 AND 6
       ORDER BY tr.conference, tr.playoff_seed`.catch(() => []),
  ]);
  const seeds = seedRows.map((r) => ({
    teamId: r.team_id, seed: Number(r.seed), league: r.league,
    abbreviation: r.abbreviation, name: r.name,
    colors: r.c1 && r.c2 ? { primary: r.c1, secondary: r.c2 } : null,
  }));
  return { season, ...buildBracket({ series, seeds }) };
}
