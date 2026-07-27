// components/gridiron/RankingsHub.js — the per-league rankings hub (/nfl/rankings,
// /cfb/rankings). Tab state lives in ?tab= so every board is linkable. Each tab is
// the FULL board: editorial boards via getEditorialBoard, the CFB Playoff Picture
// via the same market-derived title-odds reader.

import Wordmark from '@/components/gridiron/Wordmark';
import { getEditorialBoard, getLeagueIdBySlug } from '@/lib/gridiron/readers';
import { getTitleContenders } from '@/lib/gridiron/oddsReader';
import { RANKING_TABS, resolveActiveTab } from '@/lib/gridiron/rankingsHub';
import EditorialBoard from '@/components/gridiron/EditorialBoard';
import PlayoffPicture from '@/components/gridiron/PlayoffPicture';

export default async function RankingsHub({ leagueSlug, leagueLabel, searchParams }) {
  const sp = (await searchParams) ?? {};
  const tabs = RANKING_TABS[leagueSlug] ?? [];
  const active = resolveActiveTab(tabs, sp.tab);

  let board = null;
  let contenders = [];
  if (active?.kind === 'editorial') {
    board = await getEditorialBoard(active.list, leagueSlug);
  } else if (active?.kind === 'market') {
    const leagueId = await getLeagueIdBySlug(leagueSlug);
    contenders = leagueId ? await getTitleContenders(leagueId, 25) : [];
  }

  return (
    <div className="gi" data-surface="paper">
      <header className="gi-head">
        <Wordmark href={`/${leagueSlug}`} />
        <nav className="gi-head-nav">
          <a href="/nfl">TODAY</a>
          <a href="/scores">SCORES</a>
          <a className={leagueSlug === 'nfl' ? 'active' : ''} href="/nfl">NFL</a>
          <a className={leagueSlug === 'cfb' ? 'active' : ''} href="/cfb">CFB</a>
          <a href="/world-cup-2026/bracket">SOCCER</a>
        </nav>
        <div className="gi-head-right"><a href="/my">MY SPORTSVYN</a><span className="gi-member">MEMBER</span></div>
      </header>

      <nav className="gi-subnav">
        <a href={`/${leagueSlug}`}>Today</a>
        <a href="/scores">Scores &amp; Schedule</a>
        <a className="active" href={`/${leagueSlug}/rankings`}>Rankings</a>
        <span className="gi-season">{leagueLabel} · RANKINGS</span>
      </nav>

      <div className="gi-wrap">
        <div className="gi-rank-tabs" role="tablist">
          {tabs.map((t) => (
            <a
              key={t.key}
              role="tab"
              aria-selected={t.key === active?.key}
              className={t.key === active?.key ? 'active' : ''}
              href={`/${leagueSlug}/rankings?tab=${t.key}`}
            >
              {t.label}
            </a>
          ))}
        </div>

        <div className="gi-rank-body">
          {active?.kind === 'market'
            ? <PlayoffPicture contenders={contenders} leagueLabel={leagueLabel} />
            : <EditorialBoard title={active?.label ?? ''} board={board} />}
        </div>
      </div>
    </div>
  );
}
