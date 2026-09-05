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
import { getDailyHome, getYesterday, todayEntrantCount } from '../daily/entries.js';
import { overall } from '../daily/boards.js';
import { editionLabel, editionNo } from '../daily/homeModule.js';
import { displayName } from '../daily/handles.js';
import { cardState, seasonStrip, boardSection, GAME_ORDER } from './lobby.js';
import { currentContest } from '../weekly/entries.js';
import { weeklyBoardTable } from '../weekly/live.js';
import { youCell, yourStats } from './personal.js';

// MINIMUM BOARDS TO RANK ON THE PICK'EM SEASON TABLE. A user with one lucky
// board and nobody else's sample size would sit at 100% forever - the same
// small-sample problem every "season leaderboard" has. Below this, a row
// still shows (so nobody vanishes for playing), just with a dash instead of
// a rank and a note naming how many boards stand between them and one.
export const PICKEM_TABLE_MIN_BOARDS = 3;
import { pickemCardData } from '../pickem/entry.js';
import { lockLabel } from '../pickem/read.js';

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

/**
 * The Pick'em season table: correct picks and games played across every
 * SETTLED pickem contest, per user. Shape matches weeklyBoardTable's
 * ({top, self, through}) so BoardsPane renders it the same way.
 *
 * A GAME WITH NO RESULT (perfect.results[matchId] === null - a tie, "impossible
 * in CFB, defended anyway" per lib/pickem/settle.js, or a cancelled game a
 * human resolved by nulling its entry) counts toward NEITHER a user's correct
 * picks NOR their games played - it is off the board entirely for this table,
 * not a miss. Everyone else's pick on that same game is unaffected.
 *
 * MINIMUM PICKEM_TABLE_MIN_BOARDS DISTINCT SETTLED BOARDS TO RANK. A user
 * below it still gets a row (ordered the same way as everyone else, by
 * correct % desc then correct desc) - just a dash instead of a number and a
 * note naming how many boards stand between them and a rank, so a new player
 * is never simply erased from a table they are genuinely on.
 */
