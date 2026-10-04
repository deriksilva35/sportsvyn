// app/daily/v1Retired.test.mjs - sat-5 Y1: v1 of The Daily is retired.
//
// /daily and /daily/[date] answer ONE 308 to /daily/board with the query
// DROPPED (decided and pinned here: a v1 query addressed v1, and v2 reads its
// own params - ?season= is a practice board). These tests run the real page
// functions: permanentRedirect throws NEXT_REDIRECT, and its digest carries
// the destination and the status Next answers with.
//
// Also pinned: the live game is untouched (/daily/board and its children keep
// their own pages), the v1 cron is unscheduled with its route kept, every
// internal link that used to open v1 now opens the board, and the v1 DATA is
// kept - no migration drops or deletes a v1 table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerHooks } from 'node:module';
import { install } from '../../lib/testing/nextResolve.mjs';

// '@/' aliases through the house hook; 'next/navigation' to its real file
// (next ships no exports map, so bare ESM resolution cannot find it). The REAL
// permanentRedirect runs - the digest below is Next's own, not a stub's.
install();
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'next/navigation') return next('next/navigation.js', ctx);
  return next(spec, ctx);
} });

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (rel) => readFileSync(path.join(REPO, rel), 'utf8');
const load = (rel) => import(pathToFileURL(path.join(REPO, rel)).href);

async function redirectOf(rel, props) {
  const mod = await load(rel);
  try {
    await mod.default(props);
  } catch (e) {
    return String(e?.digest ?? e);
  }
  return null;
}

test('/daily 308s to /daily/board and drops the query', async () => {
  const d = await redirectOf('app/daily/page.js', { searchParams: Promise.resolve({ shell: 'sim-app', season: '2015' }) });
  assert.equal(d, 'NEXT_REDIRECT;replace;/daily/board;308;');
});

test('/daily/[date] (the v1 reveal) 308s to /daily/board and drops the query', async () => {
  const d = await redirectOf('app/daily/[date]/page.js', {
    params: Promise.resolve({ date: '2026-08-16' }), searchParams: Promise.resolve({ x: '1' }),
  });
  assert.equal(d, 'NEXT_REDIRECT;replace;/daily/board;308;');
});

test('the live board and its children are NOT redirected', () => {
  for (const rel of ['app/daily/board/page.js', 'app/daily/board/[date]/page.js', 'app/daily/leaderboards/page.js']) {
    assert.doesNotMatch(src(rel), /permanentRedirect\(/, `${rel} must still render`);
  }
  // Not via the proxy: RETIRED_ROUTES matches every path beneath a key, so
  // '/daily' there would take the live board down with it.
  assert.doesNotMatch(src('lib/retired.js'), /'\/daily'/);
  assert.doesNotMatch(src('proxy.js'), /'\/daily/);
});

test('the v1 share card stays served (it is the image in posted previews)', () => {
  assert.ok(existsSync(path.join(REPO, 'app/daily/[date]/card/route.js')));
});

test('the v1 cron is unscheduled; its route stays and stays Bearer-gated', () => {
  const vercel = JSON.parse(src('vercel.json'));
  assert.equal(vercel.crons.some((c) => c.path.startsWith('/api/cron/daily-puzzle')), false);
  const route = src('app/api/cron/daily-puzzle/route.js');
  assert.match(route, /cronAuthorized\(request\)/);
  assert.match(route, /status: 401/);
});

test('every internal link that opened v1 opens the board now', () => {
  const files = {
    'app/page.js': /href="\/daily"/,
    'app/sim/page.js': /href="\/daily"/,
    'app/account/page.js': /href="\/daily"/,
    'components/you/You.js': /href="\/daily"/,
    'components/home/DailyModule.js': /'\/daily'/,
    'lib/push/copy.js': /url: '\/daily',/,
    'lib/games/lobbyV3.js': /: '\/daily',/,
    'lib/daily/homeModule.js': /href: `\/daily\/\$\{date\}`/,
  };
  for (const [rel, v1] of Object.entries(files)) {
    assert.doesNotMatch(src(rel), v1, `${rel} still links v1`);
  }
});

test('the v1 data is kept: no migration drops or empties a v1 table', () => {
  const dir = path.join(REPO, 'migrations');
  const sqlText = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(path.join(dir, f), 'utf8')).join('\n');
  assert.doesNotMatch(sqlText, /DROP TABLE[^;]*\bpuzzle_(days|entries)\b/i);
  assert.doesNotMatch(sqlText, /(DELETE FROM|TRUNCATE)\s+(TABLE\s+)?puzzle_(days|entries)\b/i);
});
