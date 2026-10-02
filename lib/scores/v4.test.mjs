// lib/scores/v4.test.mjs - the arcade Scoreboard's pure half (scores-v4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { v4Href, parseV4, hrefs, isClose, isTonight, CLOSE, chipCounts, applyView, confOptions, oddsFoot, fmtLine, winProbRead, firstDownPct, leaderOf } from './v4.js';

const team = (id, ab, conference = null) => ({ id, abbreviation: ab, name: ab, shortName: ab, conference });
const g = (id, o = {}) => ({ id, slug: `g-${id}`, leagueSlug: 'nfl', status: 'live', kickoffAt: '2026-09-28T17:00:00Z', homeScore: 0, awayScore: 0, home: team(id * 10, 'HOM'), away: team(id * 10 + 1, 'AWY'), liveState: null, ...o });

// ---------------------------------------------------------------- the URL grammar

test('v4Href: defaults drop out, the key order is fixed, and one state is one string', () => {
  assert.equal(v4Href(), '/scores');
  assert.equal(v4Href({ sport: 'all', view: null, conf: null, mine: false, top25: false }), '/scores');
  assert.equal(v4Href({ date: '2026-09-27', sport: 'cfb', view: 'close', conf: 'SEC', mine: true, top25: true }),
    '/scores?date=2026-09-27&sport=cfb&view=close&conf=SEC&mine=1&top25=1');
  // argument order does not change the string
  assert.equal(v4Href({ top25: true, mine: true, conf: 'SEC', view: 'close', sport: 'cfb', date: '2026-09-27' }),
    v4Href({ date: '2026-09-27', sport: 'cfb', view: 'close', conf: 'SEC', mine: true, top25: true }));
});

test('v4Href: Top 25 rides only on All and CFB; a conference only on CFB; an unknown view never', () => {
  assert.equal(v4Href({ sport: 'nfl', top25: true }), '/scores?sport=nfl');
  assert.equal(v4Href({ sport: 'mlb', top25: true }), '/scores?sport=mlb');
  assert.equal(v4Href({ sport: 'all', top25: true }), '/scores?top25=1');
  assert.equal(v4Href({ sport: 'nfl', conf: 'SEC' }), '/scores?sport=nfl');
  assert.equal(v4Href({ sport: 'all', conf: 'SEC' }), '/scores');
  assert.equal(v4Href({ view: 'watch' }), '/scores');
  assert.equal(v4Href({ conf: 'Big Ten', sport: 'cfb' }), '/scores?sport=cfb&conf=Big+Ten');
});

test('parseV4 reads back exactly what v4Href writes (the round trip)', () => {
  const states = [
    { date: null, sport: 'all', view: null, conf: null, mine: false, top25: false },
    { date: '2026-09-27', sport: 'cfb', view: 'close', conf: 'Big Ten', mine: true, top25: true },
    { date: null, sport: 'mlb', view: 'tonight', conf: null, mine: false, top25: false },
    { date: null, sport: 'nfl', view: 'live', conf: null, mine: true, top25: false },
  ];
  for (const s of states) {
    const sp = Object.fromEntries(new URL(v4Href(s), 'https://x.test').searchParams);
    assert.deepEqual(parseV4(sp), s, v4Href(s));
  }
  // junk falls back to defaults; EPL is an arcade chip again (thu-24)
  assert.deepEqual(parseV4({ sport: 'golf', view: 'x', date: 'soon', conf: 'SEC' }),
    { date: null, sport: 'all', view: null, conf: null, mine: false, top25: false });
  assert.equal(parseV4({ sport: 'epl' }).sport, 'epl');
});

