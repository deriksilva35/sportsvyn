// lib/gridiron/driveCard.js - THE LIVE DRIVE CARD, PURE (drive-2).
//
// ONE MODULE for the field strip's geometry, its two text lines and the
// scoring moment, shared by /scores and the game page. It reads what those
// surfaces already hold - the recent plays (situationNow's input) and the
// drive envelopes stored on matches.metadata.drives - and invents no model.
//
// GEOMETRY IS THE MOCK'S, IN ITS OWN SVG UNITS: 354 wide, a 26-unit end zone
// each side, 100 yards across the 302 between them (3.02 per yard), a yard line
// every ten. Left end zone = HOME, as lib/gridiron/driveStrip.js fixes it, so
// the home team attacks to the right.
//
// THE SCORING MOMENT IS DETERMINISTIC AND SERVER-SIDE: it shows while the
// latest TD / FG / SAFETY play's plays.created_at is within FLASH_MS of the
// `now` the caller passes in. No client timer, no animation state: the card is
// re-rendered by the 30 s refresh and the flash is simply absent once the play
// is old enough. KNOWN EDGE: created_at is when WE first stored the play, so a
// game first imported mid-game shows its latest score's flash once (it is
// guarded to the last few plays, so only a score just made can do it).

import { lastLivePlay, byGameClock, spotLabel, STOPPAGE_TYPES, stoppageKey } from './driveStrip.js';
import { situationNow } from './situation.js';

export const FIELD = Object.freeze({ width: 354, zone: 26, yard: 3.02, top: 6, height: 34 });
export const FLASH_MS = 35_000;
// A scoring play older than this many plays is never the flash, whatever its
// stamp says (the first-import edge above).
const FLASH_WITHIN_PLAYS = 8;
const BALL_R = 7;

const ORD = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th' };
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const key = (t) => String(t ?? '').trim().toLowerCase().replace(/\s+/g, '-');
const r2 = (n) => Math.round(n * 100) / 100;

/** SVG x of a yard line, `abs` yards from the LEFT goal line (0-100). */
export function xAt(abs) {
  return r2(FIELD.zone + Math.max(0, Math.min(100, abs)) * FIELD.yard);
}

/** yards_to_goal is toward the defense's end zone; the left end zone is HOME's. */
export function absFromLeft(offenseIsHome, ytg) {
  const y = Math.max(0, Math.min(100, Number(ytg)));
  return offenseIsHome ? 100 - y : y;
}

/**
 * THE FIRST-DOWN LINE: LOS + distance toward the end zone being attacked,
 * clamped at the goal line. null on & Goal (the goal line is the line to gain).
 * PURE.
 * @returns {{ ytg: number, x: number } | null}
 */
export function firstDownLine({ offenseIsHome, yardsToGoal, distance }) {
  const ytg = num(yardsToGoal), d = num(distance);
  if (ytg == null || d == null || isGoalToGo(ytg, d)) return null;
  const fd = Math.max(0, ytg - d);
  return { ytg: fd, x: xAt(absFromLeft(offenseIsHome, fd)) };
}

/** & Goal: the line to gain is the goal line itself. */
export const isGoalToGo = (yardsToGoal, distance) => num(yardsToGoal) != null && num(distance) != null && Number(distance) >= Number(yardsToGoal);

/** The 20 yards in front of the end zone being attacked, only with the ball inside it. */
export function redZone({ offenseIsHome, yardsToGoal }) {
  const ytg = num(yardsToGoal);
  if (ytg == null || ytg > 20 || ytg < 0) return null;
  return offenseIsHome
    ? { x: xAt(80), w: r2(FIELD.zone + FIELD.yard * 100 - xAt(80)) }
    : { x: FIELD.zone, w: r2(FIELD.yard * 20) };
}

/** "2nd & 8", "1st & Goal". */
export function downLabel(down, distance, yardsToGoal) {
  const o = ORD[Number(down)];
  if (!o || num(distance) == null) return null;
  return `${o} & ${isGoalToGo(yardsToGoal, distance) ? 'Goal' : Number(distance)}`;
}

