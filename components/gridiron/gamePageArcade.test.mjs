// components/gridiron/gamePageArcade.test.mjs - the gridiron game page under
// arcade (game-page-arcade, wed-8): module order per state, CFB without win
// probability, one shared card face, no drawer and no Recap, scoring plays from
// score changes, leaders, In your games (its reads and what it never calls),
// the signed-out card, the plays count, and the closing line.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';
import { stubPath } from '../../lib/testing/stubDir.mjs';
install();

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const src = (rel) => strip(readFileSync(path.join(REPO, rel), 'utf8'));

const LINK = stubPath('__link_stub_gpa.mjs');
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/link') return { url: pathToFileURL(LINK).href, shortCircuit: true };
  return next(spec, ctx);
} });

let React, render, GamePageArcade, parts, A, Y;
before(async () => {
  writeFileSync(LINK, "import React from 'react'; export default function Link({ href, children, ...rest }) { return React.createElement('a', { ...rest, href: String(href) }, children); }\n");
  React = await import('react');
  render = (await import('react-dom/server')).renderToStaticMarkup;
  parts = await import('./GamePageArcade.js');
  GamePageArcade = parts.default;
  A = await import('../../lib/gridiron/gamePageArcade.js');
  Y = await import('../../lib/gridiron/inYourGames.js');
});
after(() => { try { unlinkSync(LINK); } catch { /* gone */ } });

const NOW = new Date('2026-09-28T02:00:00Z');
const HOME = { id: 1, abbreviation: 'CHI', name: 'Chicago Bears', shortName: 'Bears', colors: { primary: '#0B162A', secondary: '#C83803' } };
const AWAY = { id: 2, abbreviation: 'PHI', name: 'Philadelphia Eagles', shortName: 'Eagles', colors: { primary: '#004C54', secondary: '#A5ACAF' } };
const LINE = { columns: ['1', '2', '3', '4'], total: 'T', extra: [], rows: [
  { side: 'away', abbr: 'PHI', cells: ['0', '7', '0', '0'], total: 7, extra: [] },
  { side: 'home', abbr: 'CHI', cells: ['7', '3', '10', '7'], total: 27, extra: [] }] };
const X = (o = {}) => ({ rank: { home: null, away: null }, record: { home: '2-1', away: '1-2' }, spreadHome: null, total: null, openHome: null, preview: null, drive: null, diamond: null, stat: null, hasStats: true, mlbFoot: null, probables: null, prob: null, stake: null, open: false, line: LINE, closing: null, ...o });

