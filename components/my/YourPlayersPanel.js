/**
 * YourPlayersPanel: server component.
 *
 * The user's followed players with their tournament line (from
 * getFollowedPlayers -> player_match_stats aggregate + current player-power
 * MVP rank). Row is MVP rank / player name + team-abbr·position sub / goals +
 * assists, with a minutes·apps sub-line. Ordered by MVP rank (nulls last),
 * then goals. Reuses the Golden Boot gb-row player layout.
 */

const POS_SHORT = { GK: 'GK', DEF: 'DF', MID: 'MF', ATT: 'FW' };

export default function YourPlayersPanel({ players }) {
  const rows = Array.isArray(players) ? players : [];

  if (rows.length === 0) {
    return (
      <section className="panel panel-players">
        <h2 className="phead">Your Players</h2>
        <div className="pbody">
          <p className="grp-empty">No followed players yet. Tap the star on any player page.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel panel-players">
      <h2 className="phead">Your Players</h2>
      <div className="pbody">
        {rows.map((r) => {
          const sub = [r.team_abbr, POS_SHORT[r.position] ?? r.position].filter(Boolean).join(' · ');
          return (
            <a key={r.player_id} href={`/player/${r.player_slug}`} className="gb-row">
              <span className="gb-pos">{r.mvp_rank ?? '—'}</span>
              <span className="gb-main">
                <span className="gb-name">{r.player_name}</span>
                <span className="gb-sub">{sub}</span>
              </span>
              <span className="yp-stat">
                {r.goals}G {r.assists}A
                <span className="yp-stat-sub">{r.minutes} min · {r.apps} {r.apps === 1 ? 'app' : 'apps'}</span>
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
