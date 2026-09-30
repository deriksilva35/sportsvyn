// lib/run/picker.test.mjs - the Run picker's data on DEV fixtures (tue-5):
// the projected nine from a club's last final, the posted time the writer
// keeps, G1/G2 per club, and the panel's lineup line.
//
// Real rows on DEV, in 2099 is NOT possible here (lastLineupsByClub looks back
// 30 days from `now`), so the fixture passes its own `now` in 2099 and writes
// finals just before it - nothing real is ever inside that window. Slugs carry
// "test" so scripts/dev-orphan-sweep.mjs lists anything a killed run leaves.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from '../db.js';
import { lastLineupsByClub, probablesByClubGames, postedAtByClub } from './pool.js';
import { lineupNote } from './entry.js';
import { writeMlbLineups } from '../mlb/detail.js';

const TAG = `runpick-test-${process.pid}`;
const NOW = new Date('2099-10-05T18:00:00Z');
let league; let bos; let nyy; const made = [];

const card = (names) => names.map((name, i) => ({ id: String(i + 1), name, position: null, order: i + 1 }));
async function game(slug, kickoff, status, lineups = null) {
  const [m] = await sql`
    INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, season_phase, stage, metadata)
    VALUES (${league}, ${`${TAG}-${slug}`}, ${nyy}, ${bos}, ${kickoff}, ${status}, 2099, 'POST', 'wild_card',
            ${JSON.stringify(lineups ? { lineups } : {})}::jsonb)
    RETURNING id`;
  made.push(m.id); return m.id;
}

before(async () => {
  [{ id: league }] = await sql`SELECT id FROM leagues WHERE slug = 'mlb' LIMIT 1`;
  const t = await sql`SELECT id, abbreviation FROM teams WHERE league_id = ${league} AND abbreviation IN ('BOS', 'NYY')`;
  bos = t.find((x) => x.abbreviation === 'BOS').id; nyy = t.find((x) => x.abbreviation === 'NYY').id;
});
after(async () => {
  await sql`DELETE FROM matches WHERE id = ANY(${made}::int[])`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  assert.equal(n, 0, 'the fixture tears itself down');
});

test('THE PROJECTED NINE is each club\'s card from its MOST RECENT final, per side', async () => {
  // An older final with a different card, then the newest; a scheduled game
  // with a card is never a projection.
  await game('old', '2099-10-01T23:00:00Z', 'final', { away: card(['Old Leadoff']), home: card(['Old Yank']) });
  await game('last', '2099-10-04T23:00:00Z', 'final', { away: card(['Jarren Duran', 'Rafael Devers']), home: card(['Aaron Judge']) });
  await game('next', '2099-10-05T23:00:00Z', 'scheduled', { away: card(['Not Yet']), home: null });
  // A FINAL WITH ONE SIDE STORED AS JSON null - every real day has them - must
  // not throw the whole read (it did: "cannot get array length of a scalar").
  await game('nullside', '2099-10-03T23:00:00Z', 'final', { away: null, home: card(['Older Yank']) });
  const m = await lastLineupsByClub([bos, nyy], { now: NOW });
  assert.deepEqual(m.get(String(bos)).list.map((e) => e.name), ['Jarren Duran', 'Rafael Devers'], 'BOS as the away side');
  assert.deepEqual(m.get(String(nyy)).list.map((e) => e.name), ['Aaron Judge'], 'NYY as the home side');
  assert.equal(m.get(String(bos)).kickoffAt, '2099-10-04T23:00:00.000Z');
  // Thirty days is the reach: a month later there is nothing to project from.
  assert.equal((await lastLineupsByClub([bos], { now: new Date('2099-12-01T00:00:00Z') })).size, 0);
});

