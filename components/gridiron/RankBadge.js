// components/gridiron/RankBadge.js - the .rk badge from
// sportsvyn-ncaa-rankings-mock-v0_1.html. ONE component, three insertion
// points (scoreboard card, CFB game page, Pick'em row).
//
// AP ONLY. The Coaches Poll is display-only on the Rankings page and drives
// nothing here - a badge that silently mixed polls would put a number beside a
// team that the poll driving Pick'em never ranked.
//
// ABSENCE IS THE DEFAULT. An unranked team renders NOTHING - not a dash, not an
// empty span holding space. Returning null rather than an empty element also
// keeps the flex rows from gaining a zero-width child that shifts a baseline.
export default function RankBadge({ rank, size }) {
  if (rank == null) return null;
  return <span className={`rk${size === 'big' ? ' rk-big' : ''}`}>{rank}</span>;
}
