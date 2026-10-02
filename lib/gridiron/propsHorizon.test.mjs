// lib/gridiron/propsHorizon.test.mjs - EPL props price only fixtures kicking off
// within 48h, and a leg with nothing in scope makes no call at all (thu-33).
// DEV fixture: two sentinel EPL matches in one sentinel week, slugs carrying
// "test", torn down and asserted. Run: node --test lib/gridiron/propsHorizon.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROPS_HORIZON_HOURS, propsScope } from './propsIngest.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (r) => readFileSync(path.join(REPO, r), 'utf8');

test('THE RULE: EPL 48h; NFL and CFB keep their week / board scope', () => {
  assert.equal(PROPS_HORIZON_HOURS.epl, 48);
  assert.equal(PROPS_HORIZON_HOURS.nfl, undefined);
  assert.equal(PROPS_HORIZON_HOURS.cfb, undefined);
});

test('NOTHING IN SCOPE MAKES NO CALL: the early return precedes every fetch, and the route reads no budget from it', () => {
  const s = src('lib/gridiron/propsIngest.js');
  const fn = s.slice(s.indexOf('export async function ingestSportProps'));
  const skip = fn.indexOf("if (!scope.length) return { skipped: 'nothing in scope'");
  assert.ok(skip > 0, 'the skip exists');
  assert.ok(skip < fn.indexOf('fetchSportEvents('), 'before the (free) events call');
  assert.ok(skip < fn.indexOf('fetchEventProps('), 'and before any paid call');
  assert.match(src('app/api/cron/gridiron-props/route.js'), /const warn = res\.summary\?\.skipped \? null : keyAlert\(/);
});

const { sql } = await import('../db.js');
const TAG = `propshz-test-${process.pid}`;
const made = [];
let league; let home; let away;
before(async () => {
  [{ id: league }] = await sql`SELECT id FROM leagues WHERE slug = 'epl' LIMIT 1`;
  [home, away] = (await sql`SELECT id FROM teams WHERE league_id = ${league} ORDER BY id LIMIT 2`).map((t) => t.id);
});
after(async () => {
  await sql`DELETE FROM matches WHERE id = ANY(${made}::int[])`;
  const [{ n }] = await sql`SELECT count(*)::int n FROM matches WHERE slug LIKE ${`${TAG}-%`}`;
  assert.equal(n, 0, 'the fixture tears itself down');
});

test('THE SCOPE ON DEV: the fixture 1h out is priced, its matchweek-mate 60h out is not', async () => {
  const mk = async (tag, hours) => {
    const [m] = await sql`
      INSERT INTO matches (league_id, slug, home_team_id, away_team_id, kickoff_at, status, season_year, week)
      VALUES (${league}, ${`${TAG}-${tag}`}, ${home}, ${away}, now() + make_interval(hours => ${hours}::int),
              'scheduled', 2026, 99)
      RETURNING id`;
    made.push(m.id); return m.id;
  };
  const near = await mk('near', 1);
  const far = await mk('far', 60);
  const ids = (await propsScope(sql, { leagueSlug: 'epl' })).map((r) => r.id);
  assert.ok(ids.includes(near), 'inside 48h');
  assert.ok(!ids.includes(far), 'same week, outside 48h');
});
