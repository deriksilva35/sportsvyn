// lib/games/lobbyV3.js - the Games tab v3 reader.
//
// ONE CALL, EVERY CHIP, AND NOTHING THE SITE DOES NOT ALREADY COMPUTE. It
// composes readers that exist - lobbyV2's own fifteen, plus three small reads
// the v3 rows need and nothing else did - and hands the result to two pure
// shapers (nowCard.js, v3Rows.js). Every read is caught to null the way
// gamesLobby()'s are: a failed read ghosts its own row, never the page.
//
// THE THREE NEW READS, and why each is new rather than lifted:
//   the Weekly's six names   liveEntryRows needs the week's scored board, which
//                            the lobby never fetched - the card only ever
//                            showed a total.
//   the Pick'em record       there is no live grader anywhere in the app; this
//                            builds one from FINAL games only (v3Rows.js).
//   the Daily's last seven   the History pane had it per edition; the Results
//                            chip wants it per DAY with elapsed, which
//                            migration 097's two stamps make derivable.

import { sql } from '../db.js';
import { HOUSE_TZ } from '../gridiron/kickoff.js';
import { lobbyV2 } from './lobbyV2.js';
import { nowCard } from './nowCard.js';
import { weeklyRowV3, pickemRecord, pickemRowV3, dailyRowV3, draftRowV3, elapsedOf } from './v3Rows.js';
import { pctOfCeiling } from '../daily/format.js';
import { currentContest, getEntry } from '../weekly/entries.js';
import { liveScoredBoard, liveEntryRows, weeklyBoardTable } from '../weekly/live.js';
import { todayLeaderboard } from '../daily/seasonBoardLeaderboards.js';
import { displayName } from '../daily/handles.js';
import { houseMark } from '../house/mark.js';
import { DRAFT_ROUNDS, DRAFT_CONFIG } from '../draft/contest.js';
import { myLeagues } from '../leagues/core.js';
import { draftState } from '../draft/entry.js';
import { bestBall } from '../draft/bestball.js';
import { scoreLineup } from '../daily/play.js';
import { pickemTable, gameSeasonTable, pickemTablePopulatesLabel, draftTablePopulatesLabel, SEASON_TABLE_MIN_WEEKS } from './read.js';
import { boardSection } from './lobby.js';
import { overall } from '../daily/boards.js';

const nul = (p) => (p && typeof p.catch === 'function' ? p.catch(() => null) : p);

/** The reader's six, with names and points, or []. One read, only when needed. */
async function weeklySix(uid) {
  if (uid == null) return [];
  const contest = await currentContest();
  if (!contest) return [];
  const entry = await getEntry(contest.id, Number(uid));
  if (!entry) return [];
  const { scored, playedIds } = await liveScoredBoard(contest);
  return liveEntryRows({ lineup: entry.lineup ?? {}, scored, playedIds }).rows;
}

/**
 * The reader's record on one sport's open board, from FINAL games only.
 *
 * ONE QUERY, NOT pickemBoardView. That reader also fetches AP ranks, spreads,
 * team colours and networks for a board page; the lobby needs a status and a
 * winner.
 */
async function pickemFinals(uid, sport) {
  if (uid == null) return null;
  const [c] = await sql`
    SELECT id, board FROM contests
     WHERE game_type = 'pickem' AND sport = ${sport} AND NOT settled AND opens_at <= now()
     ORDER BY week DESC LIMIT 1`;
  if (!c) return null;
  const [e] = await sql`SELECT lineup FROM contest_entries WHERE contest_id = ${c.id} AND user_id = ${Number(uid)}`;
  const ids = (c.board ?? []).map((g) => g.match_id).filter(Boolean);
  if (!ids.length) return null;
  const rows = await sql`
    SELECT m.id, m.status, m.home_score, m.away_score
      FROM matches m WHERE m.id = ANY(${ids})`;
  const games = rows.map((m) => ({
    id: m.id,
    status: m.status,
    // A PUSH IS A NULL WINNER, not a loss - the same rule pickemTable applies
    // at settle. A final with equal scores resolves to nobody.
    winner: m.status !== 'final' || m.home_score === m.away_score ? null
      : (Number(m.home_score) > Number(m.away_score) ? 'home' : 'away'),
  }));
  return { record: pickemRecord({ picks: e?.lineup ?? {}, games }) };
}

/**
 * Yesterday's PERCENTAGE, and its matched count - not its score.
 *
 * v2's Daily card carries `Yesterday` as the raw score (fmt1 of mine.primary),
 * which is the right number for a stat block headed "Yesterday" and the WRONG
 * one for a line that says "yesterday 99.7%". Reading the card's stat and
 * appending a % sign would have put 2363.1% on the screen - caught on the
 * first run against PROD.
 *
 * THE ONE FORMATTER, off the stored ratio where there is one: daily_board_runs
 * .pct already holds score/ceiling, so the ceiling here is 1 and pctOfCeiling
 * does the rounding exactly once (lib/daily/format.js).
 */
