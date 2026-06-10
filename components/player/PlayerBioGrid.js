/**
 * PlayerBioGrid — § Bio section under the player hero.
 *
 * Renders a factual two-column grid of bio facts pulled from the
 * players table (sourced from API-Sports /players?id&season). Every
 * field is independently optional:
 *   · per-field hide  — a NULL value drops just its own row
 *   · whole-grid hide — if EVERY field is null (the pre-backfill case,
 *                       or a player API-Sports doesn't cover), the
 *                       component returns null so the page shows no
 *                       broken/empty bio shell. A future "Bio coming
 *                       soon" placeholder could go here once we have
 *                       a few populated to compare against — but a
 *                       silent skip beats a half-filled scaffold.
 *
 * preferred_foot is intentionally OMITTED — API-Sports doesn't return
 * a "preferred foot" field on the /players endpoint. Future add via
 * Wikidata / Transfermarkt / editorial manual entry; until then we
 * don't render a placeholder.
 */

function ageFromBirthdate(birthdate) {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const md = (now.getMonth() - d.getMonth()) || (now.getDate() - d.getDate());
  if (md < 0) age -= 1;
  return age >= 0 && age < 120 ? age : null;
}

function fmtBornLong(birthdate) {
  if (!birthdate) return null;
  const d = new Date(birthdate);
  if (Number.isNaN(d.getTime())) return null;
  // Display in en-US (Jun 24, 1987) — matches the mock's bio-grid format.
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
  }).format(d);
}

function BioItem({ label, value, accent, small }) {
  if (value == null || value === '') return null;
  return (
    <div className="player-bio-item">
      <span className="label">{label}</span>
      <span className="val">
        {accent ? <span className="accent">{accent}</span> : value}
        {accent && value ? ' ' : null}
        {accent && small ? <span className="small">{small}</span>
                         : small ? <span className="small">{small}</span>
                                 : null}
        {!accent ? null : null}
      </span>
    </div>
  );
}

// Simpler version of BioItem used when there's no leading-accent number —
// keeps the markup tidy and avoids the noisy ternary above for the bulk
// of rows.
function PlainBioItem({ label, value, small }) {
  if (value == null || value === '') return null;
  return (
    <div className="player-bio-item">
      <span className="label">{label}</span>
      <span className="val">
        {value}
        {small ? <span className="small">{small}</span> : null}
      </span>
    </div>
  );
}

// Accent-leading row (volt-colored value with a small mono trailer).
function AccentBioItem({ label, accent, small }) {
  if (accent == null || accent === '') return null;
  return (
    <div className="player-bio-item">
      <span className="label">{label}</span>
      <span className="val">
        <span className="accent">{accent}</span>
        {small ? <> <span className="small">{small}</span></> : null}
      </span>
    </div>
  );
}

export default function PlayerBioGrid({ player }) {
  if (!player) return null;

  const born      = fmtBornLong(player.birthdate);
  const age       = ageFromBirthdate(player.birthdate);
  const heightVal = player.height_cm != null
    ? `${(player.height_cm / 100).toFixed(2)} m`
    : null;

  // Whole-grid hide: if NO bio field is populated, render nothing.
  // The page should not show a header + empty grid.
  const anyPopulated =
    born != null ||
    player.nationality != null && player.nationality !== '' ||
    heightVal != null ||
    (player.club_name && player.club_name !== '') ||
    player.international_caps != null ||
    player.international_goals != null;
  if (!anyPopulated) return null;

  return (
    <section className="player-section player-bio-section">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-head-num">§ Bio</span>
          <h2 className="section-head-title">{player.known_as ?? player.full_name} · <span className="accent">profile</span></h2>
        </div>
      </div>

      <div className="player-bio-grid">
        <PlainBioItem
          label="Born"
          value={born}
          small={age != null ? `${age}yo` : null}
        />
        <PlainBioItem label="Nationality" value={player.nationality} />
        <PlainBioItem label="Height"      value={heightVal} />
        <PlainBioItem label="Club"        value={player.club_name} />
        <AccentBioItem label="Nat'l Caps"  accent={player.international_caps} />
        <AccentBioItem label="Nat'l Goals" accent={player.international_goals} />
      </div>
    </section>
  );
}
