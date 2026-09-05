// services/daily-tick/index.mjs — the systemd timer's own entrypoint.
// One-shot: ensures today's v2 edition exists and fires whichever of
// daily-live/daily-revealed is due, then exits. The TIMER owns the 5-minute
// cadence (services/daily-tick/systemd/) - this file runs exactly once.
//
// DATABASE_URL IS SET BY THE UNIT'S OWN --import, NOT IN THIS FILE. The
// systemd unit runs `node --import ./services/_preload/prod-db.mjs
// services/daily-tick/index.mjs` - that preload sets process.env.DATABASE_URL
// from PROD_DATABASE_URL and exits 1 if it is missing, fully resolved before
// THIS module's own imports load at all. An in-file assignment used to live
// here instead; it moved to the shared preload so every droplet service uses
// the SAME mechanism (services/live-poller/index.mjs's own bug - lib/wire/
// emit.js importing the shared lib/db.js instead of a PROD-scoped client -
// is exactly what a per-file assignment does not protect against, since it
// only ever covered THIS file's own top-level state, never a transitively
// imported module reading process.env.DATABASE_URL on its own).

const { neon } = await import('@neondatabase/serverless');
const { tick } = await import('../../lib/daily/seasonBoardTick.js');

const sql = neon(process.env.DATABASE_URL);
const now = new Date().toISOString();

try {
  const r = await tick(sql, now);
  console.log(
    `[daily-tick] ${now} ensured=${r.ensured?.edition_date ?? 'n/a'} `
    + `live=${r.live.map((x) => x.edition).join(',') || 'none'} `
    + `revealed=${r.revealed.map((x) => x.edition).join(',') || 'none'}`,
  );
} catch (e) {
  console.error(`[daily-tick] ERROR: ${e.message}`);
  process.exit(1);
}
