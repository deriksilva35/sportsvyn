// lib/daily/reveal.js - what a closed day is worth. PURE.
//
// THE PERFECT LINEUP IS BRUTE-FORCED, and that is a deliberate choice over
// anything cleverer. Greedy - take the best QB, best RB, best WR, best TE, then
// the two best remaining flex-eligible - is WRONG, and wrong in a way that
// looks right: the best TE can be worth less than the third-best WR, in which
// case the optimum leaves a strong TE out of the TE slot and fills FLEX twice
// from receivers. The paper test found exactly that. Sixty-four players over
// six slots is small enough to enumerate honestly, so we enumerate.

import { SLOTS } from './play.js';

const FLEX_OK = new Set(['RB', 'WR', 'TE']);

/**
 * The best possible six-slot lineup on this board, scored drop-worst.
 *
 * Enumerated as: every dedicated slot takes its own position's candidates, and
 * the two FLEX slots take any flex-eligible player not already used. The search
 * is bounded by taking only the top N per position - a player outside the top
 * six at his position cannot appear in an optimal lineup of six, because five
 * of them are dedicated to other slots.
 */
export function perfectLineup(board) {
  const byPos = {};
  for (const p of board ?? []) (byPos[p.pos] ??= []).push(p);
  for (const k of Object.keys(byPos)) {
    byPos[k].sort((a, b) => b.points - a.points || String(a.name).localeCompare(String(b.name)));
    byPos[k] = byPos[k].slice(0, 8);   // generous bound; see the doc above
  }
  const flexPool = ['RB', 'WR', 'TE'].flatMap((p) => byPos[p] ?? [])
    .sort((a, b) => b.points - a.points || String(a.name).localeCompare(String(b.name)))
    .slice(0, 12);

  let best = null;
  const consider = (picks) => {
    const total = scoreDropWorst(picks.map((p) => p.points));
    if (!best || total > best.total) best = { total, picks: picks.map((p, i) => ({ ...p, slot: SLOTS[i] })) };
  };

  for (const qb of byPos.QB ?? []) {
    for (const rb of byPos.RB ?? []) {
      for (const wr of byPos.WR ?? []) {
        for (const te of byPos.TE ?? []) {
          const used = new Set([qb.id, rb.id, wr.id, te.id]);
          const avail = flexPool.filter((p) => !used.has(p.id));
          for (let i = 0; i < avail.length; i++) {
            for (let j = i + 1; j < avail.length; j++) {
              consider([qb, rb, wr, te, avail[i], avail[j]]);
            }
          }
        }
      }
    }
  }
  if (!best) return null;
  const worst = best.picks.reduce((lo, p, i) => (p.points < best.picks[lo].points ? i : lo), 0);
  return {
    total: Math.round(best.total * 10) / 10,
    picks: best.picks.map((p, i) => ({ ...p, dropped: i === worst })),
  };
}

function scoreDropWorst(points) {
  const s = [...points].sort((a, b) => a - b);
  return s.slice(1).reduce((a, b) => a + b, 0);
}

/**
 * The tier, from score against the perfect lineup.
 *
 * A RATIO, NOT A RAW SCORE. A 90-point board and a 140-point board are
 * different puzzles, and "you got 112" means nothing without the ceiling.
 * Percent-of-perfect is comparable across days, which is what a badge has to be
 * if anyone is going to collect them.
 */
export const TIERS = [
  { at: 0.95, label: 'HALL OF FAME' },
  { at: 0.90, label: 'MVP' },
  { at: 0.75, label: 'PRO BOWLER' },
  { at: 0.55, label: 'STARTER' },
  { at: 0, label: 'PRACTICE SQUAD' },
];

export function tierFor(score, perfect) {
  if (score == null || !perfect) return null;
  const pct = Number(score) / Number(perfect);
  const t = TIERS.find((x) => pct >= x.at) ?? TIERS[TIERS.length - 1];
  return { label: t.label, pct: Math.round(pct * 1000) / 10 };
}

/**
 * Did the guess land? Reveal-time only - pre-close the player is told the bonus
 * they earned and nothing about whether it was right, because telling one
 * person the season hands it to everyone they talk to.
 */
export function guessResult(entry, day) {
  if (entry?.guess_season == null && entry?.guess_week == null) return null;
  return {
    guessedSeason: entry.guess_season ?? null,
    guessedWeek: entry.guess_week ?? null,
    seasonRight: Number(entry.guess_season) === Number(day.season_year),
    weekRight: Number(entry.guess_week) === Number(day.week),
    bonusPct: Number(entry.bonus_pct ?? 0),
  };
}

/**
 * DNF: a round that was started and never locked.
 *
 * THE ATTEMPT IS CONSUMED, because the board was seen. Handing out a second
 * clock to anyone who abandons the first would make the two minutes optional -
 * you could open the board, read it at leisure, walk away, and come back to a
 * fresh timer knowing every name on it. The reveal is shown in full: the player
 * loses the score, not the answer.
 */
export const isDnf = (entry) => Boolean(entry) && !entry.locked_at;
