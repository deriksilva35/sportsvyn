// lib/daily/shareCard.js - what the Daily's share card SAYS. PURE.
//
// One finished run becomes one 1080x1680 (9:14) image plus three short lines
// of text (relay mon-12, Derik's mock: Play tab canvas, "Daily share card"
// page, the two roster cards). The image is drawn by
// app/daily/board/[date]/card/route.js; every word and number on it comes
// from the model built here, so the rules below are testable without a
// renderer.
//
// TWO CARDS, AND THE DIFFERENCE IS THE ANSWER.
//
//   OPEN (the board has not closed): the score, the streak, "CAN YOU BEAT
//   IT?" and the eight slots in their position colours with every player
//   HIDDEN - a bar and a lock. No name, no team, no per-slot points: the
//   model does not carry them, so the renderer cannot draw them. A friend
//   who has not played yet learns the season and a number to beat, nothing
//   they could solve the board with. Same rule as lib/daily/openReveal.js -
//   the answer stays secret until midnight - applied to an image that
//   leaves the building.
//
//   CLOSED (midnight ET has passed): every pick - slot, player, team,
//   season points - with a volt star on each pick that is IN the perfect
//   lineup (the grade's `hit`, which is a match by player, so a player held
//   at a different slot than the optimum still counts), "N% of perfect" and
//   "K of 8".
//
// RANK APPEARS ONLY WITH A FIELD. "#12 of 140 · beat 92%" is printed only
// when RANK_MIN_PLAYED or more finished that board; below that a rank is a
// number about three friends, and the card says nothing rather than brag
// about it.
//
// THE PERCENTAGE IS lib/daily/format.js's, never a second rounding: one
// decimal, and "100%" only when the ceiling was actually reached.

import { pctOfCeiling } from './format.js';
import { displayTeamCode } from '../footballdb/historicalTeamDisplay.js';
import { DAILY_V2_PATH } from './boardShape.js';
import { POSITION_INK } from '../brand/dailyCardPalette.js';

export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1680;
export const RANK_MIN_PLAYED = 25;
// THE LINK IS /daily, the short form Derik's mock prints. app/daily/page.js
// answers it with a 308 to today's board (DAILY_V2_PATH), so a friend who taps
// it lands on the board they can still play, never on yesterday's results.
export const SHARE_URL = 'sportsvyn.com/daily';
export const SHARE_HREF = `https://${SHARE_URL}`;
export const CARD_PATH = (date) => `${DAILY_V2_PATH}/${date}/card`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-10-05' -> 'Oct 5'. Read off the string - a Date would move it by a zone. */
export function shortDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd ?? ''));
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

/** 1917 -> '1,917'; 1917.44 -> '1,917.4'. A total never gains a trailing '.0'. */
export function fmtTotal(n) {
  return Number(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

/** A season line's points: always one decimal, as the receipt prints them ('386.2', '135.0'). */
export function fmtPoints(n) {
  return (Math.round(Number(n ?? 0) * 10) / 10).toFixed(1);
}

/**
 * 'Tom Brady' -> 'T. Brady'; 'DK Metcalf' stays (an initialism is already
 * short); one word stays as it is. Keeps a long name inside its row.
 */
export function shortName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] ?? '';
  const [first, ...rest] = parts;
  if (/^[A-Z]{2,3}\.?$/.test(first) || /^([A-Z]\.){1,3}$/.test(first)) return [first, ...rest].join(' ');
  return [`${first[0]}.`, ...rest].join(' ');
}

/** Slot label -> its chip label and ink. Legacy boards' FLEX2 reads FLEX. */
export function slotChip(slot) {
  const label = String(slot ?? 'FLEX').replace(/\d+$/, '');
  return { slot: label, ink: POSITION_INK[label] ?? POSITION_INK.FLEX };
}

/**
 * "#12 of 140 · beat 92%" - or null below RANK_MIN_PLAYED finished runs.
 * beatPct may be null (nobody below to beat counts as "beat 0%", but a null
 * means there was no field) - then the rank stands alone.
 */
export function rankLine({ rank = null, played = 0, beatPct = null } = {}) {
  if (!(Number(played) >= RANK_MIN_PLAYED) || rank == null) return null;
  const head = `#${Number(rank).toLocaleString('en-US')} of ${Number(played).toLocaleString('en-US')}`;
  return beatPct == null ? head : `${head} · beat ${beatPct}%`;
}

