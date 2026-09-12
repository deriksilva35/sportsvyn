// components/team/TeamMark.js — one team mark at any size (GAMES TAB v2, item 6).
//
// Below 28 CSS px a helmet's decal and facemask are noise; the mark becomes a
// two-tone split circle: primary fill, secondary across the bottom 42%, a
// --line ring at 3/100 of the size. At 28 and up it IS the Helmet - wrapped,
// not re-drawn, so Helmet.js stays the one helmet. The Tonight strip on the
// lobby is the first user (24 px); nothing else switches in this relay.

import Helmet from '@/components/team/Helmet';

export const TEAMMARK_HELMET_MIN = 28;

export default function TeamMark({ primary, secondary, size = 24, className, title, abbr = null }) {
  // NO COLORS (EPL, SCORES TAB v2 Part A 2): an ink-3 disc with the
  // abbreviation, the same --line ring. Never a grey helmet, never nothing.
  if (!primary || !secondary) {
    const s = Number(size);
    const ring = Math.max(1, (s * 3) / 100);
    return (
      <span
        className={className ? `teammark teammark--abbr ${className}` : 'teammark teammark--abbr'}
        data-teammark="abbr" role="img" aria-label={title ?? abbr ?? undefined}
        style={{ width: s, height: s, borderRadius: 99, background: 'var(--ink-3, #1C1C1C)', border: `${ring}px solid var(--line, #2A2A2A)`,
          display: 'inline-grid', placeItems: 'center', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: Math.max(7, Math.round(s * 0.34)), color: 'var(--muted, #9A9A94)', lineHeight: 1, flex: '0 0 auto' }}
      >
        {(abbr ?? '').slice(0, 3)}
      </span>
    );
  }
  if (size >= TEAMMARK_HELMET_MIN) {
    return <Helmet primary={primary} secondary={secondary} size={size} className={className} title={title} />;
  }
  const s = Number(size);
  const ring = Math.max(1, (s * 3) / 100);
  const r = s / 2;
  // The secondary band: the bottom 42% of the disc, clipped to the circle.
  const bandTop = s * (1 - 0.42);
  const id = `tm-${s}-${String(primary).replace(/[^a-z0-9]/gi, '')}-${String(secondary).replace(/[^a-z0-9]/gi, '')}`;
  return (
    <svg
      className={className ? `teammark ${className}` : 'teammark'}
      width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={title ?? undefined}
      data-teammark="circle"
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <clipPath id={id}><circle cx={r} cy={r} r={r - ring / 2} /></clipPath>
      </defs>
      <circle cx={r} cy={r} r={r - ring / 2} fill={primary} />
      <rect x={0} y={bandTop} width={s} height={s - bandTop} fill={secondary} clipPath={`url(#${id})`} />
      <circle cx={r} cy={r} r={r - ring / 2} fill="none" stroke="var(--line, #2A2A2A)" strokeWidth={ring} />
    </svg>
  );
}
