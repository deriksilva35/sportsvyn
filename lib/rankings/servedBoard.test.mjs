// lib/rankings/servedBoard.test.mjs - the SERVED board (tue-13 / wed-1): the NFL
// page mounts nfl-power-z and not the Elo list, the working is the stored
// inputs, the week is the edition's, and the team hero reads the served list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../testing/nextResolve.mjs';
import { powerRating, tiedRanks, rankLabel } from './served.js';
import { SERVED, servedList, getServedBoard, servedRankFor, shapeBoard, storedWeights, workingFor } from './servedBoard.js';
import { boardTitle, editionLine } from './editionKicker.js';
import { RANKING_TABS } from '../gridiron/rankingsHub.js';

install();
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// A fake tagged-template sql: records every query and its bound values, answers by pattern.
function fakeSql(answer) {
  const calls = [];
  const sql = (strings, ...vals) => { const q = strings.join('?'); calls.push({ q, vals }); return Promise.resolve(answer(q, vals)); };
  return { sql, calls };
}

// An nfl-power-z edition as PROD stores it (edition 144's shape): notes carry
// forWeek and the weights, each entry's inputs carry record, components, z, power.
const Z_NOTES = { forWeek: { season: 2026, week: 3 }, weights: { adjPF: 25, adjPA: 12, win: 55, qorB: 8 }, games: 48 };
const zRow = (i, over = {}) => ({
  edition_number: 1, edition_label: 'Week 3 · 2026', published_at: '2026-09-29T13:05:25.443Z',
  notes: JSON.stringify(Z_NOTES), editorial_weight: '0.00', sites_weight: '0.00',
  rank: i + 1, score: (1.35 - i * 0.08).toFixed(2), team_id: 48000 + i, selection_label: null,
  previous_rank: i === 0 ? 2 : null, rank_movement: i === 0 ? 1 : null,
  inputs: { team: `T${i}`, record: { w: 3, l: 0, t: 0, text: '3-0' },
    components: { adjPF: 10.666666666666666, adjPA: -1.6666666666666667, win: 1, qorB: 0.3333333333333333, oppWin: 0.33 },
    z: { adjPF: 1.389909227062731, adjPA: 0.27476649403541675, win: 1.6035674514745464, qorB: 1.0787197799411874 },
    power: 1.3487089667562282 },
  slug: `team-${i}`, name: `Team ${i} Full`, short_name: `Team${i}`, abbreviation: `T${i}`,
  color_primary: null, color_secondary: null,
  ...over,
});
const Z_ROWS = Array.from({ length: 32 }, (_, i) => zRow(i));

test('SERVED names the boards: nfl-power-z for the NFL, cfb-top25 for CFB - and the hub tabs agree', () => {
  assert.equal(servedList('nfl'), 'nfl-power-z');
  assert.equal(servedList('cfb'), 'cfb-top25');
  assert.equal(servedList('epl'), null);
  const tab = (l) => RANKING_TABS[l].find((t) => t.key === SERVED[l].tab);
  assert.equal(tab('nfl').list, SERVED.nfl.list, 'the dark Power tab serves the same list');
  assert.equal(tab('cfb').list, SERVED.cfb.list);
});

test('getServedBoard("nfl") reads nfl-power-z - never the Elo list - and shapes it from the stored edition', async () => {
  const { sql, calls } = fakeSql((q) => (/FROM ranking_lists rl/.test(q) ? Z_ROWS : []));
  const b = await getServedBoard('nfl', { sql });
  assert.ok(calls[0].vals.includes('nfl-power-z'));
  assert.ok(!calls.some((c) => c.vals.includes('nfl-power')), 'the Elo list is never addressed');
  assert.ok(!calls.some((c) => /team_records/.test(c.q)), 'the z entries carry their own record');
  assert.equal(b.list, 'nfl-power-z');
  assert.deepEqual(b.forWeek, { season: 2026, week: 3 });
  assert.equal(b.rows.length, 32);
  assert.equal(b.rows[0].record, '3-0');
  assert.equal(b.scope, 'current season only');
  assert.deepEqual(b.weights.map((w) => [w.key, w.weight, w.pct]), [['adjPF', 25, 25], ['adjPA', 12, 12], ['win', 55, 55], ['qorB', 8, 8]]);
});

