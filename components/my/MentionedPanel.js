/**
 * MentionedPanel: server component.
 *
 * Articles tied to a match where either side is followed. Same shape
 * as getTodaysReads rows. Title volts when home or away is followed
 * (in practice always at least one, since the query filtered that
 * way; the per-row check keeps the rendering rule consistent with
 * the homepage Today's Reads tint).
 */

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
            const followed =
              (r.home_team_id != null && followedSet?.has(r.home_team_id)) ||
              (r.away_team_id != null && followedSet?.has(r.away_team_id));
            const headlineClass = followed ? 'mn-title team-name-followed' : 'mn-title';
            return (
              <li key={r.slug} className="mn-row">
                <a className="mn-link" href={readRowHref(r)}>
                  <div className="mn-kicker">{r.kicker}</div>
                  <div className={headlineClass}>{r.title}</div>
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
