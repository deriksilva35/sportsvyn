// components/scores/ScoresRail.js - the landscape board's left rail (scores-landscape).
//
// A SERVER COMPONENT, rendered by ScoreboardV4 on every request and hidden by
// CSS outside the landscape query (app/scores/scoresV4.css .sv4-rail, shown by
// scoresLandscape.css). Three parts, top to bottom:
//   · THE TABS: the app bar's own entries (lib/shell/appTabs.js APP_TABS) as
//     icons. The bottom bar is hidden in landscape, so this is the only
//     navigation left on the screen - all five are here, not four, because
//     dropping YOU would strand the account.
//   · THE SPORT CHIPS, stacked, each with the number of games it holds on the
//     selected day (v.sportCounts, read from the games scoresV2 already holds).
//     A sport with none shows no number. Links are the board's own (hrefs).
//   · THE WEEKLY TILE (signed in, with an entry): the reader's total, how many
//     of their players have played, from weeklyHero.

import Link from 'next/link';
import { APP_TABS } from '@/lib/shell/appTabs';
import { SPORTS, sportChipShown } from '@/lib/scores/v4';

/** "41.8" - one decimal, as the Weekly prints a total. */
export const fmtTotal = (n) => (Math.round(Number(n || 0) * 10) / 10).toFixed(1);

export default function ScoresRail({ sport = 'all', counts = {}, leagues = [], href, weekly = null, signedIn = false }) {
  return (
    <aside className="sv4-rail" data-rail="1" aria-label="Scores navigation">
      <nav className="rail-tabs" aria-label="App navigation">
        {APP_TABS.map((t) => (
          <Link key={t.key} href={t.href} className={`rail-tab${t.key === 'scores' ? ' on' : ''}`} data-key={t.key}
            aria-label={t.label} aria-current={t.key === 'scores' ? 'page' : undefined}>
            <span className="ic" aria-hidden="true">{t.icon}</span>
          </Link>
        ))}
      </nav>
      <nav className="rail-sports" aria-label="Sports">
        {SPORTS.filter(([k]) => sportChipShown(k, { leagues, selected: sport })).map(([k, label]) => {
          const n = counts[k] ?? 0;
          return (
            <Link key={k} href={href(k)} className={`rail-nav${sport === k ? ' on' : ''}`} data-rail-sport={k}>
              <span>{label}</span>
              {n > 0 ? <span className="n" data-count={n}>{n}</span> : null}
            </Link>
          );
        })}
      </nav>
      {signedIn && weekly ? (
        <Link href="/weekly" className="rail-weekly" data-rail-weekly="1">
          <span className="eb">YOUR WEEKLY</span>
          <span className="tot">{fmtTotal(weekly.total)}</span>
          <span className="sub">{weekly.playedCount} of {weekly.slots} played</span>
        </Link>
      ) : null}
    </aside>
  );
}
