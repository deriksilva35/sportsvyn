// scripts/live-poller-status.mjs — what the live poller has been doing.
// Committed because it will be run again on every future slate: Thursday's
// verification, and every Saturday after it, asks these same four questions.
//
// Usage: set -a && . ./.env.local && set +a && node scripts/live-poller-status.mjs
// Reads PROD_DATABASE_URL from the environment. No credential lives in here.

import { neon } from '@neondatabase/serverless';
import { DEFAULT_CAP } from '../lib/live/quota.js';

const sql = neon(process.env.PROD_DATABASE_URL);
const PT = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
}).format(new Date(d));

const day = new Date().toISOString().slice(0, 10);

console.log('=== HEARTBEAT (is it alive?) ===');
for (const lg of ['cfb', 'nfl']) {
  const [r] = await sql`
    SELECT started_at, summary FROM sync_runs
     WHERE source = ${`live-poller-${lg}`} AND kind = 'heartbeat'
     ORDER BY started_at DESC LIMIT 1`;
  if (!r) { console.log(`  ${lg}: NO HEARTBEAT EVER`); continue; }
  const ageMin = (Date.now() - new Date(r.started_at).getTime()) / 60000;
  console.log(`  ${lg}: ${PT(r.started_at)} PT (${ageMin.toFixed(1)} min ago)`
    + `${ageMin > 11 ? '  *** STALE - two beats missed ***' : ''}  ${JSON.stringify(r.summary)}`);
}

console.log('\n=== QUOTA TODAY ===');
for (const lg of ['cfb', 'nfl']) {
  const [r] = await sql`
    SELECT COALESCE(SUM((summary->>'calls')::int), 0)::int AS calls FROM sync_runs
     WHERE source = ${`live-poller-${lg}`} AND kind = ${'quota:' + day}`;
  const cap = DEFAULT_CAP[lg];
  console.log(`  ${lg}: ${r.calls} / ${cap}  (${((r.calls / cap) * 100).toFixed(1)}%)${r.calls >= cap ? '  *** CAPPED ***' : ''}`);
}

console.log('\n=== POLL WINDOWS (last 10) ===');
for (const r of await sql`
  SELECT source, kind, started_at, finished_at, ok, summary FROM sync_runs
   WHERE source LIKE 'live-poller-%' AND kind LIKE 'window:%'
   ORDER BY started_at DESC LIMIT 10`) {
  const s = r.summary ?? {};
  const lat = (s.latencies ?? []).map((l) => l.ourMs);
  const med = lat.length ? lat.slice().sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null;
  console.log(`  ${PT(r.started_at)} PT  ${r.source} ${r.kind} ok=${r.ok}`
    + `  polls=${s.polls ?? 0} calls=${s.calls ?? 0} scoreChanges=${s.scoreChanges ?? 0}`
    + ` finals=${s.finals ?? 0} events=${s.events ?? 0}`
    + `${med != null ? ` medianWriteMs=${med}` : ''}`
    + `${(s.unmapped ?? []).length ? `  UNMAPPED: ${s.unmapped.join(', ')}` : ''}`);
}

console.log('\n=== DID THE VERCEL TICK YIELD? (last 12 gridiron ticks) ===');
for (const r of await sql`
  SELECT source, kind, started_at, ok, summary->'liveScores' AS live FROM sync_runs
   WHERE source IN ('cfb-games','nfl-games') ORDER BY started_at DESC LIMIT 12`) {
  const d = r.live?.decision ?? null;
  console.log(`  ${PT(r.started_at)} PT  ${r.source} ${r.kind} ok=${r.ok}`
    + `  ${d ? `>>> ${d}` : r.live ? `ran (scoresWritten=${r.live.scoresWritten ?? 0})` : 'no live arm this kind'}`);
}

console.log('\n=== SCORE EVENTS ON THE WIRE (last 10) ===');
const ev = await sql`
  SELECT headline, seen_at, payload FROM news_items
   WHERE lane = 'score' ORDER BY seen_at DESC LIMIT 10`;
if (!ev.length) console.log('  none yet');
for (const e of ev) console.log(`  ${PT(e.seen_at)} PT  ${e.headline}`);