test('the CFB board reads cfb-top25 and takes its record from team_records for the edition\'s own season', async () => {
  const cfbRow = { edition_number: 2, edition_label: 'AP week 5 · computed 2026-09-29', published_at: '2026-09-29T15:18:56Z',
    notes: JSON.stringify({ forWeek: { season: 2026, week: 5 }, ap: { season: 2026, week: 5, ranked: 25 } }),
    editorial_weight: '0.70', sites_weight: '0.30', rank: 1, score: '9.48', team_id: 48129, previous_rank: 3, rank_movement: 2,
    inputs: { ap: { rank: 6, score: 9.43 }, elo: 1748.54, field: 138, delta3: 18.96, weights: { sites: 0.3, editorial: 0.7 }, composite: { dims: ['result'], value: 9.5 } },
    slug: 'indiana', name: 'Indiana Hoosiers', short_name: 'Indiana', abbreviation: 'IU' };
  const { sql, calls } = fakeSql((q) => (/FROM ranking_lists rl/.test(q) ? [cfbRow] : /team_records/.test(q) ? [{ team_id: 48129, wins: 5, losses: 0, ties: 0 }] : []));
  const b = await getServedBoard('cfb', { sql });
  assert.ok(calls[0].vals.includes('cfb-top25'));
  const rec = calls.find((c) => /team_records/.test(c.q));
  assert.ok(rec.vals.includes(2026), 'the season is the edition\'s forWeek.season');
  assert.equal(b.rows[0].record, '5-0');
  assert.equal(b.apWeek, 5);
  assert.deepEqual(b.weights.map((w) => [w.label, w.pct]), [['Model', 70], ['AP', 30]]);
});

test('THE WORKING IS THE STORED INPUTS - NFL: four z inputs with their stored weights', () => {
  const b = shapeBoard('nfl', Z_ROWS);
  const w = workingFor('nfl', b.rows[0], b.weights);
  assert.deepEqual(w.lines.map((l) => l.label), ['Adj points for', 'Adj points against', 'Win %', 'Quality of record']);
  assert.deepEqual(w.lines.map((l) => l.value), ['+10.7', '+1.7', '1.000', '+0.33'], 'adjPA stored RAW, shown negated');
  assert.deepEqual(w.lines.map((l) => l.z), ['+1.39', '+0.27', '+1.60', '+1.08']);
  assert.deepEqual(w.lines.map((l) => l.weight), ['25%', '12%', '55%', '8%']);
  assert.equal(w.total.value, '70', 'the stored power as its 0-100 rating: round(50 + 15 * 1.3487)');
  assert.equal(w.total.z, '+1.35', 'with the stored z beside it');
  // CHANGE THE STORED WEIGHTS AND THE WORKING FOLLOWS - nothing is typed.
  const moved = shapeBoard('nfl', Z_ROWS.map((r) => ({ ...r, notes: JSON.stringify({ ...Z_NOTES, weights: { win: 60, adjPF: 40 } }) })));
  const w2 = workingFor('nfl', moved.rows[0], moved.weights);
  assert.deepEqual(w2.lines.map((l) => [l.label, l.weight]), [['Win %', '60%'], ['Adj points for', '40%']]);
  assert.deepEqual(storedWeights('nfl', { notes: null }), [], 'no stored weights, no weights');
});

test('THE WORKING IS THE STORED INPUTS - CFB: Elo, AP rank and the curved score; unranked is model-only', () => {
  const ed = { editorial_weight: '0.70', sites_weight: '0.30' };
  const weights = storedWeights('cfb', ed);
  const ranked = { score: 9.48, inputs: { ap: { rank: 6, score: 9.43 }, elo: 1748.54, field: 138, delta3: 18.96, composite: { value: 9.5 } } };
  const w = workingFor('cfb', ranked, weights);
  const by = Object.fromEntries(w.lines.map((l) => [l.key, l]));
  assert.equal(by.elo.value, '1748.5');
  assert.equal(by.apRank.value, '#6');
  assert.equal(by.apCurved.value, '9.43'); assert.equal(by.apCurved.label, 'AP curved (138 teams)');
  assert.equal(by.model.weight, '70%'); assert.equal(by.apCurved.weight, '30%');
  assert.equal(w.total.value, '9.48');
  const unranked = workingFor('cfb', { score: 7.1, inputs: { ap: null, elo: 1601, field: 138, composite: { value: 7.1 } } }, weights);
  const u = Object.fromEntries(unranked.lines.map((l) => [l.key, l]));
  assert.equal(u.apRank.value, 'unranked'); assert.equal(u.model.weight, '100%'); assert.equal(u.apCurved.value, null);
  assert.equal(workingFor('cfb', { inputs: null }, weights), null, 'no blob, no working');
});

