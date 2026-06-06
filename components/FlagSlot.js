/**
 * FlagSlot — shared <img>-against-flag_svg_path renderer with an empty
 * rule-bordered rectangle fallback when no flag URL is on file.
 *
 * Originally lived inline in components/match/TeamsHeader. Lifted here
 * so /schedule (and any future surface) renders flags identically.
 * Sizes via CSS classes (.flag-sm / .flag-md / .flag-lg) keep visual
 * consistency across pages — each consumer's CSS owns the box.
 *
 * Honest gap: when flagSvgPath is null, we render a colored tile if a
 * colorPrimary is supplied, otherwise the empty bordered rectangle.
 * The latter is the "we don't know" state — never a wrong flag.
 */
export default function FlagSlot({ flagSvgPath, colorPrimary, size = 'md', className = '' }) {
  const cls = `flag flag-${size}${className ? ' ' + className : ''}`;
  if (flagSvgPath) {
    return (
      <span className={cls} aria-hidden="true">
        <img
          src={flagSvgPath}
          alt=""
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </span>
    );
  }
  return (
    <span
      className={cls}
      style={colorPrimary ? { background: colorPrimary } : undefined}
      aria-hidden="true"
    />
  );
}
