// services/live-poller/sweepLostFinals.test.mjs - a final nobody saw is
// still a final (defect 2). Hermetic: its own league, teams and matches on
// a sentinel season, torn down whole.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(REPO, '.env.local'));

const { sql } = await import('../../lib/db.js');
const { sweepLostFinals } = await import('./poll.mjs');

const LG = `sweeptest-${Date.now()}`;
let leagueId; let tA; let tB;
const made = {};
const now = new Date();
const ko = (mins) => new Date(now.getTime() + mins * 60000).toISOString();

async function mk(slug, status, finalSeenAt, kickoff) {
  const meta = finalSeenAt ? { detail: { final_seen_at: finalSeenAt } } : {};
  return (await sql`
    INSERT INTO matches (league_id, slug, kickoff_at, status, home_team_id, away_team_id,
                         season_year, season_phase, week, home_score, away_score,
                         external_ids, metadata)
    VALUES (${leagueId}, ${slug}, ${kickoff}, ${status}, ${tA}, ${tB}, 2092, 'REG', 1, 21, 17,
            '{}'::jsonb, ${JSON.stringify(meta)}::jsonb)
    RETURNING id`)[0].id;
}

await (async () => {
  leagueId = (await sql`INSERT INTO leagues (slug, name, sport, external_ids, metadata)
    VALUES (${LG}, 'Sweep Test', 'cfb', '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  const t = async (s, n) => (await sql`INSERT INTO teams (league_id, slug, name, short_name, external_ids, metadata)
    VALUES (${leagueId}, ${s}, ${n}, ${n}, '{}'::jsonb, '{}'::jsonb) RETURNING id`)[0].id;
  tA = await t(`${LG}-a`, 'Alpha'); tB = await t(`${LG}-b`, 'Beta');

  made.lost      = await mk(`${LG}-lost`,   'final', null, ko(-60));    // in window, unseen
  made.seen      = await mk(`${LG}-seen`,   'final', now.toISOString(), ko(-60)); // already handled
  made.old       = await mk(`${LG}-old`,    'final', null, ko(-60 * 40)); // days old, out of window
  made.live      = await mk(`${LG}-live`,   'live',  null, ko(-30));    // not final
})();

after(async () => {
  await sql`DELETE FROM matches WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM teams WHERE league_id = ${leagueId}`;
  await sql`DELETE FROM leagues WHERE id = ${leagueId}`;
});

test('sweeps exactly the in-window final with no final_seen_at', async () => {
  const seen = [];
  const r = await sweepLostFinals(sql, {
    league: LG, now,
    dispatchFn: async (_s, { match, event }) => { seen.push({ id: match.id, event }); },
  });
  assert.equal(r.considered, 1, 'only the lost one is a candidate');
  assert.equal(r.emitted, 1);
  assert.equal(r.stamped, 1);
  assert.deepEqual(seen, [{ id: made.lost, event: 'final' }], 'dispatched through the normal path, as a final');
});

test('and it stamps final_seen_at, so a second tick is a no-op', async () => {
  const [m] = await sql`SELECT metadata->'detail'->>'final_seen_at' AS f FROM matches WHERE id = ${made.lost}`;
  assert.ok(m.f, 'final_seen_at was written');

  const again = await sweepLostFinals(sql, { league: LG, now, dispatchFn: async () => { throw new Error('must not fire twice'); } });
  assert.equal(again.considered, 0, 'nothing left to sweep');
});

test('a days-old final is NEVER emitted - it is not news', async () => {
  const [m] = await sql`SELECT metadata->'detail'->>'final_seen_at' AS f FROM matches WHERE id = ${made.old}`;
  assert.equal(m.f, null, 'left untouched, outside the poll window');
});

test('an already-seen final and a live match are both left alone', async () => {
  const [s] = await sql`SELECT status FROM matches WHERE id = ${made.live}`;
  assert.equal(s.status, 'live');
  const [f] = await sql`SELECT metadata->'detail'->>'final_seen_at' AS f FROM matches WHERE id = ${made.seen}`;
  assert.equal(f.f, now.toISOString(), 'its original stamp is unchanged');
});

test('the stamp is a NESTED merge - sibling detail keys survive', async () => {
  // CLAUDE.md's own law: `metadata || jsonb` is shallow and would replace
  // the whole detail object. Proven rather than asserted in a comment.
  const id = await mk(`${LG}-sib`, 'final', null, ko(-45));
  await sql`UPDATE matches SET metadata = jsonb_build_object('detail',
      jsonb_build_object('keep_me', 'yes')) WHERE id = ${id}`;
  await sweepLostFinals(sql, { league: LG, now, dispatchFn: async () => {} });
  const [m] = await sql`SELECT metadata->'detail' AS d FROM matches WHERE id = ${id}`;
  assert.equal(m.d.keep_me, 'yes', 'the sibling key survived the stamp');
  assert.ok(m.d.final_seen_at, 'and the stamp landed');
});
