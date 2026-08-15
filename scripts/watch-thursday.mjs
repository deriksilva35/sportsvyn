/**
 * scripts/watch-thursday.mjs - READ-ONLY live watch for Thu 13 Aug 2026.
 *
 * Three code paths fire for the first time in production tonight, and none has
 * ever run against a live game:
 *   1. the detail fetch on a LIVE game   (detailTargets -> fetchGameDetail)
 *   2. the FINAL-FLIP fetch              (the version that stays on the page)
 *   3. the brief cron's GRIDIRON BRANCH  (generateGameBrief, actually swept)
 *
 * EVERY LINE IT PRINTS IS AN EVENT WORTH A NOTIFICATION. State dumps go to
 * stderr; stdout carries only transitions, and it covers the FAILURE
 * transitions as loudly as the happy ones - a watch that only greps for
 * success is silent through a crashloop, and silence looks like "still
 * running".
 *
 * Exits when the first game's full chain has resolved, or at the deadline.
 */
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.PROD_DATABASE_URL);
const SLATE = process.env.WATCH_SLATE ?? '2026-08-13';
const nextDay = (d) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
const WINDOW_OPEN = `${SLATE}T22:00:00Z`;                        // 6pm ET
const DEADLINE = Date.parse(`${nextDay(SLATE)}T06:30:00Z`);      // 2:30am ET, hard stop
const POLL_MS = 60_000;

const et = (d) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(d));
const now = () => et(new Date());
const emit = (...a) => console.log(`[${now()} ET]`, ...a);          // stdout = notification
const note = (...a) => console.error(`[${now()} ET]`, ...a);        // stderr = log only
const short = (s) => s.replace('nfl-2026-pre-w1-', '');

const prev = new Map();      // slug -> snapshot
let seenDetailRuns = 0;
let seenBriefs = new Set();
let firstFinal = null;

