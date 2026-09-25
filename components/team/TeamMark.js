// components/team/TeamMark.js — one team mark at any size (GAMES TAB v2, item 6).
//
// THREE DRAWINGS, ONE BOX. Every one of them is `size` square, so a surface
// that swaps one for another does not move:
//   - HEADGEAR, when headgearFor(leagueSlug, abbr) has a cutout
//     (lib/teams/headgear.js). The helmet or cap, facing right.
//   - the two-tone split circle otherwise: primary fill, secondary across the
//     bottom 42%, a --line ring at 3/100 of the size.
//   - an ink-3 disc with the abbreviation when there are no colours.
//
// NO LEAGUE, NO HEADGEAR. The league is never inferred from the abbreviation -
// ATL is two teams - so a caller that does not pass leagueSlug gets the disc.
//
// `headgear={false}` is how a PAIR says both-or-neither (pairHasHeadgear):
// when one side of a game has no cutout, neither side draws one.
//
// `facing="left"` mirrors the cutout (scaleX(-1)). Only a facing pair asks for
// it - the Pick'em board's home side. Everything else faces right. The disc is
// symmetric and ignores it.
//
// The cartoon SVG helmet this used to become at 28 px and up is gone;
// headgear replaced it (HEADGEAR-WEB).

import { headgearFor } from '@/lib/teams/headgear';

export default function TeamMark({
  primary, secondary, size = 24, className, title, abbr = null,
  leagueSlug = null, headgear = true, facing = 'right',
}) {
  const hg = headgear ? headgearFor(leagueSlug, abbr) : null;
  // LAZY, deliberately: React 19 hoists a <link rel=preload> into <head> for
  // every eager <img>, and a Scores board is sixty of them.
  if (hg) {
    const s = Number(size);
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a fixed 96/192 px pair from public/, drawn at a known size; next/image's loader adds nothing here
      <img
        className={className ? `teammark teammark--headgear ${className}` : 'teammark teammark--headgear'}
        data-teammark="headgear" data-facing={facing}
        src={hg.src1x} srcSet={`${hg.src1x} 1x, ${hg.src2x} 2x`}
        width={s} height={s} alt={title ?? abbr ?? ''} loading="lazy" decoding="async"
        style={{ width: s, height: s, objectFit: 'contain', flex: '0 0 auto', display: 'inline-block',
          transform: facing === 'left' ? 'scaleX(-1)' : undefined }}
      />
    );
  }
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
