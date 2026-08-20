// lib/games/read.js - everything /games needs, in one place.
//
// THE STANDINGS LAW APPLIES TO EVERY NUMBER ON THIS PAGE, and this file is
// where that is enforced. /games aggregates four games at once, which makes it
// the likeliest place for an open-day result to leak. Every figure here comes
// from a REVEALED day or a SETTLED contest, with one exception: the viewer's
// own state in the game they are playing, which is theirs to know.
//
// CARD STATE IS DATA, NOT A DEPLOY. Pick 'em is ghosted because no pickem
// contest exists, not because a date says so. When one is created the card
// goes live on the next request. That is what lets Aug 25 and Sep 8 happen
// without a release.

import { sql } from '../db.js';
import { getDailyHome, getYesterday } from '../daily/entries.js';
import { overall } from '../daily/boards.js';
import { editionLabel, editionNo } from '../daily/homeModule.js';
import { displayName } from '../daily/handles.js';
import { cardState, seasonStrip, boardSection, GAME_ORDER } from './lobby.js';
import { currentContest } from '../weekly/entries.js';
import { weeklyBoardTable } from '../weekly/live.js';
import { youCell, yourStats } from './personal.js';

/** Does a game have a live contest right now? One query for all of them. */
async function liveContests({ now = new Date() } = {}) {
  // CAUGHT, and the failure direction is the point. A contest read that fails -
  // including before migration 067 has reached an environment - reads as "no
  // game is live", which ghosts the cards. That is the same safe direction the
  // header's membership read takes, and it happens to be exactly the correct
  // pre-launch rendering. It must never take the lobby down.
  const rows = await (async () => sql`
    SELECT game_type, id, season_year, week, locks_at, settled
      FROM contests
     WHERE opens_at <= ${now.toISOString()} AND NOT settled
     ORDER BY opens_at DESC`)().catch(() => []);
  const by = new Map();
  for (const r of rows) if (!by.has(r.game_type)) by.set(r.game_type, r);
  return by;
}

/**
 * The Daily's streak: consecutive REVEALED days ending at the most recent one
 * in which the reader locked an entry. Revealed-only, so today can never
 * extend or break it on the page - it moves at midnight with everything else.
 */
async function dailyStreak(userId) {
  if (userId == null) return 0;
  const rows = await sql`
    SELECT to_char(d.puzzle_date, 'YYYY-MM-DD') AS d,
           (e.id IS NOT NULL AND e.locked_at IS NOT NULL) AS played
      FROM puzzle_days d
      LEFT JOIN puzzle_entries e ON e.puzzle_date = d.puzzle_date AND e.user_id = ${userId}
     WHERE d.revealed ORDER BY d.puzzle_date DESC`;
  let n = 0;
  for (const r of rows) { if (!r.played) break; n += 1; }
  return n;
}

