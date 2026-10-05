// lib/playoffs/seriesLine.js - THE SERIES LINE under a postseason card's
// time/network row (mon-17). PURE: rows in, one string out. Shared by MLB now
// and NBA/NFL later - a sport hands over its round label and best-of; a
// single-game round (NFL) passes bestOf 1 and gets the round alone.
//
//   "ALDS · Game 3 · NYY leads 2-0 · best of 5"
//   "ALDS · Game 2 · Series tied 1-1"           (tied after a game)
//   "ALDS · Game 4 · NYY can clinch"
//   "ALDS · Game 5 · winner advances"           (both one win away)
//   "ALDS · NYY wins series 3-1"                (the clinching final)
//   "ALDS · Game 1 · best of 5"                 (no record yet)
//   "Divisional Round"                          (single game)
//
// THE RECORD IS BEFORE THIS GAME: finals between the same two clubs in the
// same round, kicked off earlier. The one exception is this game's own final
// when it clinched - then it counts, and the line says who won the series.
// Cancelled and not-needed games are not games of the series.

const SKIP = new Set(['cancelled', 'canceled', 'not_needed', 'postponed']);

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const t = (g) => new Date(g.kickoffAt).getTime();

/** Winner abbreviation of a final, or null (no score, or a tie). */
function winnerOf(g) {
  if (g.status !== 'final') return null;
  const h = num(g.homeScore); const a = num(g.awayScore);
  if (h == null || a == null || h === a) return null;
  return h > a ? g.homeAbbr : g.awayAbbr;
}

/**
 * @param game    { id, kickoffAt, status, homeAbbr, awayAbbr, homeScore, awayScore }
 * @param series  every game of this pairing in this round (may include `game`)
 * @param round   the round's display label ("ALDS", "Divisional Round")
 * @param bestOf  games in the round; 1 (or null) means a single game
 */
export function seriesLine({ game, series = [], round, bestOf = 1 } = {}) {
  if (!round) return null;
  const k = Number(bestOf);
  if (!game || !Number.isFinite(k) || k <= 1) return round;
  const need = Math.floor(k / 2) + 1;
  const home = game.homeAbbr; const away = game.awayAbbr;
  if (!home || !away) return null;

  const others = series
    .filter((g) => g && g.id !== game.id && !SKIP.has(g.status))
    .filter((g) => t(g) < t(game) || (t(g) === t(game) && Number(g.id) < Number(game.id)));
  const wins = { [home]: 0, [away]: 0 };
  for (const g of others) {
    const w = winnerOf(g);
    if (w && w in wins) wins[w] += 1;
  }
  const n = others.length + 1;

  // THE CLINCHING FINAL: this game took a club to `need`.
  const w = winnerOf(game);
  if (w && w in wins && wins[w] + 1 >= need) {
    const loser = w === home ? away : home;
    return `${round} · ${w} wins series ${wins[w] + 1}-${wins[loser]}`;
  }

  const a = wins[home]; const b = wins[away];
  if (a + b === 0) return `${round} · Game ${n} · best of ${k}`;
  if (a === need - 1 && b === need - 1) return `${round} · Game ${n} · winner advances`;
  const leader = a > b ? home : b > a ? away : null;
  if (leader && wins[leader] === need - 1) return `${round} · Game ${n} · ${leader} can clinch`;
  if (!leader) return `${round} · Game ${n} · Series tied ${a}-${b}`;
  const hi = Math.max(a, b); const lo = Math.min(a, b);
  return `${round} · Game ${n} · ${leader} leads ${hi}-${lo} · best of ${k}`;
}