test('hrefs: a chip toggles its own key and carries the rest; a day drops the view; leaving CFB drops the conference', () => {
  const h = hrefs({ date: '2026-09-27', sport: 'cfb', view: 'close', conf: 'SEC', mine: true, top25: true });
  assert.equal(h.view('close'), '/scores?date=2026-09-27&sport=cfb&conf=SEC&mine=1&top25=1', 'the selected view toggles off');
  assert.equal(h.view('live'), '/scores?date=2026-09-27&sport=cfb&view=live&conf=SEC&mine=1&top25=1', 'another view replaces it');
  assert.equal(h.sport('nfl'), '/scores?date=2026-09-27&sport=nfl&view=close&mine=1');
  assert.equal(h.sport('cfb'), '/scores?date=2026-09-27&sport=cfb&view=close&conf=SEC&mine=1&top25=1');
  assert.equal(h.conf('SEC'), '/scores?date=2026-09-27&sport=cfb&view=close&mine=1&top25=1');
  assert.equal(h.conf('ACC'), '/scores?date=2026-09-27&sport=cfb&view=close&conf=ACC&mine=1&top25=1');
  assert.equal(h.mine(), '/scores?date=2026-09-27&sport=cfb&view=close&conf=SEC&top25=1');
  assert.equal(h.top25(), '/scores?date=2026-09-27&sport=cfb&view=close&conf=SEC&mine=1');
  assert.equal(h.day('2026-09-28'), '/scores?date=2026-09-28&sport=cfb&conf=SEC&mine=1&top25=1');
  assert.equal(h.day(null), '/scores?sport=cfb&conf=SEC&mine=1&top25=1', 'today is the bare URL');
});

// ---------------------------------------------------------------- Close

test('Close: the ruling\'s numbers, pinned', () => {
  assert.deepEqual(CLOSE, { football: { margin: 8, from: 4 }, baseball: { margin: 2, from: 7 } });
});

test('Close, football: within 8 in Q4 or OT, live only', () => {
  const fb = (p, h, a, o = {}) => g(1, { liveState: { period: p, clock: '5:00' }, homeScore: h, awayScore: a, ...o });
  assert.equal(isClose(fb(4, 21, 14)), true, '7 in the 4th');
  assert.equal(isClose(fb(4, 22, 14)), true, '8 is the edge, inclusive');
  assert.equal(isClose(fb(4, 23, 14)), false, '9 is not');
  assert.equal(isClose(fb(3, 14, 14)), false, 'tied in the 3rd is not yet');
  assert.equal(isClose(fb(5, 20, 17)), true, 'overtime');
  assert.equal(isClose(fb(6, 20, 20)), true, 'second overtime');
  assert.equal(isClose(fb(4, 14, 21, { leagueSlug: 'cfb' })), true, 'CFB is football');
  assert.equal(isClose(fb(4, 21, 14, { status: 'final' })), false, 'a final is never close');
  assert.equal(isClose(fb(4, 21, 14, { status: 'scheduled' })), false);
  assert.equal(isClose(fb('4', 21, 14)), true, 'a string period is a number');
  assert.equal(isClose(g(1, { liveState: null, homeScore: 0, awayScore: 0 })), false, 'no period, no read');
  assert.equal(isClose(fb(4, null, null)), false, 'no score, no read');
});

test('Close, MLB: within 2 from the 7th; soccer never', () => {
  const bb = (inning, h, a) => g(2, { leagueSlug: 'mlb', liveState: { period: inning, half: 'top' }, homeScore: h, awayScore: a });
  assert.equal(isClose(bb(7, 3, 1)), true, '2 in the 7th');
  assert.equal(isClose(bb(7, 4, 1)), false, '3 is not');
  assert.equal(isClose(bb(6, 2, 2)), false, 'tied in the 6th is not yet');
  assert.equal(isClose(bb(9, 5, 5)), true);
  assert.equal(isClose(bb(12, 6, 5)), true, 'extras');
  assert.equal(isClose(bb(8, 2, 10)), false, 'a blowout in the 8th');
  assert.equal(isClose(g(3, { leagueSlug: 'epl', liveState: { period: '2H', elapsed: 85 }, homeScore: 1, awayScore: 1 })), false);
});

// ---------------------------------------------------------------- Tonight

