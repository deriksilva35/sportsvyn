// lib/leagues/joinByCode.test.mjs - a player league is joined by its CODE and
// by nothing else. League ids are serial: a join keyed on one let any signed-in
// reader walk into every league by counting. That path (joinLeagueById /
// joinLeagueByIdAction / the preview's one-tap button) is gone; this pins it
// gone and proves the code path still works end to end on DEV.
//
// Fixture: two SENTINEL users (@example.invalid, found by
// scripts/dev-orphan-sweep.mjs if a killed run leaves them) and the one league
// the owner creates. after() removes all three and asserts it did.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const core = await import('./core.js');
const { sql } = await import('../db.js');

const NS = `joinbycode-${process.pid}-${Date.now()}`;
let owner; let joiner; let league;

before(async () => {
  [owner] = await sql`INSERT INTO users (email) VALUES (${`${NS}-owner@example.invalid`}) RETURNING id`;
  [joiner] = await sql`INSERT INTO users (email) VALUES (${`${NS}-joiner@example.invalid`}) RETURNING id`;
  league = await core.createLeague(owner.id, `Test ${NS}`.slice(0, 40));
  assert.equal(league.ok, true, 'fixture league created');
});

after(async () => {
  if (league?.leagueId) {
    await sql`DELETE FROM league_members WHERE league_id = ${league.leagueId}`;
    await sql`DELETE FROM player_leagues WHERE id = ${league.leagueId}`;
  }
  await sql`DELETE FROM users WHERE email LIKE ${`${NS}-%@example.invalid`}`;
  const [{ n }] = await sql`
    SELECT (SELECT count(*) FROM users WHERE email LIKE ${`${NS}-%@example.invalid`})
         + (SELECT count(*) FROM player_leagues WHERE id = ${league?.leagueId ?? -1}) AS n`;
  assert.equal(Number(n), 0, 'teardown left nothing behind');
});

test('joinLeague by code makes a member; a wrong code does not', async () => {
  const wrong = await core.joinLeague(joiner.id, 'ZZZZZZ' === league.joinCode ? 'YYYYYY' : 'ZZZZZZ');
  assert.equal(wrong.ok, false);
  const short = await core.joinLeague(joiner.id, 'ABC');
  assert.equal(short.ok, false);
  assert.equal(await core.leagueDetail(league.leagueId, joiner.id), null, 'not a member before the code');

  const res = await core.joinLeague(joiner.id, ` ${league.joinCode.toLowerCase()} `);
  assert.equal(res.ok, true);
  assert.equal(res.leagueId, league.leagueId);
  const detail = await core.leagueDetail(league.leagueId, joiner.id);
  assert.ok(detail, 'a member after the code');
  assert.equal(detail.members.length, 2);

  const again = await core.joinLeague(joiner.id, league.joinCode);
  assert.equal(again.ok, true, 'joining twice is idempotent');
  const [{ n }] = await sql`SELECT count(*)::int n FROM league_members WHERE league_id = ${league.leagueId}`;
  assert.equal(n, 2);
});

test('there is no join by league id - not in lib, not in an action, not in the UI', async () => {
  assert.equal(core.joinLeagueById, undefined, 'lib/leagues/core exports no id join');
  const actions = stripComments(src('app/actions/leagues.js'));
  assert.ok(!/joinLeagueById/.test(actions), 'no id-join server action');
  // Walk every source file: nothing anywhere names the removed path.
  const hits = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.') || name === 'test-tmp') continue;
      const p = path.join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (/\.(js|jsx|mjs|ts|tsx)$/.test(name) && !name.endsWith('.test.mjs')
        && /joinLeagueById/.test(stripComments(readFileSync(p, 'utf8')))) hits.push(path.relative(REPO, p));
    }
  };
  for (const d of ['app', 'components', 'lib']) walk(path.join(REPO, d));
  assert.deepEqual(hits, [], 'no source names joinLeagueById');
});

test('the non-member preview asks for the code - no button that joins on the id', () => {
  const page = stripComments(src('app/leagues/[id]/page.js'));
  const nonMember = page.slice(page.indexOf('if (!league)'), page.indexOf('const memberIds = await leagueMemberIds'));
  assert.ok(nonMember.length > 0);
  assert.ok(!/JoinLeagueButton|leagueId=\{leagueId\} name=/.test(nonMember), 'no one-tap id join');
  assert.match(nonMember, /<JoinWithCodeForm /);
  assert.match(nonMember, /Ask a member for the invite code\./);
  const chrome = stripComments(src('components/leagues/LeagueChrome.js'));
  assert.ok(!/JoinLeagueButton/.test(chrome));
  // The form joins through the CODE action, with the code it was given.
  assert.match(chrome, /import \{ joinLeagueAction \} from '@\/app\/actions\/leagues'/);
  assert.match(chrome, /fd\.set\('code', code\)/);
});
