/**
 * GoldenBootPanel: server component.
 *
 * Top-scorer race (getScorers, top 6). Row is rank / player name + team abbr
 * sub-line / goal count. Players whose national team is followed render volt
 * (.team-name-followed). Follow-independent data (tournament-wide board);
 * followedSet only drives highlighting.
 */

export default function GoldenBootPanel({ scorers, followedSet }) {
  const rows = Array.isArray(scorers) ? scorers : [];

  if (rows.length === 0) {
    return (
      <section className="panel panel-goldenboot">
        <h2 className="phead">Golden Boot</h2>
        <div className="pbody">
          <p className="grp-empty">No goals yet.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-goldenboot">
      <h2 className="phead">
        Golden Boot
        <a className="phead-action" href="/stats?view=scorers">All scorers {'→'}</a>
      </h2>
      <div className="pbody">
        {rows.map((r, i) => {
          const followed = r.team_id != null && followedSet?.has(r.team_id);
          return (
            <a key={r.player_slug ?? `${r.player_name}-${i}`} href={`/player/${r.player_slug}`} className="gb-row">
              <span className="gb-pos">{i + 1}</span>
              <span className="gb-main">
                <span className={`gb-name${followed ? ' team-name-followed' : ''}`}>{r.player_name}</span>
                <span className="gb-sub">{r.team_abbr}</span>
              </span>
              <span className="gb-count">{r.goals}</span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
