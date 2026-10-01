// lib/survivor/rules.js - Survivor's rules as pure functions. No database.
//
// Everything that DECIDES something lives here, so the grader, the pick action
// and the page cannot disagree about it: which week is open, when a team
// locks, what a final means for a pick, who the auto-pick is, how many lives
// are left. lib/survivor/read.js and grade.js only fetch and write.
//
// RULINGS (1 Oct 2026), each a function below:
//   - one team a week, locks at THAT team's kickoff, never reused
//   - a tie is a LOSS
//   - a game cancelled, or not played inside its NFL week, is SURVIVE (the team
//     stays used); postponed-but-played-inside-the-week grades normally
//   - a missed pick in an 'auto' pool is assigned at the week's FIRST kickoff:
//     the biggest unused favorite by spread among games still to kick off,
//     falling back to the moneyline when no game has a spread; if no game has
//     a line at all nothing is assigned, and if the reader still has no pick
//     when the week's last game kicks off the week is MISSED (a life)
//   - week 18's placeholder kickoffs lock nothing and accept no pick until the
//     real times exist
//   - teams on bye are not offered (they have no game in the week)

/**
 * THE SPORT THE PAGE READS. Always 'nfl' in production. Outside production a
 * SURVIVOR_SPORT_DEV env names a synthetic schedule instead, so a dev server
 * can be shown states the real calendar has not reached yet (a kicked game, a
 * used team) without touching DEV's real NFL rows. Ignored when NODE_ENV is
 * 'production'.
 */
export function survivorSport(env = process.env) {
  const dev = String(env?.SURVIVOR_SPORT_DEV ?? '').trim();
  return env?.NODE_ENV !== 'production' && dev ? dev : 'nfl';
}

/** Results that cost a life. */
export const LOSING = Object.freeze(['loss', 'missed']);

/** Every result word the table allows (migration 118). */
export const RESULTS = Object.freeze(['pending', 'win', 'loss', 'survive', 'missed']);

/** How long after its last kickoff a week with no following week stays open. */
export const LAST_WEEK_GRACE_HOURS = 72;

const ms = (iso) => (iso == null ? NaN : new Date(iso).getTime());

/**
 * A PLACEHOLDER KICKOFF is midnight Eastern - 05:00Z in standard time, 04:00Z
 * in daylight time - on the minute. No NFL game kicks off then; the schedule
 * feed parks undecided week-18 games there (2027-01-10T05:00:00Z on PROD,
 * 1 Oct). A placeholder is not a lock and not pickable.
 */
export function isPlaceholderKickoff(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return true;
  return d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
    && (d.getUTCHours() === 5 || d.getUTCHours() === 4);
}

/**
 * Can this game still be picked (or a pick on it changed) at `now`? The server
 * check the ruling names: now < kickoff AND status 'scheduled', and a real time.
 */
export function gameOpen(game, now = new Date()) {
  if (!game) return false;
  if (game.status !== 'scheduled') return false;
  if (isPlaceholderKickoff(game.kickoff_at)) return false;
  return ms(game.kickoff_at) > new Date(now).getTime();
}

/**
 * THE WEEKS, as the grader and the page both see them. `weeks` is one row per
 * week: { week, first_kickoff, last_kickoff, games, done } where done = every
 * game final or cancelled. A week ENDS at the next week's first kickoff (the
 * last week: LAST_WEEK_GRACE_HOURS after its last kickoff) - a game not final
 * by then was not played inside its week.
 */
export function weekEnds(weeks) {
  const sorted = [...weeks].sort((a, b) => a.week - b.week);
  const out = new Map();
  sorted.forEach((w, i) => {
    const next = sorted[i + 1];
    const end = next && next.week === w.week + 1
      ? ms(next.first_kickoff)
      : ms(w.last_kickoff) + LAST_WEEK_GRACE_HOURS * 3600e3;
    out.set(w.week, end);
  });
  return out;
}

