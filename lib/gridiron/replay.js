// lib/gridiron/replay.js - THE DRIVE CARD, REPLAYED (drive-3). PURE.
//
// Given a finished game's stored plays and drive envelopes plus a cut (a
// provider play id, or an instant), this returns the inputs the LIVE card path
// takes - the truncated plays, the drive envelopes as they stood, the game row
// as a live game at that period/clock/score, and the `now` the flash is judged
// against - and the card itself by calling the SAME driveCardFor /
// driveStripFor the board and the game page call. It re-implements no card.
//
// WHAT "AS IT STOOD" MEANS HERE
//  - PLAYS: every play in game order up to and including the chosen one. The
//    live reader keeps the latest 40; driveCardFor and situationNow only ever
//    look at the end of the list, so the longer prefix changes nothing.
//  - THE CURRENT DRIVE'S SUMMARY is rebuilt, never the final envelope: the
//    stored envelope's playCount / yards / duration / result are the whole
//    drive's. Rebuilt, it carries the drive's identity and start only, and
//    driveTotals() derives plays, yards and time of possession from the plays
//    up to the cut (CFB: a drive already complete at the cut keeps CFBD's own
//    envelope, see drivesAsOf). Earlier drives keep their stored envelopes.
//  - `now` is the chosen play's created_at + 1 s, so a scoring play that was
//    just stored flashes exactly as it did live (the flash is judged on
//    plays.created_at). With an instant, `now` is that instant.
// Nothing here reads or writes a database.

import { byGameClock } from './driveStrip.js';
import { driveCardFor } from './driveCard.js';
import { driveStripFor } from './scoresV2Shape.js';
import { lastActionPlay } from './driveStrip.js';
import { scoreChanges, lineFromPlays } from './gamePageArcade.js';
import { cfbPlayText } from './playText.js';
import { heroName } from './heroName.js';

export const REPLAY_AFTER_MS = 1_000;

const ms = (v) => { const t = new Date(v ?? NaN).getTime(); return Number.isFinite(t) ? t : null; };

/** The plays in game order (period up, clock down), the order the card itself reads them in. */
export const replayOrder = (plays) => byGameClock(plays);

/**
 * Where the cut falls. `play` is a provider_play_id; `at` an ISO instant, which
 * cuts after the last play stored by then. Neither: the last play (the game as
 * it ended). PURE.
 * @returns {{ index: number, now: Date } | null}  null when the play/instant names nothing
 */
export function resolveCut(ordered, { play = null, at = null } = {}) {
  if (!ordered.length) return null;
  if (play != null && play !== '') {
    const i = ordered.findIndex((p) => String(p.providerPlayId) === String(play));
    if (i < 0) return null;
    const t = ms(ordered[i].createdAt);
    return { index: i, now: new Date((t ?? Date.now()) + REPLAY_AFTER_MS) };
  }
  if (at != null && at !== '') {
    const t = ms(at);
    if (t == null) return null;
    let i = -1;
    ordered.forEach((p, k) => { const c = ms(p.createdAt); if (c != null && c <= t) i = k; });
    if (i < 0) return null;
    return { index: i, now: new Date(t) };
  }
  const last = ordered.length - 1;
  return { index: last, now: new Date((ms(ordered[last].createdAt) ?? Date.now()) + REPLAY_AFTER_MS) };
}

/**
 * The drive envelopes as they stood at the cut. Drives that began before the
 * current one keep their stored envelope; the current drive is rebuilt from its
 * own start (identity, offense, where and when it began) with NO totals, so the
 * card derives plays and yards from the truncated plays. Drives that had not
 * begun are gone. `allPlays` is the full game-ordered list.
 *
 * CFB ONLY, `keepWhenDone`: CFB play clocks are drive-granular (every play of a
 * drive carries the drive's clock) so a time of possession cannot be derived
 * from them; CFBD's own duration is the only one there is. A CFB drive that is
 * complete at the cut - the cut play scored, or is the drive's last - keeps its
 * stored envelope, which is what the live card read the moment it closed. A CFB
 * drive still in progress shows plays and yards only. NFL always derives: its
 * clocks are real, and the stored yards of a field-goal drive run to the goal
 * line (lib/gridiron/plays.js), which the plays themselves do not.
 */
