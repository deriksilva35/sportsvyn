// lib/rankings/powerZWiring.test.mjs - nfl-power-z around the pure ranking:
// the served tab, the board, the publisher's writes, the cron, the methodology.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { install } from '../testing/nextResolve.mjs';
import { RANKING_TABS, resolveActiveTab, stripTabs } from '../gridiron/rankingsHub.js';

install();
const src = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const OURS = JSON.parse(readFileSync(new URL('./fixtures/nfl-2026-reg-wk1-2-finals.json', import.meta.url), 'utf8'));

test('SERVED, NOT HIDDEN: the Power tab IS nfl-power-z and a bare /nfl/rankings opens on it (tue-13)', () => {
  const tabs = RANKING_TABS.nfl;
  const onPower = resolveActiveTab(tabs, 'power');
  assert.deepEqual(stripTabs(tabs, onPower).map((t) => t.key), ['power', 'mvp-offense', 'mvp-defense', 'playoff']);
  assert.equal(onPower.kind, 'power-z'); assert.equal(onPower.list, 'nfl-power-z');
  assert.equal(resolveActiveTab(tabs, undefined).key, 'power', 'a bare /nfl/rankings opens on the z board');
  // AN OLD REVIEW LINK still lands on the z board: the key is gone, so it falls back to the first tab.
  assert.equal(resolveActiveTab(tabs, 'power-z').key, 'power');
  assert.ok(!tabs.some((t) => t.list === 'nfl-power'), 'the Elo list is not served by any tab');
});

test('the board: rank, team, record, PF adj, PA adj (negated), win%, QoR, power, the plain line and the methodology link', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { default: PowerZBoard } = await import('../../components/gridiron/PowerZBoard.js');
  const board = { editionLabel: 'Week 2 · 2026', rows: [{ rank: 1, team: 'SEA', name: 'Seattle Seahawks', slug: 'seattle-seahawks', record: '2-0', adjPF: 13.5, adjPAShown: 14.5, win: 1, qor: 1, power: 1.4128758521614189 }] };
  const html = renderToStaticMarkup(React.createElement(PowerZBoard, { board }));
  for (const h of ['#', 'Team', 'Record', 'PF adj', 'PA adj', 'Win%', 'QoR', 'Power']) assert.match(html, new RegExp(`<th scope="col">${h.replace('%', '%')}</th>`));
  assert.match(html, /Based on this season&#x27;s games only; early weeks are small samples\.|Based on this season’s games only; early weeks are small samples\./);
  assert.match(html, /<td>\+14\.5<\/td>/, 'PA adj shown negated: higher is better');
  assert.match(html, /<td>1\.000<\/td>/); assert.match(html, /<td>\+1\.413<\/td>/);
  assert.match(html, /href="\/methodology#power-ranking"/);
  assert.match(renderToStaticMarkup(React.createElement(PowerZBoard, { board: null })), /No edition yet/);
});

test('THE PUBLISHER writes one edition of nfl-power-z - 32 entries, the full row in inputs - and never the Elo board or teams', async () => {
  const { publishNflPowerZ } = await import('./publishNflPowerZ.js');
  const calls = [];
  let n = 0;
  const games = OURS.games.map((g, i) => ({ ...g, home_id: 1000 + ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WSH'].indexOf(g.home), away_id: 1000 + ['ARI','ATL','BAL','BUF','CAR','CHI','CIN','CLE','DAL','DEN','DET','GB','HOU','IND','JAX','KC','LAC','LAR','LV','MIA','MIN','NE','NO','NYG','NYJ','PHI','PIT','SEA','SF','TB','TEN','WSH'].indexOf(g.away) }));
  const sql = (strings, ...vals) => {
    const q = strings.join('?'); calls.push({ q, vals }); n += 1;
    if (/FROM matches m/.test(q)) return Promise.resolve(games);
    if (/FROM ranking_lists WHERE slug/.test(q)) return Promise.resolve([{ id: 77 }]);
    if (/FROM ranking_editions\s+WHERE ranking_list_id/.test(q)) return Promise.resolve([]);
    if (/INSERT INTO ranking_editions/.test(q)) return Promise.resolve([{ id: 501 }]);
    return Promise.resolve([]);
  };
  const dry = await publishNflPowerZ({ sql, forWeek: { season: 2026, week: 2 } });
  assert.equal(dry.summary.dryRun, true); assert.ok(!calls.some((c) => /INSERT|UPDATE|DELETE/.test(c.q)), 'a dry run writes nothing');
  assert.deepEqual(dry.summary.top.slice(0, 3), ['1 SEA 1.413', '2 SF 1.314', '3 MIN 1.154'], 'the parity table\'s head');
  calls.length = 0;
  const run = await publishNflPowerZ({ sql, apply: true, forWeek: { season: 2026, week: 2 } });
  assert.equal(run.summary.ok, true); assert.equal(run.summary.editionId, 501);
  const entries = calls.filter((c) => /INSERT INTO ranking_entries/.test(c.q));
  assert.equal(entries.length, 32);
  const sea = JSON.parse(entries[0].vals.at(-1));
  assert.equal(sea.team, 'SEA'); assert.equal(sea.components.adjPA, -14.5, 'adjPA stored RAW'); assert.ok(sea.z.adjPA > 0);
  assert.ok(!calls.some((c) => /UPDATE teams|current_power/.test(c.q)), 'teams.current_power_* untouched');
  assert.ok(!calls.some((c) => c.vals.includes('nfl-power')), 'the Elo list is never addressed');
  assert.ok(calls.some((c) => /SET is_current = true/.test(c.q)), 'the new edition becomes current');
});

test('the Tuesday power-edition cron publishes nfl-power-z on the NFL run, in its own ledger row, with its own alarm', () => {
  const r = src('app/api/cron/power-edition/route.js');
  assert.match(r, /if \(league === 'nfl'\) \{\s*const z = await withAdvisoryLock\(`\$\{SOURCE\}:nfl-power-z`/);
  assert.match(r, /kind: 'nfl-power-z',\s*run: async \(\) => \(await publishNflPowerZ\(\{ apply: true \}\)\)\.summary/);
  assert.match(r, /subject: `\[pollers\] \$\{SOURCE\} FAILED for nfl-power-z`/);
});

test('migration 115 creates the list INACTIVE (hidden) and idempotent; the methodology section explains it', () => {
  const m = src('migrations/115_nfl_power_z_list.sql');
  assert.match(m, /'nfl-power-z'/); assert.match(m, /32, false, 90/); assert.match(m, /ON CONFLICT \(slug\) DO NOTHING/);
  const page = src('app/methodology/page.js');
  assert.match(page, /<h2 id="power-ranking">NFL power ranking<\/h2>/);
  for (const w of ['(25%)', '(12%)', '(55%)', '(8%)', '+0.8', 'costs only 0.2', 'costs 0.8', 'this season&rsquo;s games only']) assert.ok(page.includes(w), w);
});