function view({ state = 'final', league = 'nfl', closing = 'Closing line PHI -3.5', signedIn = false, rows = [], wp = true, plays = null } = {}) {
  const status = state === 'pre' ? 'scheduled' : state;
  const g = { id: 9, slug: 'nfl-2026-reg-w3-phi-chi', leagueSlug: league, status, kickoffAt: '2026-09-29T00:15:00Z', homeScore: state === 'pre' ? null : 27, awayScore: state === 'pre' ? null : 7, home: HOME, away: AWAY, network: 'NBC', etWeekday: 'Sun', liveState: state === 'live' ? { period: 3, clock: '6:42' } : null };
  const hasCurve = wp && league === 'nfl';
  return {
    state, league, simulated: false, g, x: X({ closing: state === 'final' ? closing : null }), signinHref: '/signin?callbackUrl=x',
    modules: A.arcadeModules({ state, league, hasCurve, hasNow: hasCurve, hasMarket: false, hasDrive: false }),
    odds: null, drive: null,
    winprob: hasCurve ? { path: '0,32 179,20 358,4', marks: [89.5, 179, 268.5], dot: '358,4', now: state === 'final' ? 'CHI won' : 'CHI 71%', stale: false, homeAbbr: 'CHI', awayAbbr: 'PHI', ot: false } : null,
    yours: { signedIn, rows, playHref: signedIn ? '/pickem/nfl' : '/signin?callbackUrl=x' },
    chips: state === 'live' ? A.liveChips({ plays: 165, box: false, stats: true, market: true }) : [],
    plays: plays ?? { latest: [{ when: 'Q3 6:42', abbr: 'CHI', text: 'C.Williams pass short right to D.Moore for 9 yards' }], total: 165, all: false },
    box: [], leaders: [{ cat: 'PASS', away: { name: 'Hurts', line: '18/30 · 190' }, home: { name: 'Williams', line: '24/33 · 281 · 2 TD' } }], teamBox: null,
    market: { closing, propsCard: null },
    scoring: state === 'final' ? [{ period: 1, clock: '8:47', side: 'home', text: 'TD pass', homeScore: 7, awayScore: 0, points: 7 }] : [],
    crumb: 'NFL · Week 3 · Sun',
  };
}
const html = (v) => render(React.createElement(GamePageArcade, { view: v, now: NOW }));
const modsOf = (h) => [...h.matchAll(/data-mod="([a-z]+)"/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// order
// ---------------------------------------------------------------------------
test('MODULE ORDER, per state (wed-8)', () => {
  assert.deepEqual(A.arcadeModules({ state: 'pre', league: 'nfl' }), ['card', 'market', 'yours']);
  assert.deepEqual(A.arcadeModules({ state: 'pre', league: 'nfl', hasMarket: false }), ['card', 'yours'], 'no two-sided read, no market module');
  assert.deepEqual(A.arcadeModules({ state: 'live', league: 'nfl', hasCurve: true }), ['card', 'drive', 'winprob', 'yours', 'chips']);
  assert.deepEqual(A.arcadeModules({ state: 'final', league: 'nfl', hasCurve: true }), ['card', 'winprob', 'yours', 'scoring', 'leaders']);
  assert.deepEqual(A.arcadeModules({ state: 'final', league: 'nfl', hasCurve: false }), ['card', 'yours', 'scoring', 'leaders'],
    'a final with no winprob_log rows has no win-probability module at all');
  assert.deepEqual(A.liveChips({ plays: 3, box: true, stats: true, market: true }).map((c) => c.label), ['Plays', 'Box', 'Stats', 'Market']);
  // ...and the page draws exactly that list, in that order.
  assert.deepEqual(modsOf(html(view({ state: 'final' }))), ['card', 'winprob', 'yours', 'scoring', 'leaders']);
  assert.deepEqual(modsOf(html(view({ state: 'live' }))), ['card', 'winprob', 'yours', 'chips']);
  assert.deepEqual(modsOf(html(view({ state: 'pre' }))), ['card', 'yours']);
});

test('CFB HAS NO WIN PROBABILITY anywhere (shadow: lib/winprob/cfb.json)', () => {
  for (const state of ['live', 'final']) {
    const m = A.arcadeModules({ state, league: 'cfb', hasCurve: true, hasNow: true });
    assert.ok(!m.includes('winprob'), `${state}: ${m}`);
  }
  assert.equal(A.winProbShown('cfb'), false);
  assert.equal(A.winProbShown('nfl'), true);
  const h = html(view({ state: 'final', league: 'cfb' }));
  assert.ok(!/data-gpa="winprob"|Win probability|Calibrating/i.test(h));
  // The reader is not even asked for CFB: the view gates the read on the same flag.
  const vsrc = src('lib/gridiron/gamePageArcadeView.js');
  assert.match(vsrc, /winProbShown\(league\) && state !== 'pre' \? caught\(winProbRows\(game\.id\)/);
  assert.match(src('lib/gridiron/gamePageArcade.js'), /sport = 'nfl'/, 'the curve query reads NFL rows only');
});

// ---------------------------------------------------------------------------
// the card
// ---------------------------------------------------------------------------
test('THE CARD FACE IS SHARED: one component, imported by /scores and the game page', () => {
  const board = src('components/scores/ScoreboardV4.js');
  const page = src('components/gridiron/GamePageArcade.js');
  assert.match(board, /export function CardFace\(/);
  assert.match(board, /<ExpandCard[\s\S]*?<CardFace \{\.\.\.props\} \/>[\s\S]*?<\/ExpandCard>/, '/scores wraps the face in its drawer');
  assert.match(page, /import \{ CardFace \} from '@\/components\/scores\/ScoreboardV4';/);
  assert.match(page, /<CardFace [^>]*onPage \/>/);
  assert.ok(!/sv4-team|sv4-lbl/.test(page), 'the page draws no card markup of its own');
  for (const r of ['app/nfl/game/[slug]/page.js', 'app/cfb/game/[slug]/page.js']) {
    const s = src(r);
    assert.match(s, /import GamePageArcade from '@\/components\/gridiron\/GamePageArcade';/, r);
    assert.match(s, /if \(arcadeFor\(isShell\)\) \{[\s\S]*?<GamePageArcade view=\{view\} \/>/, `${r}: arcade only`);
  }
});

test('NO DRAWER AND NO RECAP on the game page; the card is navy in every state', () => {
  const page = src('components/gridiron/GamePageArcade.js');
  assert.ok(!/ExpandCard/.test(page));
  for (const state of ['pre', 'live', 'final']) {
    const h = html(view({ state }));
    assert.ok(!/sv4-hit|data-open=|Recap|Box score &rarr;|Box score →|sv4-xgo/.test(h), state);
    assert.match(h, /<article class="sv4-card [a-z]+ gpa-card"/, `${state}: the page's own article`);
    if (state !== 'pre') assert.match(h, /class="sv4-ls" data-line="1"/, `${state}: the quarter line on the face`);
    else assert.ok(!/sv4-ls|sv4-stake|No pick yet/.test(h), 'pre: no line of dashes, no board stake chip');
  }
  const css = readFileSync(path.join(REPO, 'components/gridiron/gamePageArcade.css'), 'utf8');
  assert.match(css, /\.sv4-card\.gpa-card \{ background: var\(--tok-primary\)/, 'navy ground for every .gpa-card, not only .live');
});

test('/scores keeps its drawer and its link: onPage is off there', () => {
  const board = src('components/scores/ScoreboardV4.js');
  assert.match(board, /onPage\s*\?\s*\(x\.closing[\s\S]*?: <Link className="go" href=\{gameHref\}>\{x\.hasStats \? 'Box score' : 'Recap'\}/);
  assert.match(board, /export function CardFace\(\{ g, x, signedIn, signinHref, tz, now, onPage = false \}\)/);
});

test('CLOSING LINE: in the final foot when market_prior is present, absent otherwise', () => {
  assert.equal(A.closingLine({ spread: 3.5 }, { home: HOME, away: AWAY }), 'Closing line PHI -3.5', '+3.5 home = the away side by 3.5');
  assert.equal(A.closingLine({ spread: -2 }, { home: HOME, away: AWAY }), 'Closing line CHI -2');
  assert.equal(A.closingLine({ spread: 0 }, { home: HOME, away: AWAY }), 'Closing line PK');
  assert.equal(A.closingLine(null, { home: HOME, away: AWAY }), null);
  assert.equal(A.closingLine({ spread: null }, { home: HOME, away: AWAY }), null);
  assert.match(html(view({ state: 'final' })), /<span class="close" data-closing="1">Closing line PHI -3.5<\/span>/);
  const without = html(view({ state: 'final', closing: null }));
  assert.ok(!/data-closing|Closing line/.test(without));
  assert.ok(!/game time|duration/i.test(html(view({ state: 'final' }))), 'no game duration');
});

// ---------------------------------------------------------------------------
// scoring plays, leaders, the curve
// ---------------------------------------------------------------------------
test('SCORING PLAYS are every score change, in game order, with the new score', () => {
  const plays = [
    { period: 1, clock: '15:00', homeScore: 0, awayScore: 0, text: 'kickoff' },
    { period: 1, clock: '8:47', homeScore: 6, awayScore: 0, text: 'TD pass', scoring: true },
    { period: 1, clock: '8:47', homeScore: 7, awayScore: 0, text: 'extra point', scoring: false },
    { period: 2, clock: '0:00', homeScore: 7, awayScore: 7, text: 'TD run' },
    // a drive-less row, stored LAST by playsFor() but timed mid-game, at the score of its moment
    { period: 1, clock: '2:00', homeScore: 7, awayScore: 0, text: 'END QUARTER 1', driveNumber: null },
    // a stoppage stored at a stale 0-0 between two scores (PROD, PHI@CHI wk3)
    { period: 2, clock: '0:19', homeScore: 0, awayScore: 0, text: 'Timeout' },
    { period: 3, clock: '1:10', homeScore: 7, awayScore: 9, text: 'Safety' },
    { period: 4, clock: '5:00', homeScore: null, awayScore: null, text: 'timeout' },
  ];
  const s = A.scoreChanges(plays);
  assert.deepEqual(s.map((x) => [x.period, x.clock, x.side, x.homeScore, x.awayScore, x.points]), [
    [1, '8:47', 'home', 6, 0, 6], [1, '8:47', 'home', 7, 0, 1], [2, '0:00', 'away', 7, 7, 7], [3, '1:10', 'away', 7, 9, 2],
  ], 'the PAT counts though unflagged; the late-stored END QUARTER row and the stale 0-0 timeout are not scores; a null score is skipped');
  assert.equal(A.whenLabel(5, '4:10'), 'OT 4:10');
  const h = html(view({ state: 'final' }));
  assert.match(h, /data-gpa="scoring"[\s\S]*Q1 8:47<b>CHI<\/b>[\s\S]*PHI 0 · CHI 7/);
});

test('LEADERS: PASS / RUSH / REC for both teams from regTeamTables rows', () => {
  const rows = [
    { team_id: 1, full_name: 'Caleb Williams', pass_cmp: 24, pass_att: 33, pass_yds: 281, pass_td: 2, rush_att: 4, rush_yds: 20 },
    { team_id: 1, full_name: "D'Andre Swift", rush_att: 17, rush_yds: 84, rush_td: 1, rec: 2, rec_yds: 11 },
    { team_id: 1, full_name: 'DJ Moore', rec: 8, rec_yds: 92, rec_td: 1, tgt: 10 },
    { team_id: 2, full_name: 'Jalen Hurts', pass_cmp: 18, pass_att: 30, pass_yds: 190, pass_td: 0, rush_att: 9, rush_yds: 51 },
    { team_id: 2, full_name: 'Saquon Barkley', rush_att: 12, rush_yds: 51, rec: 3, rec_yds: 20 },
    { team_id: 2, full_name: 'Marvin Harrison Jr.', rec: 5, rec_yds: 70 },
  ];
  const L = A.gameLeaders(rows, { homeId: 1, awayId: 2 });
  assert.deepEqual(L, [
    { cat: 'PASS', away: { name: 'Hurts', line: '18/30 · 190' }, home: { name: 'Williams', line: '24/33 · 281 · 2 TD' } },
    { cat: 'RUSH', away: { name: 'Hurts', line: '9 · 51' }, home: { name: 'Swift', line: '17 · 84 · 1 TD' } },
    { cat: 'REC', away: { name: 'Harrison Jr.', line: '5 · 70' }, home: { name: 'Moore', line: '8 · 92 · 1 TD' } },
  ], 'a yards tie (Jalen Hurts 51 / Saquon Barkley 51 rushing) goes to the full name, so the order is stable');
  assert.deepEqual(A.gameLeaders([], { homeId: 1, awayId: 2 }), [], 'no rows, no leaders module');
  const C = A.cfbLeaders([
    { side: 'home', tables: [{ group: 'passing', rows: [{ name: 'Dante Moore', cells: ['22/30', '301', '3', '0'] }] }] },
    { side: 'away', tables: [{ group: 'rushing', rows: [{ name: 'Woody Marks', cells: ['20', '110', '2', '41'] }] }] },
  ]);
  assert.deepEqual(C, [
    { cat: 'PASS', away: null, home: { name: 'Moore', line: '22/30 · 301 · 3 TD' } },
    { cat: 'RUSH', away: { name: 'Marks', line: '20 · 110 · 2 TD' }, home: null },
  ]);
});

test('THE CURVE: winprob_log rows on the game clock, cut for a replay', () => {
  const rows = [
    { p_home: 0.5, inputs: { secs_game: 3600, is_ot: 0 } },
    { p_home: 0.6, inputs: { secs_game: 2700, is_ot: 0 } },
    { p_home: 0.7, inputs: { secs_game: 2750, is_ot: 0 } }, // a clock correction: x does not run back
    { p_home: 0.9, inputs: { secs_game: 0, is_ot: 0, reason: 'final' } },
    { p_home: 0.2, inputs: {} },
  ];
  const c = A.curvePoints(rows);
  assert.deepEqual(c.points.map((p) => p.x), [0, 900, 900, 3600]);
  assert.equal(c.end, 3600);
  assert.equal(A.curvePath(c), '0,32 89.5,25.6 89.5,19.2 358,6.4');
  assert.deepEqual(A.curvePoints(rows, { upTo: 1000 }).points.length, 3);
  assert.equal(A.elapsedOf({ is_ot: 1, secs_half: 300 }), 3900);
  assert.equal(A.elapsedAt(3, '6:42'), 1800 + 498);
  assert.deepEqual(A.wpNow(0.29, { home: HOME, away: AWAY }), { abbr: 'PHI', pct: 71 });
});

// ---------------------------------------------------------------------------
// in your games
// ---------------------------------------------------------------------------
test('IN YOUR GAMES: three reads at most, and never stakeForMatches or draftState', async () => {
  const s = src('lib/gridiron/inYourGames.js');
  assert.ok(!/stakeForMatches|draftState|lib\/draft\/entry|draft\/entry\.js/.test(s), 'its own reads, nothing from the board or the draft room');
  for (const f of ['lib/gridiron/gamePageArcadeView.js', 'components/gridiron/GamePageArcade.js', 'lib/gridiron/gamePageArcade.js']) {
    assert.ok(!/stakeForMatches|draftState|draft\/entry/.test(src(f)), f);
  }
  assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s), 'read-only');
  const calls = [];
  const game = { id: 21586, leagueSlug: 'nfl', seasonYear: 2026, seasonPhase: 'REG', week: 3, status: 'final', homeScore: 27, awayScore: 7, home: HOME, away: AWAY, kickoffAt: '2026-09-29T00:15:00Z' };
  const db = (strings, ...vals) => {
    const q = strings.join('?');
    calls.push(q.replace(/\s+/g, ' ').trim());
    if (/FROM contests/.test(q)) {
      return Promise.resolve([
        { id: 13, game_type: 'pickem', board: [{ match_id: 21586 }, { match_id: 21571 }, { match_id: 21572 }] },
        { id: 14, game_type: 'weekly', board: [{ id: 38, name: 'Jalen Hurts', team: 'PHI' }, { id: 131, name: 'DJ Moore', team: 'CHI' }, { id: 5, name: 'Josh Allen', team: 'BUF' }] },
        { id: 15, game_type: 'draft', board: [{ id: 40, name: 'Cole Kmet', team: 'CHI' }] },
      ]);
    }
    if (/FROM contest_entries/.test(q)) {
      return Promise.resolve([
        { contest_id: 13, lineup: { 21586: 'home', 21571: 'away', 21572: 'home' }, meta: {} },
        { contest_id: 14, lineup: { QB: 38, WR: 131, FLEX: 5 }, meta: {} },
        { contest_id: 15, lineup: {}, meta: { roster: [{ id: 40, name: 'Cole Kmet' }] } },
      ]);
    }
    if (/FROM matches/.test(q)) {
      return Promise.resolve([
        { id: 21586, status: 'final', home_score: 27, away_score: 7 },
        { id: 21571, status: 'final', home_score: 20, away_score: 17 },
        { id: 21572, status: 'final', home_score: 30, away_score: 10 },
      ]);
    }
    return Promise.reject(new Error(`unexpected read: ${q}`));
  };
  const statRows = [
    { nfl_player_id: 38, pass_yds: 190, pass_td: 0, rush_yds: 51 },
    { nfl_player_id: 131, rec: 8, rec_yds: 92, rec_td: 1 },
    { nfl_player_id: 40, rec: 2, rec_yds: 15 },
  ];
  const rows = await Y.inYourGames({ userId: 1, game, statRows, db });
  assert.equal(calls.length, 3, calls.join('\n'));
  assert.match(calls[0], /FROM contests WHERE game_type = ANY\(\?\) AND sport = \? AND season_year = \? AND week = \?/);
  assert.match(calls[1], /FROM contest_entries WHERE user_id = \? AND contest_id = ANY\(\?\)/);
  assert.deepEqual(rows.map((r) => [r.label, r.line, r.value]), [
    ["PICK'EM", 'You had CHI', 'Won · 2 of 3 this week'],
    ['WEEKLY', 'Hurts · Moore in your six', '35.9 pts from this game'], // 7.6 + 5.1 + 8 + 9.2 + 6, ppr
    ['THE DRAFT', 'Kmet on your roster', '3.5 pts from this game'],
  ]);
  // no pick'em entry -> no third read
  calls.length = 0;
  const db2 = (strings, ...v) => (/FROM contest_entries/.test(strings.join('?'))
    ? (calls.push('entries'), Promise.resolve([{ contest_id: 14, lineup: { QB: 38 }, meta: {} }]))
    : db(strings, ...v));
  await Y.inYourGames({ userId: 1, game, statRows, db: db2 });
  assert.ok(calls.length <= 2, `${calls.length} reads`);
  // signed out: no read at all
  calls.length = 0;
  assert.deepEqual(await Y.inYourGames({ userId: null, game, db }), []);
  assert.equal(calls.length, 0);
});

test('the contest key: NFL REG week; CFB the ISO week of its ET Monday; preseason none', () => {
  assert.deepEqual(Y.contestKeyFor({ leagueSlug: 'nfl', seasonYear: 2026, seasonPhase: 'REG', week: 3 }), { sport: 'nfl', season: 2026, week: 3 });
  assert.equal(Y.contestKeyFor({ leagueSlug: 'nfl', seasonYear: 2026, seasonPhase: 'PRE', week: 3 }), null);
  // Sat 26 Sep 2026 ET -> Monday 21 Sep -> ISO week 39 (PROD's CFB board 12 is week 39)
  assert.deepEqual(Y.contestKeyFor({ leagueSlug: 'cfb', seasonYear: 2026, kickoffAt: '2026-09-26T23:30:00Z' }), { sport: 'cfb', season: 2026, week: 39 });
  // a Monday-night 00:30Z kickoff is still Sunday in ET -> the week before
  assert.equal(Y.isoWeekOfEtMonday('2026-09-28T00:30:00Z'), 39);
  assert.equal(Y.isoWeekOfEtMonday('2026-09-28T16:00:00Z'), 40);
});

test('SIGNED OUT: ONE "Play this game" card; signed in with rows: the rows, no card', () => {
  const out = html(view({ state: 'pre', signedIn: false }));
  assert.equal((out.match(/data-play-card="1"/g) ?? []).length, 1);
  assert.match(out, /<a class="gpa-play"[^>]*href="\/signin\?callbackUrl=x"/);
  assert.match(out, />Play this game</);
  const inn = html(view({ state: 'final', signedIn: true, rows: [{ kind: 'pickem', label: "PICK'EM", line: 'You had CHI', value: 'Won · 2 of 3 this week', href: '/pickem/nfl' }] }));
  assert.ok(!/data-play-card/.test(inn));
  assert.match(inn, /In your games[\s\S]*PICK&#x27;EM[\s\S]*You had CHI[\s\S]*Won · 2 of 3 this week/);
  const pre = view({ state: 'pre', signedIn: true, rows: [{ kind: 'weekly', label: 'WEEKLY', line: 'Allen in your six', value: '1 player', href: '/weekly' }] });
  pre.yours.pre = true;
  const preH = html(pre);
  assert.match(preH, /Allen in your six[\s\S]*data-play-card="1"/, 'before kickoff with no pick: the rows, then the Play card');
  const picked = view({ state: 'pre', signedIn: true, rows: [{ kind: 'pickem', label: "PICK'EM", line: 'You have CHI', value: 'Pending', href: '/pickem/nfl' }] });
  picked.yours.pre = true;
  assert.ok(!/data-play-card/.test(html(picked)), 'a pick made: no Play card');
  const none = html(view({ state: 'pre', signedIn: true }));
  assert.match(none, /<a class="gpa-play"[^>]*href="\/pickem\/nfl"/, 'signed in, nothing of yours: the card goes to the board');
});

test('PLAYS LIST: latest first, five shown, "All plays · N" from the count', () => {
  const h = html(view({ state: 'live' }));
  assert.match(h, /data-gpa="plays"/);
  assert.match(h, /<a class="gpa-all" data-all-plays="165" href="\/nfl\/game\/nfl-2026-reg-w3-phi-chi\?plays=all#gpa-plays">All plays · 165 ›<\/a>/);
  const all = html(view({ state: 'live', plays: { latest: [{ when: 'Q1 15:00', abbr: '', text: 'kickoff' }], total: 1, all: true } }));
  assert.ok(!/gpa-all/.test(all), 'the whole list has no "All plays" link');
  const feed = src('lib/gridiron/gamePageArcade.js');
  assert.match(feed, /SELECT count\(\*\)::int AS n FROM plays WHERE match_id = \$\{matchId\}/);
  assert.match(feed, /LIMIT \$\{limit\}/);
  assert.match(feed, /limit = 5/);
});

test('NO PROSE: no brief, no gloss, no notes, no article links', () => {
  for (const state of ['pre', 'live', 'final']) {
    const h = html(view({ state }));
    assert.ok(!/THE BRIEF|Our live model|still being validated|gg-note|\/article\/|recap/i.test(h), state);
  }
  const page = src('components/gridiron/GamePageArcade.js') + src('lib/gridiron/gamePageArcadeView.js');
  assert.ok(!/getBriefForMatch|LiveWinProb from|BriefPanel|gg-note/.test(page));
});
