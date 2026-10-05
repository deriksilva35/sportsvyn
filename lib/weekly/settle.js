// lib/weekly/settle.js - the Tuesday settle. The job that turns a locked week
// into a result.
//
// IT REFUSES MORE OFTEN THAN IT SETTLES, and that is the design. Settling a
// week while one game's stat lines are missing produces a perfect lineup that
// is not perfect and scores that are quietly low for anyone who started a
// player from that game. Nobody re-reads Tuesday's leaderboard, so the error is
// permanent and invisible. The job's default is to do nothing and name what is
// missing.
//
// IT IS SCHEDULED, NOT TIMED. It runs on a cadence and settles only when the
// week is complete, rather than firing once at an hour we guessed. BDL has
// never delivered an NFL stat line in season - the whole 2015-2025 corpus
// arrived in one backfill on 2026-07-20 - so any specific "by 8am Tuesday" is a
// hope. A job that retries costs nothing; a job that settles early is wrong
// forever. This is also why the cron runs HOURLY across Tuesday rather than
// once: a single 05:00 firing that refuses would push the reveal a full week,
// which is the opposite of "a noon reveal is on-spec".
//
// ONE JOB, BOTH GAMES. A contest is a board, a week and a set of entries whose
// lineup is six player ids; the Weekly fills that lineup from a builder and The
// Draft fills it from a draft room, and by the time scoring runs the two are
// the same shape. The staggered crons are two callers, not two implementations.
//
// game_type IS READ FOR TWO THINGS, and this comment used to say one. It
// selects the lineup SOURCE - roster-plus-best-ball versus the stored six -
// and, since ruling D2 (sat-5), the SCORER: The Draft counts all six from NFL
// 2026 week 5 while the Weekly drops its worst. The gate, the void rule, the
// perfect lineup, the DNF rule and the set-once guard are all shared and must
// stay shared.
//
// ============================================================================
// STAT CORRECTIONS: A 7-DAY RE-GRADE. Ruled sat-5 (3 Oct), replacing 17 Aug.
// ============================================================================
// The 17 Aug ruling was "settled is final". It is replaced: a stat correction
// that lands within 7 days of a game's kickoff re-grades the settled contests
// holding that game - the EPL Weekly 5 pattern (lib/eplWeekly5/settle.js).
// settleContest(id, { regrade: true }) is the same function on a settled row:
// it recomputes from the stat rows, and writes only if a point moved. A game
// whose kickoff is more than 7 days old is FROZEN at the points this contest
// stored, so a late correction to it moves nothing. settled_at stays the
// first settle; meta.regraded_at records the last re-grade. The trigger is the
// daily /api/cron/football-regrade (lib/settle/regrade.js).
//
// ============================================================================
// THE VOID RULE. Ruled sat-5.
// ============================================================================
// A game still not final at settles_at + 48h - postponed, cancelled, or just
// stuck - is VOID: its players score 0 and the week settles on the rest. The
// gate accepts that only after the cutoff (lib/weekly/rules.js). The void list
// is stored on the contest (meta.void) and a re-grade honours it - a void is
// never un-voided.
//
// ============================================================================
// THE DRAFT COUNTS SIX from NFL 2026 week 5 (ruling D2): best ball's six, no
// drop-worst. Earlier weeks settled under best-five and stand. The Weekly
// keeps drop-worst. lib/draft/bestball.js draftScorer() picks the rule.

import { sql } from '../db.js';
import { fantasyPoints } from '../fantasy/scoring.js';
import { toStatLine } from '../fantasy/playerStats.js';
import { perfectLineup } from '../daily/reveal.js';
import { scoreLineup } from '../daily/play.js';
import { settleReadiness } from './rules.js';
import { weekGames, weekScores } from './pool.js';
import { bestBall, draftScorer } from '../draft/bestball.js';
import { pastVoidCutoff, inRegradeWindow, storedVoid, regradeEligible } from '../settle/footballRules.js';
import { closeVoidAll } from '../settle/voidRule.js';
import { bridgeContestRosters } from '../draft/entry.js';
import { roomStandings } from '../draft/room.js';
import { lockEntries } from './entries.js';
import { competitionRank } from '../games/rank.js';