async function dailyYesterday(uid) {
  if (uid == null) return { pct: null, matched: null };
  const [row] = await sql`
    SELECT r.pct, r.picks, b.slots
      FROM daily_boards b
      LEFT JOIN daily_board_runs r ON r.board_id = b.id AND r.user_id = ${Number(uid)}
     WHERE now() >= b.closes_at
     ORDER BY b.edition_date DESC LIMIT 1`;
  if (!row || row.pct == null) return { pct: null, matched: null };
  return { pct: pctOfCeiling(row.pct, 1), matched: null, slots: Array.isArray(row.slots) ? row.slots.length : 8 };
}

/** The reader's last seven played Daily editions, with elapsed. */
async function dailyWeek(uid) {
  if (uid == null) return [];
  // to_char, NOT String(date).slice(0, 10). edition_date is a DATE and the
  // driver hands back a JS Date, whose String() is 'Thu Sep 17 2026 ...' -
  // slicing ten characters off that gives 'Thu Sep 17', which then parses as
  // Invalid Date and printed a weekday column of them on the first PROD run.
  // historyV2() already learned this; the formatting belongs in the query.
  const rows = await sql`
    SELECT to_char(b.edition_date, 'YYYY-MM-DD') AS ymd,
           to_char(b.edition_date, 'Dy') AS dow,
           -- THE BOARD ID, so the Daily's row can link to /results/daily/<id>.
           -- The seven days are already a list of editions; the id is the only
           -- thing missing to make each of them openable.
           b.id AS board_id,
           b.season_year, r.score, r.pct, r.started_at, r.completed_at, r.picks
      FROM daily_board_runs r JOIN daily_boards b ON b.id = r.board_id
     WHERE r.user_id = ${Number(uid)} AND r.completed_at IS NOT NULL
     ORDER BY b.edition_date DESC LIMIT 7`;
  return rows.map((r) => ({
    date: r.ymd,
    day: r.dow,
    boardId: r.board_id ?? null,
    href: r.board_id == null ? null : `/results/daily/${r.board_id}`,
    season: r.season_year ?? null,
    pct: pctOfCeiling(r.pct, 1),
    pctNum: r.pct == null ? null : Number(r.pct),
    elapsed: elapsedOf({ startedAt: r.started_at, completedAt: r.completed_at }),
    matched: null,   // regraded on the Results screen only - see the note below
    you: true,
  }));
}

// ===========================================================================
// THE BOARDS CHIP
// ===========================================================================
// FOUR TABS, ONE READ. The tabs are cheap (a key and a label); the rows are
// not - weeklyBoardTable scores every entry in the contest against the week's
// stat lines. So only the SELECTED board is fetched, which is the whole reason
// the tab is a URL param rather than a client toggle.
//
// AND THREE OF THE FOUR ARE EMPTY ON MOST DAYS, WHICH IS THE POINT OF
// addendum 3: a Thursday Weekly board has entries and no scores, Pick'em has
// no board at all until its contest settles, and a Draft room posts when the
// week does. Each states that in its own words instead of drawing a table of
// dashes.
const V3_BOARD_TABS = [
  { key: 'weekly', label: 'WEEKLY' },
  { key: 'pickem', label: "PICK'EM" },
  { key: 'draft', label: 'DRAFT' },
  { key: 'daily', label: 'DAILY' },
  // THE FIFTH TAB IS NOT IN THE MOCK, AND IT IS HERE BECAUSE THE MOCK'S OWN
  // FOOT LINE IS NOT TRUE YET. "Season standings on Rankings · week boards
  // here" describes a Rankings page that carries a FOUR-ROW PREVIEW of the
  // Pick'em season table and links back to /games for the rest (lib/rankings/
  // view.js), and carries the Weekly, Draft and Daily season tables not at
  // all. v2's leaderboards pane was their only home. Deleting that pane
  // without this tab would have orphaned four season boards and left the
  // Rankings preview pointing at a page that no longer had the table.
  //
  // THE HONEST FIX IS TO MOVE THEM TO RANKINGS, in the Rankings relay, and
  // then this tab goes and the foot line becomes true. Until that happens the
  // standings stay reachable.
  { key: 'season', label: 'SEASON' },
];

const fmt1 = (n) => (n == null ? null : (Math.round(Number(n) * 10) / 10).toFixed(1));

