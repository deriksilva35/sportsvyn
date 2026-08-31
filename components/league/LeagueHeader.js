// components/league/LeagueHeader.js — the screen header for /nfl and /cfb.
//
// THE LEAGUE IS THE HEADLINE. This screen is one code's whole day, so the code
// names itself at display weight and everything else on the line is metadata
// around it.
//
// THE EYEBROW OBEYS THE REG-ONLY LANDMARK LAW, and the law lives in
// landingEyebrow() rather than here: a week number is a regular-season fact,
// so a preseason or postseason screen shows the DATE alone rather than a
// "Week 3" that silently means something else. A failed derivation degrades to
// the date, which is always true.
//
// THE PILL IS HIDDEN AT ZERO. A live-red badge reading "0" is an alert colour
// announcing that nothing is happening, which is the one thing that colour
// must never say.

import Link from 'next/link';
import { landingEyebrow, livePill } from '@/lib/gridiron/leagueLanding';
import { navPills } from '@/lib/gridiron/leagueNav';
import { resolveLeagueWeek } from '@/lib/gridiron/leagueWeek';

export default async function LeagueHeader({
  label, week, phase, date, games, leagueSlug, pathname,
}) {
  // THE WEEK LINE RESOLVES ITSELF when the caller has not already done the
  // work. The landing has - it read the slate for its own modules - so it
  // passes what it holds; every other league route passes nothing and gets the
  // same line rather than a bare title.
  let w = week; let ph = phase; let d = date;
  if (w === undefined && leagueSlug) {
    const r = await resolveLeagueWeek(leagueSlug);
    w = r.week; ph = r.phase; d = r.date;
  }
  const eyebrow = landingEyebrow({ week: w, phase: ph, date: d });
  const live = livePill(games);
  // THE PILLS COME FROM THE ROUTE, not from a prop each page remembers to set.
  // One list, one resolver - see lib/gridiron/leagueNav.js.
  const pills = leagueSlug ? navPills(leagueSlug, pathname) : [];
  const head = (
    <header className="lgh">
      <div className="lgh-l">
        {eyebrow ? <div className="lgh-eye">{eyebrow}</div> : null}
        {/* THE TITLE IS THE WAY HOME. On a sub-page it is the only one-tap
            route back to the landing; on the landing it links to itself, which
            is harmless and keeps one rule instead of two. */}
        {leagueSlug
          ? <a className="lgh-h1" href={`/${leagueSlug}`}>{label}</a>
          : <h1 className="lgh-h1">{label}</h1>}
      </div>
      {live ? (
        <span className="lgh-live" aria-label={`${live} games live now`}>
          <span className="lgh-dot" />{live} LIVE
        </span>
      ) : null}
    </header>
  );

  return (
    <>
      {head}
      {pills.length ? (
        <nav className="lgn" aria-label={`${label} sections`}>
          {pills.map((p) => (
            <Link
              key={p.key}
              href={p.href}
              className={`lgn-p${p.current ? ' on' : ''}${p.outlined ? ' out' : ''}`}
              aria-current={p.current ? 'page' : undefined}
            >
              {p.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </>
  );
}