/**
 * THE OPEN WEEK: the earliest week from the pool's start that is still being
 * played (some game not final/cancelled and the week has not ended) OR still
 * has a pending pick in this pool. The second clause keeps the next week shut
 * until the last one is graded, so nobody picks Week 6 while their Week 5 loss
 * is an hour from being written. Null once the season is over.
 *
 * @param pendingWeeks  Set of weeks with a pending pick in the pool
 */
export function openWeek(weeks, { startWeek, now = new Date(), pendingWeeks = new Set() } = {}) {
  const t = new Date(now).getTime();
  const ends = weekEnds(weeks);
  const cands = [...weeks].filter((w) => w.week >= startWeek).sort((a, b) => a.week - b.week);
  for (const w of cands) {
    const over = w.done || t >= ends.get(w.week);
    if (!over || pendingWeeks.has(w.week)) return w.week;
  }
  return null;
}

/**
 * A team's own line from a home-based spread: negative = favored. A home team
 * at -3.5 is -3.5; the away team in that game is +3.5.
 */
export function teamSpread(spreadHome, isHome) {
  if (spreadHome == null || !Number.isFinite(Number(spreadHome))) return null;
  const v = Number(spreadHome);
  return isHome ? v : (v === 0 ? 0 : -v);
}

/**
 * The week's teams, one row each, FAVORITES FIRST: every team with a game in
 * the week (a bye team has none and is simply absent), with its opponent, its
 * kickoff and its own spread. Sorted by spread ascending (biggest favorite
 * first), then by moneyline implied probability, then kickoff, then abbr; a
 * team with no line sorts after every team with one.
 *
 * @param games    [{ match_id, kickoff_at, status, home:{id,abbr,name}, away:{...} }]
 * @param spreads  Map(match_id -> home-based spread)
 * @param h2h      Map(match_id -> { home:{implied}, away:{implied} })
 */
export function teamRows(games, spreads = new Map(), h2h = new Map()) {
  const rows = [];
  for (const g of games ?? []) {
    for (const side of ['home', 'away']) {
      const t = g[side];
      const o = g[side === 'home' ? 'away' : 'home'];
      if (!t?.id) continue;
      const sp = teamSpread(spreads.get(g.match_id), side === 'home');
      const ml = h2h.get(g.match_id)?.[side]?.implied;
      rows.push({
        team_id: t.id, abbr: t.abbr ?? t.name, name: t.name,
        opp_abbr: o?.abbr ?? o?.name ?? null, home: side === 'home',
        match_id: g.match_id, kickoff_at: g.kickoff_at, status: g.status,
        spread: sp, implied: ml == null || !Number.isFinite(Number(ml)) ? null : Number(ml),
      });
    }
  }
  const key = (r) => [
    r.spread == null ? 1 : 0, r.spread ?? 0,
    r.implied == null ? 1 : 0, -(r.implied ?? 0),
    ms(r.kickoff_at), String(r.abbr),
  ];
  return rows.sort((a, b) => {
    const ka = key(a); const kb = key(b);
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] < kb[i]) return -1;
      if (ka[i] > kb[i]) return 1;
    }
    return 0;
  });
}

/**
 * THE AUTO-PICK: the biggest unused favorite among games still to kick off.
 * By SPREAD when any candidate has one (only spread-priced candidates are then
 * considered - two scales are never mixed); otherwise by MONEYLINE implied
 * probability; otherwise null - no line anywhere, nothing is assigned.
 *
 * @param rows     teamRows() output
 * @param usedIds  Set of team ids this entry has already used (any week)
 */
export function chooseAuto(rows, usedIds = new Set(), now = new Date()) {
  const open = (rows ?? []).filter((r) => !usedIds.has(r.team_id)
    && gameOpen({ status: r.status, kickoff_at: r.kickoff_at }, now));
  const bySpread = open.filter((r) => r.spread != null);
  if (bySpread.length) {
    return [...bySpread].sort((a, b) => a.spread - b.spread || ms(a.kickoff_at) - ms(b.kickoff_at)
      || String(a.abbr).localeCompare(String(b.abbr)))[0];
  }
  const byMl = open.filter((r) => r.implied != null);
  if (byMl.length) {
    return [...byMl].sort((a, b) => b.implied - a.implied || ms(a.kickoff_at) - ms(b.kickoff_at)
      || String(a.abbr).localeCompare(String(b.abbr)))[0];
  }
  return null;
}