// IDLE UNTIL THE WINDOW OPENS. Armed a day early, so it waits rather than
// spending ~1,300 pointless polls on an empty Wednesday night. One quiet check
// an hour keeps it honest about still being alive.
const WATCH_FROM = Date.parse(`${SLATE}T22:45:00Z`);   // 6:45pm ET, kickoff - 15
emit('WATCH ARMED for the Thursday slate (6 games, 7:00-9:00pm ET).');
if (Date.now() < WATCH_FROM) {
  emit(`Idling until ${et(WATCH_FROM)} ET, then polling PROD every 60s.`);
  while (Date.now() < WATCH_FROM) {
    await new Promise((r) => setTimeout(r, Math.min(3_600_000, WATCH_FROM - Date.now())));
  }
  emit('WINDOW OPEN. Watching the slate.');
}

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
  } catch (e) {
    // One failed request must not kill the watch, but a run of them is itself
    // the news.
    emit('DB READ FAILED:', String(e?.message ?? e).slice(0, 120));
    await new Promise((r) => setTimeout(r, POLL_MS));
    continue;
  }

  for (const g of games) {
    const k = short(g.slug);
    const p = prev.get(k);
    const cur = { status: g.status, ev: g.ev, ln: g.ln, brief: g.brief, fin: !!g.detail_final, seen: g.final_seen_at ?? null };
    if (!p) { prev.set(k, cur); continue; }

    if (p.status !== cur.status) {
      if (cur.status === 'live') emit(`KICKOFF   ${k}`);
      else if (cur.status === 'final') {
        emit(`FINAL     ${k}  ${g.a}-${g.h}`);
        if (!firstFinal) {
          firstFinal = { at: Date.now(), slug: k, id: g.id };
          emit('*** FIRST FINAL OF THE NIGHT. Holding for the final-flip fetch and the brief sweep.');
        }
      } else emit(`STATUS    ${k} -> ${cur.status}`);
    }
    // TIGHTENED. A line-count bump carries almost no information - three games
    // kicking together produced ~70 notifications an hour on Thursday, and
    // monitors that flood get stopped, which costs the feed. What survives:
    // the FIRST detail for a game (proves the fetch reached it) and any change
    // in the EVENT count (a score actually happened). Routine growth is in the
    // disk record, which keeps everything.
    const firstDetail = p.ev === 0 && p.ln === 0 && (cur.ev > 0 || cur.ln > 0);
    if (firstDetail) emit(`DETAIL    ${k} (${cur.status}) FIRST  events=${cur.ev} lines=${cur.ln}`);
    else if (cur.ev > p.ev) emit(`SCORE     ${k} (${cur.status}) events ${p.ev}->${cur.ev}  lines=${cur.ln}`);

    // The stamp - the behaviour tonight exists to prove.
    if (!p.seen && cur.seen) emit(`FINAL-SEEN ${k} stamped ${cur.seen} (status now ${cur.status})`);
    if (p.seen && cur.seen && p.seen !== cur.seen) emit(`*** STAMP MOVED ${k}: ${p.seen} -> ${cur.seen}  SET-ONCE VIOLATED`);

    // PATH 2: the one-time post-whistle fetch.
    if (!p.fin && cur.fin) emit(`FINAL-FETCH ${k} claimed  events=${cur.ev} lines=${cur.ln}`);
    prev.set(k, cur);
  }

  // The poller's own ledger.
  try {
    const runs = await sql`
      SELECT id, started_at, summary FROM sync_runs
       WHERE source = 'nfl-preseason' AND kind = 'detail' AND started_at > ${WINDOW_OPEN}
       ORDER BY id`;
    if (runs.length > seenDetailRuns) {
      // Only sweeps carrying a FAILURE are events. The routine ledger line
      // duplicates what the DETAIL/SCORE lines already say.
      for (const r of runs.slice(seenDetailRuns)) {
        const s = r.summary ?? {};
        for (const d of s.done ?? []) {
          if (d.error) emit(`SWEEP ERROR   #${r.id} match ${d.id}: ${d.error}`);
          else if (d.errors?.length) emit(`SWEEP PARTIAL #${r.id} match ${d.id}: ${JSON.stringify(d.errors)}`);
        }
      }
      seenDetailRuns = runs.length;
    }
  } catch { /* covered by the next poll */ }

  // PATH 3: the brief cron's gridiron branch.
  try {
    const briefs = await sql`
      SELECT b.id, b.validation_status, b.headline, m.slug
        FROM match_briefs b JOIN matches m ON m.id = b.match_id
        JOIN leagues l ON l.id = m.league_id
       WHERE l.slug = 'nfl' AND b.generated_at > ${WINDOW_OPEN} ORDER BY b.id`;
    for (const b of briefs) {
      if (seenBriefs.has(b.id)) continue;
      seenBriefs.add(b.id);
      const g2 = prev.get(short(b.slug));
      const lat = g2?.seen ? Math.round((Date.now() - new Date(g2.seen).getTime()) / 60000) : null;
      emit(`BRIEF #${b.id} ${short(b.slug)} status=${b.validation_status}`
        + (lat != null ? `  (~${lat} min after first observed final)` : ''));
      emit(`  "${b.headline}"`);
    }
  } catch { /* covered by the next poll */ }

  // A stall is news too. Six minutes after the first final, anything still
  // missing is a finding rather than a wait.
  if (firstFinal && Date.now() - firstFinal.at > 6 * 60_000) {
    const g = games.find((x) => short(x.slug) === firstFinal.slug);
    const missing = [];
    if (!g?.detail_final) missing.push('final-flip fetch');
    if (!g?.brief) missing.push('brief');
    if (missing.length) emit(`STALL     ${firstFinal.slug}: still missing ${missing.join(' + ')} 6min after final`);
    else emit(`COMPLETE  ${firstFinal.slug}: all three paths fired.`);
    emit('WATCH ENDING.');
    break;
  }

  note('poll ok', games.map((g) => `${short(g.slug).slice(0, 12)}:${g.status}:e${g.ev}:b${g.brief}`).join(' '));
  await new Promise((r) => setTimeout(r, POLL_MS));
}
if (!firstFinal) emit('WATCH ENDED at the deadline with no final recorded.');
