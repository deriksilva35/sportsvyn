// components/league/WeekLeaders.js — who leads the week, in three categories.
//
// A LEADER IS A CLAIM ABOUT ONE WEEK, and weekLeaders() scopes the query to the
// season, the week and the regular season so it cannot become a career total.
//
// LINKED AND UNLINKED READ IDENTICALLY. A player whose profile we hold gets an
// anchor; one we do not gets the same name in the same place with no marker.
// The link is a convenience, not a status.

import Link from 'next/link';

export default function WeekLeaders({ leaders, href }) {
  if (!leaders?.length) return null;
  return (
    <section className="lgm" aria-label="Week leaders">
      <div className="lgm-h"><h2>Week Leaders</h2>
        <Link className="lgm-all" href={href}>All stats →</Link>
      </div>
      <div className="lgm-rows">
        {leaders.map((l) => (
          <div className="lgm-row" key={l.key}>
            <span className="lgm-cat">{l.label}</span>
            <span className="lgm-who">
              {l.slug ? <Link className="lgm-pl" href={`/player/${l.slug}`}>{l.name}</Link> : l.name}
              {l.abbr ? <span className="lgm-tm">{l.abbr}</span> : null}
            </span>
            <span className="lgm-yd">{l.yards}<span className="lgm-unit">yds</span></span>
          </div>
        ))}
      </div>
    </section>
  );
}
