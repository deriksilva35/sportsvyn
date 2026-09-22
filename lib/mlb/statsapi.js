// lib/mlb/statsapi.js - the second provider, and the ONLY source for runners
// on base and for a probable pitcher. Behind MLB_STATSAPI=on.
//
// WHY A SECOND PROVIDER AT ALL. balldontlie gives us everything else - the
// slate, the runs, the line score, the scoring plays, and (via /plays) the
// outs, the count, the batter and the pitcher. It does NOT give us who is on
// base: the union of keys across 100 plays has no runner or base field of any
// kind, and it does not give a probable starter anywhere - no route, nothing on
// a scheduled game, nothing in /odds. Both were probed, not assumed.
//
// statsapi.mlb.com IS KEYLESS AND UNDOCUMENTED-AS-TO-TERMS, which is exactly
// why it sits behind a flag and why every reader treats what it returns as
// optional. If it goes away, or is turned off, the card loses a diamond and a
// probables line and loses nothing else. That is the whole design: this is an
// ENRICHMENT, never a dependency.
//
// THE OFFENSE OBJECT IS THE SUBTLE PART. linescore.offense carries `first`,
// `second` and `third` ONLY WHEN THOSE BASES ARE OCCUPIED - an empty base is an
// absent key, not a false. So "nobody on" and "we have no idea" look identical
// in the raw payload, and the difference matters: one draws an empty diamond,
// the other draws no diamond at all. basesOf() below returns an object when it
// HAS the offense object and null when it does not, so a caller can always
// tell those two apart.

const BASE = 'https://statsapi.mlb.com/api';

/** The flag. Off unless explicitly on - a missing env var is off. */
export function statsApiEnabled(env = process.env) {
  return String(env?.MLB_STATSAPI ?? '').trim().toLowerCase() === 'on';
}

async function getJson(path, { timeoutMs = 4000 } = {}) {
  // A TIMEOUT, BECAUSE THIS IS AN ENRICHMENT ON A 30-SECOND POLL. A provider
  // that hangs must not hold up the scores that do not depend on it.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;              // never throws: the caller carries on without it
  } finally {
    clearTimeout(t);
  }
}

/**
 * PURE. linescore.offense -> which bases are occupied.
 *
 * @returns { first, second, third } booleans, or NULL when there is no offense
 *   object to read. Null means "unknown"; an object with three falses means
 *   "known, and nobody is on". A caller that cannot tell those apart draws an
 *   empty diamond on a game it knows nothing about.
 */
export function basesOf(offense) {
  if (!offense || typeof offense !== 'object') return null;
  const on = (v) => Boolean(v && typeof v === 'object' && v.id != null);
  return { first: on(offense.first), second: on(offense.second), third: on(offense.third) };
}

