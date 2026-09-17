// lib/draft/pool.js - THE ROLLING POOL. PURE.
//
// THE RULE (ruled Fri 11 Sep): a player whose game has kicked is out of the
// pool from that moment, and a room already running loses him mid-draft.
//
// WHERE IT ACTUALLY BITES, MEASURED, so nobody builds a mental model larger
// than the thing. Rooms open Tuesday and the join window closes at the week's
// FIRST kickoff - so no game kicks off while anyone is still allowed to start,
// and the pool cannot shrink during the window. It shrinks only for a room
// STARTED shortly before the first kickoff and still running after it. Eight
// rounds times twelve seats on a thirty-second clock is at most ~48 minutes,
// so the reachable case is a room begun in the last hour, losing the one or
// two clubs that play the opener. Week 2, for instance, opens BUF at DET and
// nothing else for three days.
//
// THAT NARROWNESS IS NOT A REASON TO SKIP IT. The failure it prevents is not
// narrow at all: without the split below, a DRAFTED player leaving the pool
// makes rebuildState throw, which 500s that room on every subsequent load,
// permanently. See withholdFrom.
//
// RANKED ONLY. A practice mock in July has no week and no slate, and its pool
// must never move - the caller decides by passing gamesByTeam at all. No
// games map, no withholding.

/**
 * Has this team's game started?
 *
 * THE STATUS LEADS AND THE CLOCK IS THE FALLBACK. A game the provider has
 * moved to live or final has started whatever our clock thinks; a scheduled
 * game that is past its kickoff has started whatever the provider thinks. Both
 * directions are one-way - nothing here ever un-starts a game - so the worst a
 * disagreement costs is a player withheld a few minutes early, which is the
 * safe side of a rule about who is already playing.
 */
export function hasKickedOff(game, now = new Date()) {
  if (!game) return false;                       // no game this week: a bye, and a bye is available
  if (game.status === 'live' || game.status === 'final') return true;
  const ko = game.kickoffAt ? new Date(game.kickoffAt).getTime() : null;
  return ko != null && Number.isFinite(ko) && ko <= new Date(now).getTime();
}

/** The team abbreviations whose game has started. */
export function kickedOffTeams(gamesByTeam, now = new Date()) {
  const out = new Set();
  if (!gamesByTeam) return out;
  for (const [abbr, game] of gamesByTeam) if (hasKickedOff(game, now)) out.add(abbr);
  return out;
}

/**
 * Split an AVAILABLE list into what may still be drafted and what may not.
 *
 * IT TAKES `available`, NOT THE POOL, AND THAT IS THE WHOLE DESIGN.
 * rebuildState replays every persisted pick by looking the player up in the
 * pool it was handed (lib/fantasy/drafts.js), and throws if one is missing:
 *
 *     if (!player) throw new Error(`rebuildState: persisted player ... not in pool`)
 *
 * So filtering the POOL would mean that the moment a DRAFTED player's game
 * kicked off, every later load of that room threw - a 500 with no way back,
 * mid-draft, for the rest of the week. The pool handed to createDraftState
 * stays whole and the state's AVAILABLE list is narrowed afterwards. The
 * replay keeps its identities; only the board shrinks.
 *
 * @returns {{available: Array, withheld: Array}}
 */
export function withholdFrom(available, gamesByTeam, now = new Date()) {
  if (!gamesByTeam || !gamesByTeam.size) return { available: available ?? [], withheld: [] };
  const out = [];
  const withheld = [];
  const started = kickedOffTeams(gamesByTeam, now);
  for (const p of available ?? []) {
    // A player with no team, or a team with no game this week, stays. Absence
    // is not a kickoff.
    if (p?.team && started.has(p.team)) withheld.push(p); else out.push(p);
  }
  return { available: out, withheld };
}

/** Is this one player withheld? For the pick refusal's own message. */
export function isWithheld(player, gamesByTeam, now = new Date()) {
  if (!player?.team || !gamesByTeam) return false;
  return hasKickedOff(gamesByTeam.get(player.team), now);
}

// ---------------------------------------------------------------------------
// WHICH ADP SNAPSHOT A RANKED ROOM DRAFTS FROM
// ---------------------------------------------------------------------------
/**
 * The newest snapshot that can actually seat the room, or null.
 *
 * WHY THIS EXISTS, MEASURED. FFC's ADP feed THINS DURING THE SEASON - it is a
 * preseason market and fewer people mock-draft each week. The ppr/12 pool went
 * 194 rows (15 Sep) -> 116 (16 Sep) -> 78 (17 Sep), and a 12-seat, 8-round
 * room needs 96 real picks. On the 17th `startCustomDraftFor` refused every
 * new ranked room with 'pool_too_small' - the game was shut, for a reason that
 * had nothing to do with the game.
 *
 * TODAY'S SNAPSHOT WHEN IT CAN, THE NEWEST THAT CAN OTHERWISE (ruled). The
 * freshest ADP is the most honest ADP, so this never reaches past a snapshot
 * that fits; it only keeps reaching back until one does. The chosen date is
 * frozen onto the draft (drafts.pool_snapshot_date, written by finalizeStart)
 * exactly as before, so a room still drafts from ONE snapshot and still never
 * regrades on later ADP.
 *
 * RANKED ONLY. A practice mock is a sandbox whose config the reader chose, and
 * "that league is bigger than the current ADP pool" is the honest answer there
 * - see the caller.
 *
 * @param {Array<{snapshotDate: *, rows: number}>} candidates any order
 * @param {number} demand the config's real (non-synthetic) pick demand
 * @returns {{snapshotDate: *, rows: number}|null}
 */
export function chooseSnapshot(candidates, demand) {
  const need = Number(demand);
  if (!Number.isFinite(need) || need <= 0) return null;
  const fits = (candidates ?? [])
    .filter((c) => c?.snapshotDate != null && Number(c.rows) >= need)
    // Newest first. The dates arrive as Date objects from the driver and as
    // 'YYYY-MM-DD' strings from a fixture; both compare correctly as ISO text,
    // which is why this sorts on the string rather than on a parsed clock.
    .sort((a, b) => String(ymd(b.snapshotDate)).localeCompare(String(ymd(a.snapshotDate))));
  return fits[0] ?? null;
}

/** 'YYYY-MM-DD' from a Date or an already-dated string. Local helper: the
 *  sim's own ymd() lives in a module full of database reads. */
function ymd(d) {
  if (d == null) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  const t = new Date(d);
  return Number.isFinite(t.getTime()) ? t.toISOString().slice(0, 10) : '';
}
