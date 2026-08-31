// lib/wire/wire.test.mjs — the wire's claims, tested without writing.
// Run: node --test lib/wire/wire.test.mjs
//
// WHAT IS ACTUALLY AT RISK. Every row here is a sentence the product says in
// its own voice, and two failure modes matter more than a crash: saying the
// same thing twice, and saying something that is not so. The dedupe keys guard
// the first; the headline shapers guard the second. Both are pure, so both are
// tested with rows rather than with a database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { wireKey, hourBucket } from './hash.js';
import { lineHeadline, toRows as lineRows, MOVE_THRESHOLD_PP } from './lines.js';
import { contestHeadline, toRows as contestRows } from './contests.js';
import { finalHeadline, toRows as finalRows } from './finals.js';
import { milestoneHeadline, toRows as msRows, MILESTONES } from './milestones.js';
import { pollHeadline, toRows as pollRows } from './polls.js';
import { recordFlipRows } from './records.js';
import { injuryHeadline, toRows as injRows } from './injuries.js';
import { parseFeed, toRows as rssToRows } from './rss.js';
import { clubAllowed } from './allowlist.js';
const navModule = await import('../gridiron/leagueNav.js');

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ------------------------------------------------------------ the migration

test('NO BODY COLUMN EXISTS, and none may be added', () => {
  // This is a WIRE - a headline, a link and who said it. A body column changes
  // what the table is and what rights it needs, and it is exactly the sort of
  // thing that arrives as "just nullable, for later".
  const m = src('migrations/081_news_items.sql');
  const sqlOnly = m.replace(/^\s*--.*$/gm, '');
  const create = sqlOnly.slice(sqlOnly.indexOf('CREATE TABLE IF NOT EXISTS news_items'),
    sqlOnly.indexOf('CREATE INDEX'));
  assert.equal(/\bbody\b/i.test(create), false, 'news_items must have no body column');
  assert.equal(/\bcontent\b|\bsummary\b|\bexcerpt\b/i.test(create), false);
  // and the columns relay 2 needs are already there, so a take is an UPDATE.
  assert.match(create, /take\s+text/);
  assert.match(create, /take_generated_at\s+timestamptz/);
  assert.match(create, /UNIQUE \(dedupe_hash\)/);
});

// ------------------------------------------------------------- the keys

test('EVERY LANE KEYS ON WHAT MAKES TWO OBSERVATIONS THE SAME EVENT', () => {
  // A line move is the same event for an hour; a final happens once ever; a
  // milestone is one per player per game. Getting these wrong either repeats
  // the wire or silences it.
  const at = new Date('2026-08-31T06:40:00Z');
  const later = new Date('2026-08-31T06:55:00Z');   // same hour
  const nextHour = new Date('2026-08-31T07:05:00Z');
  const row = { match_id: 1, market_type: 'spread', selection_abbr: 'KC',
    selection_value: '-3.5', num_books: 7, movement_24h_prob: 2 };
  const a = lineRows([row], { now: at })[0].dedupe_hash;
  const b = lineRows([row], { now: later })[0].dedupe_hash;
  const c = lineRows([row], { now: nextHour })[0].dedupe_hash;
  assert.equal(a, b, 'two ticks in the same hour are one event');
  assert.notEqual(a, c, 'the next hour is a new one');

  // A final has no time bucket at all.
  const f = { id: 9, home_score: 42, away_score: 26, home_name: 'USC', away_name: 'SJSU',
    league_id: 1, slug: 's', league_slug: 'cfb' };
  assert.equal(finalRows([f])[0].dedupe_hash, 'final:9');

  // A milestone is per player per game per milestone - so 300 and 400 yards
  // are two events, and re-reading the box score is none.
  const m = { match_id: 5, player_id: 7, full_name: 'X', pass_yds: 310, total_td: 1,
    league_id: 1, slug: 's', league_slug: 'cfb' };
  const one = msRows([m]);
  const two = msRows([m]);
  assert.deepEqual(one.map((r) => r.dedupe_hash), two.map((r) => r.dedupe_hash));
  assert.match(one[0].dedupe_hash, /^milestone:5:7:pass300$/);
});