/** The current weekly contest's board: live once locked, final once settled. */
async function weeklyBoardV3(uid, now) {
  const contest = await currentContest();
  if (!contest) return { rows: [], empty: 'No weekly board this week' };
  const table = await weeklyBoardTable(contest, uid, { limit: 5, now });
  if (!table) {
    return { rows: [], empty: `Entries are sealed until Week ${contest.week} locks` };
  }
  const rows = [...table.top, table.self].filter(Boolean).map((r) => ({
    rank: r.rank, userId: r.userId, name: r.name, value: fmt1(r.points), you: r.userId === uid,
    house: r.house, persona: r.persona, personaName: r.personaName, method: r.method,
  }));
  const [c] = await sql`SELECT count(*)::int AS n FROM contest_entries WHERE contest_id = ${contest.id}`;
  // THE CEILING LINE ONLY WHEN IT IS WRITTEN (addendum 3). contests.perfect is
  // stamped at settle and is null every hour before it; "perfect six -" would
  // be a number the site has not computed.
  const ceiling = contest.settled && contest.perfect?.score != null
    ? ` · perfect six ${fmt1(contest.perfect.score)}` : '';
  return { rows, footer: `${c?.n ?? rows.length} played${ceiling}`, note: table.through };
}

/**
 * The last SETTLED pick'em board, both sports, by wins.
 *
 * SETTLED ONLY, and not because a live one would be hard: there is no live
 * grader anywhere in the app, so a board mid-weekend has no scores to rank.
 */
async function pickemBoardV3(uid) {
  const [c] = await sql`
    SELECT id, week, sport, perfect FROM contests
     WHERE game_type = 'pickem' AND settled ORDER BY settled_at DESC LIMIT 1`;
  if (!c) return { rows: [], empty: "No pick'em board has settled yet" };
  const entries = await sql`
    SELECT e.user_id, e.score, u.handle, u.is_house
      FROM contest_entries e JOIN users u ON u.id = e.user_id
     WHERE e.contest_id = ${c.id} AND e.score IS NOT NULL
     ORDER BY e.score DESC, e.user_id ASC`;
  if (!entries.length) return { rows: [], empty: `Week ${c.week} settled with no entries` };
  const all = entries.map((e, i) => ({
    rank: i + 1, userId: e.user_id, name: displayName({ id: e.user_id, handle: e.handle }),
    value: String(Number(e.score)), you: e.user_id === uid,
    ...houseMark({ isHouse: e.is_house === true, handle: e.handle }, 'pickem'),
  }));
  const mine = uid == null ? null : all.find((r) => r.userId === uid) ?? null;
  const top = all.slice(0, 5);
  const rows = [...top, mine && !top.some((r) => r.userId === mine.userId) ? mine : null].filter(Boolean);
  const max = c.perfect?.max ?? null;
  return {
    rows,
    footer: `${all.length} played${max != null ? ` · ${max} games` : ''}`,
    note: `${String(c.sport).toUpperCase()} week ${c.week} · final`,
  };
}

/**
 * The reader's own 12-seat room for the last settled Draft week, plus where
 * that room finished in the field.
 *
 * THE ROOM IS ALREADY ON THE ENTRY. weekly/settle.js stores roomStandings()'s
 * {rank, of, seats} into contest_entries.meta at settle (it has the scored
 * board in hand there); re-deriving it here would re-score twelve rosters to
 * land on the same twelve numbers. THE FIELD RANK is the only new fact, and it
 * is one window function over the same contest.
 */
async function draftBoardV3(uid) {
  if (uid == null) return { rows: [], empty: 'Sign in to see your room' };
  const [c] = await sql`
    SELECT id, week FROM contests
     WHERE game_type = 'draft' AND settled ORDER BY settled_at DESC LIMIT 1`;
  if (!c) return { rows: [], empty: 'No draft week has settled yet' };
  const ranked = await sql`
    SELECT user_id, meta,
           dense_rank() OVER (ORDER BY score DESC) AS field_rank,
           count(*) OVER () AS field_of
      FROM contest_entries WHERE contest_id = ${c.id} AND score IS NOT NULL`;
  const me = ranked.find((r) => r.user_id === Number(uid)) ?? null;
  if (!me) return { rows: [], empty: `You did not play Week ${c.week}` };
  const seats = me.meta?.room?.seats ?? [];
  if (!seats.length) return { rows: [], empty: `Week ${c.week} stored no room standings` };
  const rows = seats.map((s, i) => ({
    rank: i + 1, userId: `seat-${s.seat}`, name: `Seat ${s.seat}`,
    value: fmt1(s.score), you: s.user === true,
  }));
  return {
    rows,
    footer: `${me.field_rank} of ${me.field_of} in the field`,
    note: `Week ${c.week} · your room · final`,
  };
}

