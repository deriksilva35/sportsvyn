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

// ---------------------------------------------------------------------------
// BOX-SCORE LINES - REVEAL ONLY
// ---------------------------------------------------------------------------
/**
 * The line under a name on a CLOSED day: what the player actually did in the
 * week the board was drawn from.
 *
 * PURE, AND REVEAL-ONLY BY CONSTRUCTION. This is never reachable from a live
 * board: publicBoard() is the only sanctioned pre-close serialization and it
 * has no idea this function exists. The stat rows are read at render from
 * nfl_player_game_stats rather than frozen onto the board, so no board needs
 * regenerating and a frozen board carries no answer it did not already carry.
 * A closed day is public - the whole point of a reveal - so there is nothing
 * here to protect.
 *
 * WHAT SHOWS AND WHAT DOES NOT. The volume stat that anchors a position always
 * prints, because a missing anchor reads as "no data" rather than "zero".
 * Everything else prints only when it happened - "0 TD" on a receiver is noise
 * on sixty-four rows. The one deliberate exception is a QUARTERBACK'S
 * INTERCEPTIONS, which print at zero: a clean sheet is a real statement about
 * how a quarterback played, and omitting it would read as though we had not
 * looked.
 */
export function statLine(pos, s) {
  if (!s) return null;
  const n = (v) => Number(v ?? 0);
  const bits = [];

  if (pos === 'QB') {
    if (n(s.passAtt)) {
      bits.push(`${n(s.passCmp)}/${n(s.passAtt)}`, `${n(s.passYds)} yds`);
      bits.push(`${n(s.passTd)} TD`, `${n(s.int)} INT`);   // both, always - see above
    }
    if (n(s.rushAtt) || n(s.rushYds)) {
      bits.push(`${n(s.rushAtt)} rush ${n(s.rushYds)} yds${n(s.rushTd) ? `, ${n(s.rushTd)} TD` : ''}`);
    }
  } else if (pos === 'RB') {
    if (n(s.rushAtt) || n(s.rushYds)) {
      bits.push(`${n(s.rushAtt)} att`, `${n(s.rushYds)} yds`);
      if (n(s.rushTd)) bits.push(`${n(s.rushTd)} TD`);
    }
    if (n(s.rec) || n(s.recYds)) {
      bits.push(`${n(s.rec)} rec ${n(s.recYds)} yds${n(s.recTd) ? `, ${n(s.recTd)} TD` : ''}`);
    }
  } else if (pos === 'WR' || pos === 'TE') {
    if (n(s.rec) || n(s.tgt)) {
      bits.push(`${n(s.rec)}/${n(s.tgt)}`, `${n(s.recYds)} yds`);
      if (n(s.recTd)) bits.push(`${n(s.recTd)} TD`);
    }
    if (n(s.rushAtt) || n(s.rushYds)) {
      bits.push(`${n(s.rushAtt)} rush ${n(s.rushYds)} yds${n(s.rushTd) ? `, ${n(s.rushTd)} TD` : ''}`);
    }
  }

  // A player who cleared the PPR floor on something this shape does not cover
  // gets nothing rather than an empty scaffold. Absence over inference.
  return bits.length ? bits.join(', ') : null;
}
