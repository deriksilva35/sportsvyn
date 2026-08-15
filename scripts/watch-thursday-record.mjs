/**
 * scripts/watch-thursday-record.mjs - the DURABLE record of Thursday 13 Aug 2026.
 *
 * Sibling of scripts/watch-thursday.mjs, which is the live feed inside a Claude
 * session. That one dies with the session and stops at the first final, because
 * its job is to tell somebody watching what just happened. This one is
 * detached, writes to disk, and runs the WHOLE SLATE, because its job is to
 * still be there tomorrow morning whether anyone was watching or not.
 *
 * Three code paths run against a live game for the first time tonight:
 *   1. the detail fetch on a LIVE game   (detailTargets -> fetchGameDetail)
 *   2. the FINAL-FLIP fetch              (the version that stays on the page)
 *   3. the brief cron's GRIDIRON BRANCH  (generateGameBrief, actually swept)
 *
 * READ-ONLY. No INSERT, UPDATE or DELETE anywhere in this file. It also holds
 * no lock and takes no advisory anything - it must not be able to perturb the
 * thing it is measuring.
 *
 * Every line is timestamped and flushed as it is written, so a `tail -f` on the
 * log is a live feed and a `cat` after the fact is the record. The two are the
 * same file on purpose: a summary written only at exit is lost if the process
 * is killed, which is exactly when you most want to know what it saw.
 */
import { neon } from '@neondatabase/serverless';
import { appendFileSync } from 'node:fs';