/** The last CLOSED Daily edition, by score. */
async function dailyBoardV3(uid) {
  const [board] = await sql`
    SELECT id, to_char(edition_date, 'YYYY-MM-DD') AS ymd FROM daily_boards
     WHERE now() >= closes_at ORDER BY edition_date DESC LIMIT 1`;
  if (!board) return { rows: [], empty: 'No edition has closed yet' };
  const all = await todayLeaderboard(sql, board.id);
  if (!all.length) return { rows: [], empty: 'Nobody played that edition' };
  const mine = uid == null ? null : all.find((r) => r.userId === uid) ?? null;
  const top = all.slice(0, 5);
  const pick = [...top, mine && !top.some((r) => r.userId === mine.userId) ? mine : null].filter(Boolean);
  return {
    rows: pick.map((r) => ({
      rank: r.rank, userId: r.userId, name: r.handle, value: fmt1(r.primary),
      you: r.userId === uid, ...houseMark({ isHouse: r.isHouse === true, handle: r.rawHandle }, 'daily'),
    })),
    footer: `${all.length} played`,
    note: board.ymd,
  };
}

/**
 * The four SEASON tables, in v2's own shapes, for the SeasonBoard component.
 *
 * SAME READERS, SAME SECTIONS, no second opinion about what a season board
 * is: pickemTable, gameSeasonTable x2 and the Daily's overall(), wrapped by
 * the same boardSection() gate that decides live-vs-pending. The only thing
 * that moved is which screen renders them.
 */
async function seasonBoards(uid) {
  const [daily, pickem, weekly, draft, draftLabel] = await Promise.all([
    overall(uid, 10).catch(() => null),
    pickemTable(uid, { sport: null }).catch(() => null),
    gameSeasonTable('weekly', uid).catch(() => null),
    gameSeasonTable('draft', uid).catch(() => null),
    draftTablePopulatesLabel().catch(() => 'First settle with Week 1'),
  ]);
  return [
    boardSection({ key: 'overall', name: 'The Daily — season', table: daily, populatesLabel: 'Populates at the first close' }),
    boardSection({ key: 'pickem', name: "Pick'em — season", table: pickem, populatesLabel: pickemTablePopulatesLabel() }),
    boardSection({ key: 'weekly', name: 'The Weekly — season', table: weekly, populatesLabel: `Populates after ${SEASON_TABLE_MIN_WEEKS} weeks` }),
    boardSection({ key: 'draft', name: 'The Draft — season', table: draft, populatesLabel: draftLabel }),
  ];
}

async function boardsPane(uid, now, want) {
  const key = V3_BOARD_TABS.some((t) => t.key === want) ? want : 'weekly';
  if (key === 'season') {
    const sections = await seasonBoards(uid).catch(() => []);
    return {
      boardKey: key,
      boards: V3_BOARD_TABS.map((t) => ({ ...t, rows: [] })),
      sections,
    };
  }
  const one = await (key === 'weekly' ? weeklyBoardV3(uid, now)
    : key === 'pickem' ? pickemBoardV3(uid)
      : key === 'draft' ? draftBoardV3(uid)
        : dailyBoardV3(uid)).catch(() => ({ rows: [], empty: 'That board is having a moment' }));
  return {
    boardKey: key,
    boards: V3_BOARD_TABS.map((t) => (t.key === key ? { ...t, ...one } : { ...t, rows: [] })),
    sections: null,
  };
}