// THE BIG NUMBER FITS ITS ROW. Rubik Mono One runs ~0.83em a character, so
// '1,917' fills the mock's 138px (at 3x) comfortably and '1,937.7' does not -
// on the closed card it shares the row with "% of perfect". The size steps
// down to fit the width it has, never below 84px.
const MONO_EM = 0.83;
export const SCORE_MAX_PX = 138;
export function scoreFontSize(label, widthPx) {
  const n = String(label ?? '').length || 1;
  return Math.max(84, Math.min(SCORE_MAX_PX, Math.floor(widthPx / (n * MONO_EM))));
}

/**
 * The card model.
 *
 * @param {object} a
 * @param {'open'|'closed'} a.phase
 * @param {string} a.editionDate   'YYYY-MM-DD'
 * @param {number|string} a.seasonYear
 * @param {number|null} a.streak   current streak; 0/null draws no flame
 * @param {number} a.score         the run's stored score
 * @param {string[]} a.slots       the board's own slot shape (open card)
 * @param {object} [a.grade]       regradeStoredRun(...).grade (closed card only)
 * @param {number} [a.played]      finished runs on this board
 * @param {number|null} [a.rank]
 * @param {number|null} [a.beatPct]
 */
export function shareCardModel({
  phase, editionDate, seasonYear, streak = null, score, slots = [], grade = null,
  played = 0, rank = null, beatPct = null,
}) {
  const date = shortDate(editionDate);
  const base = {
    phase: phase === 'closed' ? 'closed' : 'open',
    editionDate,
    season: String(seasonYear),
    header: `THE DAILY · ${String(date ?? '').toUpperCase()} · ${seasonYear}`,
    streak: Number(streak) > 0 ? Number(streak) : null,
    scoreLabel: fmtTotal(score),
    // 936 = the card's 1080 less its 72px margins; the closed card leaves
    // 376 of that to the percentage block beside the number.
    scoreSize: scoreFontSize(fmtTotal(score), phase === 'closed' ? 560 : 936),
    rankLine: rankLine({ rank, played, beatPct }),
    url: SHARE_URL,
  };

  if (base.phase === 'open') {
    // NOTHING BUT THE SLOT LABEL. This list is built from the board's slot
    // shape, never from the run's picks, so there is no player to leak.
    return {
      ...base,
      challenge: 'CAN YOU BEAT IT?',
      slots: slots.map((s) => slotChip(s)),
      footnote: 'Picks revealed at midnight.',
      footRight: SHARE_URL,
    };
  }

  const rows = (grade?.rows ?? []).map((r) => {
    const chip = slotChip(r.you?.slot);
    const empty = r.you?.name == null;
    return {
      ...chip,
      name: empty ? null : shortName(r.you.name),
      team: empty || r.you.abbr == null ? null : displayTeamCode(r.you.abbr),
      points: empty ? null : fmtPoints(r.you.points),
      star: r.hit === true,
    };
  });
  return {
    ...base,
    pctLabel: pctOfCeiling(score, grade?.perfect),
    starCount: rows.filter((r) => r.star).length,
    slotCount: rows.length,
    rows,
    legend: '= in the perfect lineup',
    footRight: null,
  };
}

/**
 * The words sent beside the image - three lines, the mock's:
 *   The Daily · Oct 5 · 2021
 *   1,917 pts 🔥2
 *   Can you beat it? sportsvyn.com/daily      (open)
 *   88.0% of perfect · sportsvyn.com/daily    (closed)
 */
export function shareText(model) {
  const l1 = `The Daily · ${shortDate(model.editionDate)} · ${model.season}`;
  const l2 = `${model.scoreLabel} pts${model.streak ? ` 🔥${model.streak}` : ''}`;
  const l3 = model.phase === 'open'
    ? `Can you beat it? ${SHARE_URL}`
    : (model.pctLabel ? `${model.pctLabel} of perfect · ${SHARE_URL}` : SHARE_URL);
  return [l1, l2, l3].join('\n');
}

/** The image's file name in the share sheet / download. */
export const cardFileName = (editionDate) => `sportsvyn-daily-${editionDate}.png`;