const sql = neon(process.env.PROD_DATABASE_URL);
// PARAMETERISED BY ENV so the same script covers any slate - it was written for
// one Thursday and immediately needed for the Friday after, which is the whole
// argument for it living in scripts/ rather than a scratchpad.
//
// SLATE is the ET calendar day. Everything else derives from it, in UTC,
// because that is the clock the host and Date.parse actually read: an ET
// evening's window opens at 22:00Z the same day and closes at 07:00Z the next.
const SLATE = process.env.WATCH_SLATE ?? '2026-08-13';
const LOG = process.env.WATCH_LOG ?? `/home/derik/watch-logs/slate-${SLATE}.log`;
const nextDay = (d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const WINDOW_OPEN = `${SLATE}T22:00:00Z`;                       // 6pm ET
const WATCH_FROM = Date.parse(`${SLATE}T22:45:00Z`);            // 6:45pm ET, kickoff - 15
const DEADLINE = Date.parse(`${nextDay(SLATE)}T07:00:00Z`);     // 3am ET, hard stop
const POLL_MS = 60_000;

const et = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', month: 'short', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(d));
const short = (s) => s.replace('nfl-2026-pre-w1-', '');

function log(line) {
  const s = `[${et(new Date())} ET] ${line}\n`;
  // Synchronous append: the process may be killed at any moment and a buffered
  // record is not a record.
  appendFileSync(LOG, s);
  process.stdout.write(s);
}

log('='.repeat(72));
log(`RECORD OPENED  pid=${process.pid}  slate=${SLATE}`);
log('Watching: (1) live detail fetch  (2) final-flip fetch  (3) brief cron gridiron branch');
log('READ-ONLY. Detached from any session.');

if (Date.now() < WATCH_FROM) {
  log(`Idling until ${et(WATCH_FROM)} ET (kickoff - 15).`);
  while (Date.now() < WATCH_FROM) {
    await new Promise((r) => setTimeout(r, Math.min(1_800_000, WATCH_FROM - Date.now())));
    if (Date.now() < WATCH_FROM) log(`still idle, ${Math.round((WATCH_FROM - Date.now()) / 60000)} min to go`);
  }
}
log('WINDOW OPEN. Polling PROD every 60s.');

const prev = new Map();
const firstAt = { detailLive: null, final: null, finalFetch: null, brief: null };
let seenSweeps = 0;
const seenBriefs = new Set();
let polls = 0;
let readFails = 0;

while (Date.now() < DEADLINE) {
  let games;
  try {
    games = await sql`
      SELECT m.id, m.slug, m.status, m.home_score h, m.away_score a,
             (m.metadata->'detail'->>'final')::boolean AS detail_final,
             m.metadata->'detail'->>'final_seen_at'     AS final_seen_at,
             (SELECT count(*)::int FROM gridiron_game_events e WHERE e.match_id = m.id)  AS ev,
             (SELECT count(*)::int FROM gridiron_player_lines l WHERE l.match_id = m.id) AS ln,
             (SELECT count(*)::int FROM match_briefs b WHERE b.match_id = m.id AND b.kind = 'auto') AS brief
        FROM matches m JOIN leagues lg ON lg.id = m.league_id
       WHERE lg.slug = 'nfl' AND (m.kickoff_at AT TIME ZONE 'America/New_York')::date = ${SLATE}::date
       ORDER BY m.kickoff_at, m.id`;
    readFails = 0;
  } catch (e) {
    readFails += 1;
    log(`DB READ FAILED (${readFails} in a row): ${String(e?.message ?? e).slice(0, 140)}`);
    await new Promise((r) => setTimeout(r, POLL_MS));
    continue;
  }
  polls += 1;

  for (const g of games) {
    const k = short(g.slug);
    const cur = { status: g.status, ev: g.ev, ln: g.ln, brief: g.brief, fin: !!g.detail_final, seen: g.final_seen_at ?? null };
    const p = prev.get(k);
    if (!p) { prev.set(k, cur); log(`BASELINE  ${k.padEnd(44)} ${cur.status} ev=${cur.ev} ln=${cur.ln} brief=${cur.brief}`); continue; }

    if (p.status !== cur.status) {
      log(`STATUS    ${k.padEnd(44)} ${p.status} -> ${cur.status}  ${g.a ?? '-'}-${g.h ?? '-'}`);
      if (cur.status === 'final' && !firstAt.final) { firstAt.final = Date.now(); log(`*** FIRST FINAL: ${k}`); }
    }
    if (cur.ev > p.ev || cur.ln > p.ln) {
      log(`DETAIL    ${k.padEnd(44)} ${cur.status}  events ${p.ev}->${cur.ev}  lines ${p.ln}->${cur.ln}`);
      if (cur.status === 'live' && !firstAt.detailLive) {
        firstAt.detailLive = Date.now();
        log('*** PATH 1 CONFIRMED: detail landed while a game was LIVE.');
      }
    }
    // The stamp is the behaviour tonight exists to prove: written once, the
    // first time the feed says final, and never retracted by a flap.
    if (!p.seen && cur.seen) log(`FINAL-SEEN ${k.padEnd(43)} stamped ${cur.seen}  (status now ${cur.status})`);
    if (p.seen && cur.seen && p.seen !== cur.seen) log(`*** STAMP MOVED on ${k}: ${p.seen} -> ${cur.seen}  (set-once VIOLATED)`);
    if (!p.fin && cur.fin) {
      log(`FINAL-FETCH ${k.padEnd(42)} claimed  events=${cur.ev} lines=${cur.ln}`);
      if (!firstAt.finalFetch) { firstAt.finalFetch = Date.now(); log('*** PATH 2 CONFIRMED: the post-whistle fetch fired.'); }
    }
    prev.set(k, cur);
  }

  try {
    const sweeps = await sql`
      SELECT id, started_at, summary FROM sync_runs
       WHERE source = 'nfl-preseason' AND kind = 'detail' AND started_at > ${WINDOW_OPEN}
       ORDER BY id`;
    for (const r of sweeps.slice(seenSweeps)) {
      const s = r.summary ?? {};
      log(`SWEEP #${r.id} ${et(r.started_at)} requests=${s.requests} games=${s.games}`);
      for (const d of s.done ?? []) {
        if (d.error) log(`   SWEEP ERROR   match ${d.id}: ${d.error}`);
        else if (d.errors?.length) log(`   SWEEP PARTIAL match ${d.id}: ${JSON.stringify(d.errors)}`);
        else log(`   ok match ${d.id} final=${d.final} events=${d.events} lines=${d.lines}`);
      }
    }
    seenSweeps = sweeps.length;
  } catch (e) { log(`sweep read failed: ${String(e?.message ?? e).slice(0, 100)}`); }

  try {
    const briefs = await sql`
      SELECT b.id, b.validation_status, b.headline, b.generated_at, m.slug
        FROM match_briefs b JOIN matches m ON m.id = b.match_id
        JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = 'nfl' AND b.generated_at > ${WINDOW_OPEN} ORDER BY b.id`;
    for (const b of briefs) {
      if (seenBriefs.has(b.id)) continue;
      seenBriefs.add(b.id);
      // Final-to-brief latency is the ordering fix's own report card.
      const g2 = prev.get(short(b.slug));
      const lat = g2?.seen ? Math.round((new Date(b.generated_at) - new Date(g2.seen)) / 60000) : null;
      log(`BRIEF #${b.id} ${short(b.slug)} status=${b.validation_status} at ${et(b.generated_at)}`
        + (lat != null ? `  (${lat} min after first observed final)` : ''));
      log(`   "${b.headline}"`);
      if (!firstAt.brief) { firstAt.brief = Date.now(); log('*** PATH 3 CONFIRMED: the brief cron swept a gridiron game.'); }
    }
  } catch (e) { log(`brief read failed: ${String(e?.message ?? e).slice(0, 100)}`); }

  // The budget, because a cap that nobody reads is not a cap.
  if (polls % 15 === 0) {
    try {
      const spent = await sql`
        SELECT COALESCE(sum((summary->>'requests')::int), 0)::int n FROM sync_runs
         WHERE source = 'nfl-preseason'
           AND started_at >= date_trunc('day', now() AT TIME ZONE 'America/New_York') AT TIME ZONE 'America/New_York'`;
      log(`budget: ${spent[0].n} / 1400 requests today`);
    } catch { /* next time */ }
  }

  // Done when EVERY game has finished and had its chain resolve. The live feed
  // stops at the first final; the record waits for the slate.
  const done = games.length > 0 && games.every((g) => g.status === 'final' && g.detail_final && g.brief > 0);
  if (done) { log('ALL SIX GAMES: final, final-fetch claimed, brief written.'); break; }

  await new Promise((r) => setTimeout(r, POLL_MS));
}

log('-'.repeat(72));
log('SUMMARY');
const mark = (t) => (t ? `CONFIRMED at ${et(t)} ET` : 'NEVER FIRED');
log(`  PATH 1 live detail fetch : ${mark(firstAt.detailLive)}`);
log(`  PATH 2 final-flip fetch  : ${mark(firstAt.finalFetch)}`);
log(`  PATH 3 brief (swept)     : ${mark(firstAt.brief)}`);
log(`  first final              : ${firstAt.final ? et(firstAt.final) + ' ET' : 'none recorded'}`);
log(`  detail sweeps seen       : ${seenSweeps}`);
log(`  briefs written           : ${seenBriefs.size}`);
log(`  polls                    : ${polls}`);
for (const [k, v] of prev) log(`  ${k.padEnd(44)} ${v.status} ev=${v.ev} ln=${v.ln} brief=${v.brief} finalFetch=${v.fin}`);
log('RECORD CLOSED');
