// components/player/GridironTeamNext.js - "Next up" for the player's team.
//
// The soccer page's match log renders GROUP fixtures, which a gridiron player
// has none of. This is the gridiron equivalent and it is deliberately thin:
// the next games, and a way to the team page that already holds the full roster
// and schedule. It does not restate the schedule the team page owns.

const fmt = (iso) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return { day: '—', time: '' };
  // ET, because a football day is an ET day everywhere in this codebase.
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
  }).format(d);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
  }).format(d).replace(' ', '').toLowerCase();
  return { day, time };
};

export default function GridironTeamNext({ teamName, teamSlug, games, leagueLabel }) {
  return (
    <section className="gp-mod full" id="team">
      <div className="gp-modeb">
        <span>{teamName}</span>
        <span className="gp-ctx">Next up</span>
      </div>
      {games.map((g) => {
        const { day, time } = fmt(g.kickoff_at);
        const home = g.home_team_id === g.us_id;
        const us = home ? g.home_short_name || g.home_name : g.away_short_name || g.away_name;
        const them = home ? g.away_short_name || g.away_name : g.home_short_name || g.home_name;
        return (
          <div className="gp-trow" key={g.id}>
            <div className="gp-when">{day}<br />{time}</div>
            <div className="gp-mu">{us} <span className="gp-at">{home ? 'vs' : 'at'}</span> {them}</div>
            <div className="gp-meta">
              {leagueLabel}{g.week != null ? ` · Wk ${g.week}` : ''}
            </div>
          </div>
        );
      })}
      {teamSlug && (
        <a className="gp-cta" href={`/team/${teamSlug}`}>Team page: full roster + schedule →</a>
      )}
    </section>
  );
}
