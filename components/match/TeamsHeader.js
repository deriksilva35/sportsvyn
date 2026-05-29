/**
 * TeamsHeader — the always-visible teams bar above the tab bar.
 * Renders home (favored on the left when applicable) vs away.
 *
 * "favored" coloring is intentionally NOT derived in the shell — until a
 * Win Probability or odds data source exists for this match, neither team
 * gets the .favored class. The CSS supports it; the data feed does not yet.
 */

function FlagSlot({ abbreviation, colorPrimary, size = 'lg' }) {
  const known = new Set(['USA', 'SEN']);
  const cls = `flag flag-${size}`;
  if (abbreviation && known.has(abbreviation.toUpperCase())) {
    return <span className={`${cls} flag-${abbreviation.toLowerCase()}`} />;
  }
  return (
    <span
      className={cls}
      style={colorPrimary ? { background: colorPrimary } : undefined}
      aria-hidden="true"
    />
  );
}

export default function TeamsHeader({ match }) {
  return (
    <div className="teams-header">
      <div className="teams-header-team">
        <FlagSlot
          abbreviation={match.home_abbreviation}
          colorPrimary={match.home_flag_color}
        />
        <div className="teams-header-team-name">{match.home_name ?? 'Home'}</div>
      </div>
      <div className="teams-header-vs">vs</div>
      <div className="teams-header-team away">
        <div className="teams-header-team-name">{match.away_name ?? 'Away'}</div>
        <FlagSlot
          abbreviation={match.away_abbreviation}
          colorPrimary={match.away_flag_color}
        />
      </div>
    </div>
  );
}
