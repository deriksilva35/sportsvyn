// components/gridiron/DriveCard.js - the live drive card's field strip and its
// two lines (drive-2). A SERVER component: no state, no timer, no effect. The
// scoring moment is in the props (lib/gridiron/driveCard.js decides it from the
// server's `now`), so the same markup renders it on /scores and the game page
// and the 30 s refresh is what takes it away again.
//
// The geometry is the approved mock's, in its own SVG units; every colour is
// lib/brand/driveCardPalette.js or a team's stored colour, so there is no new
// literal in a component and no stylesheet change.

import { FIELD, inkOn } from '@/lib/gridiron/driveCard';
import { DRIVE_PALETTE as P } from '@/lib/brand/driveCardPalette';

const { width: W, zone: Z, top: T, height: H } = FIELD;
const BALL_R = 7;
const MONO = { fontFamily: "var(--tok-font-num, 'Rubik Mono One', sans-serif)" };
const SANS = { fontFamily: "var(--tok-font-display, 'Rubik', sans-serif)" };

function EndZone({ side, z }) {
  const x = side === 'left' ? 0 : W - Z;
  const tx = side === 'left' ? Z / 2 : W - Z / 2;
  const fill = z.flash ? P.ball : (z.color ?? P.zoneFallback);
  const ink = z.flash ? P.navy : inkOn(z.color, P.white, P.navy);
  return (
    <g data-zone={side} data-flash={z.flash ?? undefined}>
      {z.flash ? <rect x={x - 2} y={T - 4} width={Z + 4} height={H + 8} rx="7" fill={P.ball} opacity="0.35" /> : null}
      <rect x={x} y={T} width={Z} height={H} rx="6" fill={fill} />
      <text x={tx} y="26" fill={ink} fontSize={z.flash === 'SAFETY' ? 5 : z.flash ? 8 : 7} textAnchor="middle" style={MONO}>
        {z.flash ?? z.abbr}
      </text>
    </g>
  );
}

export default function DriveCard({ dc, lastPlay = null }) {
  if (!dc) return null;
  return (
    <div className="sv4-field" data-drive="1" data-dc={dc.mode} data-kind={dc.kind ?? undefined}>
      {/* THE LINES. The down line (or, for a score, the headline) and the drive
          line under it; wrapping, not shrinking, at 390px. */}
      <div className="sit" data-sit={dc.mode === 'flash' ? 'score' : 'down'} style={{ flexWrap: 'wrap', gap: '2px 10px', alignItems: 'baseline' }}>
        <span data-dc-line="1">{dc.line}</span>
        {dc.driveLine ? <span data-dc-drive="1" style={{ ...SANS, fontSize: 10, fontWeight: 500, opacity: 0.78 }}>{dc.driveLine}</span> : null}
      </div>
      <svg viewBox={`0 0 ${W} 60`} role="img" aria-label={dc.aria} data-dc-field="1"
        style={{ display: 'block', width: '100%', height: 'auto', maxWidth: '100%' }}>
        <rect x="0" y={T} width={W} height={H} rx="6" fill={P.field} />
        <EndZone side="left" z={dc.endZones.left} />
        <EndZone side="right" z={dc.endZones.right} />
        {dc.redZone ? <rect data-redzone="1" x={dc.redZone.x} y={T} width={dc.redZone.w} height={H} fill={P.redZone} opacity="0.2" /> : null}
        {dc.yardLines.map((x) => <line key={x} x1={x} y1={T} x2={x} y2={T + H} stroke={P.yardLine} strokeWidth="1" />)}
        {dc.band ? <rect data-band="1" x={dc.band.x} y="16" width={dc.band.w} height="14" fill={P.ball} opacity="0.28" /> : null}
        {dc.startX != null ? <line data-start="1" x1={dc.startX} y1="12" x2={dc.startX} y2="34" stroke={P.ball} strokeWidth="1" strokeDasharray="2 2" opacity="0.7" /> : null}
        {/* THE BALL SITS UNDER THE LINES (drive-4): at the goal line the dot is centred on the
            line of scrimmage, and drawn last it hid the very line it marks. The dot is
            kept inside the field of play (one radius in from each goal line), and the first-down line and the LOS are drawn over it. */}
        {dc.ballX != null ? <circle data-ball="1" cx={Math.max(Z + BALL_R, Math.min(W - Z - BALL_R, dc.ballX))} cy="23" r={BALL_R} fill={P.ball} stroke={P.ballRing} strokeWidth="2" /> : null}
        {dc.firstDownX != null ? <line data-firstdown="1" x1={dc.firstDownX} y1={T} x2={dc.firstDownX} y2={T + H} stroke={P.firstDown} strokeWidth="2.5" /> : null}
        {dc.losX != null ? <line data-los="1" x1={dc.losX} y1={T} x2={dc.losX} y2={T + H} stroke={P.los} strokeWidth="2" /> : null}
        {dc.yardLabels.map((l, i) => <text key={i} x={l.x} y="54" fill={P.yardLabel} fontSize="8" textAnchor="middle" style={SANS}>{l.text}</text>)}
      </svg>
      {lastPlay ? <p className="lp" title={lastPlay}>{lastPlay}</p> : null}
    </div>
  );
}
