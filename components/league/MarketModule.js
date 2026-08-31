// components/league/MarketModule.js — the next three priced games.
//
// ONE SOURCE FOR THE LINE. Every number here came through oddsReader, the same
// reader the Market page and the pick'em board use. This file opens no query of
// its own and a test forbids it.
//
// THE FAVOURITE IS NAMED. A bare signed number on a row with two teams on it is
// ambiguous to everyone not already fluent, so spreadLabel spends the sign on a
// name. The total sits behind it, muted, because it is the second question.

import Link from 'next/link';
import { spreadLabel } from '@/lib/standings/view';
import { isPreGame } from '@/lib/gridiron/oddsFormat';

export default function MarketModule({ rows, href, statuses }) {
  const live = (rows ?? []).filter((r) => isPreGame(statuses?.get?.(r.matchId) ?? 'scheduled'));
  if (!live.length) return null;
  return (
    <section className="lgm" aria-label="The market">
      <div className="lgm-h"><h2>The Market</h2>
        <Link className="lgm-all" href={href}>Lines for the week →</Link>
      </div>
      <div className="lgm-rows">
        {live.map((r) => {
          const label = spreadLabel({ spreadHome: r.spreadHome, homeAbbr: r.homeAbbr, awayAbbr: r.awayAbbr });
          if (!label) return null;
          return (
            <div className="lgm-row" key={r.matchId}>
              <span className="lgm-fx">{r.awayAbbr} @ {r.homeAbbr}</span>
              <span className="lgm-sp">{label}</span>
              {r.total ? <span className="lgm-tot">O/U {r.total}</span> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
