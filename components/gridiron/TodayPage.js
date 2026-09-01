// components/gridiron/TodayPage.js — shared server render for the /nfl and /cfb
// Today shells. Local ink header + sport sub-nav; NO site header. DEV reads only.
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import { getCurrentWeek, getNearestUpcomingWeek, getWeekSlate } from '@/lib/gridiron/readers';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import LeagueHeader from '@/components/league/LeagueHeader';
import StandingsSnapshot from '@/components/league/StandingsSnapshot';
import MarketModule from '@/components/league/MarketModule';
import WeekLeaders from '@/components/league/WeekLeaders';
import ReadsModule from '@/components/league/ReadsModule';
import WireModule from '@/components/wire/WireModule';
import { wireTeaser } from '@/lib/wire/read';
import '@/components/wire/wire.css';
import { standingsSnapshot, marketRows, weekLeaders, leagueReads } from '@/lib/gridiron/landingModules';
import RankRail from '@/components/league/RankRail';
import GamesStrip from '@/components/league/GamesStrip';
import LeagueScores from '@/components/league/LeagueScores';
import { railFor } from '@/lib/gridiron/leagueRail';
import { railChips, stripTiles } from '@/lib/gridiron/leagueLanding';
import { loadRecordChips } from '@/lib/gridiron/recordsLoader';
import { readViewerTz } from '@/lib/gridiron/serverTz';
import { GAME_META, GAME_ORDER } from '@/lib/games/lobby';
import { gamesLobby } from '@/lib/games/read';
import '@/components/league/league.css';

export default async function TodayPage({ leagueSlug, leagueLabel, searchParams }) {
  const sp = (await searchParams) ?? {};
  // 3.1.1: the league pages are reachable inside the native container
  // (capacitor allowNavigation covers sportsvyn.com), so the Suite teaser's
  // the pricing CTA must not render there.
  // THE VIEWER, for the games strip only. A signed-out reader still sees every
  // tile and its lock - those are true for everybody - but no volt button,
  // because the action is not available to them yet.
  const session = await auth().catch(() => null);
  const userId = session?.user?.id ?? null;
  const now = new Date();
  const seasonYear = resolveSeasonYear(now);
  // Pin to the nearest UPCOMING week (the season opener during the offseason),
  // not the prior season's final slate; fall back to the latest started week.
  const upcoming = await getNearestUpcomingWeek(leagueSlug, seasonYear);
  const cur = upcoming ?? (await getCurrentWeek(leagueSlug, seasonYear));
  const phase = (sp.phase === 'POST' || sp.phase === 'REG') ? sp.phase : (cur?.seasonPhase ?? 'REG');
  const week = Number(sp.week) || cur?.week || 1;

  const slate = await getWeekSlate(leagueSlug, seasonYear, phase, week);

  // ---- v1.3 LEAGUE LANDING ------------------------------------------------
  // Each read is caught to its own empty value: the rail, the strip and the
  // record chips are all decoration on top of a screen that must render
  // without them. None of the three may take the landing down.
  const isNfl = leagueSlug === 'nfl';
  const { currentApWeek, latestPollSeason, AP_POLL } = await import('@/lib/cfb/rankings');
  const apSeason = isNfl ? null : await latestPollSeason(AP_POLL).catch(() => null);
  const apWeek = apSeason ? await currentApWeek(apSeason).catch(() => null) : null;
  const [railRows, lobby, recordChips, snapshot, market, leaders, reads, wire] = await Promise.all([
    railFor(leagueSlug, { season: seasonYear, apWeek }),
    gamesLobby(userId ?? null).catch(() => null),
    loadRecordChips(),
    standingsSnapshot(leagueSlug, seasonYear, { userId }),
    marketRows(leagueSlug),
    weekLeaders(leagueSlug, seasonYear, week),
    leagueReads(leagueSlug),
    wireTeaser(leagueSlug).catch(() => ({ items: [], newest: null })),
  ]);
  const viewerTz = await readViewerTz();
  const chips = railChips(railRows);
  const lobbyCards = Object.fromEntries((lobby?.cards ?? []).filter(Boolean).map((c) => [c.key, c]));
  const tiles = stripTiles({
    leagueSlug, meta: GAME_META, order: GAME_ORDER, cards: lobbyCards, signedIn: userId != null,
  });
  // Every game on the week, flattened, for the scores module and the live pill.
  const allGames = slate.byDay.flatMap((d) => d.games);

  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav={leagueSlug} />

      {/* THE v1.3 LANDING, above everything that predates it. Nothing below is
          retired this relay - relay B owns the retirements, and a dark gap
          between the two would be worse than a long page. */}
      <LeagueHeader
        label={leagueLabel}
        week={week}
        phase={phase}
        date={allGames[0]?.kickoffAt ?? null}
        games={allGames}
        leagueSlug={leagueSlug}
        pathname={`/${leagueSlug}`}
      />
      <RankRail
        chips={chips}
        title={isNfl ? 'Sportsvyn Power Rankings' : 'AP Top 25'}
        allHref={isNfl ? '/nfl/rankings?tab=power' : '/cfb/rankings'}
        allLabel={isNfl ? 'All 32 →' : 'All 25 →'}
      />
      <GamesStrip tiles={tiles} signedIn={userId != null} />
      <LeagueScores
        leagueSlug={leagueSlug}
        label={leagueLabel}
        games={allGames}
        records={recordChips}
        initialTz={viewerTz}
        now={now}
      />

      {/* THE WIRE SITS BETWEEN THE SCORES AND THE STANDINGS: what just
          happened, after what the games did and before what they add up to. */}
      <WireModule
        leagueSlug={leagueSlug}
        items={wire.items}
        newest={wire.newest}
        now={now}
      />

      <StandingsSnapshot
        snapshot={snapshot}
        leagueSlug={leagueSlug}
        href={`/${leagueSlug}/standings`}
      />
      <MarketModule
        rows={market}
        href={`/${leagueSlug}/market`}
        statuses={new Map(allGames.map((g) => [g.id, g.status]))}
      />
      {/* THE LEADERS TAIL POINTS AT THE LEAGUE'S OWN STANDINGS, not /stats.
          /stats is the World Cup stats page (hardcoded to fifa-wc-2026), so an
          "All stats →" from an NFL module was sending readers to soccer
          scoring leaders. It points there again when a gridiron stats surface
          exists. */}
      <WeekLeaders leaders={leaders} href={`/${leagueSlug}/standings`} />
      <ReadsModule reads={reads} />
    </div>
  );
}
