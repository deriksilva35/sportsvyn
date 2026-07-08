// lib/panelLoaders.js -- My Sportsvyn panel BINDINGS (server-only).
//
// Sibling to lib/dashboard.js (the server readers) and lib/panels.js (the pure
// metadata registry). This file is server-only: it imports the readers and the
// panel components, so it must never be pulled into a client bundle (import the
// metadata from lib/panels.js for client UI instead).
//
// PANEL_BINDINGS maps a panel id to { Component, load }, where load(followedIds)
// returns the PROPS OBJECT for that Component (followedSet is added by the page,
// not here). The render loop spreads it: <Component {...await load(ids)}
// followedSet={...} />. Only the 5 BUILT panels have a binding; the other 7
// registry ids exist in metadata only, and the render loop skips any active id
// with no binding (correct behaviour until each is built -- no stub components).
//
// NOTE: the schedule loader calls getFollowedFixtures straight, with NO dedup.
// Subtracting Today & Next's next-ids from the schedule list is a cross-panel
// concern reconciled at the page level, not inside an isolated loader.

import {
  getTodayAndNext,
  getFollowedFixtures,
  getFollowedGroups,
  getMentionedReads,
  getLiveNow,
  getFollowedPlayers,
  getMarketPanelData,
} from './dashboard.js';
import { getTopN } from './rankings.js';
import { getScorers } from './stats.js';
import { getTodayWatchboard } from './watchScore.js';
import TodayNextPanel from '@/components/my/TodayNextPanel';
import SchedulePanel from '@/components/my/SchedulePanel';
import GroupsPanel from '@/components/my/GroupsPanel';
import MentionedPanel from '@/components/my/MentionedPanel';
import LiveNowPanel from '@/components/my/LiveNowPanel';
import RankingsPanel from '@/components/my/RankingsPanel';
import GoldenBootPanel from '@/components/my/GoldenBootPanel';
import WatchPanel from '@/components/my/WatchPanel';
import YourPlayersPanel from '@/components/my/YourPlayersPanel';
import MarketPanel from '@/components/my/MarketPanel';

const WC_LEAGUE_SLUG = 'fifa-wc-2026';

export const PANEL_BINDINGS = {
  today: {
    Component: TodayNextPanel,
    // getTodayAndNext returns { recent, next } -- the component's props as-is.
    load: async (followedIds) => await getTodayAndNext(followedIds),
  },
  schedule: {
    Component: SchedulePanel,
    load: async (followedIds) => ({ fixtures: await getFollowedFixtures(followedIds, { limit: 12 }) }),
  },
  groups: {
    Component: GroupsPanel,
    load: async (followedIds) => ({ groups: await getFollowedGroups(followedIds) }),
  },
  mentioned: {
    Component: MentionedPanel,
    load: async (followedIds) => ({ reads: await getMentionedReads(followedIds, { limit: 5 }) }),
  },
  live: {
    Component: LiveNowPanel,
    load: async (followedIds) => ({ matches: await getLiveNow(followedIds) }),
  },
  // The three MORE panels below are tournament-wide boards: their loaders are
  // follow-INDEPENDENT (they ignore followedIds); the page adds followedSet at
  // render for volt highlighting only.
  rankings: {
    Component: RankingsPanel,
    load: async () => ({ board: await getTopN({ listSlug: 'team-power', leagueSlug: WC_LEAGUE_SLUG, limit: 48 }) }),
  },
  goldenboot: {
    Component: GoldenBootPanel,
    load: async () => ({ scorers: await getScorers(WC_LEAGUE_SLUG, 6) }),
  },
  watch: {
    Component: WatchPanel,
    load: async () => ({ matches: await getTodayWatchboard() }),
  },
  // players: follow-independent of TEAMS. The page passes followed PLAYER ids
  // via the optional second `ctx` arg; the five shipped loaders above take only
  // (followedIds) and ignore it (JS drops extra args), so no signature churn.
  players: {
    Component: YourPlayersPanel,
    load: async (followedIds, ctx) => ({ players: await getFollowedPlayers(ctx?.followedPlayerIds ?? []) }),
  },
  // market: tournament-wide (follow-INDEPENDENT data); the page adds followedSet
  // at render for the volt treatment only. Same shape as rankings/watch.
  market: {
    Component: MarketPanel,
    load: async () => await getMarketPanelData(),
  },
};
