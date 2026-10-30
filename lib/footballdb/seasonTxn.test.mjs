// lib/footballdb/seasonTxn.test.mjs — a season is atomic: mid-season failure
// rolls back every nfl_players mint and every season_totals row; success
// commits. No database: a fake pg client keeps committed state plus a
// transaction snapshot, so ROLLBACK really discards what the season wrote.

import test from 'node:test';
import assert from 'node:assert/strict';
import { txSql, inSeasonTransaction, upsertSeasonTotal } from './seasonTxn.js';
import { loadCandidateIndex, resolveAndPersistIdentity } from './identity.js';

function fakeClient({ failOnTotalsInsert = null } = {}) {
  const log = [];
  let committed = { players: [{ id: 1, normalized_name: 'old guy', position: 'QB' }], totals: [] };
  let live = null;
  let nextId = 100;
  let totalsInserts = 0;
  return {
    log,
    get state() { return committed; },
    async query(text, values = []) {
      const t = text.trim();
      log.push(t.split(/\s+/).slice(0, 3).join(' '));
      if (t === 'BEGIN') { live = structuredClone(committed); return { rows: [] }; }
      if (t === 'COMMIT') { committed = live; live = null; return { rows: [] }; }
      if (t === 'ROLLBACK') { live = null; return { rows: [] }; }
      assert.ok(live, `query outside a transaction: ${t}`);
      if (t.startsWith('SELECT id, normalized_name')) return { rows: live.players };
      if (t.startsWith('INSERT INTO nfl_players')) {
        const row = { id: nextId += 1, normalized_name: values[3], position: values[4] };
        live.players.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (t.startsWith('INSERT INTO nfl_player_season_totals')) {
        totalsInserts += 1;
        if (failOnTotalsInsert && totalsInserts === failOnTotalsInsert) throw new Error('check constraint violated');
        live.totals.push({ nfl_player_id: values[0], season_year: values[1] });
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${t}`);
    },
  };
}

const ROWS = ['Old Guy', 'New One', 'New Two', 'New Three'];
const totalsRow = (id) => ({
  nflPlayerId: id, season_year: 2000, team_key: 'X', position: 'QB', games: 1,
  pass_cmp: null, pass_att: null, pass_yds: null, pass_td: null, pass_int: null,
  rush_att: null, rush_yds: null, rush_td: null, rush_long: null,
  rec: null, rec_yds: null, rec_td: null, rec_long: null,
  fgm: null, fga: null, fg_long: null, xp: null, sacks: null, def_int: null, def_td: null,
  matched_by: 'x', raw_name: 'x',
});

async function season(db) {
  const idx = await loadCandidateIndex(db);
  const written = [];
  for (const name of ROWS) {
    const r = await resolveAndPersistIdentity(db, name, 'QB', idx, { apply: true });
    written.push(totalsRow(r.nflPlayerId));
  }
  for (const w of written) await upsertSeasonTotal(db, w);
}

test('txSql turns a tagged template into $n placeholders and returns rows', async () => {
  const seen = [];
  const sql = txSql({ query: async (text, values) => { seen.push([text, values]); return { rows: [{ ok: 1 }] }; } });
  const rows = await sql`SELECT ${'a'} , ${2} FROM t`;
  assert.deepEqual(rows, [{ ok: 1 }]);
  assert.deepEqual(seen[0], ['SELECT $1 , $2 FROM t', ['a', 2]]);
});

test('a failure mid-season rolls back: zero season_totals rows, zero minted players', async () => {
  const client = fakeClient({ failOnTotalsInsert: 3 });
  await assert.rejects(inSeasonTransaction(client, season), /check constraint violated/);
  assert.equal(client.state.totals.length, 0);
  assert.equal(client.state.players.length, 1, 'only the pre-existing player remains');
  assert.equal(client.log.at(-1), 'ROLLBACK');
  assert.ok(!client.log.includes('COMMIT'));
});

test('a successful season commits its mints and its totals', async () => {
  const client = fakeClient();
  await inSeasonTransaction(client, season);
  assert.equal(client.state.totals.length, 4);
  assert.equal(client.state.players.length, 4, '1 existing + 3 minted');
  assert.equal(client.log[0], 'BEGIN');
  assert.equal(client.log.at(-1), 'COMMIT');
  assert.ok(!client.log.includes('ROLLBACK'));
});

test('an earlier committed season survives a later season failing', async () => {
  const client = fakeClient();
  await inSeasonTransaction(client, season);
  const before = client.state.totals.length;
  await assert.rejects(inSeasonTransaction(client, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(client.state.totals.length, before);
});