export async function pickemTable(uid = null, { limit = 10 } = {}) {
  const contests = await sql`
    SELECT id, perfect FROM contests WHERE game_type = 'pickem' AND settled`;
  if (!contests.length) return null;

  const contestIds = contests.map((c) => c.id);
  const entries = await sql`
    SELECT e.contest_id, e.user_id, e.lineup, u.handle
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ANY(${contestIds})`;

  const resultsByContest = new Map(contests.map((c) => [c.id, c.perfect?.results ?? {}]));
  const byUser = new Map(); // userId -> { handle, correct, played, boardsPlayed }
  for (const e of entries) {
    const results = resultsByContest.get(e.contest_id) ?? {};
    let correct = 0; let played = 0;
    for (const [matchId, side] of Object.entries(e.lineup ?? {})) {
      const result = results[matchId];
      if (result == null) continue; // push/cancelled - off the numerator AND denominator
      played += 1;
      if (side === result) correct += 1;
    }
    if (!played) continue; // an entry that touched no resolved game contributes nothing
    if (!byUser.has(e.user_id)) byUser.set(e.user_id, { handle: e.handle, correct: 0, played: 0, boardsPlayed: 0 });
    const u = byUser.get(e.user_id);
    u.correct += correct; u.played += played; u.boardsPlayed += 1;
  }
  if (!byUser.size) return null;

  const rows = [...byUser.entries()]
    .map(([userId, u]) => ({
      userId, name: displayName({ id: userId, handle: u.handle }),
      correct: u.correct, played: u.played, boardsPlayed: u.boardsPlayed,
      pct: u.played ? Math.round((u.correct / u.played) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.pct - a.pct || b.correct - a.correct || a.userId - b.userId);

  let rank = 0;
  const ranked = rows.map((r) => {
    const eligible = r.boardsPlayed >= PICKEM_TABLE_MIN_BOARDS;
    if (eligible) rank += 1;
    return {
      ...r,
      rank: eligible ? rank : null,
      note: eligible ? null : `${r.boardsPlayed} of ${PICKEM_TABLE_MIN_BOARDS} boards`,
    };
  });

  const top = ranked.slice(0, limit);
  const mine = uid == null ? null : ranked.find((r) => r.userId === uid) ?? null;
  return {
    top,
    self: mine && !top.some((r) => r.userId === mine.userId) ? mine : null,
    through: `${contests.length} board${contests.length === 1 ? '' : 's'} settled`,
  };
}

/** The pickem table's populates label - computed from the minimum, never a
 * typed date. Used until enough boards exist for pickemTable() to return
 * rows at all. */
export function pickemTablePopulatesLabel() {
  return `Populates after ${PICKEM_TABLE_MIN_BOARDS} boards`;
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });

/** The Draft season table's populates label - derived from the next/current
 * draft contest's own settles_at, never a typed date. Null contest -> a
 * label with no date rather than a guess. */
export async function draftTablePopulatesLabel() {
  const [c] = await sql`
    SELECT week, settles_at FROM contests WHERE game_type = 'draft'
     ORDER BY opens_at ASC LIMIT 1`;
  if (!c) return 'First settle after Week 1';
  return `First settle with Week ${c.week} · ${MONTH_DAY.format(new Date(c.settles_at))}`;
}

export async function gamesLobby(userId = null, { now = new Date() } = {}) {
  const uid = userId == null ? null : Number(userId);
  const [live, dailyHome, yesterday, table, streak, me, pickem, playingToday] = await Promise.all([
    liveContests({ now }),
    getDailyHome(uid).catch(() => null),
    getYesterday(uid).catch(() => null),
    overall(uid, 10).catch(() => null),
    dailyStreak(uid).catch(() => 0),
    uid == null ? null
      : sql`SELECT handle FROM users WHERE id = ${uid}`.then((r) => r[0] ?? null).catch(() => null),
    // Caught to null like every lobby read: no board (or a failed read)
    // ghosts the card, the safe direction.
    pickemCardData(uid, { now }).catch(() => null),
    todayEntrantCount().catch(() => 0),
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
        // THE NUMBER IS THE STATE. How many people have played today - a fact
        // about the edition, true for everybody, so it rides for signed-out
        // readers too.
        count: dailyHome
          ? { value: String(playingToday ?? 0), unit: 'played today' }
          : null,
      });
    }
    if (key === 'pickem') {
      // Live once board 1 exists: entered / picked count / next kickoff -
      // the viewer's own state only, per the card law.
      return cardState({
        key,
        contest: pickem ? {
          closesLabel: pickem.nextKickoff
            ? `locks per game · next ${lockLabel(pickem.nextKickoff)}`
            : 'all games kicked · grading in',
        } : null,
        mine: (uid != null && pickem) ? { entered: pickem.entered } : null,
        // MY picks over the board's size. Viewer-scoped, so a stranger gets the
        // board size alone rather than somebody else's progress.
        count: pickem
          ? (uid != null
            ? { value: `${pickem.picked}/${pickem.total}`, unit: 'picked' }
            : { value: String(pickem.total), unit: 'games' })
          : null,
        // Honest, and it is the ONLY hardcoded date on the page: a label,
        // not a gate. The card flips on the contest existing, never on the
        // clock.
        opensLabel: 'Opens Aug 25',
      });
    }
    const c = live.get(key) ?? null;
    return cardState({
      key,
      // The lock label derives from the contest's snapshotted locks_at, the
      // Pick'em card's grammar - never hardcoded (rehearsal F5: the live
      // Weekly card said nothing about when the board locks).
      contest: c ? {
        closesLabel: new Date(c.locks_at) > now
          ? `locks ${lockLabel(c.locks_at)}`
          : 'locked · live',
      } : null,
      mine: null,
      opensLabel: 'Opens Sep 8',
      // THE WEEKLY AND THE DRAFT. The Weekly's lineup is six slots; the Draft's
      // number is the room. Both come from the contest row this card was built
      // from, so a ghosted game - no contest - carries no number, which is the
      // honest reading of "nothing has opened yet".
      count: c
        ? (key === 'weekly'
          ? { value: '6', unit: 'slots' }
          : { value: 'Room open', unit: null })
        : null,
    });
  });
  // Pick 'em's CTA copy, from data - n/8 once the viewer holds picks.
  const pickemCard = cards[1];
  if (pickem && pickemCard.state !== 'ghost') {
    pickemCard.cta = (uid != null && pickem.picked > 0)
      ? `${pickem.picked}/${pickem.total} PICKED`
      : 'MAKE YOUR PICKS';
  }

  // PULSE DATA - live numbers through the readers above, never page SQL.
  // The page owns the sentence; this owns the facts.
  cards[0].pulse = { playing: playingToday, perfect: yesterday?.perfect ?? null };
  pickemCard.pulse = (pickem && pickemCard.state !== 'ghost')
    ? { games: pickem.total, next: pickem.nextKickoff ? lockLabel(pickem.nextKickoff) : null, boardNumber: pickem.boardNumber }
    : null;

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
  const [weeklyTable, pickemSeasonTable, draftPopulatesLabel] = await Promise.all([
    currentContest().then((c) => weeklyBoardTable(c, uid, { now })).catch(() => null),
    pickemTable(uid).catch(() => null),
    draftTablePopulatesLabel().catch(() => 'First settle with Week 1'),
  ]);
  const boards = [
    boardSection({ key: 'overall', name: 'Overall', table, populatesLabel: 'Populates at the first close' }),
    boardSection({ key: 'pickem', name: 'Pick ’em — season', table: pickemSeasonTable, populatesLabel: pickemTablePopulatesLabel() }),
    boardSection({ key: 'weekly', name: 'The Weekly — season', table: weeklyTable, populatesLabel: 'Opens with NFL Week 1 · Sep 15' }),
    boardSection({ key: 'draft', name: 'The Draft — season', populatesLabel: draftPopulatesLabel }),
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