// ===========================================================================
// THE RESULTS CHIP - the graded week, under the Daily's seven days
// ===========================================================================
const GRADED_MARK = { weekly: 'W', pickem: 'P', draft: 'R' };
const GRADED_NAME = { weekly: 'The Weekly', pickem: "Pick'em", draft: 'The Draft' };
// THE RESULTS ROUTE, PER CONTEST. These used to point at the PLAY pages -
// /weekly, /draft, /pickem/nfl - which render their own graded state, so "tap a
// row for the graded screen" landed on four different screens that had grown
// four different grammars. One route now, and it needs the contest id, so the
// href is built per row rather than looked up as a constant.
const resultsHref = (game, contestId) => `/results/${game}/${Number(contestId)}`;
const ord = (n) => (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');

/**
 * The reader's own line in every contest graded in the latest NFL week.
 *
 * THE WEEK NUMBER IS THE NFL'S, AND CFB DOES NOT SHARE IT. Taking max(week)
 * across game types was my first cut and PROD answered it immediately: the
 * CFB pick'em boards are numbered on the CFBD calendar - 35, 36, 37 - so the
 * latest settled "week" came back as 37 and the block rendered one CFB row
 * under a heading that said WEEK 37 while the Weekly it belonged beside was
 * week 1. Exactly the quiet wrong this function's window is for.
 *
 * SO THE SPINE IS THE WEEKLY (or the Draft, which shares its window) and a
 * board of any sport joins that week when its LOCK falls inside the window.
 * The lock, not opens_at: CFB week 37 OPENED on 1 September, a full week
 * before NFL week 1's window began, and locked on the 13th - inside it. The
 * lock is the weekend the games were actually played, which is what a reader
 * means by "the graded week".
 */
async function gradedWeekV3(uid) {
  if (uid == null) return { rows: [], label: null };
  const [spine] = await sql`
    SELECT c.id, c.week, c.opens_at, c.settles_at
      FROM contests c JOIN contest_entries e ON e.contest_id = c.id
     WHERE c.settled AND c.game_type IN ('weekly', 'draft')
       AND e.user_id = ${Number(uid)} AND e.score IS NOT NULL
     ORDER BY c.season_year DESC, c.week DESC LIMIT 1`;
  if (!spine) return { rows: [], label: null };
  const ranked = await sql`
    SELECT c.id AS contest_id, c.game_type, c.sport, c.perfect, e.user_id, e.score, e.lineup, e.meta,
           dense_rank() OVER (PARTITION BY c.id ORDER BY e.score DESC) AS rank,
           count(*) OVER (PARTITION BY c.id) AS of
      FROM contests c JOIN contest_entries e ON e.contest_id = c.id
     WHERE c.settled AND c.game_type <> 'daily' AND e.score IS NOT NULL
       AND c.locks_at >= ${spine.opens_at} AND c.locks_at <= ${spine.settles_at}`;
  const mine = ranked.filter((r) => r.user_id === Number(uid));
  const rows = [];
  for (const type of ['weekly', 'pickem', 'draft']) {
    const got = mine.filter((r) => r.game_type === type);
    if (!got.length) continue;
    if (type === 'pickem') {
      // THE RECORD, NOT THE WIN COUNT, and through the same pure shaper the
      // This week row uses: a settled board's `perfect.results` IS a results
      // map, so a push is a null winner here exactly as it is live.
      let correct = 0; let played = 0;
      for (const r of got) {
        const results = r.perfect?.results ?? {};
        const rec = pickemRecord({
          picks: r.lineup ?? {},
          games: Object.entries(results).map(([id, winner]) => ({ id, status: 'final', winner })),
        });
        correct += rec.correct; played += rec.played;
      }
      // PICK'EM CAN BE TWO CONTESTS IN ONE WEEK (NFL and CFB) and the row sums
      // them. It links to the FIRST - the one whose sport leads the sub - rather
      // than inventing a combined results screen that has no contest behind it.
      rows.push({ key: type, mark: GRADED_MARK[type], name: GRADED_NAME[type],
        sub: got.map((r) => String(r.sport).toUpperCase()).join(' + '),
        value: `${correct}-${played - correct}`,
        href: resultsHref(type, got[0].contest_id) });
      continue;
    }
    const r = got[0];
    const room = r.meta?.room ?? null;
    // THE DRAFT'S HEADLINE RANK IS THE ROOM'S, NOT THE FIELD'S, which is the
    // mock's line and also the only one that reads as a result: a 12-seat room
    // is the thing the reader played in, and the field is the context. The
    // first cut printed the field rank beside the room's seat count and read
    // as a contradiction - '1st · 62.0' next to eleven higher seat scores.
    const seat = room?.seats?.find?.((s) => s.user)?.seat ?? null;
    const rank = type === 'draft' && room?.rank != null ? room.rank : r.rank;
    rows.push({
      key: type, mark: GRADED_MARK[type], name: GRADED_NAME[type],
      sub: type === 'draft'
        ? [seat != null ? `seat ${seat}` : null, `${r.rank}${ord(r.rank)} of ${r.of} field`].filter(Boolean).join(' · ')
        : `${r.of} played`,
      value: `${rank}${ord(rank)} · ${fmt1(r.score)}`,
      href: resultsHref(type, r.contest_id),
    });
  }
  return { rows, label: `WEEK ${spine.week}` };
}

// ===========================================================================
// THE ALERTS CHIP
// ===========================================================================
/**
 * WHAT IS ACTUALLY STORED, AND NOTHING THAT IS NOT. alert_prefs carries scope
 * 'team' | 'match' (migration 082) and no per-GAME scope at all, so the mock's
 * five game switches have nowhere to write. They are their own relay; here the
 * pane lists the subscriptions that exist and links to the page that changes
 * each one.
 */
async function alertsPane(uid) {
  if (uid == null) return { follows: [], matchAlerts: [], nextAlertAt: null };
  const [follows, matches] = await Promise.all([
    sql`
      SELECT p.scope_id AS team_id, t.name, t.slug
        FROM alert_prefs p JOIN teams t ON t.id = p.scope_id
       WHERE p.user_id = ${Number(uid)} AND p.scope = 'team' AND p.master
       ORDER BY t.name ASC`.catch(() => []),
    sql`
      SELECT p.scope_id AS match_id, m.slug, m.kickoff_at, h.name AS home, a.name AS away
        FROM alert_prefs p
        JOIN matches m ON m.id = p.scope_id
        LEFT JOIN teams h ON h.id = m.home_team_id
        LEFT JOIN teams a ON a.id = m.away_team_id
       WHERE p.user_id = ${Number(uid)} AND p.scope = 'match' AND p.master
         AND m.kickoff_at > now() - interval '1 day'
       ORDER BY m.kickoff_at ASC`.catch(() => []),
  ]);
  return {
    follows: follows.map((f) => ({ teamId: f.team_id, name: f.name, slug: f.slug })),
    matchAlerts: matches.map((m) => ({
      matchId: m.match_id, label: `${m.away ?? 'Away'} at ${m.home ?? 'Home'}`,
      detail: 'kickoff · scores · final', href: `/match/${m.slug}`,
      kickoffAt: m.kickoff_at ? new Date(m.kickoff_at).toISOString() : null,
    })),
    // NEXT MEANS NEXT. The list keeps today's game (kickoff_at > now - 1 day)
    // because a reader mid-Sunday wants to see the alert they set this
    // morning; the foot line says "Next", so it takes the first kickoff that
    // has not happened, or says nothing.
    nextAlertAt: (() => {
      const t = Date.now();
      const next = matches.find((m) => m.kickoff_at && new Date(m.kickoff_at).getTime() > t);
      return next ? new Date(next.kickoff_at).toISOString() : null;
    })(),
  };
}

/**
 * The reader's own Draft room, as a row: on the clock, roster in, or scoring.
 *
 * THE FIRST CUT READ A PILL LABEL. `v2.draft.pill.label === 'Live' ?
 * 'drafting' : 'none'` collapsed every state that is not literally Live into
 * a blank row - so on the night his own room finished, user 1's Draft row was
 * a dash while the entry, the roster and the locked contest all existed. A
 * pill is copy; this reads the facts the copy is made of.
 *
 * THE BEST SIX IS THE ROOM'S OWN ARITHMETIC, not a second opinion: bestBall()
 * then scoreLineup(), which is exactly what roomStandings() runs per seat at
 * settle. Before any game has scored there is no best six, and the row says
 * "roster in" rather than printing a 0.0 nobody earned.
 */
async function draftRow(uid, now) {
  if (uid == null) return { state: 'none' };
  const st = await draftState(uid, { now });
  if (!st?.contest) return { state: 'none' };
  const { contest, entry, draft } = st;

  // ON THE CLOCK: the room is still running. The pick number is COUNTED, not
  // guessed - the next overall pick is one past the picks already made, and
  // the room's own teamsCount turns that into "7.06".
  if (draft && draft.status !== 'completed') {
    const teams = contest.meta?.config?.teamsCount ?? DRAFT_CONFIG.teamsCount;
    const [c] = await sql`SELECT count(*)::int AS n FROM draft_picks WHERE draft_id = ${draft.id}`;
    const made = c?.n ?? 0;
    const round = Math.floor(made / teams) + 1;
    const inRound = (made % teams) + 1;
    const rounds = contest.meta?.config?.rounds ?? DRAFT_ROUNDS;
    return {
      state: 'drafting', onTheClock: true,
      pick: `${round}.${String(inRound).padStart(2, '0')}`,
      roundsToGo: Math.max(0, rounds - round),
    };
  }
  const roster = (entry?.meta?.roster ?? []).filter((r) => r?.id != null);
  if (!roster.length) return { state: 'none' };
  if (contest.settled) return { state: 'settled', roomRank: entry?.meta?.room?.rank ?? null,
    roomOf: entry?.meta?.room?.of ?? null, score: entry?.score ?? null };

  // LOCKED AND NOT YET SETTLED: score what has actually been played.
  const { scored, playedIds } = await liveScoredBoard(contest);
  const anyPlayed = roster.some((r) => playedIds.has(r.id));
  if (!anyPlayed) {
    return { state: 'entered', rosterSize: roster.length, toPlay: roster.length };
  }
  const { lineup } = bestBall(roster, scored);
  const { baseScore } = scoreLineup(lineup, scored);
  return {
    state: 'live', bestSix: baseScore,
    toPlay: roster.filter((r) => !playedIds.has(r.id)).length,
    rosterSize: roster.length,
  };
}

/**
 * THE WHOLE SCREEN - one chip's worth of it.
 *
 * ONLY THE SELECTED PANE IS READ. v2 ran its entire lobby reader for every
 * pane, which was defensible when the panes shared one payload; these do not.
 * The Boards chip scores a contest, the Results chip ranks a settled week,
 * and neither is work a reader on Alerts should pay for.
 *
 * @param {number|null} userId
 * @param {{now?: Date, chip?: string, boardKey?: string|null}} opts
 */
// ---------------------------------------------------------------------------
// THE MLB GROUP - two rows, the same one-line grammar as the football four
// ---------------------------------------------------------------------------

/**
 * THE HOUSE ZONE, which is Pacific - see lib/gridiron/kickoff.js HOUSE_TZ. The
 * comment that stood here claimed Eastern was "the one zone every lock time on
 * this site is stated in" and it was wrong: the app deck and the site's own
 * kickoff labels are PT. These two rows name the SAME first pitch the October
 * card names, so a row in one zone and a card in the other is two answers to
 * one question on two screens a tap apart.
 */
const PT_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: HOUSE_TZ, hour: 'numeric', minute: '2-digit',
});
const PT_DOW = new Intl.DateTimeFormat('en-US', { timeZone: HOUSE_TZ, weekday: 'short' });