/**
 * Score every player in the week's pool from their real stat lines.
 *
 * A player who did not play scores ZERO, not null: he was startable and the
 * lineup that started him gets what he produced, which was nothing. Null would
 * propagate into the perfect-lineup search as a missing value.
 */
export function poolWithScores(board, statRows) {
  const byPlayer = new Map();
  for (const r of statRows ?? []) {
    // A player can appear once per game; a week is one game, but a corrected
    // duplicate row must add rather than replace.
    const prev = byPlayer.get(r.id) ?? 0;
    byPlayer.set(r.id, prev + fantasyPoints(toStatLine(r), 'ppr'));
  }
  return (board ?? []).map((p) => ({
    ...p,
    points: Math.round((byPlayer.get(p.id) ?? 0) * 10) / 10,
  }));
}

/**
 * The week's pool scored for a RE-GRADE. PURE.
 *
 * Starts from the board the contest STORED at settle (it carries points) and
 * recomputes only what may still move:
 *   - a VOID game's rows are ignored - its players stay at 0;
 *   - a FROZEN game (kickoff more than 7 days ago) keeps the stored points
 *     of every player who played in it. A player is placed in a game by his
 *     stat rows, or - when he has none now - by his team in the game's label,
 *     so a correction that DELETES a frozen game's row cannot move him either.
 * Everyone else is recomputed from the current rows.
 *
 * @param storedBoard  contests.board after settle ({id, team, points, ...})
 * @param statRows     weekScores() rows, each with match_id
 * @param games        weekGames() rows ({id, label, kickoff_at})
 */
export function regradePool(storedBoard, statRows, games, { voidIds = new Set(), now = new Date() } = {}) {
  const frozen = new Set((games ?? [])
    .filter((g) => !voidIds.has(Number(g.id)) && !inRegradeWindow(g.kickoff_at, now))
    .map((g) => Number(g.id)));
  const frozenTeams = new Set();
  for (const g of games ?? []) {
    if (!frozen.has(Number(g.id))) continue;
    for (const abbr of String(g.label ?? '').split('@')) if (abbr) frozenTeams.add(abbr);
  }
  const frozenPlayers = new Set();
  const live = [];
  const withRows = new Set();
  for (const r of statRows ?? []) {
    const mid = Number(r.match_id);
    withRows.add(String(r.id));
    if (voidIds.has(mid)) continue;
    if (frozen.has(mid)) { frozenPlayers.add(String(r.id)); continue; }
    live.push(r);
  }
  const fresh = poolWithScores(storedBoard, live);
  return (storedBoard ?? []).map((p, i) => {
    const id = String(p.id);
    const keep = frozenPlayers.has(id) || (!withRows.has(id) && p.team != null && frozenTeams.has(p.team));
    return keep ? { ...p, points: Number(p.points) || 0 } : fresh[i];
  });
}

/** Did any player's points move between two scored boards? PURE. */
export function boardPointsChanged(before, after) {
  const was = new Map((before ?? []).map((p) => [String(p.id), Number(p.points) || 0]));
  for (const p of after ?? []) {
    if (Math.abs((was.get(String(p.id)) ?? 0) - (Number(p.points) || 0)) > 1e-9) return true;
  }
  return false;
}

/**
 * Settle one week, or explain why not. With { regrade: true } it is the SAME
 * function run over an already-settled week (the 7-day correction window):
 * it recomputes, and writes only if a point moved.
 *
 * @returns {{settled:boolean, regraded?:boolean, reason?:string, missing?:Array, entries?:number, perfect?:number}}
 */
