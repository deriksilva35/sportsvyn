/**
 * lib/gridiron/propsIngest.js — player props ingest (The Odds API, per-event).
 *
 * THESE ROWS ARE market_scope='match', NOT 'player_prop', AND THAT IS FORCED.
 * The table's composite CHECK reads:
 *   (market_scope='player_prop' AND player_id IS NOT NULL AND (match_id IS NOT
 *    NULL OR league_id IS NOT NULL))
 * so the player_prop scope cannot hold a row whose player we have not resolved
 * — and resolving the vendor's name against 29,721 players is its own relay by
 * ruling, deliberately not a rider on this one. The World Cup's anytime_scorer
 * rows already solved this exact problem the same way: market_scope='match',
 * player_id NULL, the player's name verbatim in selection_label. Following the
 * precedent costs no migration and keeps the deferral honest. When name
 * matching ships, these rows can be backfilled into 'player_prop' with the ids
 * filled in, which is a migration that ADDS knowledge rather than one taken on
 * spec today.
 *
 * They stay separable from the board by fetcher_version ('odds-api-v4-props'),
 * which every /market read already filters on.
 *
 * SCOPE IS STRUCTURAL, NOT A SETTING. Props live on the per-event endpoint, so
 * they cost one call per GAME rather than one per league. Polling every priced
 * game would be 381 credits a tick (CFB week 1 alone is 99 games); the scoped
 * set is 108. The scope is therefore expressed as a JOIN that cannot return an
 * out-of-scope game, not as a limit applied after the fact — a cap you could
 * forget to apply is not a budget.
 *
 *   NFL  the current game week
 *   CFB  the Pick'em board ONLY. Full-week CFB is a later relay and must be
 *        justified by movement data, not assumed.
 *   EPL  the current matchweek
 *
 * TWO DE-VIG TREATMENTS, AND THE FORK IS MATHEMATICAL:
 *
 *   Over/Under markets are genuine two-way propositions on one number. The
 *   book prices both sides, they are mutually exclusive and exhaustive, so
 *   devig2Way normalises them to 100.000 exactly.
 *
 *   ANYTIME markets are NOT A FIELD. Several players score a touchdown in one
 *   game — the outcomes are not mutually exclusive, and the vendor prices only
 *   "Yes". Normalising them to 100% would assert that exactly one player
 *   scores, which is false, and would invent probabilities no book offered.
 *   The World Cup's anytime_scorer rows are the precedent and they agree:
 *   their fields sum to 663–849%, stored raw and single-sided as-offered.
 *   That is the correct treatment, and it is preserved here deliberately.
 *
 * PLAYER NAMES ARE STORED VERBATIM. The vendor's `description` is the player;
 * mapping it onto our 29,721-row players table is name-matching across two
 * providers and is its own relay, not a rider on this one.
 */

import {
  fetchSportEvents, fetchEventProps, SPORT_KEYS, PROP_MARKETS, ANYTIME_MARKETS,
} from '../theOddsApi.js';
import { devig2Way, median, decimalToAmerican } from '../odds.js';
import { normalizeName } from './nameMatch.js';
import { resolveTeamId } from './oddsJoin.js';

const FETCHER_VERSION = 'odds-api-v4-props';
const SCOPE = 'match'; // see the header - 'player_prop' requires a resolved player_id

/**
 * THE SCOPE QUERY. One statement, and it is the budget.
 *
 * A game reaches this list only by being in its league's current game week
 * (nfl, epl) or on the Pick'em board (cfb). There is no branch that widens it
 * and no limit that narrows it, so the credit projection is a property of the
 * data rather than of the caller remembering to pass an argument.
 */
