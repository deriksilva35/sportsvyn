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
import { resolveLeagueWeek, resolveEplWeek } from '@/lib/gridiron/leagueWeek';
import { switcherRows } from '@/lib/gridiron/leagueSwitch';
import LeagueSwitcher from '@/components/league/LeagueSwitcher';

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

  // THE SHEET'S ROWS ARE RESOLVED HERE, ON THE SERVER. Each carries its own
  // live week, so the switcher answers "what is happening over there" before
  // the reader commits to the tap. Each eyebrow is caught on its own: a league
  // whose week cannot be derived shows its name and nothing else, which is the
  // same degradation the header's own eyebrow makes.
  let rows = [];
  if (leagueSlug) {
    rows = switcherRows(pathname, leagueSlug);
    const eyebrows = await Promise.all(rows.map(async (r) => {
      try {
        if (r.slug === 'epl') return (await resolveEplWeek()).label;
        const wk = await resolveLeagueWeek(r.slug);
        return landingEyebrow({ week: wk.week, phase: wk.phase, date: wk.date });
      } catch { return null; }
    }));
    rows = rows.map((r, i) => ({ ...r, eyebrow: eyebrows[i] }));
  }
  const head = (
    <header className="lgh">
      <div className="lgh-l">
        {eyebrow ? <div className="lgh-eye">{eyebrow}</div> : null}
        {/* THE TITLE OPENS THE SWITCHER, and the way home moved inside it -
            the sheet's current-league row carries the link to /{league}. One
            tap target rather than a split hitbox. */}
        {leagueSlug
          ? <LeagueSwitcher label={label} rows={rows} />
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
