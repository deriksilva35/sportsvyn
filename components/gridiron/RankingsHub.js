// components/gridiron/RankingsHub.js — the per-league rankings hub (/nfl/rankings,
// /cfb/rankings). Tab state lives in ?tab= so every board is linkable. Each tab is
// the FULL board: editorial boards via getEditorialBoard, the CFB Playoff Picture
// via the same market-derived title-odds reader.

import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import LeagueHeader from '@/components/league/LeagueHeader';
import '@/components/league/league.css';
import { getEditorialBoard, getLeagueIdBySlug } from '@/lib/gridiron/readers';
import { getTitleContenders } from '@/lib/gridiron/oddsReader';
import { RANKING_TABS, resolveActiveTab, stripTabs } from '@/lib/gridiron/rankingsHub';
import { getPowerZBoard } from '@/lib/rankings/nflPowerZReads';
import PowerZBoard from '@/components/gridiron/PowerZBoard';
import EditorialBoard from '@/components/gridiron/EditorialBoard';
import PlayoffPicture from '@/components/gridiron/PlayoffPicture';
import PollBoard from '@/components/gridiron/PollBoard';
import { pollTable, latestWeek } from '@/lib/cfb/rankings';
import '@/components/gridiron/pollboard.css';
import { resolveShellMode } from '@/lib/shell/shell';
import { arcadeFor } from '@/lib/brand/theme';
import { readViewerTz } from '@/lib/gridiron/serverTz';
import { SERVED, getServedBoard } from '@/lib/rankings/servedBoard';
import ArcadeBoard from '@/components/rankings/ArcadeBoard';

export default async function RankingsHub({ leagueSlug, leagueLabel, searchParams }) {
  const sp = (await searchParams) ?? {};
  const tabs = RANKING_TABS[leagueSlug] ?? [];
  const active = resolveActiveTab(tabs, sp.tab);

  // THE ARCADE BOARD (board A, tue-13). Under data-theme="arcade" the league's
  // SERVED board - nfl-power-z, cfb-top25 - is the page, drawn as the canvas
  // draws it; the dark page below is exactly what it was. The flag is the
  // deployment's, or ARCADE_SHELL for a request carrying the shell cookie, the
  // same per-request answer /scores uses. Only a bare URL or the served tab's
  // own key opens it: every other ?tab= keeps its board, so boardHref links to
  // MVP, Heisman or the polls still land somewhere under arcade.
  const served = SERVED[leagueSlug] ?? null;
  const isShell = await resolveShellMode().catch(() => false);
  if (served && arcadeFor(isShell) && (sp.tab == null || sp.tab === served.tab)) {
    const [board, tz] = await Promise.all([getServedBoard(leagueSlug).catch(() => null), readViewerTz()]);
    return (
      <div className="gi" data-surface="ink">
        <GlobalHeaderServer activeNav={leagueSlug} arcadeNav="rankings" />
        <ArcadeBoard leagueSlug={leagueSlug} leagueLabel={leagueLabel} board={board}
          all={one(sp.all) === '1'} open={one(sp.open) ?? null} tz={tz ?? undefined} />
      </div>
    );
  }

  let board = null;
  let contenders = [];
  let poll = null;
  let powerZ = null;
  if (active?.kind === 'power-z') {
    powerZ = await getPowerZBoard();
  } else if (active?.kind === 'editorial') {
    board = await getEditorialBoard(active.list, leagueSlug);
  } else if (active?.kind === 'market') {
    const leagueId = await getLeagueIdBySlug(leagueSlug);
    contenders = leagueId ? await getTitleContenders(leagueId, active.n ?? 25) : [];
  } else if (active?.kind === 'poll') {
    // A THIRD KIND, not a change to the other two. The editorial and market
    // branches above are byte-identical to what they were; the polls arrive as
    // a sibling so Sportsvyn 25, Heisman and Playoff Picture cannot regress
    // through a shared code path they never had.
    const season = await latestSeasonFor(active.poll);
    const week = season ? await latestWeek(active.poll, season) : null;
    poll = season && week
      ? { name: active.poll, season, week, rows: await pollTable(active.poll, { season, week }) }
      : { name: active.poll, season, week, rows: [] };
  }

  return (
    <div className="gi" data-surface="ink">
      {/* The dark header lights the league; the arcade header lights RANKINGS. */}
      <GlobalHeaderServer activeNav={leagueSlug} arcadeNav="rankings" />

      {/* ONE HEADER, EVERY LEAGUE PAGE. This hub used to hand-write three of
          the league's destinations, which is how a reader who tapped Rankings
          lost the way to Standings. */}
      <LeagueHeader
        label={leagueLabel}
        leagueSlug={leagueSlug}
        pathname={`/${leagueSlug}/rankings`}
      />

      <div className="gi-wrap">
        <div className="gi-rank-tabs" role="tablist">
          {stripTabs(tabs, active).map((t) => (
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
          {active?.kind === 'power-z'
            ? <PowerZBoard board={powerZ} />
            : active?.kind === 'poll'
            ? <PollBoard poll={poll} />
            : active?.kind === 'market'
              ? <PlayoffPicture contenders={contenders} leagueLabel={leagueLabel} />
              : <EditorialBoard title={active?.label ?? ''} board={board} />}
        </div>
      </div>
    </div>
  );
}

const one = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * The newest season we hold a poll for. Read from the rankings themselves
 * rather than derived from the calendar: the page shows what we HAVE, and a
 * calendar-derived season would render an empty board in the gap between a
 * season rolling over and its first poll being published.
 */
async function latestSeasonFor(pollName) {
  const { latestPollSeason } = await import('@/lib/cfb/rankings');
  return latestPollSeason(pollName);
}