/**
 * THE TWO MLB ROWS. Each carries its own state and its own door, and a
 * preview says PREVIEW ON THE ROW rather than only on the card it opens - a
 * reader deciding whether to tap should not have to tap to find out.
 *
 * A ROW WITH NOTHING BEHIND IT IS STILL A ROW, and says so ("opens with the
 * bracket"). Hiding it would make the group appear and disappear between
 * visits for reasons nobody can see; the dead "MLB 2027" chip is the other
 * failure mode, and a row that states its own emptiness avoids both.
 */
export async function mlbRowsV3(uid, now = new Date()) {
  const [{ currentOctoberDay }, { currentRunRound }] = await Promise.all([
    import('../october/create.js'), import('../run/create.js'),
  ]);
  const [oct, run] = await Promise.all([
    currentOctoberDay({ now }).catch(() => null),
    currentRunRound({ now }).catch(() => null),
  ]);
  return [octoberRowV3(oct, now), runRowV3(run, now)];
}

export function octoberRowV3(contest, now = new Date()) {
  const base = { key: 'october', mark: 'O', name: 'October · five a day', href: '/october' };
  if (!contest) return { ...base, line: 'Opens with the bracket', tone: 'muted' };
  const preview = contest.meta?.preview === true;
  const lock = contest.locks_at ? new Date(contest.locks_at) : null;
  const locked = lock != null && lock.getTime() <= new Date(now).getTime();
  const games = contest.meta?.games ?? (contest.board ?? []).length;
  return {
    ...base,
    line: locked
      ? `${games} games · today's card is locked`
      : `Today's card is open · ${games} games`,
    right: preview ? 'PREVIEW' : null,
    rightLabel: preview ? null : (lock ? `${PT_TIME.format(lock)} PT` : null),
    tone: locked ? 'done' : 'live',
  };
}

