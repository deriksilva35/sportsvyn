// lib/nba/yours.js - what the reader has riding on NBA games (nba-card,
// thu-37): the game page's "In your games" and the /scores Pick'em strip.
//
// PICK'EM ONLY, BY RULING. Tonight's Six is not built; its row on the game
// page is drawn ONLY when a Tonight's Six entry exists, so today it is absent -
// never a placeholder. When that game lands it adds a row kind here.
//
// THE DAY BOARD IS lib/nba/dayPickem.js's, and so is its lock: every decision
// reads the match's CURRENT kickoff_at and status (dayGameLocked), never the
// tip frozen into the board - the rule the save and the settle apply, so this
// cannot call a game open that the board would refuse.
//
// ALL SELECTS. The board holding a game is found by containment on its board
// jsonb (a tip that moved across midnight is still on the board it was filed
// on), never by re-deriving a day from the current tip.

import { sql } from '../db.js';
import { pickState } from '../gridiron/scoresV2Shape.js';
import { dayBoardFor, etDay, currentGames, withCurrentTips, dayGameLocked, isVoidStatus } from './dayPickem.js';

const PICKEM_HREF = '/pickem/nba';
const sideOf = (lineup, id) => lineup?.[id] ?? lineup?.[String(id)] ?? null;

/** "leading by 3" / "trailing by 3" / "tied", from the picked side. PURE. */
export function marginWords(side, homeScore, awayScore) {
  const h = Number(homeScore); const a = Number(awayScore);
  if (!Number.isFinite(h) || !Number.isFinite(a)) return null;
  const d = side === 'home' ? h - a : a - h;
  return d === 0 ? 'tied' : d > 0 ? `leading by ${d}` : `trailing by ${-d}`;
}

/**
 * THE ROWS AND THE OFFER, from what the reads returned. PURE.
 * @param game          the page's game (id, status, scores, kickoffAt, home, away)
 * @param contest       the day board holding this game, or null
 * @param entry         the reader's entry on it, or null
 * @param boardMatches  Map(match id -> { status, home_score, away_score, kickoff_at }) - currentGames()
 * @returns {{ rows: [{kind,label,line,value,href}], open: [{kind,label,href}] }}
 */
export function nbaYourGames({ game, contest = null, entry = null, boardMatches = new Map(), signedIn = false, now = new Date() }) {
  if (!contest) return { rows: [], open: [] };
  const onBoard = (contest.board ?? []).some((b) => Number(b.match_id) === Number(game.id));
  if (!onBoard) return { rows: [], open: [] };
  const side = sideOf(entry?.lineup, game.id);
  const rows = [];
  if (side === 'home' || side === 'away') {
    const abbr = (side === 'home' ? game.home : game.away)?.abbreviation ?? '';
    const state = game.status === 'final' ? 'final' : game.status === 'live' ? 'live' : 'pre';
    let value;
    if (state === 'final') {
      // TONIGHT'S RECORD: picks on the board's finished games, and how many
      // were right. A void game is off the board for everyone.
      let won = 0, decided = 0;
      for (const [id, m] of boardMatches) {
        const s = sideOf(entry?.lineup, id);
        if (!s || m.status !== 'final' || isVoidStatus(m.status)) continue;
        decided += 1;
        if (pickState({ side: s, homeScore: m.home_score, awayScore: m.away_score, status: 'final' }) === 'won') won += 1;
      }
      const st = pickState({ side, homeScore: game.homeScore, awayScore: game.awayScore, status: 'final' });
      value = [st === 'won' ? 'Won' : st === 'lost' ? 'Lost' : 'Push', decided ? `${won} of ${decided} tonight` : null].filter(Boolean).join(' · ');
    } else if (state === 'live') {
      value = marginWords(side, game.homeScore, game.awayScore) ?? 'Live';
    } else {
      value = 'Locks at tip';
    }
    rows.push({ kind: 'pickem', label: "PICK'EM", line: `${state === 'final' ? 'You had' : 'You have'} ${abbr}`, value, href: PICKEM_HREF });
  }
  // THE OFFER: this game is still pickable (its CURRENT tip ahead, still
  // scheduled) and the reader has no pick on it. Signed out it is offered too:
  // the Play card says "Sign in to play".
  const cur = boardMatches.get(Number(game.id)) ?? { status: game.status, kickoff_at: game.kickoffAt };
  const open = !side && !dayGameLocked({ ...cur, kickoff_at: cur.kickoff_at ?? game.kickoffAt }, now)
    ? [{ kind: 'pickem', label: "Pick'em", href: PICKEM_HREF }] : [];
  return { rows: signedIn ? rows : [], open };
}