test('the key is legible, not a digest', () => {
  assert.equal(wireKey('line', 20744, 'spread', '2026-08-31T05'), 'line:20744:spread:2026-08-31t05');
  assert.equal(hourBucket(new Date('2026-08-31T06:59:59Z')), '2026-08-31T06');
});

// --------------------------------------------------------- the headlines

test('LINE GRAMMAR IS PER MARKET TYPE - the first draft got two of three wrong', () => {
  // spread: a handicap. total: a number belonging to the game. h2h: a
  // probability. Running all three through the spread formatter produced
  // "Over +3" and dropped every moneyline move silently.
  assert.equal(lineHeadline({ market_type: 'spread', selection_abbr: 'ND',
    selection_value: '-10', opponent_abbr: 'BYU', num_books: 1 }), 'ND −10 at BYU · 1 book');
  assert.equal(lineHeadline({ market_type: 'total', selection_label: 'Over',
    selection_value: '54.5', home_abbr: 'TTU', away_abbr: 'HOU', num_books: 7 }),
  'Over 54.5 · HOU at TTU · 7 books');
  assert.equal(lineHeadline({ market_type: 'h2h', selection_abbr: 'FSU',
    implied_probability: 18.4, opponent_abbr: 'ALA', num_books: 1 }), 'FSU to 18% at ALA · 1 book');
  // "1 books" is how a wire announces it is a machine.
  assert.match(lineHeadline({ market_type: 'spread', selection_abbr: 'A', selection_value: '-1', num_books: 1 }), /1 book$/);
  // A pick'em is PK, not +0.
  assert.match(lineHeadline({ market_type: 'spread', selection_abbr: 'A', selection_value: '0' }), /^A PK/);
});

test('NO EM DASH ANYWHERE IN THE WIRE, and the arrow is an arrow', () => {
  const files = ['lines.js', 'contests.js', 'finals.js', 'milestones.js', 'polls.js',
    'records.js', 'injuries.js', 'rss.js', 'allowlist.js', 'emit.js', 'hash.js'];
  for (const f of files) {
    const code = strip(src(`lib/wire/${f}`));
    assert.equal(code.includes('—'), false, `${f} renders an em dash`);
  }
  // U+2212 for the minus sign; a hyphen beside an abbreviation reads as a name.
  assert.ok(lineHeadline({ market_type: 'spread', selection_abbr: 'ND', selection_value: '-10' }).includes('−'));
});

test('a final names the WINNER first', () => {
  assert.equal(finalHeadline({ home_score: 42, away_score: 26, home_name: 'USC', away_name: 'San José State' }),
    'Final: USC 42, San José State 26');
  assert.equal(finalHeadline({ home_score: 10, away_score: 15, home_name: 'TCU', away_name: 'North Carolina' }),
    'Final: North Carolina 15, TCU 10');
  // A draw names the away side first and claims no winner.
  assert.equal(finalHeadline({ home_score: 3, away_score: 3, home_name: 'A', away_name: 'B' }), 'Final: B 3, A 3');
  assert.equal(finalHeadline({ home_score: null, away_score: 1, home_name: 'A', away_name: 'B' }), null);
});

test('a milestone leads with the figure that earned it', () => {
  assert.equal(milestoneHeadline({ full_name: 'Davis Warren', pass_yds: 310, total_td: 1 },
    MILESTONES[0]), 'Davis Warren 310 pass yds, 1 TD');
  // No touchdowns, no touchdown clause.
  assert.equal(milestoneHeadline({ full_name: 'X', rush_yds: 142, total_td: 0 },
    MILESTONES[1]), 'X 142 rush yds');
  // The TD milestone does not repeat itself.
  assert.equal(milestoneHeadline({ full_name: 'Y', total_td: 3 }, MILESTONES[3]), 'Y 3 TD');
});