/** PURE. The live half-inning state, in OUR vocabulary. */
export function liveFrom(feed) {
  const ls = feed?.liveData?.linescore ?? null;
  if (!ls) return null;
  const num = (v) => (v == null ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
  const inning = num(ls.currentInning);
  if (inning == null) return null;
  // inningState IS THE FOUR-VALUE FIELD - "Top", "Bottom", "Middle", "End" -
  // and it is preferred over inningHalf, which only ever says Top or Bottom
  // and so cannot express the two between-halves states. Normalised to the
  // same four words lib/live/vocabulary.js already understands.
  const raw = String(ls.inningState ?? ls.inningHalf ?? '').trim().toLowerCase();
  const half = raw.startsWith('top') ? 'Top'
    : raw.startsWith('bot') ? 'Bottom'
      : raw.startsWith('mid') ? 'Mid'
        : raw.startsWith('end') ? 'End' : null;
  const name = (p) => (p && typeof p === 'object' && p.fullName ? String(p.fullName) : null);
  return {
    period: inning,
    half,
    outs: num(ls.outs),
    balls: num(ls.balls),
    strikes: num(ls.strikes),
    // bases is the ONLY optional-by-design field on this object.
    bases: basesOf(ls.offense),
    batter: name(ls.offense?.batter),
    pitcher: name(ls.defense?.pitcher),
  };
}

/** PURE. A schedule game -> the two probable starters, or null. */
export function probablesFrom(game) {
  const one = (side) => {
    const p = game?.teams?.[side]?.probablePitcher ?? null;
    if (!p?.id || !p?.fullName) return null;
    return { id: String(p.id), name: String(p.fullName) };
  };
  const away = one('away'); const home = one('home');
  if (!away && !home) return null;
  return { away, home };
}

/** One live game's state. NULL when the flag is off, always, before any fetch. */
export async function fetchLiveState(gamePk, { env = process.env } = {}) {
  if (!statsApiEnabled(env) || gamePk == null) return null;
  const feed = await getJson(`/v1.1/game/${encodeURIComponent(gamePk)}/feed/live`);
  return feed ? liveFrom(feed) : null;
}

/**
 * One day's probables, as Map(gamePk -> {away, home}).
 * hydrate=probablePitcher IS REQUIRED - without it the schedule returns the
 * games with no probablePitcher key at all, which is indistinguishable from
 * "not announced yet". Probed both ways.
 */
export async function fetchProbables(dateIso, { env = process.env } = {}) {
  if (!statsApiEnabled(env)) return new Map();
  const j = await getJson(`/v1/schedule?sportId=1&date=${encodeURIComponent(dateIso)}&hydrate=probablePitcher`);
  const out = new Map();
  for (const d of j?.dates ?? []) {
    for (const g of d?.games ?? []) {
      const p = probablesFrom(g);
      if (p && g.gamePk != null) out.set(String(g.gamePk), p);
    }
  }
  return out;
}

/**
 * MATCHING statsapi's gamePk TO OUR ROW is the open problem and it is NOT
 * solved by the date: statsapi returned 16 games for 2026-09-22 where BDL
 * returned 11, because the two disagree about which day a 01:45Z first pitch
 * belongs to. The join is the two abbreviations plus the official date, and it
 * is done by the caller that holds our rows - this module deliberately does not
 * guess, and returns what it fetched keyed by gamePk.
 */
export function matchKey(awayAbbr, homeAbbr, officialDate) {
  if (!awayAbbr || !homeAbbr || !officialDate) return null;
  return `${String(officialDate).slice(0, 10)}:${String(awayAbbr).toUpperCase()}@${String(homeAbbr).toUpperCase()}`;
}

/**
 * One day's schedule keyed the way a caller holding OUR rows can find it:
 * Map(matchKey -> [{ gamePk, gameNumber, gameDate, probables }]). A LIST, not
 * a value, and that is the whole point of this function.
 *
 * (DATE, AWAY, HOME) IS NOT UNIQUE AND THE PROBE PROVED IT. 2026-09-22 returns
 * TWO TB @ NYY games on the same officialDate - a doubleheader - with gamePk
 * 823543 and 823494 and DIFFERENT starters (Martinez/Rodón and
 * Rasmussen/Fried). A Map(key -> value) would have silently kept one of them
 * and put the wrong pitcher and the wrong runners on both cards. The caller
 * gets the list and disambiguates with pickByKickoff() below, or refuses.
 *
 * hydrate=probablePitcher,team - BOTH. probablePitcher alone returns no
 * abbreviation and the key cannot be built; team alone returns no starter.
 */
/**
 * THE THREE CLUBS THE TWO PROVIDERS SPELL DIFFERENTLY. Measured, not guessed:
 * the 2026-09-22 schedule's 30 abbreviations against ours on PROD.
 *
 *   ours   statsapi
 *   ARI    AZ
 *   CHW    CWS
 *   OAK    ATH
 *
 * Every other club agrees. This cost exactly three of sixteen games their
 * probables on the first dry run - CHW @ KC, ARI @ COL and LAA @ OAK came back
 * "no statsapi probables" and looked like games with no starter announced,
 * which is a real state and therefore an invisible failure.
 *
 * THE MAP IS statsapi -> OURS, because ours is what the key is built from
 * everywhere else. It is a THREE-ENTRY EXCEPTION LIST, not a normaliser: a
 * fourth disagreement must show up as a miss and be measured, not silently
 * absorbed by a rule that strips vowels.
 */
export const STATSAPI_ABBR = Object.freeze({ AZ: 'ARI', CWS: 'CHW', ATH: 'OAK' });

export function ourAbbr(a) {
  const up = String(a ?? '').trim().toUpperCase();
  if (!up) return null;
  return STATSAPI_ABBR[up] ?? up;
}

export async function fetchScheduleByMatch(dateIso, { env = process.env } = {}) {
  const out = new Map();
  if (!statsApiEnabled(env)) return out;
  const j = await getJson(`/v1/schedule?sportId=1&date=${encodeURIComponent(dateIso)}&hydrate=probablePitcher,team`);
  for (const d of j?.dates ?? []) {
    for (const g of d?.games ?? []) {
      const key = matchKey(ourAbbr(g?.teams?.away?.team?.abbreviation),
        ourAbbr(g?.teams?.home?.team?.abbreviation), g?.officialDate ?? d?.date);
      if (!key || g?.gamePk == null) continue;
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({
        gamePk: String(g.gamePk),
        gameNumber: g.gameNumber == null ? null : Number(g.gameNumber),
        // ALREADY UTC 'Z' on this feed - see the header. It still does not get
        // a raw new Date() here: this module hands the string on and the one
        // comparison that needs a number does it in pickByKickoff.
        gameDate: g.gameDate ?? null,
        probables: probablesFrom(g),
      });
    }
  }
  return out;
}

/** The probables alone, for the schedule importer's --probables pass. */
export async function fetchProbablesByMatch(dateIso, opts) {
  const sched = await fetchScheduleByMatch(dateIso, opts);
  const out = new Map();
  for (const [key, list] of sched) {
    const withP = list.filter((g) => g.probables);
    if (withP.length) out.set(key, withP);
  }
  return out;
}

/**
 * WHICH HALF OF THE DOUBLEHEADER IS OUR ROW. Returns the one candidate, or
 * NULL - and null is a real answer that the callers print rather than paper
 * over.
 *
 * ONE CANDIDATE IS THE ANSWER WITHOUT A CLOCK. Most keys have exactly one game
 * and asking the time of it would only invent a way to fail.
 *
 * WITH SEVERAL, THE FIRST PITCH DECIDES, and only if it decides clearly. Our
 * kickoff_at and statsapi's gameDate are the same event from two providers, so
 * they agree to within minutes; the two halves of a doubleheader are hours
 * apart. The nearest candidate wins IF it is inside `toleranceMin` AND the
 * runner-up is at least `marginMin` further away. A pair we cannot separate by
 * an hour is a pair we do not understand, and guessing there puts one game's
 * runners on the other game's diamond.
 */
export function pickByKickoff(candidates, kickoffIso, { toleranceMin = 180, marginMin = 60 } = {}) {
  const list = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const t = kickoffIso == null ? NaN : Date.parse(kickoffIso);
  if (!Number.isFinite(t)) return null;
  const scored = list
    .map((g) => ({ g, d: Math.abs(Date.parse(g.gameDate ?? '') - t) }))
    .filter((x) => Number.isFinite(x.d))
    .sort((a, b) => a.d - b.d);
  if (!scored.length) return null;
  if (scored[0].d > toleranceMin * 60_000) return null;
  if (scored.length > 1 && scored[1].d - scored[0].d < marginMin * 60_000) return null;
  return scored[0].g;
}
