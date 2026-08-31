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

import { landingEyebrow, livePill } from '@/lib/gridiron/leagueLanding';

export default function LeagueHeader({ label, week, phase, date, games }) {
  const eyebrow = landingEyebrow({ week, phase, date });
  const live = livePill(games);
  return (
    <header className="lgh">
      <div className="lgh-l">
        {eyebrow ? <div className="lgh-eye">{eyebrow}</div> : null}
        <h1 className="lgh-h1">{label}</h1>
      </div>
      {live ? (
        <span className="lgh-live" aria-label={`${live} games live now`}>
          <span className="lgh-dot" />{live} LIVE
        </span>
      ) : null}
    </header>
  );
}