export async function gamesLobby(userId = null, { now = new Date() } = {}) {
  const uid = userId == null ? null : Number(userId);
  const [live, dailyHome, yesterday, table, streak, me] = await Promise.all([
    liveContests({ now }),
    getDailyHome(uid).catch(() => null),
    getYesterday(uid).catch(() => null),
    overall(uid, 10).catch(() => null),
    dailyStreak(uid).catch(() => 0),
    uid == null ? null
      : sql`SELECT handle FROM users WHERE id = ${uid}`.then((r) => r[0] ?? null).catch(() => null),
  ]);

  // ---- the 2x2 grid -------------------------------------------------------
  const cards = GAME_ORDER.map((key) => {
    if (key === 'daily') {
      return cardState({
        key,
        contest: dailyHome ? { closesLabel: 'closes midnight ET' } : null,
        // NO PER-USER BLOCK FOR A STRANGER. A signed-out reader was getting a
        // `you` object full of nulls - not a leak, but it is a per-user shape
        // on a payload that has no user, and the leak test is right to refuse
        // it rather than learn to tolerate one.
        mine: (uid != null && dailyHome)
          ? { entered: dailyHome.state === 'receipt', score: dailyHome.score ?? null, streak }
          : null,
        opensLabel: 'Opens at midnight ET',
      });
    }
    const c = live.get(key) ?? null;
    return cardState({
      key,
      contest: c ? { closesLabel: null } : null,
      mine: null,
      // Honest, and it is the ONLY hardcoded date on the page: a label, not a
      // gate. The card flips on the contest existing, never on the clock.
      opensLabel: key === 'pickem' ? 'Opens Aug 25' : 'Opens Sep 8',
    });
  });
  // The Daily's own edition and CTA copy, from data.
  const dailyCard = cards[0];
  if (dailyHome) {
    dailyCard.cta = dailyHome.state === 'receipt' ? 'YOUR ENTRY' : `PLAY ED. ${dailyHome.edition}`;
    dailyCard.foot = streak > 0
      ? `streak ${streak} · closes midnight ET`
      : 'closes midnight ET';
  }

  // ---- leaderboards -------------------------------------------------------
  // The Weekly's table exists from LOCK onward (live totals, then the settle's
  // final) - pre-lock it stays null and the section keeps its populates label,
  // because a pre-lock board is just the entry list wearing zeros. Caught to
  // null like every lobby read: a contest table must never cost the lobby.
  const weeklyTable = await currentContest()
    .then((c) => weeklyBoardTable(c, uid, { now }))
    .catch(() => null);
  const boards = [
    boardSection({ key: 'overall', name: 'Overall', table, populatesLabel: 'Populates at the first close' }),
    boardSection({ key: 'pickem', name: 'Pick ’em — season', populatesLabel: 'Populates at first settle · Aug 29' }),
    boardSection({ key: 'weekly', name: 'The Weekly — season', table: weeklyTable, populatesLabel: 'Opens with NFL Week 1 · Sep 15' }),
    boardSection({ key: 'draft', name: 'The Draft — season', populatesLabel: 'First settle with Week 1 · Sep 15' }),
  ];

  // ---- history: every REVEALED edition, newest first, plus sealed days ----
  const days = await sql`
    SELECT to_char(puzzle_date, 'YYYY-MM-DD') AS d, season_year, week, revealed,
           perfect->>'total' AS perfect
      FROM puzzle_days ORDER BY puzzle_date DESC`;
  const tops = await sql`
    SELECT to_char(e.puzzle_date, 'YYYY-MM-DD') AS d, e.score, u.handle, u.id
      FROM puzzle_entries e
      JOIN puzzle_days pd ON pd.puzzle_date = e.puzzle_date AND pd.revealed
      JOIN users u ON u.id = e.user_id
     WHERE e.locked_at IS NOT NULL AND e.score IS NOT NULL
     ORDER BY e.puzzle_date DESC, e.score DESC`;
  const topBy = new Map();
  for (const t of tops) if (!topBy.has(t.d)) topBy.set(t.d, t);

  // THE READER'S OWN ENTRIES, AND THE `pd.revealed` JOIN IS THE WHOLE POINT.
  // Without it this picks up today's locked entry, and the reader's own open
  // day would then reach the YOU column, the average, the best score and the
  // streak - four numbers that would disagree with the leaderboard one pane
  // over. See lib/games/personal.js.
  const mineRows = uid == null ? [] : await sql`
    SELECT to_char(e.puzzle_date, 'YYYY-MM-DD') AS d,
           e.score, e.locked_at, e.guess_season, e.guess_week, e.bonus_pct
      FROM puzzle_entries e
      JOIN puzzle_days pd ON pd.puzzle_date = e.puzzle_date AND pd.revealed
     WHERE e.user_id = ${uid}`;
  const mineBy = new Map(mineRows.map((r) => [r.d, r]));

  const history = days.map((r) => {
    // A day older than the edition epoch has no edition number, and printing
    // "No. null" is worse than printing the date. DEV carries such a day - the
    // 15 Aug playtest board - so this is not hypothetical.
    const edition = editionLabel(editionNo(r.d));
    if (!r.revealed) {
      // A sealed row says a day EXISTS and is not readable yet. It carries no
      // season, no week and no score - the whole point.
      return { date: r.d, edition, label: edition ? `Ed. ${edition}` : r.d, sealed: true };
    }
    const t = topBy.get(r.d);
    const perfect = r.perfect ? Number(r.perfect) : null;
    // `you` is UNDEFINED for a signed-out reader, so it is absent from the
    // serialized payload and the column cannot render at all.
    const you = youCell({ signedIn: uid != null, entry: mineBy.get(r.d) ?? null, perfect });
    return {
      date: r.d, edition, label: edition ? `Ed. ${edition}` : r.d, sealed: false,
      season: r.season_year, week: r.week,
      perfect,
      href: `/daily/${r.d}`,
      top: t ? { name: displayName({ id: t.id, handle: t.handle }), score: Number(t.score) } : null,
      ...(you === undefined ? {} : { you }),
    };
  });

  // The stats module reads the SAME revealed days and the SAME entry map the
  // history rows do - one read, so the module and the rows above it can never
  // disagree about what the reader did.
  const stats = yourStats({
    signedIn: uid != null,
    days: days.filter((r) => r.revealed).map((r) => ({
      date: r.d, season_year: r.season_year, week: r.week,
      perfect: r.perfect ? Number(r.perfect) : null,
      entry: mineBy.get(r.d) ?? null,
    })),
  });

  const mine = table?.self ?? table?.top?.find((x) => x.userId === uid) ?? null;
  return {
    signedIn: uid != null,
    cards,
    boards,
    yesterday,
    history,
    season: uid == null ? null : seasonStrip({
      handle: me?.handle ? `@${me.handle}` : (uid ? displayName({ id: uid, handle: null }) : null),
      standing: mine ? { ...mine, streak } : null,
      pickem: null,
    }),
    streak,
    stats,
    seasonKey: table?.seasonKey ?? null,
  };
}