test('Tonight: today in the viewer\'s zone, not yet started', () => {
  const now = new Date('2026-09-28T23:00:00Z');       // 7 pm ET, 4 pm PT
  const s = (ko, o = {}) => g(4, { status: 'scheduled', kickoffAt: ko, ...o });
  const et = { today: '2026-09-28', tz: 'America/New_York', now };
  assert.equal(isTonight(s('2026-09-29T00:15:00Z'), et), true, '8:15 pm ET Monday');
  assert.equal(isTonight(s('2026-09-29T04:30:00Z'), et), false, '12:30 am ET is tomorrow in New York');
  assert.equal(isTonight(s('2026-09-29T04:30:00Z'), { today: '2026-09-28', tz: 'America/Los_Angeles', now }), true, '9:30 pm PT is tonight in LA');
  assert.equal(isTonight(s('2026-09-28T22:00:00Z'), et), false, 'kickoff passed, still marked scheduled');
  assert.equal(isTonight(s('2026-09-29T00:15:00Z', { status: 'live' }), et), false, 'started');
  assert.equal(isTonight(s('2026-09-30T00:15:00Z'), et), false, 'tomorrow');
});

// ---------------------------------------------------------------- counts and narrowing

const today = '2026-09-28';
const now = new Date('2026-09-28T23:00:00Z');
const ctx = { today, tz: 'America/New_York', now };
function slate() {
  const close = g(10, { liveState: { period: 4, clock: '2:00' }, homeScore: 20, awayScore: 17, leagueSlug: 'cfb', home: team(100, 'UGA', 'SEC'), away: team(101, 'TENN', 'SEC') });
  const blow = g(11, { liveState: { period: 4, clock: '2:00' }, homeScore: 45, awayScore: 3, leagueSlug: 'cfb', home: team(110, 'OSU', 'Big Ten'), away: team(111, 'AKR', 'MAC') });
  const tonight = g(12, { status: 'scheduled', kickoffAt: '2026-09-29T00:15:00Z' });
  const yoursLive = g(13, { liveState: { period: 5, clock: '8:00' }, homeScore: 10, awayScore: 10 });
  const fin = g(14, { status: 'final', kickoffAt: '2026-09-28T17:00:00Z', homeScore: 3, awayScore: 0, leagueSlug: 'cfb', home: team(140, 'CLEM', 'ACC'), away: team(141, 'FSU', 'ACC') });
  return [
    { key: 'yours', title: 'Yours', sub: '1 game · 1 live', games: [yoursLive] },
    { key: 'live', title: 'Live now', sub: 'updates every 30s', games: [close, blow] },
    { key: 'day', title: 'Today', sub: '1 game', subTail: '', games: [tonight] },
    { key: 'final', title: 'Final', sub: 'Mon', games: [fin] },
  ];
}

test('chipCounts counts every card on screen, the Yours band included', () => {
  assert.deepEqual(chipCounts(slate(), ctx), { live: 3, close: 2, tonight: 1 });
});

test('applyView: Close keeps the close games and the Yours band, drops emptied groups', () => {
  const { groups } = applyView(slate(), { view: 'close', ...ctx });
  assert.deepEqual(groups.map((x) => [x.key, x.games.map((y) => y.id)]), [['yours', [13]], ['live', [10]]]);
  const t = applyView(slate(), { view: 'tonight', ...ctx }).groups;
  assert.deepEqual(t.map((x) => [x.key, x.games.map((y) => y.id)]), [['yours', [13]], ['day', [12]]]);
  assert.equal(t[1].sub, '1 game', 'a counted sub is rebuilt through gamesSub');
  assert.equal(applyView(slate(), { view: null, ...ctx }).groups.length, 4, 'no view, no change');
});

test('the conference picker is built from the day\'s CFB rows, and a stale conference stops applying', () => {
  assert.deepEqual(confOptions(slate()), ['ACC', 'Big Ten', 'MAC', 'SEC']);
  const sec = applyView(slate(), { conf: 'SEC', ...ctx });
  assert.equal(sec.conf, 'SEC');
  assert.deepEqual(sec.groups.map((x) => [x.key, x.games.map((y) => y.id)]), [['yours', [13]], ['live', [10]]]);
  const stale = applyView(slate(), { conf: 'Pac-12', ...ctx });
  assert.equal(stale.conf, null);
  assert.equal(stale.groups.length, 4, 'a conference not on the day empties nothing');
});

