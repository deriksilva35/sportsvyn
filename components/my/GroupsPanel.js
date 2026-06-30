/**
 * GroupsPanel: server component.
 *
 * Renders only the WC groups that contain at least one followed team.
 * Treatment mirrors the /bracket GroupCard: W-D-L, GD, PTS columns,
 * with the followed team's row name in volt via .team-name-followed
 * (reused from globals.css).
 *
 * Standings come pre-ordered from getFollowedGroups (which delegates
 * to getGroupStandings). This panel only renders; tiebreaker logic is
 * upstream.
 */

export default function GroupsPanel({ groups, followedSet }) {
  const entries = groups instanceof Map ? Array.from(groups.entries()) : [];
  if (entries.length === 0) {
    return (
      <section className="panel panel-groups">
        <h2 className="phead">Your Groups</h2>
        <div className="pbody">
          <p className="grp-empty">No groups to show.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="panel panel-groups">
      <h2 className="phead">Your Groups</h2>
      <div className="pbody">
        {entries.map(([letter, teams]) => {
          // "two of yours" annotation: only when this single group holds two or
          // more followed teams. Derived from the same followedSet marker that
          // tints names volt -- no new reader or prop. getFollowedGroups only
          // ever returns group-stage standings (stage='group', group_code not
          // null), so the label is always "Group {letter}" -- no knockout branch.
          const followedInGroup = teams.reduce(
            (n, t) => n + (followedSet?.has(t.team_id) ? 1 : 0),
            0,
          );
          return (
          <div key={letter} className="grp-card">
            <div className="grp-card-head">
              <span>
                <span className="grp-letter">Group {letter}</span>
                {followedInGroup >= 2 && (
                  <span className="grp-card-note" style={{ textTransform: 'none' }}>
                    {' '}two of yours
                  </span>
                )}
              </span>
              <span className="grp-cols">
                <span>W-D-L</span>
                <span>GD</span>
                <span>PTS</span>
              </span>
            </div>
            <ul className="grp-rows">
              {teams.map((t, i) => {
                const followed = followedSet?.has(t.team_id);
                const gd = t.gd > 0 ? `+${t.gd}` : `${t.gd}`;
                return (
                  <li key={t.team_id} className="grp-row">
                    <span className="grp-pos">{i + 1}</span>
                    {t.slug ? (
                      <a
                        href={`/team/${t.slug}`}
                        className={`grp-name${followed ? ' team-name-followed' : ''}`}
                      >
                        {t.name}
                      </a>
                    ) : (
                      <span className={`grp-name${followed ? ' team-name-followed' : ''}`}>
                        {t.name}
                      </span>
                    )}
                    <span className="grp-num">{t.wins}-{t.draws}-{t.losses}</span>
                    <span className="grp-num">{gd}</span>
                    <span className="grp-pts">{t.points}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })}
      </div>
    </section>
  );
}
