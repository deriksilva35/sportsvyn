/**
 * MentionedPanel: server component.
 *
 * Articles tied to a match where either side is followed. Same shape
 * as getTodaysReads rows. Title volts when home or away is followed
 * (in practice always at least one, since the query filtered that
 * way; the per-row check keeps the rendering rule consistent with
 * the homepage Today's Reads tint).
 */

import FlagSlot from '@/components/FlagSlot';

function readRowHref(r) {
  if (r.match_slug) return `/match/${r.match_slug}`;
  return `/article/${r.slug}`;
}

export default function MentionedPanel({ reads, followedSet }) {
  if (!reads || reads.length === 0) {
    return (
      <section className="panel panel-mentioned">
        <h2 className="phead">Mentioned</h2>
        <div className="pbody">
          <p className="mn-empty">No coverage yet involving your follows.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="panel panel-mentioned">
      <h2 className="phead">Mentioned</h2>
      <div className="pbody">
        <ul className="mn-list">
          {reads.map((r) => {
            const homeFollowed = r.home_team_id != null && followedSet?.has(r.home_team_id);
            const awayFollowed = r.away_team_id != null && followedSet?.has(r.away_team_id);
            const followed = homeFollowed || awayFollowed;
            const headlineClass = followed ? 'mn-title team-name-followed' : 'mn-title';
            // One chip per row: the followed side. When BOTH sides are followed,
            // chip the HOME side (positional rule for determinism, not a claim
            // about which team the story is "about"). Neither followed -> no chip.
            const chip = homeFollowed ? r.home : awayFollowed ? r.away : null;
            return (
              <li key={r.slug} className="mn-row">
                <a className="mn-link" href={readRowHref(r)}>
                  <div className="mn-kicker">{r.kicker}</div>
                  <div className={headlineClass}>{r.title}</div>
                  {chip && chip.name && (
                    <span className="mn-chip">
                      <FlagSlot
                        flagSvgPath={chip.flag_svg_path}
                        colorPrimary={chip.flag_color_primary}
                        size="sm"
                      />
                      {chip.name}
                    </span>
                  )}
                  <div className="mn-read-time">{r.read_time_min} min</div>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
