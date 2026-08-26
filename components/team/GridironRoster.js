// components/team/GridironRoster.js - the gridiron roster, in the app's grammar.
//
// A SIBLING OF SquadList, NOT A BRANCH INSIDE IT. Soccer's squad is a jersey +
// name list grouped GK/DEF/MID/ATT; this is a jersey + name + tag line with two
// fixed measurement columns, grouped OFF/DEF/ST. Folding both into one
// component would have meant a sport switch inside every row - the same
// sibling-not-extension call the live_state formatter and the soccer scoreboard
// card were built under.
//
// ROWS LINK, as of the player-page relay. They were unlinked for exactly as
// long as there was nothing to link to: /player/[slug] now renders a real
// gridiron page - hero, bio, and stats where they exist - so the link is a
// promise the app keeps. The test that pinned zero links is inverted to pin
// that every row HAS one; the two commits are the same promise, before and
// after.

import { groupRoster, heightImperial, weightImperial, tagLine } from './gridiron';

function RosterRow({ p }) {
  const num = p.current_team_jersey_number;
  const ht = heightImperial(p.height_cm);
  const wt = weightImperial(p.weight_kg);
  // experience_years === 1 is a first-season player. The chip is the Tracker
  // room's existing rookie pattern, reused rather than reinvented.
  const rookie = p.experience_years === 1;
  return (
    <a className="gr-row" href={`/player/${p.slug}`}>
      <span className="nrail">{num != null ? num : '—'}</span>
      <div className="ndeck">
        <div className="nline1">
          <span className="gr-nm">{p.full_name}</span>
          {rookie && <span className="gr-rookie">R</span>}
        </div>
        <div className="nline2">
          <span className="gr-tag">
            {tagLine({ position: p.position, college: p.college, experienceYears: p.experience_years })}
          </span>
        </div>
      </div>
      <div className="ncols">
        <span className="ncol">{ht ?? '—'}</span>
        <span className="ncol">{wt ?? '—'}</span>
      </div>
    </a>
  );
}

export default function GridironRoster({ players }) {
  const groups = groupRoster(players);
  if (!groups.length) return null;
  // Counts come from the grouped rows themselves - never a hardcoded number, so
  // the header cannot drift from what is rendered beneath it.
  const total = groups.reduce((n, g) => n + g.count, 0);

  return (
    <section className="page-section gr" id="squad">
      <div className="section-head">
        <div className="section-head-left">
          <span className="section-head-num">§ Roster</span>
          <h2 className="section-head-title">
            The <span className="accent">{total}</span>
          </h2>
        </div>
      </div>

      <div className="gr-head">
        <span className="nrail">#</span>
        <span className="ndeck">Player</span>
        <span className="ncols"><span className="ncol">HT</span><span className="ncol">WT</span></span>
      </div>

      {groups.map((g) => (
        <div key={g.key ?? 'unlisted'}>
          {/* The Unlisted group appears ONLY when this team has players in it,
              carrying THIS team's count - not the 379 league-wide figure, which
              is entirely college and would read as a lie on an NFL page. */}
          <div className={`gr-grp${g.key === null ? ' unlisted' : ''}`}>
            {g.label} <span className="n">{g.count}</span>
          </div>
          {g.members.map((p) => <RosterRow key={p.slug} p={p} />)}
        </div>
      ))}
    </section>
  );
}