export function runRowV3(contest, now = new Date()) {
  const base = { key: 'run', mark: 'R', name: 'The Run · nine a round', href: '/run' };
  if (!contest) return { ...base, line: 'Opens with the bracket', tone: 'muted' };
  const preview = contest.meta?.preview === true;
  const first = contest.meta?.firstPitch ? new Date(contest.meta.firstPitch) : null;
  const open = first != null && first.getTime() > new Date(now).getTime();
  const label = contest.meta?.label ?? 'Round';
  return {
    ...base,
    // A ROUND STILL OPEN NAMES THE CLOCK IT LOCKS ON; one that has locked
    // names the round it is.
    line: open && first
      ? `Locks ${PT_TIME.format(first)} PT · ${PT_DOW.format(first)}`
      : `${label} · locked`,
    right: preview ? 'PREVIEW' : null,
    rightLabel: preview ? null : (open && first ? PT_DOW.format(first) : null),
    tone: open ? 'live' : 'done',
  };
}

export async function lobbyV3(userId = null, { now = new Date(), chip = 'week', boardKey = null } = {}) {
  const uid = userId == null ? null : Number(userId);
  const handleOf = async () => (uid == null ? null
    : sql`SELECT handle FROM users WHERE id = ${uid}`.then((r) => r[0]?.handle ?? null).catch(() => null));

  if (chip === 'boards') {
    const [handle, boards] = await Promise.all([handleOf(), boardsPane(uid, now, boardKey)]);
    return { handle, chip, boards };
  }
  if (chip === 'alerts') {
    const [handle, alerts] = await Promise.all([handleOf(), alertsPane(uid).catch(() => null)]);
    return { handle, chip, alerts: alerts ?? { follows: [], matchAlerts: [], nextAlertAt: null } };
  }
  if (chip === 'results') {
    const [handle, days, graded] = await Promise.all([
      handleOf(),
      nul(dailyWeek(uid)) ?? [],
      gradedWeekV3(uid).catch(() => ({ rows: [], label: null })),
    ]);
    return { handle, chip, results: resultsShape(days ?? [], graded) };
  }

  const v2 = await lobbyV2(uid, { now });
  if (!v2) return null;

  const [six, pkNfl, pkCfb, yday, leagues, dr] = await Promise.all([
    nul(weeklySix(uid)) ?? [],
    nul(pickemFinals(uid, 'nfl')),
    nul(pickemFinals(uid, 'cfb')),
    nul(dailyYesterday(uid)),
    uid == null ? [] : myLeagues(uid).catch(() => []),
    draftRow(uid, now).catch(() => ({ state: 'none' })),
  ]);

  // ---- the four rows -----------------------------------------------------
  const w = v2.weekly ?? {};
  const weekly = weeklyRowV3({
    rows: six ?? [],
    state: w.state, filled: Number(w.sub?.match?.(/(\d+) of 6/)?.[1] ?? 0) || (six ?? []).filter((r) => r.id != null).length,
    live: w.state === 'locked',
    scored: w.stats?.find?.((s) => s.label === 'Scored')?.value ?? null,
    toPlay: (six ?? []).length ? (six ?? []).filter((r) => r.id != null && !r.played).length : null,
  });
  const pickem = pickemRowV3({ nfl: pkNfl, cfb: pkCfb });
  const d = v2.daily ?? {};
  const daily = dailyRowV3({
    pct: yday?.pct ?? null, matched: yday?.matched ?? null, slots: yday?.slots ?? 8,
    streak: v2.streak ?? 0, state: d.state, opensAt: d.closesAt ?? null,
  });
  const draft = draftRowV3(dr);

  const rows = [daily, weekly, pickem, draft];

  // ---- the MLB group, UNDER the four football rows (B3 addendum) ---------
  // NOT between Daily and Weekly: those four are one league's week and MLB is
  // a different sport on a different clock. Its own labelled group says that
  // in the layout instead of making the reader infer it from two rows that
  // do not share a season with their neighbours.
  const mlb = await mlbRowsV3(uid, now).catch(() => []);

  // ---- the now card, over the same view ----------------------------------
  const card = nowCard({
    daily: { ...d, gradedLine: yday?.pct ?? null, streakLine: (v2.streak ?? 0) > 0 ? `${v2.streak}-day streak` : null,
      shape: '8 slots · 12 teams · about 3 minutes' },
    weekly: { ...w, live: w.state === 'locked', scored: weekly.right == null ? null : Number(weekly.right) },
    draft: dr,
  }, { now });

  return {
    handle: v2.handle ?? null,
    chip: 'week',
    week: {
      now: card, rows, mlb, week: v2.week ?? null,
      practice: [
        { key: 'draft', label: 'Mock draft', title: 'The Draft', href: '/sim',
          sub: `12 · ${DRAFT_ROUNDS} rounds · this season` },
        // THE SECOND TILE IS THE READER'S OWN LEAGUE, which is what the mock
        // draws ('Your league · The Longest Yard'). It carries the league's
        // NAME and its member count - both already stored - and becomes the
        // pitch when there is no league to name, rather than a tile promising
        // rules nobody has set.
        (leagues ?? []).length
          ? { key: 'league', label: 'Mock draft', title: (leagues[0].name ?? 'Your league'),
            href: '/leagues', sub: `${leagues[0].members} member${leagues[0].members === 1 ? '' : 's'} · your rules` }
          : { key: 'league', label: 'Mock draft', title: 'Start a league', href: '/leagues', sub: 'your rules, your people' },
      ],
      foot: 'Everything scores on its own · graded Tuesday',
    },
  };
}