export async function settleContest(contestId, { now = new Date(), regrade = false } = {}) {
  const c = (await sql`SELECT * FROM contests WHERE id = ${contestId}`)[0];
  if (!c) return { settled: false, reason: 'no such contest' };
  if (c.settled && !regrade) return { settled: false, reason: 'already settled', alreadySettled: true };
  if (!c.settled && regrade) return { settled: false, regraded: false, reason: 'not settled' };
  // AN ALL-VOID CLOSE IS NEVER RE-GRADED (ruling sun-10 item 4): no scores.
  if (regrade && c.meta?.void_all === true) return { settled: false, regraded: false, reason: 'void_all' };
  if (regrade && !regradeEligible(c)) return { settled: false, regraded: false, reason: 'settled before the re-grade ruling' };
  if (new Date(c.locks_at).getTime() > now.getTime()) {
    return { settled: false, reason: 'not locked yet' };
  }

  const games = await weekGames(c.season_year, c.week);
  let voidIds;
  if (regrade) {
    // THE VOID LIST IS THE ONE THE SETTLE STORED. A re-grade never un-voids.
    voidIds = new Set(storedVoid(c));
  } else {
    const gate = settleReadiness(games.map((g) => ({
      id: g.id, label: g.label, status: g.status, statLines: g.statLines,
    })), { voidAllowed: pastVoidCutoff(c, now) });
    if (!gate.ready && gate.reason === 'every game void') {
      // CLOSED AS VOID (ruling sun-10 item 4): settled, meta.void_all, no
      // scores, no ranks, no perfect, no settle push (settled: false here, so
      // no caller's "settled" hook fires).
      const { closed, void: ids } = await closeVoidAll(sql, c.id, gate.void);
      return { settled: false, voidAll: true, closed, void: ids, reason: gate.reason };
    }
    if (!gate.ready) return { settled: false, reason: gate.reason, missing: gate.missing };
    voidIds = new Set(gate.void.map(Number));
  }

  // THE DRAFT'S COMPLETION, AS A FALLBACK. This is the SECOND caller: the
  // first is the lazy post-lock read in draftState, which fills an abandoned
  // room on Wednesday night so the player's own view shows their real eight
  // rather than a half-finished roster they stare at for five days.
  //
  // KEPT HERE ANYWAY, and that is the point of a fallback. An entry nobody
  // looked at between lock and Tuesday was never swept, and a room that
  // finished after the tab closed would arrive with no roster at all - either
  // would settle as a DNF, failing a player for our missed write rather than
  // for their draft. Same idempotent path, so anything already done is a
  // no-op and a replay still matches the original.
  if (c.game_type === 'draft' && !regrade) {
    await bridgeContestRosters(contestId).catch(() => null);
  }

  const statRows = await weekScores(c.season_year, c.week);
  const scored = regrade
    ? regradePool(c.board, statRows, games, { voidIds, now })
    // A VOID GAME'S ROWS NEVER SCORE: a game suspended part-way may carry a
    // half-game of stat lines, and the ruling is that its players score 0.
    : poolWithScores(c.board, statRows.filter((r) => !voidIds.has(Number(r.match_id))));
  // THE CHEAP EXIT. Every number below is a function of the board's points
  // (rosters and lineups are fixed by now), so if no point moved, nothing
  // can - and a re-grade with nothing to do is one read, not a rewrite.
  if (regrade && !boardPointsChanged(c.board, scored)) {
    return { settled: false, regraded: false, reason: 'unchanged' };
  }
  const perfect = perfectLineup(scored);

  // Read AFTER the bridge above, not before: the loop needs the roster it just
  // wrote, and a stale meta here would settle every self-healed entry as a DNF.
  const entries = await sql`SELECT id, user_id, lineup, meta, COALESCE(submitted_at, created_at) AS submitted_at FROM contest_entries WHERE contest_id = ${contestId}`;
  const isDraft = c.game_type === 'draft';
  // THE DRAFT'S SCORER (ruling D2): all six from 2026 week 5, best-five
  // before. The Weekly is always drop-worst.
  const score = isDraft ? draftScorer(c) : scoreLineup;
  let counted = 0;
  const scoredEntries = []; // {id, userId, score} - real entries, for the Draft's ceiling below
  for (const e of entries) {
    // ---- THE ONE PLACE game_type IS READ, and it is a lineup SOURCE, not a
    // scoring rule. The Draft's entry carries a ROSTER; best-ball turns it into
    // the six slots the rest of this function already knows how to score.
    //
    // IT RUNS HERE AND NOT AT LOCK because it needs the real scores to choose,
    // and those do not exist until the week is complete - which is precisely
    // the condition the gate above has just confirmed.
    //
    // The dropped-worst rule USED TO apply identically to both games (best
    // ball's six, then drop-worst's five). Ruling D2 (sat-5) split them: from
    // NFL 2026 week 5 The Draft counts all six of best ball's six - "best six
    // of your eight count" is now literally true - and the Weekly keeps
    // drop-worst. `score` above is that one fork; earlier Draft weeks keep the
    // rule they settled under.
    // A DRAFT ENTRY WITH A ROSTER goes through best ball; one WITHOUT falls back
    // to whatever lineup it already carries. The fallback is not dead code and
    // not a nicety: an entry that already holds six scoreable slots IS
    // scoreable, and DNF-ing it because the roster key is missing would fail a
    // player for a shape our own bridge did not write. The replay harness seeds
    // draft entries exactly this way and caught this as a regression.
    const roster = isDraft ? (e.meta?.roster ?? []).filter((r) => r?.id != null) : [];
    const lineup = roster.length
      ? bestBall(roster, scored).lineup
      : (e.lineup ?? {});
    if (roster.length && Object.keys(lineup).length) {
      await sql`UPDATE contest_entries SET lineup = ${JSON.stringify(lineup)}::jsonb WHERE id = ${e.id}`;
    }
    // BOT ROSTER SCORING, THE OTHER ELEVEN SEATS (relay 2b item 1). A ranked
    // room is one draft per ENTRY (lib/draft/entry.js: "one ranked draft per
    // user per week"), so the room standing is computed once per entry here,
    // independent of whether the user's own lineup is complete - the bots'
    // scores come from draft_picks, not from this entry's own outcome, so a
    // DNF still gets a real room to have finished last (or not) in.
    const room = isDraft && e.meta?.draftId != null
      ? await roomStandings(Number(e.meta.draftId), scored, { score }).catch(() => null)
      : null;

    const filled = Object.values(lineup).filter((v) => v != null).length;
    if (filled < 6) {
      // AN INCOMPLETE LINEUP IS A DNF, not a partial score. Six slots is the
      // game; scoring five of them would rank a player who forgot a slot above
      // one who filled all six badly, which inverts the thing being measured.
      //
      // FOR THE DRAFT THIS IS NOW A TRIPWIRE, NOT A PLAYER OUTCOME. An
      // abandoned ranked room auto-completes on best-available before it
      // bridges (see lib/fantasy/drafts.js autoCompleteDraftFor), and the
      // eight-pick config deals 1 QB and 7 flex-eligible against a requirement
      // of 1 and 5 - so a draft entry reaching here short means the ranked
      // shape has been changed to something unfieldable, not that somebody
      // walked away. The Weekly still reaches it the ordinary way: a builder
      // lineup left half-filled at kickoff.
      await sql`
        UPDATE contest_entries
           SET score = NULL, base_score = NULL,
               meta = meta || jsonb_build_object('dnf', true, 'filled', ${filled}::int)
                           || CASE WHEN ${room != null} THEN jsonb_build_object('room', ${JSON.stringify(room)}::jsonb) ELSE '{}'::jsonb END,
               updated_at = now()
         WHERE id = ${e.id}`;
      continue;
    }
    const b = score(lineup, scored);
    await sql`
      UPDATE contest_entries
         SET score = ${b.baseScore}, base_score = ${b.baseScore},
             -- ::text is load-bearing: without it Postgres cannot infer the
             -- parameter's type inside jsonb_build_object and the whole
             -- statement fails with "could not determine data type".
             meta = meta || jsonb_build_object('droppedSlot', ${b.droppedSlot}::text, 'dnf', false)
                         || CASE WHEN ${room != null} THEN jsonb_build_object('room', ${JSON.stringify(room)}::jsonb) ELSE '{}'::jsonb END,
             updated_at = now()
       WHERE id = ${e.id}`;
    counted += 1;
    scoredEntries.push({ id: e.id, userId: e.user_id, score: b.baseScore, submittedAt: e.submitted_at });
  }

  // THE CEILING, STORED AT SETTLE (ruling). Two different questions get two
  // different shapes, because "the best possible outcome" means something
  // different in each game:
  //
  //   THE WEEKLY draws every entry from the SAME shared pool, so its ceiling
  //   is a THEORETICAL construct - perfectLineup's own best six from the pool,
  //   a roster nobody necessarily drafted. Known before any entry is scored.
  //
  //   THE DRAFT gives every entrant a DIFFERENT eight-player roster, so there
  //   is no shared pool to build a dream team from - the ceiling here is
  //   whoever's REAL roster scored highest this week, the best entry that
  //   actually exists, not an impossible one. Only knowable AFTER every entry
  //   is scored, which is why this reads scoredEntries rather than perfect.
  let ceiling = null;
  if (isDraft) {
    if (scoredEntries.length) {
      // A TIE FOR THE BEST DRAFT names the earliest submission (lib/games/rank.js)
      // - the same entry the field board lists first.
      const top = competitionRank(scoredEntries, (x) => x.score, (x) => x.submittedAt)[0];
      const [seatRow] = await sql`
        SELECT d.pick_position FROM contest_entries e
          LEFT JOIN drafts d ON d.id = (e.meta->>'draftId')::int
         WHERE e.id = ${top.id}`;
      ceiling = { score: top.score, entry_id: top.id, user_id: top.userId, seat: seatRow?.pick_position ?? null };
    }
  } else {
    ceiling = { score: perfect.total, players: perfect.picks };
  }

  // PCT, PER ENTRY: score / ceiling.score, stored in meta (the only
  // extensible place a per-entry derived fact already lives - droppedSlot and
  // dnf are meta too). A ceiling of 0 or absent leaves pct null rather than
  // dividing by zero or guessing.
  if (ceiling?.score) {
    for (const se of scoredEntries) {
      const pct = Math.round((se.score / ceiling.score) * 1000) / 10;
      await sql`UPDATE contest_entries SET meta = meta || jsonb_build_object('pct', ${pct}::numeric) WHERE id = ${se.id}`;
    }
  }

  if (regrade) {
    // THE RE-GRADE WRITE: settled_at stays the first settle; regraded_at is
    // a top-level meta key of ours, so the shallow || is exact here.
    await sql`
      UPDATE contests
         SET perfect = ${JSON.stringify(ceiling)}::jsonb,
             board = ${JSON.stringify(scored)}::jsonb,
             meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('regraded_at', ${new Date(now).toISOString()}::text)
       WHERE id = ${contestId} AND settled`;
    return {
      settled: false, regraded: true, entries: counted, dnf: entries.length - counted,
      perfect: ceiling?.score ?? null, games: games.length,
    };
  }

  // SET-ONCE, guarded the same way the Daily's close is: a second tick in the
  // same window finds nothing to do rather than recomputing. The void list
  // rides on meta (a top-level key: the shallow || is exact) so a re-grade
  // can honour it.
  const upd = await sql`
    UPDATE contests
       SET settled = true, settled_at = now(),
           perfect = ${JSON.stringify(ceiling)}::jsonb,
           board = ${JSON.stringify(scored)}::jsonb,
           meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('void', ${JSON.stringify([...voidIds])}::jsonb)
     WHERE id = ${contestId} AND NOT settled
     RETURNING id`;
  if (!upd.length) return { settled: false, reason: 'already settled', alreadySettled: true };

  return {
    settled: true, entries: counted, dnf: entries.length - counted,
    perfect: ceiling?.score ?? null, games: games.length, void: [...voidIds],
  };
}