// ---------------------------------------------------------------- the feet

test('oddsFoot: "DEN -3.5 · 44.5 · opened -2.5", named by the current favourite, no O/U label (mon-21)', () => {
  const den = g(20, { home: team(1, 'DEN'), away: team(2, 'KC') });
  assert.equal(oddsFoot(den, { spreadHome: -3.5, total: 44.5, openHome: -2.5 }), 'DEN -3.5 · 44.5 · opened -2.5');
  assert.equal(oddsFoot(den, { spreadHome: 3.5, total: 44.5, openHome: -1 }), 'KC -3.5 · 44.5 · opened +1', 'the away favourite; the opening from the same side');
  assert.equal(oddsFoot(den, { spreadHome: -3.5, total: null, openHome: 0 }), 'DEN -3.5 · opened PK');
  assert.equal(oddsFoot(den, { spreadHome: -3.5, total: 44.5 }), 'DEN -3.5 · 44.5');
  assert.equal(oddsFoot(den, { total: 44.5, openHome: -2.5 }), '44.5', 'no current line, no opening either');
  assert.equal(oddsFoot(den, {}), null);
  assert.equal(fmtLine(0), 'PK'); assert.equal(fmtLine(2.5), '+2.5'); assert.equal(fmtLine(-7), '-7'); assert.equal(fmtLine('x'), null);
});

test('winProbRead: NFL live only, from the game page\'s own view of the stored value', () => {
  const v = { home: 36, away: 64, stale: false };
  const nfl = g(30, { home: team(1, 'CHI'), away: team(2, 'PHI') });
  assert.deepEqual(winProbRead(nfl, v), { abbr: 'PHI', pct: 64, stale: false });
  assert.deepEqual(winProbRead(nfl, { home: 50, away: 50, stale: true }), { abbr: 'CHI', pct: 50, stale: true });
  assert.equal(winProbRead({ ...nfl, leagueSlug: 'cfb' }, v), null, 'CFB is shadow');
  assert.equal(winProbRead({ ...nfl, leagueSlug: 'mlb' }, v), null);
  assert.equal(winProbRead({ ...nfl, status: 'final' }, v), null);
  assert.equal(winProbRead(nfl, null), null, 'no view (dead or missing), nothing');
});

test('firstDownPct: the ball plus the distance, none at goal-to-go', () => {
  assert.equal(firstDownPct({ pct: 66, togo: 6 }), 72);
  assert.equal(firstDownPct({ pct: 92, togo: 8 }), null);
  assert.equal(firstDownPct({ pct: 40, togo: null }), null);
  assert.equal(firstDownPct(null), null);
  assert.equal(leaderOf({ homeScore: 3, awayScore: 7 }), 'away');
  assert.equal(leaderOf({ homeScore: 7, awayScore: 7 }), null);
  assert.equal(leaderOf({ homeScore: null, awayScore: 7 }), null);
});

test('fieldLine: named, spot-only, or nothing (mon-21)', async () => {
  const { fieldLine } = await import('./v4.js');
  assert.deepEqual(fieldLine({ label: '2nd & 10', spot: 'PHI 33', pct: 67, snapSpot: 'PHI 35', snapPct: 65 }), { line: '2nd & 10 · PHI 33', pct: 67, named: true });
  assert.deepEqual(fieldLine({ label: null, spot: null, pct: null, snapSpot: 'PHI 15', snapPct: 15 }), { line: 'PHI 15', pct: 15, named: false });
  assert.deepEqual(fieldLine({ label: null, snapSpot: null, snapPct: null }), { line: null, pct: null, named: false });
  assert.deepEqual(fieldLine(null), { line: null, pct: null, named: false });
});
