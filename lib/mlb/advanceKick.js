// lib/mlb/advanceKick.js - trigger (a) of the postseason advance (tue-2):
// the live poller calls this with the MLB games it just marked final.
//
// FOR EACH ET DAY THOSE GAMES BELONG TO, IN THE POSTSEASON: if the day's slate
// is over (lib/mlb/advance.js slateDone - nothing live or still to play,
// doubleheaders included), schedule the advance job five minutes out. Once per
// day: `fired` remembers the days this process kicked, and the transient
// systemd unit is NAMED for the day, so a second kick after a poller restart
// is refused by systemd itself. A kick that fails is logged, never thrown -
// the 10:00Z timer is the safety net, and the poller must not stall on it.
import { slateDone, etDay, kickUnitName, ADVANCE_UNIT, KICK_DELAY_SEC } from './advance.js';

const FIRED = new Set();
export function _resetKicks() { FIRED.clear(); }

/** The default launcher: a transient timer that starts the advance unit. */
export async function systemdKick(day, { spawn } = {}) {
  const { spawnSync } = spawn ?? await import('node:child_process');
  const r = spawnSync('systemd-run', ['--user', `--on-active=${KICK_DELAY_SEC}`, `--unit=${kickUnitName(day)}`,
    '--description=Sportsvyn MLB postseason advance (after the day\'s last final)',
    'systemctl', '--user', 'start', ADVANCE_UNIT], { encoding: 'utf8', timeout: 15000 });
  return { ok: r.status === 0, detail: (r.stderr || r.stdout || '').trim().slice(0, 200) };
}

/**
 * @param sql     the poller's PROD client
 * @param finalIds match ids this poll turned final (any league - non-MLB ids simply match nothing)
 * @returns [{ day, fired, reason }] one entry per postseason ET day touched
 */
export async function kickIfDayDone(sql, finalIds = [], { launch = systemdKick, fired = FIRED, log = () => {} } = {}) {
  const ids = [...new Set((finalIds ?? []).filter((x) => x != null).map(Number))];
  if (!ids.length) return [];
  const finals = await sql`
    SELECT m.id, m.kickoff_at FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
     WHERE m.id = ANY(${ids}) AND m.season_phase = 'POST'`;
  const days = [...new Set(finals.map((f) => etDay(f.kickoff_at)))];
  const out = [];
  for (const day of days) {
    if (fired.has(day)) { out.push({ day, fired: false, reason: 'already-kicked' }); continue; }
    const games = await sql`
      SELECT m.id, m.status FROM matches m JOIN leagues l ON l.id = m.league_id AND l.slug = 'mlb'
       WHERE (m.kickoff_at AT TIME ZONE 'America/New_York')::date = ${day}::date`;
    if (!slateDone(games)) { out.push({ day, fired: false, reason: 'slate-not-done' }); continue; }
    fired.add(day);
    let r;
    try { r = await launch(day); } catch (e) { r = { ok: false, detail: String(e?.message ?? e).slice(0, 200) }; }
    log(`[mlb] postseason day ${day} done: ${r.ok ? `advance kicked in ${KICK_DELAY_SEC}s` : `advance kick FAILED (${r.detail}) - the 10:00Z timer will run it`}`);
    out.push({ day, fired: Boolean(r.ok), reason: r.ok ? 'kicked' : 'kick-failed' });
  }
  return out;
}