/**
 * Settle everything of one game type that is due, and report per contest.
 *
 * INDEPENDENT PER CONTEST: one refusal does not stop the next. The Weekly and
 * The Draft run as separate cron invocations with separate recordRun rows and
 * share no state mid-job, so a Draft failure can never leave the Weekly
 * half-settled or vice versa.
 */
export async function settleDue(gameType, { now = new Date(), sport = 'nfl' } = {}) {
  const due = await sql`
    SELECT id, season_year, week FROM contests
     WHERE game_type = ${gameType} AND sport = ${sport}
       AND NOT settled AND locks_at < ${now.toISOString()}
     ORDER BY season_year, week`;

  const results = [];
  for (const c of due) {
    // Never let one contest's failure hide the others.
    try {
      // THE LOCK STAMP LANDS HERE, before the gate can refuse - entries seal
      // at lock, not at settle success, so a stats-are-late Tuesday still
      // stamps every entry on its first firing (the rehearsal's F3: the
      // function existed, its promised caller did not). Idempotent inside.
      await lockEntries(c.id, { now }).catch(() => null);
      const r = await settleContest(c.id, { now });
      results.push({ contestId: c.id, week: c.week, ...r });
    } catch (err) {
      results.push({ contestId: c.id, week: c.week, settled: false, error: String(err?.message ?? err) });
    }
  }
  return {
    gameType,
    considered: due.length,
    settled: results.filter((r) => r.settled).length,
    results,
  };
}