test('a poll that held is NOT news, and a first edition is not 32 arrivals', () => {
  assert.equal(pollHeadline({ abbreviation: 'TEX', rank: 3, previous_rank: 5 }), 'TEX to No. 3 from No. 5');
  assert.equal(pollHeadline({ abbreviation: 'MIA', rank: 7, previous_rank: 7 }), null, 'held is not a move');
  assert.equal(pollHeadline({ abbreviation: 'BYU', rank: 22, previous_rank: null }), 'BYU enters at No. 22');
  // A SYNTHETIC PRIOR WEEK, because waiting for the calendar is not a test.
  const wk2 = pollRows([
    { team_id: 1, rank: 3, previous_rank: 5, abbreviation: 'TEX' },
    { team_id: 2, rank: 7, previous_rank: 7, abbreviation: 'MIA' },
    { team_id: 3, rank: 22, previous_rank: null, abbreviation: 'BYU' },
  ], { pollName: 'AP Top 25', season: 2026, week: 2, leagueSlug: 'cfb' });
  assert.deepEqual(wk2.map((r) => r.headline),
    ['TEX to No. 3 from No. 5 · AP Top 25', 'BYU enters at No. 22 · AP Top 25']);
  // Every row lacking a prior rank means the POLL is new, not the teams.
  assert.deepEqual(pollRows([
    { team_id: 1, rank: 1, previous_rank: null, abbreviation: 'LAR' },
    { team_id: 2, rank: 2, previous_rank: null, abbreviation: 'SEA' },
  ], { pollName: 'p', season: 2026, week: 0, leagueSlug: 'nfl' }), []);
});

test('a record flip is a CHANGE, not a rewrite', () => {
  const T = { id: 1, abbreviation: 'USC' };
  const base = { team: T, leagueSlug: 'cfb', season: 2026 };
  assert.equal(recordFlipRows([{ ...base, before: { wins: 1, losses: 0 }, after: { wins: 2, losses: 0 } }])[0].headline, 'USC to 2-0');
  assert.equal(recordFlipRows([{ ...base, before: null, after: { wins: 1, losses: 0 } }]).length, 0, 'a first write is not a flip');
  assert.equal(recordFlipRows([{ ...base, before: { wins: 2, losses: 0 }, after: { wins: 2, losses: 0 } }]).length, 0, 'a rewrite is not a flip');
  // The key is the record itself, so a re-run of the same sync is a no-op.
  assert.match(recordFlipRows([{ ...base, before: { wins: 1, losses: 0 }, after: { wins: 2, losses: 0 } }])[0].dedupe_hash, /^record:cfb:2026:1:2-0-0$/);
});

