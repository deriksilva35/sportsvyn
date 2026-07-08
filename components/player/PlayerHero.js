/**
 * PlayerHero — top of /player/[slug].
 *
 * Three-column hero: photo · identity middle column · composite dormant.
 *
 * Identity middle column populates from real player + team data
 * (name, position, team flag + name + #jersey). The team name links
 * to /team/{team_slug} — getTeamBySlug on the receiving end already
 * disambiguates duplicate slug rows toward the WC team, so this hand-
 * off is deterministic.
 *
 * Composite column stays dormant (no current_composite_rank /
 * current_composite_score in the DB yet — explicit empty-state,
 * not fabricated numbers).
 */

import PlayerFollowStar from './PlayerFollowStar';

function PlayerPhoto({ src, name }) {
  if (!src) {
    return (
      <div className="player-hero-photo" aria-label="No photo">
        <svg viewBox="0 0 64 80" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true">
          <circle cx="32" cy="26" r="13" />
          <path d="M 10 80 L 10 60 Q 10 46 32 46 Q 54 46 54 60 L 54 80 Z" />
        </svg>
      </div>
    );
  }
  // photo_url_source is the raw api-sports url; duotone treatment is a
  // later pass. Use unoptimized img — Next/Image-style optimization is
  // out of scope here.
  return (
    <div className="player-hero-photo">
      <img src={src} alt={`${name} portrait`} loading="lazy" />
    </div>
  );
}

const POSITION_LABEL = {
  GK: 'Goalkeeper',
  DEF: 'Defender',
  MID: 'Midfielder',
  ATT: 'Forward',
};

export default function PlayerHero({ player, isAuthed = false, initialFollowing = false }) {
  const posLabel = POSITION_LABEL[player.position] ?? player.position ?? null;
  const teamHref = player.team_slug ? `/team/${player.team_slug}` : null;

  return (
    <section className="player-hero">
      <PlayerPhoto src={player.photo_url_source} name={player.full_name} />

      <div className="player-hero-info">
        {/* Name + star share a flex cluster so the star can wrap below the H1
            on narrow viewports (mirrors TeamHero's .team-name-and-star). */}
        <div className="player-name-and-star">
          <h1 className="player-hero-name">{player.full_name}</h1>
          <PlayerFollowStar
            playerId={player.id}
            playerName={player.full_name}
            isAuthed={isAuthed}
            initialFollowing={initialFollowing}
          />
        </div>

        <div className="player-hero-affil-row">
          {player.flag_svg_path && (
            <span
              className="flag-inline-svg team-flag"
              role="img"
              aria-hidden="true"
              style={{ backgroundImage: `url(${player.flag_svg_path})` }}
            />
          )}
          {teamHref ? (
            <a href={teamHref} className="team-name">{player.team_name}</a>
          ) : (
            <span className="team-name">{player.team_name ?? '—'}</span>
          )}
          {posLabel && (
            <>
              <span className="pipe">·</span>
              <span className="pos">{posLabel}</span>
            </>
          )}
          {player.current_team_jersey_number != null && (
            <>
              <span className="pipe">·</span>
              <span className="num">#{player.current_team_jersey_number}</span>
            </>
          )}
        </div>
      </div>

      {/* Composite block — dormant. No current_composite_rank /
          current_composite_score on PROD; show a quiet placeholder
          rather than a 9.6 from the mock. */}
      <div className="player-composite-block player-composite-block--dormant">
        <div className="player-composite-kicker">Player Composite</div>
        <div className="player-dormant-line">
          Player rankings begin once the tournament is underway.
        </div>
      </div>
    </section>
  );
}
