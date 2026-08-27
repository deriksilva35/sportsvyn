// components/player/GridironHero.js - the gridiron player hero.
//
// NO PHOTO, AND NO PLACEHOLDER FOR ONE. Headshots are not a gap to work around
// here, they are brand law (tokens v1.2): 0 of 29,721 gridiron players carry a
// photo_url and none is coming. The anchor is the jersey numeral, set oversized
// and OUTLINED in volt - stroke only, never filled, so it reads as texture
// behind the name rather than as the loudest number on a page full of numbers.
// A player with no jersey number simply has no numeral; nothing takes its place.

import { heroEyebrow, heroChips, bioCells } from './gridironPlayer';
// THE FOLLOW STAR THE GRIDIRON ARM NEVER HAD. user_player_follows FKs to
// players(id) with no league column, so the soccer component works here
// unchanged - 29,721 pages shipped with no way to follow them, and this is the
// smallest honest fix. Soccer's PlayerHero is untouched.
import PlayerFollowStar from './PlayerFollowStar';

export default function GridironHero({ player, isAuthed = false, initialFollowing = false }) {
  const eyebrow = heroEyebrow(player.league_slug, player.position);
  const chips = heroChips({
    position: player.position,
    positionGroup: player.position_group,
    experienceYears: player.experience_years,
  });
  const cells = bioCells({
    heightCm: player.height_cm,
    weightKg: player.weight_kg,
    college: player.college,
    jersey: player.current_team_jersey_number,
  });
  const jersey = player.current_team_jersey_number;

  return (
    <section className="gp-hero">
      {jersey != null && (
        <div className="gp-num" aria-hidden="true"><span className="gp-hash">#</span>{jersey}</div>
      )}
      {eyebrow && <div className="gp-eb">{eyebrow}</div>}
      <div className="gp-nameline">
        <h1 className="gp-name">{player.full_name}</h1>
        <PlayerFollowStar
          playerId={player.id}
          playerName={player.full_name}
          isAuthed={isAuthed}
          initialFollowing={initialFollowing}
        />
      </div>
      <div className="gp-tagline">
        {player.team_slug && (
          <a className="gp-chip team" href={`/team/${player.team_slug}`}>{player.team_name} →</a>
        )}
        {chips.map((c) => (
          <span key={c.label} className={`gp-chip${c.rookie ? ' rook' : ''}`}>{c.label}</span>
        ))}
      </div>
      {cells.length > 0 && (
        <div className="gp-biostrip">
          {cells.map((c) => (
            <div className="gp-bio" key={c.k}>
              <span className="gp-k">{c.k}</span>
              <span className="gp-v">{c.v}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
