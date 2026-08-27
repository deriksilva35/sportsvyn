// lib/today/leagues.js - the Today page's league vocabulary and its ordering.
//
// TWO GRAINS, ONE STORE. Migration 039 added `scope` to user_dashboards "so one
// user can own more than a single saved layout … room for future boards without
// a second table" - in its own words. The tuned-league set is that second
// board: scope 'today', the same ordered-array-of-{id} shape, resolved against
// THIS vocabulary instead of the panel registry. No new table, no new migration.
//
// THE ORDER IS COMPUTED, NEVER HARDCODED. "CFB first in August, NFL first in
// September" is a fact about the calendar, not a constant, and the moment it is
// written down as a constant it is wrong on the day the calendar moves. Same
// law as the first-kickoff resolver: derive it from `matches`, every time.
//
// The RANKING is pure and the READS are not, and they are split for the reason
// alertSummary was split: a function that touches the database is not the unit
// you want to test ordering with. gatherSignals() reads; rankLeagues() sorts.

// TIERS. Gridiron outranks soccer, but only under the condition in
// tierPreferenceActive() below - a rule that always fired would be "gridiron
// first" with extra steps, and would be wrong every June.
export const TIER = Object.freeze({ GRIDIRON: 'gridiron', SOCCER: 'soccer' });

export const LEAGUES = Object.freeze([
  { id: 'cfb', label: 'CFB', slug: 'cfb', defaultOn: true, tier: TIER.GRIDIRON },
  { id: 'nfl', label: 'NFL', slug: 'nfl', defaultOn: true, tier: TIER.GRIDIRON },
  { id: 'epl', label: 'EPL', slug: 'epl', defaultOn: true, tier: TIER.SOCCER },
  // The archive is real content and stays reachable, but the tournament is
  // over: on by default it would put frozen July data above a live slate.
  { id: 'wc', label: 'World Cup', slug: 'fifa-wc-2026', defaultOn: false, archive: true,
    tier: TIER.SOCCER },
]);

export const LEAGUE_IDS = Object.freeze(LEAGUES.map((l) => l.id));
export const DEFAULT_TODAY_LEAGUES = Object.freeze(LEAGUES.filter((l) => l.defaultOn).map((l) => l.id));

export const isLeagueId = (id) => LEAGUE_IDS.includes(id);
export const leagueById = (id) => LEAGUES.find((l) => l.id === id) ?? null;

/** How many days ahead still counts as standing in the game week. */
export const GAME_WEEK_LEAD_DAYS = 7;

/**
 * Is this league IN ITS GAME WEEK?
 *
 * Two ways to qualify, and the second is load-bearing rather than a
 * convenience: the mock shows "Game week" on a Wednesday for a Saturday
 * kickoff, so standing in the game week includes the APPROACH, not only the
 * span. And the span clause is what CFB needs this season - week 1 runs Aug 29
 * to Sep 7, so a league can be mid-week with its next game days away and still
 * obviously be playing this week.
 *
 * Preseason never qualifies; gatherSignals excludes it before we get here.
 */
export function inGameWeek(signal) {
  if (!signal) return false;
  if (signal.playsToday || signal.inWeekSpan) return true;
  return signal.daysToNext != null && signal.daysToNext <= GAME_WEEK_LEAD_DAYS;
}

/**
 * The tier rule only applies when BOTH tiers have a league standing in its
 * game week. Clause 2 of the ruling, and the reason it exists: a dormant
 * gridiron must never outrank in-season soccer. In the deep offseason no NFL
 * or CFB league qualifies, the rule switches itself off, and EPL leads on
 * proximity like anything else.
 */
export function tierPreferenceActive(signals = []) {
  const live = signals.filter((s) => inGameWeek(s) && !leagueById(s.id)?.archive);
  const tiers = new Set(live.map((s) => leagueById(s.id)?.tier));
  return tiers.has(TIER.GRIDIRON) && tiers.has(TIER.SOCCER);
}

