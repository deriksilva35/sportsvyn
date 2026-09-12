/**
 * TeamsHeader — the always-visible teams bar above the tab bar.
 * Renders the two sides in the LEAGUE's order (lib/gridiron/teamOrder.js) -
 * soccer reads home-first across a "v" - with the favored side coloured.
 *
 * "favored" coloring is intentionally NOT derived in the shell — until a
 * Win Probability or odds data source exists for this match, neither team
 * gets the .favored class. The CSS supports it; the data feed does not yet.
 */

import { orderFor, connectorFor } from '@/lib/gridiron/teamOrder';

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
  // WHO LEADS AND THE WORD BETWEEN THEM ARE THE LEAGUE'S, not this header's
  // (TEAM ORDER relay). Soccer reads home-first across a "v", which is what
  // this header always did by hand; now it asks the one rule, so a header on
  // a gridiron slug would flip and say "at" without anybody editing it.
  const [first, second] = orderFor(match.league_slug);
  const team = (side, position) => {
    const isHome = side === 'home';
    // The SECOND block is the right-hand one - the modifier is a position,
    // not a side, so it stays correct whichever order the league takes.
    const cls = `teams-header-team${position === 1 ? ' away' : ''}${favoredSide === side ? ' favored' : ''}`;
    const flag = (
      <FlagSlot
        flagSvgPath={isHome ? match.home_flag_svg : match.away_flag_svg}
        colorPrimary={isHome ? match.home_flag_color : match.away_flag_color}
      />
    );
    const name = (
      <div className="teams-header-team-name">
        {(isHome ? match.home_name : match.away_name) ?? (isHome ? 'Home' : 'Away')}
      </div>
    );
    return (
      <div className={cls} key={side}>
        {position === 1 ? <>{name}{flag}</> : <>{flag}{name}</>}
      </div>
    );
  };
  return (
    <div className="teams-header">
      {team(first, 0)}
      <div className="teams-header-vs">{connectorFor(match.league_slug)}</div>
      {team(second, 1)}
    </div>
  );
}