export async function propsScope(sql, { leagueSlug }) {
  if (leagueSlug === 'cfb') {
    return sql`
      SELECT DISTINCT m.id, m.slug, m.kickoff_at, m.home_team_id, m.away_team_id,
             h.name AS home_name, a.name AS away_name
        FROM contests c
        CROSS JOIN LATERAL jsonb_array_elements(c.board) g
        JOIN matches m ON m.id = (g->>'match_id')::int
        JOIN leagues l ON l.id = m.league_id
        LEFT JOIN teams h ON h.id = m.home_team_id
        LEFT JOIN teams a ON a.id = m.away_team_id
       WHERE l.slug = 'cfb'
         AND c.board IS NOT NULL AND jsonb_typeof(c.board) = 'array'
         AND m.status = 'scheduled' AND m.kickoff_at > now()
       ORDER BY m.kickoff_at`;
  }
  // The current game week: the week of the next scheduled kickoff, and every
  // game sharing it. Same season_phase, so a preseason week never drags a
  // regular-season game in behind it.
  //
  // COMPETITIVE PHASES ONLY, AND NULL IS NOT PRESEASON. The vendor does not
  // price player props for NFL preseason, so a PRE week scoped 13 games, made
  // zero calls and tripped the zero-match guard four times a day for a
  // condition that was never wrong - the alarm was right and the question was
  // bad. Scoping PRE out makes nfl-props quiet BY CONSTRUCTION until REG W1,
  // rather than by loosening the guard.
  //
  // IS DISTINCT FROM, not `<> 'PRE'`. EPL's season_phase is NULL on all 370
  // scheduled matches, and `season_phase <> 'PRE'` is NULL for NULL - it would
  // have excluded every EPL match exactly as the odds join's `= ANY(...)` did.
  // NULL means "this league has no phases", which is not preseason.
  return sql`
    WITH nxt AS (
      SELECT m.week, m.season_phase, m.season_year
        FROM matches m JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = ${leagueSlug} AND m.status = 'scheduled' AND m.kickoff_at > now()
         AND m.season_phase IS DISTINCT FROM 'PRE'
       ORDER BY m.kickoff_at LIMIT 1
    )
    SELECT m.id, m.slug, m.kickoff_at, m.home_team_id, m.away_team_id,
           h.name AS home_name, a.name AS away_name
      FROM matches m
      JOIN leagues l ON l.id = m.league_id
      JOIN nxt n ON m.week IS NOT DISTINCT FROM n.week
                AND m.season_phase IS NOT DISTINCT FROM n.season_phase
                AND m.season_year IS NOT DISTINCT FROM n.season_year
      LEFT JOIN teams h ON h.id = m.home_team_id
      LEFT JOIN teams a ON a.id = m.away_team_id
     WHERE l.slug = ${leagueSlug} AND m.status = 'scheduled' AND m.kickoff_at > now()
       AND m.season_phase IS DISTINCT FROM 'PRE'
     ORDER BY m.kickoff_at`;
}

/**
 * Match a vendor event to one of our scoped games.
 *
 * THIS USED TO COMPARE NORMALISED NAMES DIRECTLY AND IT MATCHED ALMOST
 * NOTHING. The first live run scoped 15 NFL and 8 CFB games and made ZERO
 * calls, because the book prints "North Carolina Tar Heels" where we store
 * "North Carolina", and "TCU Horned Frogs" where we store "TCU". The
 * sport-level ingest had solved this long ago in resolveTeamId - exact match,
 * then a curated override, then the longest whole-word prefix - and this
 * function reimplemented the naive half of it. Reusing the resolver is the
 * fix; a second, weaker matcher for the same two providers was the defect.
 */
function buildResolver(teamRows) {
  const byNorm = new Map();
  for (const t of teamRows) byNorm.set(normalizeName(t.name), t.id);
  const normsDesc = [...byNorm.keys()].sort((a, b) => b.length - a.length);
  return { byNorm, normsDesc };
}

function matchEvent(events, row, sport, resolver) {
  for (const e of events) {
    const h = resolveTeamId(sport, e.home_team ?? '', resolver.byNorm, resolver.normsDesc);
    const a = resolveTeamId(sport, e.away_team ?? '', resolver.byNorm, resolver.normsDesc);
    if (h != null && a != null && h === row.home_team_id && a === row.away_team_id) return e;
  }
  return null;
}