/** "m:ss" from seconds. */
export function mmss(sec) {
  const s = Math.max(0, Math.round(Number(sec)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const clockSec = (c) => { const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(c ?? '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
/** Elapsed game seconds at (period, clock): a quarter break and halftime cost nothing. */
export function gameElapsed(period, clock) {
  const p = num(period), left = clockSec(clock);
  if (p == null || left == null) return null;
  if (p >= 5) return 3600 + (p - 5) * 600 + Math.max(0, 600 - left);
  return (p - 1) * 900 + Math.max(0, 900 - left);
}

// ---------------------------------------------------------------- scoring

/**
 * TD / FG / SAFETY from the play's type and the points it added, or null for
 * anything else (an extra point, a two-point try, a score the type and delta
 * cannot name). PURE. `delta` is the scoring side's gain on this play.
 */
export function classifyScore(playType, delta) {
  const t = key(playType), d = num(delta);
  if (d == null || d <= 0) return null;
  if (/safety/.test(t)) return d === 2 ? 'SAFETY' : null;
  if (/extra-point|two-point|2-point|conversion|\bpat\b/.test(t)) return null;
  if (/field-goal/.test(t)) return d === 3 ? 'FG' : null;
  if (/touchdown/.test(t)) return d >= 6 ? 'TD' : null;
  if (d === 3) return 'FG';
  if (d >= 6 && d <= 8) return 'TD';
  return null;
}

const KIND_WORD = { TD: 'Touchdown', FG: 'Field goal', SAFETY: 'Safety' };

/**
 * The latest TD / FG / SAFETY play, in game order, with the side that scored.
 * The delta is against the PREVIOUS SCORING row, not the previous row: a
 * stoppage row can carry a stale 0-0.
 * @returns {{ play, kind, side, fromEnd }|null} fromEnd = plays after it
 */
export function latestScore(plays) {
  const ordered = byGameClock(plays);
  let h = 0, a = 0, found = null;
  ordered.forEach((p, i) => {
    if (!p.scoring || num(p.homeScore) == null || num(p.awayScore) == null) return;
    const dh = Number(p.homeScore) - h, da = Number(p.awayScore) - a;
    h = Number(p.homeScore); a = Number(p.awayScore);
    const side = dh > da ? 'home' : 'away';
    const kind = classifyScore(p.playType, side === 'home' ? dh : da);
    if (kind) found = { play: p, kind, side, fromEnd: ordered.length - 1 - i };
  });
  return found;
}

/** The scoring moment, or null once it is older than FLASH_MS (or was never fresh). PURE. */
export function scoringMoment(plays, now = new Date()) {
  const s = latestScore(plays);
  if (!s || s.fromEnd >= FLASH_WITHIN_PLAYS) return null;
  const at = new Date(s.play.createdAt ?? NaN).getTime();
  if (!Number.isFinite(at)) return null;
  const age = new Date(now).getTime() - at;
  return age <= FLASH_MS && age >= -5_000 ? s : null;
}

// ---------------------------------------------------------------- the drive

// A SNAP, NOT A STOPPAGE OR A KICKOFF: timeouts, end-of-period rows and the like
// carry the situation (down, spot) in the feeds, and CFB files the DEFENSE's
// timeout - and the drive-opening kickoff, under the RECEIVING team - in the
// drive with a yard line of their own. Counted as plays they add snaps and turn
// "59 yds" into "-31 yds" (found replaying OSU-ORE, 7 Nov: drive 12 read
// "10 plays - -31 yds"; drive 1 read "1 play - 0 yds"). Stoppages and kickoffs
// are out, and so is any row whose offense is not the drive's own (the offense
// most of its snaps name).
const isScrimmage = (p) => p.down != null && p.yardsToGoal != null
  && !STOPPAGE_TYPES.has(stoppageKey(p.playType)) && !/kickoff/.test(stoppageKey(p.playType));
const snapsOf = (rows) => {
  const scr = rows.filter(isScrimmage);
  const tally = new Map();
  for (const p of scr) if (p.offenseTeamId != null) tally.set(p.offenseTeamId, (tally.get(p.offenseTeamId) ?? 0) + 1);
  const off = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return off == null ? scr : scr.filter((p) => p.offenseTeamId == null || p.offenseTeamId === off);
};

/**
 * "9 plays · 37 yds · 4:31" parts for one drive: the stored envelope first
 * (CFB: CFBD's own count, yards and duration; NFL: our reconstruction, whose
 * duration is null because BDL has no drive clock), then whatever the drive's
 * own plays can say. NFL time of possession is game-clock elapsed from the
 * drive's first snap to its latest play, across any quarter break, so it runs
 * to the last snap seen, not through that play's own run-off. PURE.
 * `deriveTop` false (CFB): CFB play clocks are drive-granular (every play of a
 * drive carries the drive's clock), so a time derived from them is wrong - the
 * stored summary's duration or nothing.
 * @returns {{ plays, yards, top, startYtg, derived }}
 */
export function driveTotals({ env = null, plays = [], deriveTop = true } = {}) {
  const own = byGameClock(plays);
  const scr = snapsOf(own);
  let count = num(env?.playCount), yards = num(env?.yards);
  let top = typeof env?.duration === 'string' && /^\d+:\d{2}$/.test(env.duration.trim()) ? env.duration.trim() : null;
  let derived = false;
  if (count == null && scr.length) { count = scr.length; derived = true; }
  if (yards == null && scr.length) {
    const first = scr[0], last = scr.at(-1);
    // A KICK DOES NOT MOVE THE OFFENSE: a field goal row's yards_gained is the kick
    // (27 on a 27-yard try), so ytg - gained put the drive 18 yds past the goal line
    // ("13 plays - 81 yds" for a drive that started at 63 and kicked from the 9).
    const kick = /field-goal|punt/.test(stoppageKey(last.playType));
    const endYtg = num(last.yardsToGoal) != null && num(last.yardsGained) != null
      ? Number(last.yardsToGoal) - (kick ? 0 : Number(last.yardsGained)) : null;
    if (num(first.yardsToGoal) != null && endYtg != null) { yards = Number(first.yardsToGoal) - endYtg; derived = true; }
  }
  if (top == null && deriveTop) {
    const a = gameElapsed(env?.startPeriod ?? own[0]?.period, env?.startClock ?? own[0]?.clock);
    const b = gameElapsed(env?.endPeriod ?? own.at(-1)?.period, env?.endClock ?? own.at(-1)?.clock);
    if (a != null && b != null && b >= a) { top = mmss(b - a); if (env?.duration == null) derived = derived || !env; }
  }
  return { plays: count, yards, top, startYtg: num(env?.startYardsToGoal) ?? num(scr[0]?.yardsToGoal), derived };
}

const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export function driveLine(t) {
  if (!t || t.plays == null) return null;
  const bits = [plural(t.plays, 'play')];
  if (t.yards != null) bits.push(`${t.yards} yds`);
  if (t.top) bits.push(t.top);
  return bits.join(' · ');
}

// ---------------------------------------------------------------- the card

const teamName = (t) => t?.shortName ?? t?.short_name ?? t?.name ?? t?.abbreviation ?? '';
const teamAbbr = (t) => t?.abbreviation ?? String(t?.shortName ?? t?.name ?? '').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
const hexOk = (v) => (/^#?[0-9a-f]{6}$/i.test(String(v ?? '').trim()) ? `#${String(v).trim().replace('#', '').toUpperCase()}` : null);
/** White ink on a dark zone, navy on a light one (relative luminance, WCAG weights). */
export function inkOn(hex, dark, light) {
  const h = hexOk(hex); if (!h) return dark;
  const [r, g, b] = [1, 3, 5].map((i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? light : dark;
}

/**
 * THE CARD. null when there is nothing to draw (no snap with a ball yet and no
 * scoring moment), and the caller then keeps the old strip.
 *
 * @param plays  recent plays: period, clock, down, distance, yardsToGoal,
 *               yardsGained, offenseTeamId, playType, scoring, homeScore,
 *               awayScore, driveId, createdAt
 * @param game   { home, away } with id, abbreviation, name/shortName, colors
 * @param drives matches.metadata.drives (newest last is fine; matched by driveId)
 * @param now    the instant the flash is judged against
 */
export function driveCardFor({ plays = [], game, drives = [], now = new Date() } = {}) {
  const home = game?.home, away = game?.away;
  if (!home || !away) return null;
  const snap = lastLivePlay(plays);
  const flash = scoringMoment(plays, now);
  if (!snap && !flash) return null;

  const sideTeam = (side) => (side === 'home' ? home : away);
  const colorOf = (side) => hexOk(sideTeam(side)?.colors?.primary);

  const driveId = flash ? (flash.play.driveId ?? snap?.driveId ?? null) : (snap?.driveId ?? null);
  const env = driveId == null ? null : (drives ?? []).find((d) => String(d?.driveId) === String(driveId)) ?? null;
  const dplays = driveId == null ? [] : plays.filter((p) => p.driveId != null && String(p.driveId) === String(driveId));
  const totals = driveTotals({ env, plays: dplays, deriveTop: game?.leagueSlug !== 'cfb' });

  const offenseId = flash ? (env?.offenseTeamId ?? flash.play.offenseTeamId ?? snap?.offenseTeamId ?? null) : (snap.offenseTeamId ?? null);
  const offenseIsHome = offenseId != null && offenseId === home.id;
  if (!flash && offenseId == null) return null;
  const offense = offenseIsHome ? home : away;
  const defense = offenseIsHome ? away : home;
  const offAbbr = teamAbbr(offense), defAbbr = teamAbbr(defense);

  const zone = (side) => ({ abbr: teamAbbr(sideTeam(side)), color: colorOf(side), flash: null });
  const endZones = { left: zone('home'), right: zone('away') };

  const yardLines = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => xAt(i * 10));
  const yardLabels = [10, 20, 30, 40, 50, 40, 30, 20, 10].map((t, i) => ({ x: yardLines[i], text: String(t) }));
  const base = { endZones, yardLines, yardLabels, losX: null, firstDownX: null, ballX: null, band: null, startX: null, redZone: null };

  const bandFor = (ballX) => {
    if (totals.startYtg == null) return { band: null, startX: null };
    const startX = xAt(absFromLeft(offenseIsHome, totals.startYtg));
    return { band: { x: Math.min(startX, ballX), w: r2(Math.abs(ballX - startX)) }, startX };
  };
  const dl = driveLine(totals);

  // ---- THE SCORING MOMENT ------------------------------------------------
  if (flash) {
    const scorerIsHome = flash.side === 'home';
    const goalX = scorerIsHome ? xAt(100) : xAt(0);
    const target = scorerIsHome ? 'right' : 'left';
    endZones[target] = { ...endZones[target], flash: flash.kind };
    // Only the scorer's own drive has a band to draw to the goal line.
    const mine = offenseId != null && (offenseId === sideTeam(flash.side).id);
    const { band, startX } = mine ? bandFor(goalX) : { band: null, startX: null };
    // THE SCORING DRIVE'S YARDS ARE ITS GEOMETRY, not a provider's tally: a TD
    // drive covers its start to the goal line, a FG drive its start to the line
    // of scrimmage the kick was taken from. CFBD's envelope said 80 for a drive
    // from the 7 that scored (93), and a band drawn from the 7 to the goal line
    // sat under a line that disagreed with it (OSU TD, 8 Nov).
    const yardsMade = mine && totals.startYtg != null
      ? (flash.kind === 'TD' ? totals.startYtg
        : flash.kind === 'FG' && num(flash.play.yardsToGoal) != null ? totals.startYtg - Number(flash.play.yardsToGoal) : totals.yards)
      : totals.yards;
    const flashLine = driveLine({ ...totals, yards: yardsMade });
    const who = teamName(sideTeam(flash.side));
    return {
      mode: 'flash', kind: flash.kind,
      line: `${KIND_WORD[flash.kind]} · ${who}`,
      driveLine: flashLine,
      aria: `${KIND_WORD[flash.kind]}, ${who}`,
      // The ball rests just inside the goal line (its radius), so the volt zone's
      // TD / FG / SAFETY label is not under it.
      ...base, endZones, losX: goalX, ballX: scorerIsHome ? goalX - BALL_R : goalX + BALL_R, band, startX,
    };
  }

  // ---- IN PLAY -----------------------------------------------------------
  const sit = situationNow(plays);              // the state AFTER the last play, or null
  const ytg = num(sit ? sit.yardsToGoal : snap.yardsToGoal);
  if (ytg == null) return null;
  const ballX = xAt(absFromLeft(offenseIsHome, ytg));
  const { band, startX } = bandFor(ballX);
  const spot = spotLabel(ytg, offAbbr || null, defAbbr || null);
  let fd = null, label = null, aria = `Ball at ${spot}`;
  if (sit) {
    label = downLabel(sit.down, sit.distance, ytg);
    fd = firstDownLine({ offenseIsHome, yardsToGoal: ytg, distance: sit.distance });
    aria = isGoalToGo(ytg, sit.distance) ? `Ball at ${spot}, goal to go`
      : fd ? `Ball at ${spot}, first down at ${spotLabel(fd.ytg, offAbbr || null, defAbbr || null)}` : aria;
  }
  return {
    mode: 'live', kind: null,
    line: label ? `${label} · ${spot}` : spot,
    driveLine: dl,
    aria,
    ...base, losX: ballX, firstDownX: fd?.x ?? null, ballX, band, startX,
    redZone: redZone({ offenseIsHome, yardsToGoal: ytg }),
  };
}
