// lib/results/weekly.js - the Weekly's results, in the one shape.
//
// THE CEILING IS THEORETICAL AND IT IS STORED. contests.perfect =
// { score, players[] } - perfectLineup's best six from the SHARED pool, written
// at settle (lib/weekly/settle.js's own ruling). It is not a person and the
// mock says so in its footer.
//
// NOTHING IS RE-SCORED HERE. settledView() already joins the entry's lineup
// against the frozen scored board, and pairRows() is the pairing the Weekly's
// grade screen has always used - this reader composes the two and adds the field.

import { sql } from '../db.js';
import { settledView } from '../weekly/view.js';
import { pairRows } from '../games/gradePairing.js';
import { scoreLeaderboard } from '../games/leaderboard.js';
import { header, distribution, axisFor, lostIt, lastName, scoresOf } from './shape.js';

const slotRow = (p, { hit = false, dropped = false } = {}) => ({
  slot: p?.label ?? p?.slot ?? null,
  pos: p?.pos ?? null,
  name: p?.name ?? null,
  short: p?.name ? `${p.name.split(/\s+/)[0][0]}. ${lastName(p.name)}` : null,
  team: p?.team ?? null,
  meta: null,
  points: p?.points == null ? null : Math.round(Number(p.points) * 10) / 10,
  hit,
  dropped,
});

export async function weeklyResults(contestId, userId = null) {
  const [contest] = await sql`
    SELECT id, game_type, sport, season_year, week, settled, settled_at, perfect, board
      FROM contests WHERE id = ${Number(contestId)} AND game_type = 'weekly'`;
  if (!contest || !contest.settled) return null;

  const [entry] = userId == null ? [] : await sql`
    SELECT id, user_id, score, base_score, lineup, meta FROM contest_entries
     WHERE contest_id = ${Number(contestId)} AND user_id = ${Number(userId)}`;

  const view = settledView({ contest, entry: entry ?? null, board: contest.board });
  const rows = view.you ? pairRows(view.you.picks.map((p) => ({ ...p, label: p.slot })), view.perfectPicks) : [];

  // THE FIELD, AND ITS DNFs. A DNF entry has a score of null or meta.dnf, so it
  // is absent from `scored` by construction - counted here so the distribution
  // can give it its own leftmost bar, which is the one place on this screen a
  // DNF is a fact rather than a gap.
  const all = await sql`
    SELECT score, meta FROM contest_entries WHERE contest_id = ${Number(contestId)}`;
  // scoresOf, NOT map(Number): Number(null) is 0 and 0 is finite - see shape.js.
  const scores = scoresOf(all);
  const dnf = all.filter((r) => r.score == null || r.meta?.dnf === true).length;
  const lb = await scoreLeaderboard(Number(contestId), userId == null ? null : Number(userId), { limit: 3, game: 'weekly' });

  const dist = distribution(scores, { mine: view.you?.score ?? null, ceiling: view.perfect, dnf });
  const num = (n) => String(Math.round(Number(n) * 10) / 10);

  return {
    game: 'weekly',
    title: 'The Weekly',
    subtitle: `${String(contest.sport).toUpperCase()} week ${contest.week}`,
    edition: contest.settled_at
      ? `Settled ${new Date(contest.settled_at).toISOString().slice(0, 10)}`
      : 'Settled',
    ceilingWord: 'optimal',
    header: header({
      rank: lb.self?.rank ?? lb.top.find((r) => r.userId === Number(userId))?.rank ?? null,
      of: lb.played, score: view.you?.score ?? null, ceiling: view.perfect,
      pct: view.you?.pct ?? null,
    }),
    mine: rows.map((r) => slotRow(r.you, { hit: r.verdict === 'hit', dropped: r.you?.dropped === true })),
    ceiling: rows.map((r) => slotRow(r.best, { hit: r.verdict === 'hit' })),
    matched: rows.filter((r) => r.verdict === 'hit').length,
    slotCount: rows.length,
    toCeiling: view.you && view.perfect
      ? Math.round((view.perfect - view.you.score) * 10) / 10 : null,
    lostIt: lostIt(rows),
    dnf: view.dnf === true,
    field: {
      distribution: dist,
      axis: axisFor(dist, { mine: view.you?.score ?? null, label: num }),
      median: dist.median,
      played: lb.played,
      dnf,
      rows: [...lb.top, ...(lb.self ? [lb.self] : [])].map((r) => ({
        rank: r.rank, name: r.name, house: r.house === true,
        you: userId != null && r.userId === Number(userId),
        score: Math.round(Number(r.score) * 10) / 10,
        pct: view.perfect ? Math.round((Number(r.score) / view.perfect) * 1000) / 10 : null,
        sub: r.method ?? null,
        userId: r.userId,
      })),
    },
  };
}