/**
 * WHAT A GAME MEANS FOR A PICK, or null while it is still to be decided.
 *   final        -> win if the picked team scored more, else LOSS (a tie is a loss)
 *   cancelled    -> survive
 *   not final once its week has ended (postponed out of the week) -> survive
 *
 * @param pick   { team_id }
 * @param match  { status, home_team_id, away_team_id, home_score, away_score }
 * @param weekEndMs  when the pick's NFL week ended (weekEnds())
 */
export function gradePick(pick, match, { now = new Date(), weekEndMs = Infinity } = {}) {
  if (!pick || !match) return null;
  if (match.status === 'final') {
    // Number(null) is 0: a final with a missing score would grade as a 0-x
    // result. It waits for the score instead.
    if (match.home_score == null || match.away_score == null) return null;
    const hs = Number(match.home_score); const as = Number(match.away_score);
    if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
    const mine = Number(pick.team_id) === Number(match.home_team_id) ? hs : as;
    const theirs = Number(pick.team_id) === Number(match.home_team_id) ? as : hs;
    return mine > theirs ? 'win' : 'loss';
  }
  if (match.status === 'cancelled') return 'survive';
  if (new Date(now).getTime() >= weekEndMs) return 'survive';
  return null;
}

/**
 * LIVES, DERIVED FROM THE PICKS. Walks the weeks in order; each loss or miss
 * costs a life; the week the last life goes is the elimination week. Picks
 * after that week do not count (they cannot revive anybody).
 *
 * @returns {{ livesLeft: number, eliminatedWeek: number|null }}
 */
export function livesFrom(picks, lives) {
  let left = Number(lives);
  let eliminatedWeek = null;
  for (const p of [...(picks ?? [])].sort((a, b) => a.week - b.week)) {
    if (eliminatedWeek != null) break;
    if (LOSING.includes(p.result)) {
      left -= 1;
      if (left <= 0) { left = 0; eliminatedWeek = p.week; }
    }
  }
  return { livesLeft: Math.max(left, 0), eliminatedWeek };
}

/**
 * THE ENTRY CUTOFF: the first kickoff of the pool's entry_until_week, from the
 * schedule (`weeks` as seasonWeeks returns them) - never a typed time. Null when
 * the pool never closes, or its cutoff week has no games yet.
 */
export function entryCutoff(pool, weeks = []) {
  if (pool?.entry_until_week == null) return null;
  const w = weeks.find((x) => Number(x.week) === Number(pool.entry_until_week));
  return w?.first_kickoff ?? null;
}

/** May a new entry join at `now`? Until the cutoff kickoff (entryCutoff), or always with none. */
export function entriesOpen(pool, cutoffKickoff, now = new Date()) {
  if (pool?.entry_until_week == null) return true;
  if (cutoffKickoff == null) return true;
  return new Date(now).getTime() < ms(cutoffKickoff);
}

/**
 * THE REFUSALS, in the words the reader sees. The action returns a key; the
 * room renders the sentence.
 */
export const REFUSALS = Object.freeze({
  signed_out: 'Sign in to pick',
  no_pool: 'Survivor is not open',
  no_week: 'No week is open for picks',
  entries_closed: 'Entries are closed for this season',
  eliminated: 'You are out - no more picks this season',
  not_this_week: 'That team does not play this week',
  team_locked: 'That game has kicked off',
  pick_locked: 'Your pick has kicked off - it is locked in',
  placeholder: 'Kickoff times for this game are not set yet',
  used: 'You have already used that team',
  failed: 'Could not save the pick',
});
