// lib/games/confirmRules.js - WHEN AN ENTRY MAY STILL CONFIRM (rolling lock).
// A Pick'em entry confirms while any row on its board is still unkicked
// (now < the board's last kickoff); the Weekly and the Draft confirm until
// the contest's locks_at - for the Weekly that is the join-window close, for
// the Draft still the room lock. Pure: the server action feeds it the row.
export function lastKickoffOf(board) {
  return (Array.isArray(board) ? board : []).reduce((max, g) => (
    g?.kickoff_at && (!max || new Date(g.kickoff_at) > new Date(max)) ? g.kickoff_at : max), null);
}

export function confirmVerdict(gameType, contest, now = new Date()) {
  if (!contest) return { ok: false, reason: 'no such contest' };
  if (contest.settled) return { ok: false, reason: 'settled' };
  const closeAt = gameType === 'pickem' ? (lastKickoffOf(contest.board) ?? contest.locks_at) : contest.locks_at;
  const t = new Date(closeAt ?? NaN).getTime();
  if (!Number.isFinite(t) || t <= new Date(now).getTime()) return { ok: false, reason: 'locked', closeAt: closeAt ?? null };
  return { ok: true, closeAt };
}