test('postedAt: set on the first write that carries a side, KEPT on every later one, cleared if it un-posts', async () => {
  const id = await game('post', '2099-10-06T23:00:00Z', 'scheduled');
  const read = async () => (await sql`SELECT metadata->'lineups' AS l FROM matches WHERE id = ${id}`)[0].l;
  await writeMlbLineups(sql, id, { away: null, home: null }, { at: '2099-10-06T15:00:00Z' });
  assert.deepEqual((await read()).postedAt, { away: null, home: null }, 'not posted is a reading, with no time');
  await writeMlbLineups(sql, id, { away: card(['Jarren Duran']), home: null }, { at: '2099-10-06T16:12:00Z' });
  await writeMlbLineups(sql, id, { away: card(['Jarren Duran']), home: card(['Aaron Judge']) }, { at: '2099-10-06T17:30:00Z' });
  const l = await read();
  assert.equal(l.postedAt.away, '2099-10-06T16:12:00.000Z', 'the away card keeps the time it first went up');
  assert.equal(l.postedAt.home, '2099-10-06T17:30:00.000Z');
  assert.equal(l.fetchedAt, '2099-10-06T17:30:00.000Z', 'fetchedAt is still the last read');
  // A card pulled (a rainout, a provider blip) clears its time with it.
  await writeMlbLineups(sql, id, { away: null, home: card(['Aaron Judge']) }, { at: '2099-10-06T17:45:00Z' });
  assert.equal((await read()).postedAt.away, null);
  assert.equal((await read()).postedAt.home, '2099-10-06T17:30:00.000Z');
});

test('G1 AND G2 PER CLUB, numbered by the club\'s place in the round; a final G1 makes G2 the next', () => {
  const m = (id, ko, status, probables) => ({ id, kickoff_at: ko, home_team_id: 10, away_team_id: 11, status, probables });
  const both = probablesByClubGames([
    m(2, '2099-10-02T23:00:00Z', 'scheduled', { home: { name: 'Max Fried' }, away: { name: 'Sonny Gray' } }),
    m(1, '2099-10-01T23:00:00Z', 'scheduled', { home: { name: 'Cam Schlittler' }, away: { name: 'Payton Tolle' } }),
  ]);
  assert.deepEqual(both.get('10'), { g1: { gameNo: 1, name: 'Cam Schlittler', id: null }, g2: { gameNo: 2, name: 'Max Fried', id: null } });
  assert.equal(both.get('11').g2.name, 'Sonny Gray');
  const noG2 = probablesByClubGames([m(1, '2099-10-01T23:00:00Z', 'scheduled', { home: { name: 'Cam Schlittler' } }),
    m(2, '2099-10-02T23:00:00Z', 'scheduled', null)]);
  assert.equal(noG2.get('10').g2, null, 'BDL has no G2 starter yet');
  assert.equal(noG2.get('11').g1, null, 'TBA');
  const after = probablesByClubGames([m(1, '2099-10-01T23:00:00Z', 'final', { home: { name: 'Cam Schlittler' } }),
    m(2, '2099-10-02T23:00:00Z', 'scheduled', { home: { name: 'Max Fried' } })]);
  assert.deepEqual(after.get('10').g1, { gameNo: 2, name: 'Max Fried', id: null }, 'the next game keeps its own number');
});

test('THE PANEL LINE: posted with its PT time, posted without one, projected from a weekday, or not posted', () => {
  assert.equal(lineupNote({ posted: true, postedAt: '2026-09-29T16:12:00Z' }), 'lineup posted 9:12 AM PT');
  assert.equal(lineupNote({ posted: true, postedAt: null }), 'lineup posted', 'a card from before postedAt existed invents no time');
  assert.equal(lineupNote({ posted: false, projectedFrom: '2026-09-28T00:15:00Z' }), "projected from Sun's game", '00:15Z Monday is Sunday night in the Pacific');
  assert.equal(lineupNote({}), 'lineup not posted yet');
  const rows = [{ id: 1, kickoff_at: '2099-10-01T23:00:00Z', status: 'scheduled', home_team_id: 10, away_team_id: 11,
    lineups: { postedAt: { away: '2099-10-01T20:00:00Z', home: null } } }];
  assert.equal(postedAtByClub(rows).get('11'), '2099-10-01T20:00:00Z');
  assert.equal(postedAtByClub(rows).get('10'), null);
});
