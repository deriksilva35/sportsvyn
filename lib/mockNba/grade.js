// lib/mockNba/grade.js - the NBA mock's team grade and its steal (sun-5, sun-7). PURE.
//
// TEAM VALUE = projected season points: the starters' SVP season value plus half
// the bench's (a bench player is insurance, not a starter). The grade is the
// user's RANK among the teams by that number, scaled to the field (12 teams or 8
// or 14 alike) - mon-1. THE STEAL is the user's pick
// taken furthest after his SVP rank said he should go.

const LADDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'D'];

export function teamValue(roster) {
  return Math.round(roster.reduce((a, r) => a + (r.player?.sv ?? 0) * (r.slot === 'BN' ? 0.5 : 1), 0));
}

/** Place (1..teams) -> a letter, the field scaled onto the ladder. */
export function gradeFor(place, teams) {
  if (teams <= 1) return 'A';
  const i = Math.round(((place - 1) / (teams - 1)) * (LADDER.length - 1));
  return LADDER[Math.max(0, Math.min(LADDER.length - 1, i))];
}

export function gradeMock(st) {
  const values = st.rosters.map((r, seat) => ({ seat, v: teamValue(r) })).sort((a, b) => b.v - a.v || a.seat - b.seat);
  const place = values.findIndex((x) => x.seat === st.userSeat) + 1;
  const mine = st.picks.filter((p) => p.seat === st.userSeat).map((p) => ({ ...p, player: st.pool.find((x) => x.id === p.id) }));
  const steal = mine.map((p) => ({ ...p, gap: p.n - (p.player?.svp ?? p.n) })).sort((a, b) => b.gap - a.gap)[0] ?? null;
  return {
    grade: gradeFor(place, st.teams),
    place,
    value: teamValue(st.rosters[st.userSeat]),
    steal: steal && steal.gap > 0 ? { name: steal.player.name, svp: steal.player.svp, n: steal.n, gap: steal.gap } : null,
  };
}
