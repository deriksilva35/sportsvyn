// lib/mockNba/grade.js - the NBA mock's team grade and its steal (sun-5). PURE.
//
// TEAM VALUE = the starting nine's SV plus half the bench's (a bench player is
// insurance, not a starter). The grade is the user's place among the 12 teams.
// THE STEAL is the user's pick taken furthest after his SV rank said he should go.

const GRADES = ['A+', 'A', 'A-', 'B+', 'B+', 'B', 'B', 'C+', 'C+', 'C', 'C', 'D'];

export function teamValue(roster) {
  return Math.round(roster.reduce((a, r) => a + (r.player?.sv ?? 0) * (r.slot === 'BN' ? 0.5 : 1), 0));
}

export function gradeMock(st) {
  const values = st.rosters.map((r, seat) => ({ seat, v: teamValue(r) })).sort((a, b) => b.v - a.v || a.seat - b.seat);
  const place = values.findIndex((x) => x.seat === st.userSeat) + 1;
  const mine = st.picks.filter((p) => p.seat === st.userSeat).map((p) => ({ ...p, player: st.pool.find((x) => x.id === p.id) }));
  const steal = [...mine].map((p) => ({ ...p, gap: p.n - (p.player?.rank ?? p.n) }))
    .sort((a, b) => b.gap - a.gap)[0] ?? null;
  return {
    grade: GRADES[place - 1] ?? 'C',
    place,
    value: teamValue(st.rosters[st.userSeat]),
    steal: steal && steal.gap > 0 ? { name: steal.player.name, rank: steal.player.rank, n: steal.n, gap: steal.gap } : null,
  };
}