/** The Results chip's shape: seven Daily days, then the graded week. */
function resultsShape(days, graded) {
  const avg = days.length
    ? Math.round((days.reduce((a, r) => a + (r.pctNum ?? 0), 0) / days.length) * 1000) / 10
    : null;
  const best = days.length ? Math.max(...days.map((r) => r.pctNum ?? 0)) : null;
  return {
    dailyDays: days,
    dailySummary: days.length
      ? `${days.length} played this week · avg ${avg}% · best ${pctOfCeiling(best, 1) ?? '-'}`
      : null,
    // THE DAILY'S ROW IS THE SAME SEVEN DAYS, SUMMED - not a fifth read. It
    // sits in the graded block because the mock puts it there and because a
    // week's Daily average is a week's result.
    gradedWeek: [
      ...(graded.rows ?? []),
      ...(days.length ? [{
        // THE DAILY'S ROW GOES TO THE RESULTS ROUTE TOO, for the newest edition
        // it has a submitted run on - the seven days are already listed above it
        // and the row is the week's summary, so the screen it opens is the last
        // one played.
        key: 'daily', mark: 'D', name: 'The Daily',
        href: days[0]?.boardId != null ? resultsHref('daily', days[0].boardId) : '/daily',
        sub: `${days.length} played · best ${pctOfCeiling(best, 1) ?? '-'}`,
        value: avg == null ? '-' : `avg ${avg}%`,
      }] : []),
    ],
    gradedWeekLabel: graded.label ?? null,
  };
}