// Per-book prices for one player's Over/Under on one market, aligned so index i
// is the same book on both sides. A book contributes only if it prices both.
function collectOverUnder(bookmakers, marketKey) {
  const byPlayer = new Map();
  for (const bk of bookmakers ?? []) {
    const mkt = (bk.markets ?? []).find((m) => m.key === marketKey);
    if (!mkt) continue;
    const seen = new Map();
    for (const o of mkt.outcomes ?? []) {
      const who = o.description;
      if (!who || !(Number(o.price) > 0)) continue;
      if (!seen.has(who)) seen.set(who, {});
      seen.get(who)[o.name] = { price: Number(o.price), point: o.point };
    }
    for (const [who, sides] of seen) {
      if (!byPlayer.has(who)) byPlayer.set(who, { over: [], under: [], points: [], books: [], paired: false });
      const e = byPlayer.get(who);
      // A BOOK CONTRIBUTES TO THE DE-VIG ONLY IF IT PRICES BOTH SIDES - the
      // overround is a property of the PAIR, and normalising one book's Over
      // against another book's Under would remove a margin neither of them
      // charged. When no book prices both, the market is single-sided and
      // falls through to as-offered below.
      if (sides.Over && sides.Under) {
        e.paired = true;
        e.over.push(sides.Over.price);
        e.under.push(sides.Under.price);
        if (sides.Over.point != null) e.points.push(Number(sides.Over.point));
        e.books.push(bk.title);
        continue;
      }
      const one = sides.Over ?? sides.Under;
      if (!one) continue;
      e.singleName = sides.Over ? 'Over' : 'Under';
      (e.single ??= []).push(one.price);
      if (one.point != null) e.points.push(Number(one.point));
      e.books.push(bk.title);
    }
  }
  return byPlayer;
}

// Anytime markets: one price per player, "Yes" only, median across books.
function collectAnytime(bookmakers, marketKey) {
  const byPlayer = new Map();
  for (const bk of bookmakers ?? []) {
    const mkt = (bk.markets ?? []).find((m) => m.key === marketKey);
    if (!mkt) continue;
    for (const o of mkt.outcomes ?? []) {
      const who = o.description;
      if (!who || o.name !== 'Yes' || !(Number(o.price) > 0)) continue;
      if (!byPlayer.has(who)) byPlayer.set(who, { prices: [], books: [] });
      byPlayer.get(who).prices.push(Number(o.price));
      byPlayer.get(who).books.push(bk.title);
    }
  }
  return byPlayer;
}

const decToImplied = (d) => (Number(d) > 0 ? (1 / Number(d)) * 100 : null);

async function upsertProp(sql, {
  matchId, marketType, selectionLabel, selectionValue, decimalOdds, impliedPct, books,
}) {
  const american = decimalToAmerican(decimalOdds);
  const prior = (await sql`
    SELECT implied_probability, american_odds, fetched_at
      FROM odds_markets
     WHERE match_id = ${matchId} AND market_scope = ${SCOPE}
       AND market_type = ${marketType} AND selection_label = ${selectionLabel}
       AND fetcher_version = ${FETCHER_VERSION} AND is_current = true
     LIMIT 1`)[0] ?? null;

  await sql`
    UPDATE odds_markets SET is_current = false
     WHERE match_id = ${matchId} AND market_scope = ${SCOPE}
       AND market_type = ${marketType} AND selection_label = ${selectionLabel}
       AND fetcher_version = ${FETCHER_VERSION} AND is_current = true`;

  await sql`
    INSERT INTO odds_markets (
      market_scope, market_type, match_id, selection_label, selection_value,
      american_odds, implied_probability, decimal_odds, source_books, num_books,
      consensus_method, previous_american_odds, previous_implied_prob,
      previous_snapshot_at, movement_24h_prob, movement_24h_odds,
      is_current, fetched_at, fetcher_version
    ) VALUES (
      ${SCOPE}, ${marketType}, ${matchId}, ${selectionLabel}, ${selectionValue},
      ${american}, ${impliedPct}, ${decimalOdds}, ${books}, ${books.length},
      'median', ${prior?.american_odds ?? null}, ${prior?.implied_probability ?? null},
      ${prior?.fetched_at ?? null},
      ${prior?.implied_probability == null ? null : impliedPct - Number(prior.implied_probability)},
      ${prior?.american_odds == null ? null : american - Number(prior.american_odds)},
      true, now(), ${FETCHER_VERSION}
    )`;
  return 1;
}