test('THE WEEK LABEL IS THE EDITION\'S forWeek, never a literal', () => {
  assert.equal(boardTitle('NFL', { season: 2026, week: 3 }), 'NFL · WEEK 3');
  assert.equal(boardTitle('NFL', { season: 2026, week: 11 }), 'NFL · WEEK 11');
  assert.equal(boardTitle('CFB', null), 'CFB · PRESEASON');
  assert.equal(editionLine({ editionNumber: 1, publishedAt: '2026-09-29T13:05:25Z', scope: 'current season only' }, 'America/Los_Angeles'),
    'Edition 1 · computed Tue 6:05 AM PDT · current season only');
  // and the component takes it from the board, not from a typed number
  const board = strip(src('components/rankings/ArcadeBoard.js'));
  assert.match(board, /boardTitle\(leagueLabel, board\?\.forWeek\)/);
  assert.doesNotMatch(board, /WEEK \d/);
});

async function render(el) {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: ArcadeBoard } = await import('../../components/rankings/ArcadeBoard.js');
  return renderToStaticMarkup(React.createElement(ArcadeBoard, el));
}

test('THE NFL PAGE MOUNTS THE z BOARD: the hub\'s arcade branch reads the served list and draws board A', async () => {
  const hub = strip(src('components/gridiron/RankingsHub.js'));
  assert.match(hub, /getServedBoard\(leagueSlug\)/);
  assert.match(hub, /<ArcadeBoard leagueSlug=\{leagueSlug\}/);
  assert.match(hub, /arcadeFor\(isShell\)/);
  assert.doesNotMatch(hub, /'nfl-power'/, 'no Elo slug in the hub');
  const board = shapeBoard('nfl', Z_ROWS);
  const html = await render({ leagueSlug: 'nfl', leagueLabel: 'NFL', board, tz: 'America/New_York' });
  assert.match(html, /data-board="nfl-power-z"/);
  assert.match(html, />NFL · WEEK 3</);
  assert.match(html, />SPORTSVYN POWER</);
  assert.match(html, /Edition 1 · computed Tue 9:05 AM EDT · current season only/);
  assert.equal((html.match(/class="rka-li/g) ?? []).length, 10, 'top 10 by default');
  assert.match(html, />ALL 32</);
  assert.match(html, /class="rka-chip on" aria-current="page" href="\/nfl\/rankings">NFL</);
  assert.match(html, /Adj points for 25% · Adj points against 12% · Win % 55% · Quality of record 8%\./);
  assert.equal((html.match(/rka-work"/g) ?? []).length, 0, 'nothing open');
  const all = await render({ leagueSlug: 'nfl', leagueLabel: 'NFL', board, all: true });
  assert.equal((all.match(/class="rka-li/g) ?? []).length, 32);
  assert.match(all, />TOP 10</);
});

test('EXACTLY ONE ROW OPENS, to its working; a row beyond the top N opens the field', async () => {
  const board = shapeBoard('nfl', Z_ROWS);
  const html = await render({ leagueSlug: 'nfl', leagueLabel: 'NFL', board, open: 'team-0' });
  assert.equal((html.match(/aria-expanded="true"/g) ?? []).length, 1);
  assert.equal((html.match(/data-working="nfl"/g) ?? []).length, 1);
  assert.match(html, /TEAM0 · THE WORKING/);
  assert.match(html, /href="\/nfl\/rankings\?open=team-1"/, 'another row\'s link opens IT, closing this one');
  assert.match(html, /aria-expanded="true"[^>]*href="\/nfl\/rankings"|href="\/nfl\/rankings"[^>]*aria-expanded="true"/, 'the open row\'s link closes it');
  const deep = await render({ leagueSlug: 'nfl', leagueLabel: 'NFL', board, open: 'team-29' });
  assert.equal((deep.match(/class="rka-li/g) ?? []).length, 32);
  assert.equal((deep.match(/aria-expanded="true"/g) ?? []).length, 1);
  // A TIE AT THE CUT keeps both: the top N is by rank, not by position.
  const tied = shapeBoard('cfb', Array.from({ length: 30 }, (_, i) => zRow(i, { rank: i === 25 ? 25 : i + 1, notes: '{}' })));
  const t = await render({ leagueSlug: 'cfb', leagueLabel: 'CFB', board: tied });
  assert.equal((t.match(/class="rka-li/g) ?? []).length, 26);
  assert.match(t, />ALL 30</);
  const none = await render({ leagueSlug: 'nfl', leagueLabel: 'NFL', board: null });
  assert.match(none, /No edition yet/);
});

test('THE HERO READS THE SERVED LIST: servedRankFor addresses nfl-power-z / cfb-top25, and the page passes it', async () => {
  const { sql, calls } = fakeSql(() => [{ rank: 4, score: '0.91', rank_movement: -2 }]);
  const p = await servedRankFor('nfl', 48086, { sql });
  assert.deepEqual(p, { rank: 4, score: 64, rating: true, movement: -2, label: 'Power' }, 'NFL score shown as round(50 + 15 * 0.91)');
  assert.ok(calls[0].vals.includes('nfl-power-z') && calls[0].vals.includes(48086));
  assert.ok(!calls.some((c) => c.vals.includes('nfl-power')));
  const c = fakeSql(() => []);
  assert.equal(await servedRankFor('cfb', 1, { sql: c.sql }), null);
  assert.ok(c.calls[0].vals.includes('cfb-top25'));
  const page = strip(src('app/team/[slug]/page.js'));
  assert.match(page, /servedRankFor\(leagueSlug, team\.id\)/);
  assert.match(page, /<TeamHero [^>]*power=\{power\}/);

  const { heroPower } = await import('../../components/team/heroPower.js');
  // THE ELO COLUMNS ON `team` ARE IGNORED when the served list is passed.
  const team = { id: 1, current_power_rank: 9, current_power_score: 5.5, current_rank_movement: 3 };
  assert.deepEqual(heroPower(team, { rank: 4, score: 0.91, movement: -2, label: 'Power' }), { rank: 4, score: 0.91, movement: -2, label: 'Power' });
  assert.equal(heroPower(team, null), null, 'not on the served board: no block, no Elo fallback');
  assert.equal(heroPower(team).rank, 9, 'a page that passes nothing reads the columns, as before');
  const hero = strip(src('components/team/TeamHero.js'));
  assert.match(hero, /const p = heroPower\(team, power\);/);
  assert.match(hero, /\{p\.rank\}/);
  assert.doesNotMatch(hero, /\{team\.current_power_rank\}/, 'the block draws p, never the column directly');
});

test('THE NFL POWER DISPLAYS AS A 0-100 RATING: round(50 + 15z), clamped both ends (wed-6)', () => {
  assert.equal(powerRating(0), 50);
  assert.equal(powerRating(1.3487089667562282), 70);
  assert.equal(powerRating(-1.2), 32);
  assert.equal(powerRating(0.1), 52, '51.5 rounds up');
  assert.equal(powerRating(-0.1), 49, '48.5 rounds up');
  assert.equal(powerRating(3.4), 100, '101 clamps to 100');
  assert.equal(powerRating(9), 100);
  assert.equal(powerRating(-3.4), 0, '-1 clamps to 0');
  assert.equal(powerRating(-9), 0);
  assert.equal(powerRating(null), null); assert.equal(powerRating('x'), null);
});

test('THE BOARD SHOWS THE RATING, CFB IS UNCHANGED, and the stored values are not touched', async () => {
  const board = shapeBoard('nfl', Z_ROWS);
  const html = await render({ leagueSlug: 'nfl', leagueLabel: 'NFL', board });
  assert.match(html, /<span class="rka-pw">70<\/span>/, 'inputs.power 1.3487 -> 70');
  assert.equal(board.rows[0].score, 1.35, 'the shaped row keeps the stored SDs');
  assert.match(html, /<span class="c-pw">PWR<\/span>/, 'the NFL column is still PWR');
  // /rankings and the hero go through the same function
  assert.match(strip(src('components/rankings/Rankings.js')), /value=\{powerRating\(r\.inputs\?\.power \?\? r\.score\)\}/);
});

test('TIES PRINT AS T-n, at the cut and everywhere, and both teams are shown (wed-6)', async () => {
  assert.deepEqual([...tiedRanks([1, 2, 2, 4, 25, 25, null])].sort((a, b) => a - b), [2, 25]);
  assert.equal(rankLabel(25, new Set([25])), 'T-25'); assert.equal(rankLabel(3, new Set([25])), '3');
  const rows = Array.from({ length: 12 }, (_, i) => zRow(i, { rank: i < 10 ? i + 1 : 10 }));
  const html = await render({ leagueSlug: 'nfl', leagueLabel: 'NFL', board: shapeBoard('nfl', rows) });
  assert.equal((html.match(/class="rka-li/g) ?? []).length, 12, 'the three teams at 10 are all inside the top 10');
  assert.equal((html.match(/>T-10</g) ?? []).length, 3);
  assert.doesNotMatch(html, /class="rka-n">10</, 'no bare 10 beside a tie');
});

test('THE SELECTED CHIP IS VOLT WITH NAVY INK, and the sheet is under the volt guards (wed-6)', () => {
  const css = src('components/rankings/arcadeBoard.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.rka-chip\.on \{ background: var\(--tok-action\); border-color: var\(--tok-action\); color: var\(--tok-on-action\); \}/);
  assert.match(src('app/voltContrast.test.mjs'), /'components\/rankings\/arcadeBoard\.css'/);
});

test('A LISTED CFB TEAM\'S WORKING leads with its editor rank, then Elo, AP rank and score (wed-6)', () => {
  const weights = storedWeights('cfb', { editorial_weight: '0.70', sites_weight: '0.30' });
  const w = workingFor('cfb', { score: 8.91, inputs: { editor: { rank: 1, score: 9.9 }, ap: { rank: 4, score: 9.5 }, elo: 1702.3, field: 138, composite: { value: 8.6 } } }, weights);
  assert.deepEqual(w.lines.map((l) => l.key), ['editor', 'elo', 'model', 'apRank', 'apCurved']);
  assert.equal(w.lines[0].value, '#1');
  assert.equal(w.total.value, '8.91');
  const unlisted = workingFor('cfb', { score: 7, inputs: { editor: null, ap: null, elo: 1600, composite: { value: 7 } } }, weights);
  assert.ok(!unlisted.lines.some((l) => l.key === 'editor'), 'no editor line for an unlisted team');
});

test('/rankings, /rankings/teams and the topic drafts read the SERVED slug, not is_active; the model\'s case is the head of 26+', () => {
  const reads = strip(src('lib/rankings/reads.js'));
  assert.match(reads, /export const nflPower = \(opts = \{\}\) => editionEntries\(servedList\('nfl'\), opts\);/);
  assert.match(reads, /export const ourTop25 = \(opts = \{\}\) => editionEntries\(servedList\('cfb'\), opts\);/);
  assert.doesNotMatch(reads.replace(/--.*$/gm, ''), /is_active/, 'the flag answers nothing: nfl-power-z is served and inactive');
  assert.doesNotMatch(reads, /'nfl-power'|'cfb-top25'/);
  const mc = reads.slice(reads.indexOf('export async function modelCase'));
  assert.match(mc.slice(0, 900), /re\.editor_rank IS NULL/);
  assert.match(mc.slice(0, 900), /ORDER BY re\.rank ASC/, 'by the 26+ order, not by Elo');
  assert.doesNotMatch(mc.slice(0, 900), /ORDER BY re\.elo/);
  assert.match(strip(src('app/rankings/teams/page.js')), /const listSlug = servedList\(league\);/);
  assert.match(strip(src('lib/rankings/view.js')), /modelCase\(servedList\('cfb'\)\)/);
  assert.match(strip(src('lib/topicDraftLeagues.js')), /\{ list: servedList\('nfl'\), label: 'Power Rankings' \}/);
});

test('CFB\'S RIGHT-HAND COLUMN IS THE AP RANK (wed-7): "AP n", an em dash when unranked; the score lives in the working', async () => {
  const cfbRows = [
    zRow(0, { score: '9.65', notes: '{}', inputs: { ap: { rank: 8, score: 9.1 }, elo: 1700, field: 138, composite: { value: 9.5 } } }),
    zRow(1, { score: '8.60', notes: '{}', inputs: { ap: null, elo: 1690, field: 138, composite: { value: 8.6 } } }),
  ];
  const board = shapeBoard('cfb', cfbRows);
  const html = await render({ leagueSlug: 'cfb', leagueLabel: 'CFB', board });
  assert.match(html, /<span class="c-pw">AP<\/span>/);
  assert.match(html, /<span class="rka-pw">AP 8<\/span>/);
  assert.match(html, /<span class="rka-pw">—<\/span>/);
  assert.doesNotMatch(html, /rka-pw">9\.65|rka-pw">8\.60/, 'the composite is not a column');
  const open = await render({ leagueSlug: 'cfb', leagueLabel: 'CFB', board, open: 'team-0' });
  assert.match(open, /data-line="total"><dt>Score<\/dt><dd><b>9\.65<\/b>/, 'the score is the working\'s Score line');
});
