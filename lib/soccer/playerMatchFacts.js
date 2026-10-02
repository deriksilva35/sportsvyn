// lib/soccer/playerMatchFacts.js - what a player did that the per-player
// payload does not say, derived from the fixture's own events. PURE.
//
// API-Sports' /fixtures/players line carries minutes, goals, assists, cards,
// saves and penalty.{saved,missed} - but NOT own goals, NOT when a player came
// on or went off, and NOT what his team conceded while he was on the pitch
// (goals.conceded is the GOALKEEPER's and reads 0 for everyone else). EPL
// Weekly 5's clean sheet needs the last one, so it is derived here from the
// same fixture payload's events, walked IN ORDER:
//
//   subst  `player` is the man going OFF, `assist` the man coming ON
//          (measured on MW5, Everton-Ipswich 19 Sep: B. Johnson off at 66'
//          with 66 minutes played, T. Dibling on with 24). The walk does not
//          trust the convention blindly: if `player` is not on the pitch and
//          `assist` is, the two are swapped.
//   Goal   a goal that stands is conceded by the side it does NOT count for -
//          an own goal's `team` is the side it counts FOR (measured on
//          Martinez's own goal, 20 Sep, which carries Fulham) - so every
//          player on the pitch for the other side at that moment conceded it.
//          'Own Goal' also credits the scorer an own goal; 'Missed Penalty'
//          is not a goal, and shootout kicks are never goals.
//   Card   a red (or second yellow) takes the player off at that minute.
//
// ORDER, NOT MINUTE, decides a goal and a substitution in the same minute: the
// provider lists events chronologically, and two events at 70' are resolved by
// which came first.

const shootout = (e) => /penalty shootout/i.test(e?.comments ?? '');
const minuteOf = (e) => {
  const el = Number(e?.time?.elapsed);
  return Number.isFinite(el) ? el : null;
};

/**
 * @param fixture  one /fixtures?id= (or ids=) response entry: { teams, events,
 *                 lineups, players }
 * @returns Map(providerPlayerId:string -> { cameOn, cameOff, ownGoals,
 *          concededOnPitch, side }) for every player the payload names, or
 *          null when the fixture carries no events (nothing can be derived and
 *          the caller must store NULL, not zero).
 */
export function playerMatchFacts(fixture) {
  if (!fixture || !Array.isArray(fixture.events) || !fixture.events.length) return null;
  const homeId = fixture.teams?.home?.id ?? null;
  const awayId = fixture.teams?.away?.id ?? null;
  const sideOfTeam = (id) => (id === homeId ? 'home' : id === awayId ? 'away' : null);

  const facts = new Map();
  const fact = (id, side = null) => {
    const k = String(id);
    if (!facts.has(k)) facts.set(k, { cameOn: null, cameOff: null, ownGoals: 0, concededOnPitch: 0, side });
    const f = facts.get(k);
    if (side && !f.side) f.side = side;
    return f;
  };

  // THE STARTING ELEVENS: lineups first, the players payload as a fallback.
  const onPitch = { home: new Set(), away: new Set() };
  for (const l of fixture.lineups ?? []) {
    const side = sideOfTeam(l.team?.id);
    if (!side) continue;
    for (const s of l.startXI ?? []) {
      if (s?.player?.id == null) continue;
      onPitch[side].add(String(s.player.id));
      fact(s.player.id, side).cameOn = 0;
    }
  }
  for (const t of fixture.players ?? []) {
    const side = sideOfTeam(t.team?.id);
    if (!side) continue;
    for (const p of t.players ?? []) {
      if (p?.player?.id == null) continue;
      const f = fact(p.player.id, side);
      const g = p.statistics?.[0]?.games ?? {};
      if (onPitch[side].size < 11 && g.substitute === false && f.cameOn == null) {
        onPitch[side].add(String(p.player.id));
        f.cameOn = 0;
      }
    }
  }

  for (const e of fixture.events) {
    const side = sideOfTeam(e.team?.id);
    const minute = minuteOf(e);
    if (e.type === 'subst' && side) {
      let off = e.player?.id == null ? null : String(e.player.id);
      let on = e.assist?.id == null ? null : String(e.assist.id);
      if (off && on && !onPitch[side].has(off) && onPitch[side].has(on)) [off, on] = [on, off];
      if (off) { onPitch[side].delete(off); fact(off, side).cameOff = minute; }
      if (on) { onPitch[side].add(on); fact(on, side).cameOn = minute; }
      continue;
    }
    if (e.type === 'Card' && /red card|second yellow/i.test(e.detail ?? '') && side && e.player?.id != null) {
      const id = String(e.player.id);
      if (onPitch[side].delete(id)) fact(id, side).cameOff = minute;
      continue;
    }
    if (e.type === 'Goal' && !/missed/i.test(e.detail ?? '') && !shootout(e) && side) {
      const conceding = side === 'home' ? 'away' : 'home';
      for (const id of onPitch[conceding]) fact(id, conceding).concededOnPitch += 1;
      if (/own goal/i.test(e.detail ?? '') && e.player?.id != null) fact(e.player.id).ownGoals += 1;
    }
  }
  return facts;
}