test('THE RECORD LANE IS NOT POLLED - it is emitted at write time', () => {
  const r = strip(src('lib/wire/records.js'));
  assert.doesNotMatch(r, /\bsql`/, 'records.js must not read the database');
  assert.doesNotMatch(strip(src('app/api/cron/wire/route.js')), /recordFlipRows/,
    'the cron must not poll for record flips');
});

// -------------------------------------------------------------- lane 2

test('an injury renders without a date, and without a comment', () => {
  assert.equal(injuryHeadline({ status: 'PUP-P',
    player: { first_name: 'Brian', last_name: 'Branch', position_abbreviation: 'S', team: { abbreviation: 'DET' } } }),
  'Brian Branch, S, DET · PUP-P');
  // The real row that proves both are optional.
  const rows = injRows([{ status: 'NFI-A', date: null, comment: 'Knee',
    player: { id: 280489, first_name: 'Giovanni', last_name: 'Manu', position_abbreviation: 'OT', team: { abbreviation: 'DET' } } }]);
  assert.equal(rows[0].headline, 'Giovanni Manu, OT, DET · NFI-A');
  assert.equal(rows[0].published_at, null);
  // The key is the STATE, so re-polling an unchanged list writes nothing.
  assert.equal(rows[0].dedupe_hash, 'injury:280489:nfi-a:knee');
  // THE VENDOR IS NEVER NAMED TO A READER. source lands on the row and a
  // surface prints it; lib/legal.test.mjs forbids the vendor in user-facing
  // source, and a source string is as user-facing as it gets.
  assert.equal(rows[0].source, 'Injury report');
  assert.doesNotMatch(rows[0].source, /ball|bdl/i);
  assert.equal(injuryHeadline({ status: '', player: { first_name: 'A', last_name: 'B' } }), null);
});

test('a club item is keyed on the guid, and the TEAM IS THE FEED', () => {
  const xml = `<rss><channel><item><title>Packers agree to terms on trade with Rams</title>
    <link>https://www.packers.com/news/x</link><guid>abc-123</guid>
    <pubDate>Sun, 30 Aug 2026 20:00:00 GMT</pubDate>
    <media:keywords><![CDATA[News: All News]]></media:keywords></item></channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Packers agree to terms on trade with Rams');
  const rows = rssToRows(items, { id: 12, league_id: 5, team_id: 99, name: 'Green Bay Packers' });
  assert.deepEqual(rows[0].team_ids, [99], 'the team comes from the feed row, never the item');
  assert.equal(rows[0].dedupe_hash, 'club:12:abc-123');
  assert.equal(rows[0].source, 'Green Bay Packers');
  assert.equal(rows[0].payload.keywords, 'News: All News', 'keywords are stored, not acted on');
});

test('THE CLUB ALLOWLIST FILTERS ON THE HEADLINE, because keywords cannot', () => {
  // 414 distinct media:keywords across 8 feeds, no shared taxonomy, many of
  // them author bylines. The census is in the file header.
  for (const yes of ['49ers Sign DL Joyner to One-Year Deal', '49ers Announce Trade for LB Deion Jones',
    'Eagles announce initial 53-man roster', 'Final: Bengals 30, Eagles 13',
    'Packers place WR on injured reserve']) {
    assert.equal(clubAllowed(yes), true, yes);
  }
  for (const no of ['49ers Launch Melbourne Foodie Passport Program',
    'Christian McCaffrey Steps Into New Role With a Signature Shoe',
    'More Than a Game: How T.H.I.N.K. Gold Is Building the Next Generation']) {
    assert.equal(clubAllowed(no), false, no);
  }
  // IT IS NOT WIRED IN. Everything is ingested; relay 2 decides what renders.
  assert.doesNotMatch(strip(src('lib/wire/rss.js')), /clubAllowed|CLUB_ALLOW/);
  assert.doesNotMatch(strip(src('app/api/cron/wire/route.js')), /clubAllowed|CLUB_ALLOW/);
});

// ---------------------------------------------------------------- the cron

test('THE CRON IS STAGGERED OFF THE :00 CROWD and ledgered', () => {
  const crons = JSON.parse(src('vercel.json')).crons;
  const mine = crons.find((c) => c.path === '/api/cron/wire');
  assert.ok(mine, 'the wire must be scheduled');
  assert.equal(mine.schedule, '7,22,37,52 * * * *');
  assert.equal(/^0[, ]|^0 /.test(mine.schedule), false, 'never on the hour with everything else');
  const route = strip(src('app/api/cron/wire/route.js'));
  assert.match(route, /cronAuthorized\(request\)/);
  assert.match(route, /recordRun\(sql/);
  assert.match(route, /maybeAlert\(sql/);
  // EVERY LANE CAUGHT SEPARATELY: one dead club feed must not cost the finals.
  assert.match(route, /catch \(e\) \{\s*errors\.push/);
});

test('the wire writes through ONE insert, and it is idempotent by constraint', () => {
  const e = strip(src('lib/wire/emit.js'));
  assert.match(e, /ON CONFLICT \(dedupe_hash\) DO NOTHING/);
  // Nothing checks-then-inserts: that races itself the moment two ticks overlap.
  assert.doesNotMatch(e, /SELECT[\s\S]*FROM news_items[\s\S]*INSERT/);
  assert.match(e, /DELETE FROM news_items/, 'retention lives beside the write');
});

// ===========================================================================
// RELAY 2 — the surface, and the take
// ===========================================================================

const { validateTake, envelopeNumbers, buildEnvelope: _be } = await import('./take.js');
const { renderable, chipsForLeague, updatedLabel, ageLabel, dayKey, WIRE_CHIPS, headlineParts } = await import('./read.js');
const { parseWireChip, parseWirePage, wireHref } = await import('./wireNav.js');


test('THE NUMERIC-SUBSET CHECK REJECTS AN INVENTED FIGURE', () => {
  const env = { records: [{ team: 'USC', record: '1-0' }], apRanks: [{ team: 'USC', rank: 14 }] };
  assert.equal(validateTake('USC is 1-0 and ranked 14th.', env).ok, true);
  assert.equal(validateTake('USC is 9-1.', env).reason, 'unknown_number_9');
  // A model asked for "one specific figure" will produce a plausible one. This
  // is the only guard that makes that impossible rather than unlikely.
});

test('FIELD NAMES ARE PART OF THE ENVELOPE, and the second sentinel proved it', () => {
  // `spreadMoveLast24hInProbabilityPoints` produces "in the last 24 hours" in a
  // correct take. Counting only VALUES rejected that as an invented 24 - and
  // accepted it elsewhere only because a team happened to score 24 points.
  const env = { nextGame: [{ spreadMoveLast24hInProbabilityPoints: 1.05 }] };
  const known = envelopeNumbers(env);
  assert.ok(known.has('24'), 'the unit in the field name is known');
  assert.ok(known.has('1.05'));
  assert.equal(validateTake('The line moved 1.05 probability points in the last 24 hours.', env).ok, true);
  // And a number in neither name nor value is still a rejection.
  assert.equal(validateTake('The line moved 8 points.', env).reason, 'unknown_number_8');
});

test('the other three rejections', () => {
  const env = { records: [{ record: '1-0' }] };
  assert.equal(validateTake('A take with an em dash — here.', env).reason, 'em_dash');
  assert.equal(validateTake('NONE', env).reason, 'none');
  assert.equal(validateTake('One. Two. Three.', env).reason, 'too_many_sentences_3');
  assert.match(validateTake('x'.repeat(241), env).reason, /^too_long_/);
});

test('AN EMPTY ENVELOPE MEANS NO TAKE, NOT A FILLER TAKE', () => {
  const code = strip(src('lib/wire/take.js'));
  // buildEnvelope returns null when it holds no numbers at all...
  assert.match(code, /return hasNumbers \? env : null/);
  // ...and the writer refuses to be called with one.
  assert.match(code, /if \(!env\) return \{ ok: false, reason: 'empty_envelope' \}/);
  // The cron counts that as a rejection rather than skipping silently.
  assert.match(strip(src('app/api/cron/wire/route.js')), /rejected\.empty_envelope/);
});

test('THE WRITER RECEIVES ONLY THE HEADLINE AND THE ENVELOPE', () => {
  const code = strip(src('lib/wire/take.js'));
  const call = code.slice(code.indexOf('const user ='), code.indexOf('let res;'));
  assert.match(call, /item\.headline/);
  assert.match(call, /JSON\.stringify\(env/);
  // It cannot cite what it was never given.
  for (const forbidden of ['item.url', 'item.source', 'item.lane', 'item.payload']) {
    assert.equal(call.includes(forbidden), false, `${forbidden} must not reach the writer`);
  }
});

test('THE ENVELOPE IS SCOPED TO THE SEASON - the sentinel caught this too', () => {
  // Unscoped, it handed a writer Northwestern's 34-7 from a PRIOR season and
  // the take said "opened its home slate with a 34-7 win". Every guard passed;
  // the numeral was real and the year was wrong.
  const code = strip(src('lib/wire/take.js'));
  const finals = code.slice(code.indexOf("WHERE m.status = 'final'"), code.indexOf('ORDER BY m.kickoff_at DESC'));
  assert.match(finals, /m\.season_year = \$\{season\}/);
  const next = code.slice(code.indexOf("WHERE m.status = 'scheduled'"), code.indexOf('ORDER BY m.kickoff_at ASC'));
  assert.match(next, /m\.season_year = \$\{season\}/);
});

// --------------------------------------------------------------- the surface

test('A TAKE IS ALWAYS LABELLED, and a headline without one is complete', () => {
  const c = strip(src('components/wire/WireItem.js'));
  // The label is inside the same conditional as the take - it cannot render
  // without it, and the take cannot render without it either.
  const block = c.slice(c.indexOf('{item.take ?'), c.indexOf(': null}', c.indexOf('{item.take ?')));
  assert.match(block, /wi-take/);
  assert.match(block, /Auto-generated/);
  // Nothing renders in a missing take's place: no skeleton, no placeholder.
  assert.equal(/placeholder|skeleton|generating/i.test(c), false);
});

test('numbers in a headline wear the mono face', () => {
  const parts = headlineParts('KC −3 → −3.5 at LAC · 11 books');
  const figures = parts.filter((p) => p.num).map((p) => p.t);
  assert.deepEqual(figures, ['3', '3.5', '11'], 'the figures are marked, the words are not');
  // Rejoining must reproduce the headline exactly - nothing is re-encoded.
  assert.equal(parts.map((p) => p.t).join(''), 'KC −3 → −3.5 at LAC · 11 books');
});

test('THE CLUB ALLOWLIST IS APPLIED AT READ, NOT AT INGEST', () => {
  const kept = renderable([
    { lane: 'club', headline: '49ers Sign DL Joyner to One-Year Deal' },
    { lane: 'club', headline: '49ers Launch Melbourne Foodie Passport Program' },
    { lane: 'line', headline: 'Anything at all with no verb' },
  ]);
  assert.deepEqual(kept.map((r) => r.lane), ['club', 'line'], 'club filtered, our own lanes never');
  // Store-all is unchanged: the ingest and the cron still know nothing about it.
  assert.doesNotMatch(strip(src('lib/wire/rss.js')), /clubAllowed/);
  assert.doesNotMatch(strip(src('app/api/cron/wire/route.js')), /clubAllowed|renderable/);
});

test('A CHIP IS ABSENT WHEN THE LEAGUE HAS NO SOURCE FOR IT', () => {
  const nfl = chipsForLeague('nfl').map((c) => c.label);
  const cfb = chipsForLeague('cfb').map((c) => c.label);
  assert.deepEqual(nfl, ['Lines', 'Injuries', 'Club', 'Games', 'Board']);
  // No NCAAF injury feed and no college club-RSS pattern exist at all.
  assert.deepEqual(cfb, ['Lines', 'Games', 'Board']);
});

test('the wire URL is one builder, round-tripped', () => {
  assert.equal(wireHref('nfl'), '/nfl/wire');
  assert.equal(wireHref('nfl', { chip: 'lines' }), '/nfl/wire?lane=lines');
  assert.equal(wireHref('nfl', { chip: 'lines', page: 2 }), '/nfl/wire?lane=lines&p=2');
  assert.equal(wireHref('nfl', { chip: 'nonsense' }), '/nfl/wire', 'junk falls to the default');
  for (const c of WIRE_CHIPS) {
    const sp = Object.fromEntries(new URL(wireHref('nfl', { chip: c.key }), 'https://x').searchParams);
    assert.equal(parseWireChip(sp), c.key);
  }
  assert.equal(parseWireChip({}), null, 'no param means All');
  assert.equal(parseWirePage({ p: '-1' }), 0);
});

test('THE WIRE PILL IS IN THE NAV, both leagues', () => {
  const { LEAGUE_NAV } = navModule;
  const wire = LEAGUE_NAV.find((i) => i.key === 'wire');
  assert.ok(wire, 'the wire needs a door');
  assert.deepEqual(wire.leagues, ['nfl', 'cfb']);
  assert.equal(wire.href('nfl'), '/nfl/wire');
  // and the route exists on disk, which leagueNav's own test then requires
  assert.ok(existsSync(path.join(REPO, 'app/nfl/wire/page.js')));
  assert.ok(existsSync(path.join(REPO, 'app/cfb/wire/page.js')));
});

test('the module sits between Scores and Standings, and vanishes at zero', () => {
  const t = strip(src('components/gridiron/TodayPage.js'));
  const scores = t.indexOf('<LeagueScores');
  const wire = t.indexOf('<WireModule');
  const standings = t.indexOf('<StandingsSnapshot');
  assert.ok(scores > 0 && wire > scores && standings > wire, 'order: scores, wire, standings');
  assert.match(strip(src('components/wire/WireModule.js')), /if \(!items\?\.length\) return null/);
});

test('relative under a day, then the day and the time', () => {
  const now = new Date('2026-08-31T12:00:00Z');
  assert.equal(ageLabel(new Date('2026-08-31T11:58:00Z'), now), '2m');
  assert.equal(ageLabel(new Date('2026-08-31T09:00:00Z'), now), '3h');
  assert.match(ageLabel(new Date('2026-08-29T09:00:00Z'), now), /^[A-Z][a-z]{2} /);
  assert.equal(ageLabel(null, now), null);
  assert.equal(updatedLabel(new Date('2026-08-31T11:55:00Z'), now), 'updated 5 min ago');
  assert.equal(updatedLabel(null, now), null);
  assert.equal(typeof dayKey(new Date('2026-08-31T12:00:00Z')), 'string');
});

test('SEASON-SCOPE LAW: every envelope match query carries the season bound', () => {
  // THE 2025 LEAK MUST NOT RECUR SILENTLY. An unscoped lastFinal handed a
  // writer Northwestern's 34-7 from a prior season and it came back as this
  // season's opener - a true score attached to the wrong year, with every
  // guard passing because the numeral was real.
  //
  // So this walks EVERY query in the envelope builder that reads `matches` and
  // requires a season bound on each, rather than pinning the two that exist
  // today. A third query added without one fails here.
  const code = strip(src('lib/wire/take.js'));
  const body = code.slice(code.indexOf('export async function buildEnvelope'),
    code.indexOf('export function envelopeNumbers'));
  const queries = [...body.matchAll(/FROM matches m[\s\S]*?(?=`|\n\s{4}sql`)/g)].map((m) => m[0]);
  assert.ok(queries.length >= 2, `expected the match queries, found ${queries.length}`);
  for (const q of queries) {
    assert.match(q, /m\.season_year = \$\{season\}/,
      `an envelope query over matches has no season bound:\n${q.slice(0, 160)}`);
  }
  // And the season is a required input, not a default that could drift.
  assert.match(body, /buildEnvelope\(item, \{ season \}\)/);
});

test('THE CLUB DENY PASS: a recurring column is not the news', () => {
  // Measured on 400 stored club items: the allowlist alone passed 87, and 8 of
  // those were the club's standing column wearing a transactional word -
  // "Mailbag: Any surprises with final cuts?" matches on `final` AND `cuts`.
  // With the deny pass: 74 pass, 0 columns.
  for (const denied of [
    'Mailbag: Any surprises with final cuts?',
    'Late for Work: Pundits React to Ravens\' Roster Cuts',
    'Morning Break: A closer look at the Saints\' initial 53-man roster',
    '5 takeaways from Packers\' roster decisions',
    'LIONS DAILY: 7 thoughts on Detroit\'s initial 53-man roster',
    'Just announced! Colts 2026 gameday giveaways, entertainment and promotions',
  ]) assert.equal(clubAllowed(denied), false, denied);

  for (const kept of [
    'Titans Sign LB Dyontae Johnson, Waive/Injured LB Dominique Hampton',
    'Bills trade C Sedrick Van-Pran Granger to Indianapolis Colts',
    'Bills release 13 players | Aug. 29',
    'Titans Trim Roster to 53 Players',
  ]) assert.equal(clubAllowed(kept), true, kept);

  // THE STEMS ARE SPELLED OUT, not stemmed - the greedy form matched
  // "promotions" on a giveaways release and read it as a roster promotion.
  // COMMENTS STRIPPED FIRST: the sentence explaining this trap contains the
  // very pattern it forbids, which is exactly how this assertion failed once.
  const code = strip(src('lib/wire/allowlist.js'));
  assert.equal(/promot\\w\*/.test(code), false, 'the stem must be spelled out');
  assert.ok(code.includes('|promoted|'), 'the verb is literal');
});

test('NON-ENGLISH ITEMS ARE DROPPED, and that is stated as a decision', () => {
  assert.equal(clubAllowed('Mit diesem Kader gehen die Seahawks in die Saison 2026'), false);
  assert.equal(clubAllowed('3 Dinge, die du über Devon Witherspoon wissen musst'), false);
  // Not an accident of the pattern - the file says so.
  assert.match(src('lib/wire/allowlist.js'), /NON-ENGLISH ITEMS FALL OUT HERE TOO/);
});
