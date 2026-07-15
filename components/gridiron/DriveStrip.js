// components/gridiron/DriveStrip.js — the named live-football Drive Strip
// (docs/design/gridiron-ui-reference.md). Pure SVG from props; no data deps.
// Renders ONLY on live football cards (never soccer, never pre/final) — there
// are no live rows yet, so it currently ships behind a hidden demo state in the
// Scoreboard, ready for the poller session.
//
// Field geometry: playing field x=20..220 (200 units = 100 yards, 2 units/yd),
// end zones x0..20 and x220..240. Drive points RIGHT toward the x=220 end zone,
// so a point at `ytEndzone` yards from that end zone sits at x = 220 - ytEndzone*2.

export default function DriveStrip({
  yardsToEndzone = 34,      // ball spot, yards to the attacking end zone
  distance = 6,             // yards to go for a first down
  driveStartYTE = 75,       // where the drive began (yards to end zone)
  possessionAbbr = 'TEAM',
  down = 2,
  opponentSide = 'OPP 34',  // human field-position label
}) {
  const xOf = (yte) => 220 - yte * 2;
  const ballX = xOf(yardsToEndzone);
  const startX = xOf(driveStartYTE);
  const firstDownX = xOf(Math.max(0, yardsToEndzone - distance));
  const trailX = Math.min(startX, ballX);
  const trailW = Math.abs(ballX - startX);
  const ord = down === 1 ? '1st' : down === 2 ? '2nd' : down === 3 ? '3rd' : `${down}th`;
  const firstDownYard = Math.max(0, yardsToEndzone - distance);

  return (
    <div className="gi-drive">
      <svg viewBox="0 0 240 46" role="img" aria-label={`${possessionAbbr} drive, ${ord} and ${distance}`}>
        {/* field + end zones */}
        <rect x="0" y="6" width="240" height="34" fill="var(--graphite)" />
        <rect x="0" y="6" width="20" height="34" fill="var(--graphite-up)" />
        <rect x="220" y="6" width="20" height="34" fill="var(--graphite-up)" />
        {/* yard lines every 20 units (10 yards) */}
        {[40, 60, 80, 100, 120, 140, 160, 180, 200].map((x) => (
          <line key={x} x1={x} y1="6" x2={x} y2="40" stroke={x === 120 ? '#3A3A3A' : 'var(--rule)'} strokeWidth="1" />
        ))}
        <text x="120" y="30" textAnchor="middle" fontSize="7" fill="var(--muted-dim)" fontFamily="var(--font-jetbrains-mono), monospace">50</text>
        {/* drive-so-far trail */}
        <rect x={trailX} y="21" width={trailW} height="4" fill="var(--volt)" opacity="0.18" />
        {/* first-down line */}
        <line x1={firstDownX} y1="6" x2={firstDownX} y2="40" stroke="var(--paper)" strokeWidth="1.5" strokeDasharray="3 2" />
        {/* ball marker (volt diamond) + arrow */}
        <path d={`M ${ballX} 16 L ${ballX + 5} 23 L ${ballX} 30 L ${ballX - 5} 23 Z`} fill="var(--volt)" />
        <path d={`M ${ballX + 6} 23 l 6 0 m -3 -3 l 3 3 l -3 3`} stroke="var(--volt)" strokeWidth="1.5" fill="none" />
      </svg>
      <div className="gi-drive-cap">
        <b>◆ {possessionAbbr} · {ord} &amp; {distance}</b> · {opponentSide} · <span className="fd">first down at the {firstDownYard}</span>
      </div>
    </div>
  );
}
