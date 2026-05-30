/**
 * TeamsHeader — the always-visible teams bar above the tab bar.
 * Renders home (favored on the left when applicable) vs away.
 *
 * "favored" coloring is intentionally NOT derived in the shell — until a
 * Win Probability or odds data source exists for this match, neither team
 * gets the .favored class. The CSS supports it; the data feed does not yet.
 */

// Flag rendering: reads teams.flag_svg_path (populated by formSync /
// backfill-flags from lib/flags.js's code→ISO map → flagcdn SVG URL).
// Falls back to an empty bordered rectangle if no flag URL is on file
// (sparse-data fixture or an unmapped country code).
function FlagSlot({ flagSvgPath, colorPrimary, size = 'lg' }) {
  const cls = `flag flag-${size}`;
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

// favoredSide: 'home' | 'away' | null. Derived from win probability — null
// when no odds exist so we never guess a favorite without market data.
// The .teams-header-team.favored rule in match.css flips that side's team
// name from paper-warm to volt — subtle, no additional badge or weight.
export default function TeamsHeader({ match, favoredSide = null }) {
  const homeClass = `teams-header-team${favoredSide === 'home' ? ' favored' : ''}`;
  const awayClass = `teams-header-team away${favoredSide === 'away' ? ' favored' : ''}`;
  return (
    <div className="teams-header">
      <div className={homeClass}>
        <FlagSlot
          flagSvgPath={match.home_flag_svg}
          colorPrimary={match.home_flag_color}
        />
        <div className="teams-header-team-name">{match.home_name ?? 'Home'}</div>
      </div>
      <div className="teams-header-vs">vs</div>
      <div className={awayClass}>
        <div className="teams-header-team-name">{match.away_name ?? 'Away'}</div>
        <FlagSlot
          flagSvgPath={match.away_flag_svg}
          colorPrimary={match.away_flag_color}
        />
      </div>
    </div>
  );
}