/**
 * One league's props tick.
 *
 * UNMAPPED MARKET KEYS ARE COUNTED, NOT DROPPED. If the vendor starts pricing
 * a market we do not handle, it appears in the run summary as unmappedMarkets
 * rather than vanishing — a silently ignored new market is a feature we never
 * learn we could have had.
 */
export async function ingestSportProps(sql, { sport, leagueSlug }) {
  const sportKey = SPORT_KEYS[sport];
  const markets = PROP_MARKETS[sport];
  if (!sportKey || !markets) throw new Error(`ingestSportProps: unknown sport '${sport}'`);

  const scope = await propsScope(sql, { leagueSlug });
  // /events is free, so scoping never costs a credit.
  const { events } = await fetchSportEvents(sportKey);
  const teamRows = await sql`
    SELECT t.id, t.name FROM teams t
      JOIN leagues l ON l.id = t.league_id
     WHERE l.slug = ${leagueSlug}`;
  const resolver = buildResolver(teamRows);

  let upserted = 0;
  let called = 0;
  let creditsLast = 0;
  let budget = null;
  const unmatched = [];
  const unmappedMarkets = new Set();

  for (const row of scope) {
    const ev = matchEvent(events, row, sport, resolver);
    if (!ev) { unmatched.push(`${row.away_name} @ ${row.home_name}`); continue; }
    const res = await fetchEventProps(sportKey, ev.id, markets);
    called += 1;
    budget = res.budget ?? budget;
    creditsLast += Number(res.budget?.requests_last ?? 0);
    const payload = res.events ?? res.data ?? res;
    const bookmakers = payload?.bookmakers ?? [];

    for (const bk of bookmakers) {
      for (const m of bk.markets ?? []) {
        if (!markets.includes(m.key)) unmappedMarkets.add(m.key);
      }
    }

    for (const key of markets) {
      if (ANYTIME_MARKETS.has(key)) {
        // RAW AND SINGLE-SIDED. See the header: this field is not exclusive and
        // must not be normalised.
        for (const [who, e] of collectAnytime(bookmakers, key)) {
          const dec = median(e.prices);
          upserted += await upsertProp(sql, {
            matchId: row.id, marketType: key, selectionLabel: who, selectionValue: null,
            decimalOdds: dec, impliedPct: decToImplied(dec), books: [...new Set(e.books)],
          });
        }
        continue;
      }
      for (const [who, e] of collectOverUnder(bookmakers, key)) {
        const line = e.points.length ? median(e.points) : null;
        const books = [...new Set(e.books)];
        // SINGLE-SIDED O/U IS THE ANYTIME TREATMENT, not a dropped row.
        // player_shots_on_target is priced Over-only, so requiring both sides
        // stored NOTHING for it and the market's credits bought nothing. There
        // is no pair, so there is no overround to remove: it is as-offered,
        // exactly like an anytime price, and it carries no implied %.
        //
        // THE FORK IS ON THE DATA, NOT ON THE MARKET KEY. The day the vendor
        // starts pricing both sides, `paired` goes true and the devig2Way path
        // below takes over with no code change.
        if (!e.paired) {
          if (!e.single?.length) continue;
          const dec = median(e.single);
          upserted += await upsertProp(sql, {
            matchId: row.id, marketType: key,
            selectionLabel: `${who} ${e.singleName}`,
            selectionValue: line == null ? null : `${line}`,
            decimalOdds: dec, impliedPct: null, books,
          });
          continue;
        }
        // Genuine two-way: normalise to 100.000.
        const dv = devig2Way({ a: median(e.over), b: median(e.under) });
        if (!dv) continue;
        upserted += await upsertProp(sql, {
          matchId: row.id, marketType: key, selectionLabel: `${who} Over`,
          selectionValue: line == null ? null : `${line}`,
          decimalOdds: median(e.over), impliedPct: dv.a_pct, books,
        });
        upserted += await upsertProp(sql, {
          matchId: row.id, marketType: key, selectionLabel: `${who} Under`,
          selectionValue: line == null ? null : `${line}`,
          decimalOdds: median(e.under), impliedPct: dv.b_pct, books,
        });
      }
    }
  }

  return {
    scoped: scope.length,
    called,
    creditsLast,
    upserted,
    unmatched: unmatched.length,
    unmatchedSample: unmatched.slice(0, 5),
    unmappedMarkets: [...unmappedMarkets],
    budget,
  };
}

