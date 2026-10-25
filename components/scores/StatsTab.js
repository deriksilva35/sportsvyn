// components/scores/StatsTab.js - the Stats tab of /scores (sun-1), server half.
//
// Reads the day's stat rows through the 30 s data cache (statsCached.js), the
// viewer's own players uncached (statsMine.js), and hands the board its view
// (lib/scores/statsTab.js statsView). NFL and NBA only; any other sport shows a
// one-line "coming soon".

import Link from 'next/link';
import ScoresTabs from '@/components/scores/ScoresTabs';
import StatsBoard from '@/components/scores/StatsBoard';
import ZoneLabel from '@/components/scores/ZoneLabel';
import { cachedStatsDay } from '@/lib/scores/statsCached';
import { readMineKeys } from '@/lib/scores/statsMine';
import { statsView, statsSport, STATS_CHIPS, STATS_SPORTS, SPORT_NAME } from '@/lib/scores/statsTab';
import { ET, viewerDay, dayStripDays, weekdayOf } from '@/lib/gridiron/scoresV2Shape';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function StatsTab({ sp, userId = null, zoneLabel = 'Eastern', now = new Date() }) {
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  const league = statsSport(one(sp.sport));
  const today = viewerDay(now.toISOString(), ET);
  const date = DAY_RE.test(one(sp.date) ?? '') ? one(sp.date) : today;
  const href = (o = {}) => {
    const p = new URLSearchParams({ tab: 'stats', sport: o.sport ?? league });
    const d = o.date === undefined ? (date === today ? null : date) : o.date;
    if (d) p.set('date', d);
    return `/scores?${p}`;
  };
  let view; let games = 0; let live = 0;
  if (STATS_SPORTS.includes(league)) {
    const day = await cachedStatsDay(league, date).catch(() => ({ total: 0, games: [], stats: [] }));
    const mine = userId == null ? null : await readMineKeys({ userId, league, date, games: day.games }).catch(() => new Set());
    view = statsView({ league, games: day.games, stats: day.stats, mine, signedIn: userId != null });
    games = day.total; live = day.games.filter((g) => g.status === 'live').length;
  } else {
    view = statsView({ league, games: [], stats: [] });
  }
  return (
    <div className="svs" data-surface="ink" data-stats-sport={league}>
      <div className="svs-head">
        <h1>Scoreboard</h1>
        <div className="svs-sub">{STATS_SPORTS.includes(league) ? `${games} game${games === 1 ? '' : 's'}${live ? ` · ${live} live` : ''}` : ''}</div>
      </div>
      <div className="svs-eb">{weekdayOf(date, true)} {'·'} all times <ZoneLabel initial={zoneLabel} /></div>
      <ScoresTabs active="stats" sport={league} />
      <div className="svs-chips top" data-section="sports">
        {STATS_CHIPS.map(([k, label]) => (
          <Link key={k} className={`svs-chip${league === k ? ' on' : ''}`} href={href({ sport: k })} data-chip={`sport:${k}`}>{label}</Link>
        ))}
      </div>
      <div className="svs-days" data-section="days">
        {dayStripDays(today).map((d) => (
          <Link key={d.date} className={`svs-day${d.date === date ? ' on' : ''}`} href={href({ date: d.date === today ? null : d.date })} data-date={d.date}>
            <small>{d.dow}</small><b>{d.day}</b>
          </Link>
        ))}
      </div>
      {view.supported
        ? <StatsBoard key={`${league}:${date}`} view={view} signedIn={userId != null} />
        : <p className="svs-empty" data-soon={league}>{view.soon ?? `Stats for ${SPORT_NAME[league]} coming soon`}</p>}
    </div>
  );
}
