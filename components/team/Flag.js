/**
 * Shared flag rendering for the team page.
 *
 * For seeded teams whose flag gradients are defined in team.css (.flag-arg,
 * .flag-aus, .flag-nga, .flag-cro, .flag-mex, .flag-jpn, .flag-isl) we use
 * the class. For unknown teams we fall back to a single-color tile derived
 * from teams.flag_color_primary so the design still renders without nulls.
 *
 * `variant` controls size: 'hero' for the big team-page hero, 'mini' for
 * inline use in match cards and schedule rows.
 */

const KNOWN_ABBR = new Set(['ARG', 'AUS', 'NGA', 'CRO', 'MEX', 'JPN', 'ISL']);

export default function Flag({ abbreviation, colorPrimary, variant = 'mini' }) {
  const key = abbreviation ? abbreviation.toUpperCase() : null;
  const base = variant === 'hero' ? 'flag-hero' : 'flag-mini';

  if (key && KNOWN_ABBR.has(key)) {
    return <div className={`${base} flag-${key.toLowerCase()}`} />;
  }
  return (
    <div
      className={base}
      style={colorPrimary ? { background: colorPrimary } : undefined}
    />
  );
}