export function drivesAsOf(drives, truncated, allPlays = null, { keepWhenDone = false } = {}) {
  const cut = truncated.at(-1) ?? null;
  const last = [...truncated].reverse().find((p) => p.driveId != null) ?? null;
  if (!last) return [];
  const hasMore = (id) => allPlays != null && allPlays.some((p) => p.driveId != null && String(p.driveId) === String(id) && !truncated.includes(p));
  const seen = new Set(truncated.filter((p) => p.driveId != null).map((p) => String(p.driveId)));
  const out = [];
  for (const d of drives ?? []) {
    if (!d || !seen.has(String(d.driveId))) continue;
    if (String(d.driveId) !== String(last.driveId)) { out.push(d); continue; }
    if (keepWhenDone && (cut?.scoring === true || !hasMore(d.driveId))) { out.push(d); continue; }
    out.push({
      driveId: d.driveId, driveNumber: d.driveNumber, offenseTeamId: d.offenseTeamId,
      offenseName: d.offenseName, startPeriod: d.startPeriod, startClock: d.startClock,
      startYardsToGoal: d.startYardsToGoal,
    });
  }
  return out;
}

/**
 * The game as a LIVE game at the cut: status live, the score of the last score
 * change, the period and clock of the last play. `game` is getGamePage's shape.
 */
export function gameAsOf(game, truncated) {
  const cfb = game.leagueSlug === 'cfb';
  const ordered = byGameClock(truncated);
  const last = ordered.at(-1) ?? null;
  const scored = scoreChanges(truncated).at(-1) ?? null;
  return {
    ...game,
    status: 'live',
    homeScore: scored?.homeScore ?? 0,
    awayScore: scored?.awayScore ?? 0,
    liveState: { period: last?.period ?? null, clock: last?.clock ?? null },
    home: { ...game.home, shortName: cfb ? heroName(game.home) : (game.home?.short_name ?? null) },
    away: { ...game.away, shortName: cfb ? heroName(game.away) : (game.away?.short_name ?? null) },
  };
}

/**
 * THE REPLAY, whole: the inputs and the card slice the page hands to CardFace
 * (g, x) exactly as arcadeGameView hands them for a live game.
 * @returns {{ cut, plays, drives, now, g, x, driveCard } | null}
 */
export function replayFor({ game, plays = [], drives = [], play = null, at = null } = {}) {
  const ordered = replayOrder(plays);
  const cut = resolveCut(ordered, { play, at });
  if (!cut) return null;
  const truncated = ordered.slice(0, cut.index + 1);
  const drivesNow = drivesAsOf(drives, truncated, ordered, { keepWhenDone: game.leagueSlug === 'cfb' });
  const g = gameAsOf(game, truncated);
  const cfb = game.leagueSlug === 'cfb';
  const clean = (t) => (cfb ? cfbPlayText(t) : t);
  const cleanDrive = (d) => (cfb && d?.lastPlay ? { ...d, lastPlay: cfbPlayText(d.lastPlay) } : d);
  const driveCard = driveCardFor({ plays: truncated, game: g, drives: drivesNow, now: cut.now });
  const x = {
    rank: { home: null, away: null }, record: { home: null, away: null },
    spreadHome: null, total: null, openHome: null, preview: null,
    drive: cleanDrive(driveStripFor({ plays: truncated, game: g })),
    driveCard,
    diamond: null, stat: null, hasStats: false, mlbFoot: null, probables: null, prob: null,
    stake: null, open: false,
    line: lineFromPlays(truncated, g),
    closing: null,
    lastPlay: clean(lastActionPlay(truncated)?.text ?? null),
  };
  return { cut, plays: truncated, drives: drivesNow, now: cut.now, g, x, driveCard };
}