/** THE READ for the game page. `db` injectable for the read-count tests. */
export async function nbaInYourGames({ userId = null, game, now = new Date(), db = sql }) {
  const [contest] = await db`
    SELECT id, board, settled FROM contests
     WHERE game_type = 'pickem' AND sport = 'nba'
       AND COALESCE((meta->>'day_board')::boolean, false)
       AND board @> ${JSON.stringify([{ match_id: Number(game.id) }])}::jsonb
     ORDER BY id DESC LIMIT 1`;
  if (!contest) return { rows: [], open: [] };
  const uid = userId == null ? null : Number(userId);
  const [entry] = uid == null || !Number.isFinite(uid) ? [] : await db`
    SELECT lineup FROM contest_entries WHERE contest_id = ${contest.id} AND user_id = ${uid}`;
  const boardMatches = await currentGames(contest.board);
  return nbaYourGames({ game, contest, entry: entry ?? null, boardMatches, signedIn: uid != null, now });
}

/**
 * THE STRIP'S WORDS. PURE. Null when there is nothing to say about today.
 *   open games   signed in "1 of 3 picked · next lock"; signed out "3 to pick · next lock"
 *   all tipped   "3 games · all tipped · 2 picked"
 *   settled      "Settled · 2 of 3 right"
 * nextLock is the instant of the next lock; the strip renders it in the PAGE
 * zone (StandaloneTime), so it agrees with the header and the cards.
 */
export function nbaStripWords({ settled = false, games = 0, pickable = 0, pickedOpen = 0, picked = 0, score = null, max = null, nextLock = null, signedIn = false }) {
  if (!games) return null;
  const count = `${games} ${games === 1 ? 'game' : 'games'}`;
  if (settled) {
    return { line: signedIn && score != null ? `Settled · ${score} of ${max ?? games} right` : `${count} · settled`, nextLock: null, cta: 'Board' };
  }
  if (pickable > 0) {
    return { line: signedIn ? `${pickedOpen} of ${pickable} picked` : `${pickable} to pick`, nextLock, cta: 'Pick' };
  }
  return { line: `${count} · all tipped${signedIn && picked ? ` · ${picked} picked` : ''}`, nextLock: null, cta: 'Board' };
}

/**
 * THE STRIP'S READ: TODAY'S board only (the ET day of now), once open. A day
 * with no NBA board is no strip - the ruling: "shown only when today has an
 * NBA board".
 * @returns {{ href, kicker, line, nextLock, cta } | null}
 */
export async function nbaPickemStrip({ userId = null, now = new Date() } = {}) {
  const c = await dayBoardFor({ dayEt: etDay(now) });
  if (!c || new Date(c.opens_at).getTime() > new Date(now).getTime()) return null;
  const byId = await currentGames(c.board);
  const board = withCurrentTips(c.board, byId);
  const uid = userId == null ? null : Number(userId);
  const [e] = uid == null ? [] : await sql`
    SELECT lineup, score FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${uid}`;
  const picks = e?.lineup ?? {};
  const live = board.filter((g) => !isVoidStatus(byId.get(Number(g.match_id))?.status));
  const open = live.filter((g) => !dayGameLocked({ ...byId.get(Number(g.match_id)), kickoff_at: g.kickoff_at }, now));
  const words = nbaStripWords({
    settled: c.settled === true,
    games: live.length,
    pickable: open.length,
    pickedOpen: open.filter((g) => sideOf(picks, g.match_id) != null).length,
    picked: Object.keys(picks).length,
    score: e?.score == null ? null : Number(e.score),
    max: c.perfect?.max ?? null,
    nextLock: open[0]?.kickoff_at ?? null,
    signedIn: uid != null,
  });
  return words ? { href: PICKEM_HREF, kicker: "Pick'em · Tonight", ...words } : null;
}

/**
 * TONIGHT'S SIX IN "IN YOUR GAMES" (fri-1). PURE. `six` is
 * lib/six/entry.js sixEntryTouchingMatch's answer: this user's Six slots in
 * THIS game, or null. One row, the canvas's words:
 *   "Tatum · Cunningham in your six"  pre: "2 players" | live: "58.5 pts live"
 *   | final: "71 pts from this game". A DNP reads "(DNP)" after the name.
 */
export function sixYourRow(six, state) {
  if (!six?.slots?.length) return null;
  const last = (n) => String(n ?? '').trim().split(/\s+/).pop() || '?';
  const names = six.slots.map((s) => `${last(s.name)}${s.dnp ? ' (DNP)' : ''}`).join(' · ');
  const pts = Math.round(six.slots.reduce((a, s) => a + (Number(s.points) || 0), 0) * 10) / 10;
  const n = six.slots.length;
  const value = state === 'pre' ? `${n} player${n === 1 ? '' : 's'}`
    : state === 'live' ? `${pts} pts live` : `${pts} pts from this game`;
  return { kind: 'six', label: "TONIGHT'S SIX", line: `${names} in your six`, value, href: six.href ?? '/six' };
}
