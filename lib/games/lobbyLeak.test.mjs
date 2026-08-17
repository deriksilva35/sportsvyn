// lib/games/lobbyLeak.test.mjs - the lobby's serialized payloads.
//
// /games AGGREGATES FOUR GAMES AT ONCE, which makes it the likeliest place in
// the product for an open-day result to leak by accident. The standings law
// applies to every number on the page, so this asserts on the SERIALIZED view
// - what actually reaches a browser - for both a signed-out and a signed-in
// reader, exactly as the ruling asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
(function loadEnv(p) {
  let t; try { t = readFileSync(p, 'utf8'); } catch { return; }
  for (const line of t.split('\n')) {
    const s = line.trim(); if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('='); if (eq < 0) continue;
    const k = s.slice(0, eq).trim(); let v = s.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
})(path.resolve(__dirname, '..', '..', '.env.local'));

const { sql } = await import('../db.js');
const { gamesLobby } = await import('./read.js');
const { cardState, seasonStrip, boardSection } = await import('./lobby.js');

/** Today's answer, straight from the row - the thing that must never appear. */
async function openDayAnswer() {
  const r = await sql`
    SELECT to_char(puzzle_date,'YYYY-MM-DD') d, season_year, week
      FROM puzzle_days WHERE NOT revealed ORDER BY puzzle_date LIMIT 1`;
  return r[0] ?? null;
}

test('LEAK: a SIGNED-OUT fetch carries no open-board answer', async () => {
  const open = await openDayAnswer();
  const v = await gamesLobby(null);
  const wire = JSON.stringify(v);

  if (open) {
    // The season of a day that has not revealed must not appear anywhere -
    // not in a card, not in history, not in a board.
    const sealed = v.history.find((h) => h.date === open.d);
    assert.ok(sealed, 'the open day appears as a row');
    assert.equal(sealed.sealed, true, 'and it is sealed');
    assert.equal(sealed.season, undefined, 'a sealed row carries no season');
    assert.equal(sealed.week, undefined, 'nor a week');
    assert.equal(sealed.perfect, undefined, 'nor a perfect total');
    assert.equal(sealed.top, undefined, 'nor anybody\'s score');
  }
  assert.equal(v.signedIn, false);
  assert.equal(v.season, null, 'no per-user strip for a stranger');
  assert.equal(/"you":\{/.test(wire), false, 'no per-user block at all');
});

test('LEAK: a SIGNED-IN fetch carries the reader\'s own state and nobody else\'s open-day result', async () => {
  const u = await sql`SELECT user_id FROM puzzle_entries ORDER BY id DESC LIMIT 1`;
  if (!u.length) return;                       // nothing to assert against yet
  const uid = u[0].user_id;
  const v = await gamesLobby(uid);

  // Their own card state is theirs to know.
  const daily = v.cards.find((c) => c.key === 'daily');
  assert.ok(daily, 'the Daily card renders');

  // Every history row is either sealed or revealed - never a third state that
  // shows a score for an open day.
  for (const h of v.history) {
    if (h.sealed) {
      assert.equal(h.season, undefined, `${h.date}: sealed rows say nothing`);
      assert.equal(h.top, undefined);
    } else {
      assert.ok(h.season != null, `${h.date}: a revealed row has an answer`);
    }
  }

  // Boards are through-revealed by construction - overall() enforces it - so
  // the label must be present whenever a board is live.
  const overall = v.boards.find((b) => b.key === 'overall');
  if (overall.state === 'live') {
    assert.ok(overall.table.through, 'a live board states what it is through');
  }
});

test('LEAK: no OTHER player\'s open-day score appears for any viewer', async () => {
  // Construct the exact risk: a rival with a locked score on an OPEN day.
  const open = await openDayAnswer();
  if (!open) return;
  const rivals = await sql`
    SELECT e.user_id, e.score FROM puzzle_entries e
     WHERE e.puzzle_date = ${open.d} AND e.locked_at IS NOT NULL AND e.score IS NOT NULL`;
  if (!rivals.length) return;

  for (const viewer of [null, rivals[0].user_id]) {
    const wire = JSON.stringify(await gamesLobby(viewer));
    for (const r of rivals) {
      if (String(r.user_id) === String(viewer)) continue;   // their own is fine
      assert.equal(wire.includes(String(r.score)), false,
        `a rival's open-day score ${r.score} reached viewer ${viewer}`);
    }
  }
});

// ---------------------------------------------------------------------------
// CARD STATE IS DATA
// ---------------------------------------------------------------------------

test('a game with no contest is GHOSTED, and says when rather than teasing', () => {
  const c = cardState({ key: 'weekly', contest: null, opensLabel: 'Opens Sep 8' });
  assert.equal(c.state, 'ghost');
  assert.equal(c.playable, false);
  assert.equal(c.opensLabel, 'Opens Sep 8');
  assert.equal(c.you, undefined, 'a ghosted card carries no per-user block');
});

test('a card FLIPS LIVE on the contest existing, not on a date', () => {
  // This is what lets Aug 25 and Sep 8 happen without a deploy.
  const before = cardState({ key: 'pickem', contest: null, opensLabel: 'Opens Aug 25' });
  const after = cardState({ key: 'pickem', contest: { closesLabel: 'first lock Thu' } });
  assert.equal(before.state, 'ghost');
  assert.equal(after.state, 'open');
  assert.equal(after.playable, true);
});

test('a card never carries another player\'s anything', () => {
  const c = cardState({ key: 'daily', contest: {}, mine: { entered: true, score: 92.1 } });
  assert.deepEqual(Object.keys(c.you).sort(), ['score', 'streak', 'tier']);
});

test('a board with nothing to show says WHEN, not nothing', () => {
  const b = boardSection({ key: 'pickem', name: 'Pick em', populatesLabel: 'Populates Aug 29' });
  assert.equal(b.state, 'pending');
  assert.equal(b.populatesLabel, 'Populates Aug 29');
  const live = boardSection({ key: 'overall', name: 'Overall', table: { top: [{ userId: 1 }] } });
  assert.equal(live.state, 'live');
});

test('the season strip is absent for a reader with no standing at all', () => {
  assert.equal(seasonStrip({}), null);
  assert.equal(seasonStrip({ standing: { points: 3 } })?.points, 3);
});
