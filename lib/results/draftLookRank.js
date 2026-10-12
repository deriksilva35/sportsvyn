// Competition places as ordinals ("1st", "1st", "3rd"): equal scores share the
// higher place; a tie lists in seat order. PURE.
const ord = (n) => {
  const t = n % 100;
  if (t >= 11 && t <= 13) return `${n}th`;
  return `${n}${n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
};
export function competitionRankOrdinal(rows) {
  const sorted = [...rows].sort((a, b) => (b.score - a.score) || (a.key - b.key));
  let lastScore = null; let lastPlace = 0;
  return sorted.map((r, i) => {
    const place = r.score === lastScore ? lastPlace : i + 1;
    lastScore = r.score; lastPlace = place;
    return { ...r, place: ord(place) };
  });
}