/**
 * THE KEY GUARD. A props ingest pointed at the wrong API key drains it
 * silently: every call returns 200 until the moment it does not, and the only
 * warning is a header nobody read.
 *
 * IT WATCHES THE HEADER, NOT THE CONFIG. Checking an env var proves which
 * string we sent, not which plan answered — and the failure being guarded
 * against is precisely a key that is not the one we think it is. The vendor's
 * own requests_remaining is the only witness that cannot be wrong.
 */
/**
 * A SYNC RUN'S SUCCESS IS WHAT IT WROTE.
 *
 * Both of this subsystem's real failures wore ok=true. The first EPL odds tick
 * fetched 20 events, matched 0 and reported success; the first props run
 * scoped 15 NFL and 8 CFB games, called nothing and reported success. Neither
 * threw, so neither alerted, and both would have read as "the vendor has
 * nothing" indefinitely.
 *
 * Fetching rows and storing none is not a quiet day - it is a broken join,
 * every time. This is the predicate, and it is deliberately blunt: events > 0
 * with matched = 0 is never a legitimate state.
 */
export function zeroMatchAlert({ events = 0, matched = 0, source }) {
  if (!(events > 0) || matched > 0) return null;
  return `${source}: fetched ${events} vendor events and matched NONE. `
    + 'A run that writes nothing is a failed run, not a quiet one - '
    + 'check the team-name resolver and the candidate query.';
}

export const PROPS_MIN_REMAINING = 10_000;

export function keyAlert(budget) {
  if (!budget) return 'props run reported no vendor budget headers at all';
  // Number(null) is 0, not NaN - so an ABSENT header would sail past a bare
  // isFinite check and be reported as a 0-credit key. Both cases alert, but
  // they need different fixes (a missing header is a vendor/plumbing problem,
  // a small plan is a key mixup), so they must not wear each other's message.
  const rawRemaining = budget.requests_remaining;
  if (rawRemaining == null || rawRemaining === '') return 'props run reported an unreadable requests_remaining';
  const remaining = Number(rawRemaining);
  const used = Number(budget.requests_used);
  if (!Number.isFinite(remaining)) return 'props run reported an unreadable requests_remaining';
  // The plan size the vendor itself implies. A 500-credit key can never look
  // like the 100K plan, whatever the config says it is.
  const plan = remaining + (Number.isFinite(used) ? used : 0);
  if (plan < 50_000) {
    return `props ran against a ${plan}-credit key, not the 100K plan `
      + `(remaining ${remaining}). Props must never run on the small key.`;
  }
  if (remaining < PROPS_MIN_REMAINING) {
    return `props credit floor breached: ${remaining} remaining, floor ${PROPS_MIN_REMAINING}`;
  }
  return null;
}
