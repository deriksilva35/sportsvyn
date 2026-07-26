// Futures math + parsing + reader-shape. Loads .env.local (modules import db).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p){let t;try{t=readFileSync(p,"utf8");}catch{return;}for(const line of t.split("\n")){const s=line.trim();if(!s||s.startsWith("#"))continue;const eq=s.indexOf("=");if(eq<0)continue;const k=s.slice(0,eq).trim();let v=s.slice(eq+1).trim();if(v.startsWith(String.fromCharCode(34))&&v.endsWith(String.fromCharCode(34)))v=v.slice(1,-1);if(!process.env[k])process.env[k]=v;}})(path.resolve(__dirname, '..', '..', '.env.local'));

const { devigField } = await import('../odds.js');
const { collectOutrightField } = await import('./oddsIngest.js');
const { shapeContenders } = await import('./oddsReader.js');

const near = (a, b, e = 0.05) => assert.ok(Math.abs(a - b) <= e, `${a} !~= ${b}`);

test('devigField: even pair sums to 100', () => {
  const p = devigField([2, 2]);
  near(p[0], 50); near(p[1], 50); near(p[0] + p[1], 100);
});
test('devigField: full field normalizes to ~100 incl. a longshot Field outcome', () => {
  const p = devigField([1.5, 3, 100]); // last ~= "Field" longshot
  near(p.reduce((a, x) => a + x, 0), 100);
  assert.ok(p[0] > p[1] && p[1] > p[2]); // favorite highest, field lowest
});
test('devigField: null on empty / unpriceable', () => {
  assert.equal(devigField([]), null);
  assert.equal(devigField([0]), null);
});

test('collectOutrightField: gathers prices per outcome across books', () => {
  const events = [{ bookmakers: [
    { title: 'DK', markets: [{ key: 'outrights', outcomes: [{ name: 'Chiefs', price: 6 }, { name: 'Bills', price: 8 }] }] },
    { title: 'FD', markets: [{ key: 'outrights', outcomes: [{ name: 'Chiefs', price: 6.5 }, { name: 'Bills', price: 7.5 }] }] },
  ] }];
  const { byName, books } = collectOutrightField(events);
  assert.deepEqual(byName.get('Chiefs'), [6, 6.5]);
  assert.deepEqual(byName.get('Bills'), [8, 7.5]);
  assert.deepEqual(books, ['DK', 'FD']);
});

test('shapeContenders: ranks in row order + maps fields', () => {
  const rows = [
    { team_id: 1, team_name: 'Kansas City Chiefs', team_abbr: 'KC', team_slug: 'kc', selection_label: 'Kansas City Chiefs', implied: 18.2, american: -120, move_prob: 1.1, num_books: 6, source_books: ['DK'], fetched_at: '2026-07-25T09:00:00Z' },
    { team_id: 2, team_name: 'Buffalo Bills', team_abbr: 'BUF', team_slug: 'buf', selection_label: 'Buffalo Bills', implied: 12.0, american: 140, move_prob: null, num_books: 6, source_books: ['DK'], fetched_at: '2026-07-25T09:00:00Z' },
  ];
  const c = shapeContenders(rows);
  assert.equal(c[0].rank, 1); assert.equal(c[0].abbr, 'KC'); assert.equal(c[0].impliedPct, 18.2); assert.equal(c[0].moveProb, 1.1);
  assert.equal(c[1].rank, 2); assert.equal(c[1].moveProb, null);
});