/**
 * ORDER THE BANDS.
 *
 * `signals` is one entry per league: { id, playsToday, daysToNext, inSeason }.
 * The ranking, in order of authority:
 *
 *   1. A LEAGUE PLAYING TODAY OUTRANKS EVERYTHING. This is the whole point -
 *      the Saturday CFB slate belongs above an NFL season that starts in a
 *      fortnight, and in September that reverses on its own.
 *   2. Then soonest next game. A league 2 days out is more use than one 13
 *      days out.
 *   3. Then in-season over out-of-season, so a league between weeks still
 *      outranks one whose season has not opened.
 *   4. Then the declared order in LEAGUES, purely so the result is STABLE.
 *      Array.prototype.sort is not guaranteed stable across engines for all
 *      inputs, and a band order that flickers between renders would look like
 *      a bug even when every band is correct.
 *
 * The archive never floats: it is pinned last regardless of signal, because
 * "the World Cup played today" is not a thing that can become true again.
 */
export function rankLeagues(signals = []) {
  const declared = new Map(LEAGUE_IDS.map((id, i) => [id, i]));
  const known = signals.filter((s) => isLeagueId(s?.id));
  const tiered = tierPreferenceActive(known);
  const tierRank = (s) => (leagueById(s.id)?.tier === TIER.GRIDIRON ? 0 : 1);

  return [...known].sort((a, b) => {
    // The archive never floats: "the World Cup played today" cannot become
    // true again.
    const aArc = leagueById(a.id)?.archive ? 1 : 0;
    const bArc = leagueById(b.id)?.archive ? 1 : 0;
    if (aArc !== bArc) return aArc - bArc;

    // A LEAGUE PLAYING TODAY OUTRANKS EVERYTHING, tier included. This sits
    // ABOVE the tier rule deliberately, and the two ruled cases are what fix
    // the order: on Aug 29 CFB and EPL are both playing and the NFL is eleven
    // days out, so it is cfb > epl > nfl - the tier rule does not get to lift a
    // dormant NFL over a league that is on right now. On Aug 26 nobody plays,
    // the tier rule applies to everyone, and it is cfb > nfl > epl.
    if (!!b.playsToday !== !!a.playsToday) return b.playsToday ? 1 : -1;

    // GRIDIRON ABOVE SOCCER, only while both tiers are in a game week.
    if (tiered) {
      const at = tierRank(a), bt = tierRank(b);
      if (at !== bt) return at - bt;
    }

    const ad = a.daysToNext == null ? Infinity : a.daysToNext;
    const bd = b.daysToNext == null ? Infinity : b.daysToNext;
    if (ad !== bd) return ad - bd;

    if (!!b.inSeason !== !!a.inSeason) return b.inSeason ? 1 : -1;

    // Stable last resort: sort is not guaranteed stable for all inputs, and a
    // band order that flickers between renders reads as a bug.
    return declared.get(a.id) - declared.get(b.id);
  }).map((s) => s.id);
}

/** Whole days from an ET day-string to a kickoff instant, floored at 0. */
export function daysBetween(etDay, kickoffAt) {
  if (!etDay || !kickoffAt) return null;
  const start = Date.parse(`${etDay}T00:00:00-05:00`);
  const k = new Date(kickoffAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(k)) return null;
  return Math.max(0, Math.floor((k - start) / 86400000));
}

/**
 * The band's context line - "First kickoff Sat 12:00p ET · Game week",
 * "13 days out". Derived, so it cannot claim a game week that is not one.
 */
export function contextLine({ playsToday, daysToNext }) {
  if (playsToday) return 'Game week · playing today';
  if (daysToNext == null) return 'No scheduled games';
  if (daysToNext === 0) return 'Playing today';
  if (daysToNext === 1) return 'Tomorrow';
  if (daysToNext <= 7) return `${daysToNext} days out · game week`;
  return `${daysToNext} days out`;
}
