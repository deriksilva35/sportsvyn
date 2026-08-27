// lib/panelLoaders.js -- My Sportsvyn panel BINDINGS (server-only).
//
// Sibling to lib/panels.js (the pure metadata registry) and lib/my/reads.js
// (the dashboard's readers). This file is server-only: it imports readers and
// panel components, so it must never be pulled into a client bundle - import
// the metadata from lib/panels.js for client UI instead.
//
// PANEL_BINDINGS maps a panel id to { Component, load }, where load(followedIds,
// ctx) returns the PROPS OBJECT for that Component. Every registered panel has
// a binding now; the "registered but unbuilt" state that produced silently
// skipped ids is gone with the WC panels.
//
// PHASE 1: every loader below is league-agnostic or explicitly multi-league.
// The `fifa-wc-2026` literal that used to sit in seven of them appears nowhere
// in this file or in lib/my/reads.js, and the tests pin its absence.
//
// ALL READS. No loader writes; the only writer on this surface is
// saveUserLayout, which is a server action, not a panel.

import { getDailyHome, getYesterday } from './daily/entries.js';
import { pickemCardData, pickemBoardView } from './pickem/entry.js';
import { getWeeklyHome } from './weekly/entries.js';
import { getDraftHome } from './draft/entry.js';
import { getDraftHistory } from './fantasy/drafts.js';
import { getMovementCard } from './fantasy/movement.js';
import { apPollTop } from './cfb/rankings.js';
import {
  myTodayAndNext, myLiveNow, mySlate, myFollowedTeamNext, myFollowedPlayers,
} from './my/reads.js';

import {
  ContestsPanel, PickemPanel, FantasyPanel, MoversPanel, TodayNextPanel,
  LiveNowPanel, RankingsPanel, SchedulePanel, YourPlayersPanel,
} from '@/components/my/panels';
import WatchBoard from '@/components/my/WatchBoard';

export const PANEL_BINDINGS = {
  // contests: daily_entries + contests via the four existing home readers.
  contests: {
    Component: ContestsPanel,
    load: async (_ids, ctx) => {
      const [daily, yesterday, pickem, weekly, draft] = await Promise.all([
        getDailyHome(ctx?.userId).catch(() => null),
        getYesterday(ctx?.userId).catch(() => null),
        pickemCardData(ctx?.userId).catch(() => null),
        getWeeklyHome(ctx?.userId).catch(() => null),
        getDraftHome(ctx?.userId).catch(() => null),
      ]);
      return { daily, yesterday, pickem, weekly, draft };
    },
  },
  // pickem: contests.board + contest_entries, through the existing view.
  pickem: {
    Component: PickemPanel,
    load: async (_ids, ctx) => ({ view: await pickemBoardView(ctx?.userId).catch(() => null) }),
  },
  // fantasy: drafts + draft_configs.
  fantasy: {
    Component: FantasyPanel,
    load: async (_ids, ctx) => ({ drafts: await getDraftHistory(ctx?.userId).catch(() => []) }),
  },
  // movers: sim_player_pool snapshots via getMovementBoard, plus nfl_players
  // for the rookie set. PPR-12 is the board's own default pool.
  movers: {
    Component: MoversPanel,
    load: async () => ({ card: await getMovementCard('ppr', 5).catch(() => null) }),
  },
  // today / live / watch: matches + leagues + teams, MY_LEAGUES predicate.
  today: {
    Component: TodayNextPanel,
    load: async () => ({ games: await myTodayAndNext({ limit: 3 }) }),
  },
  live: {
    Component: LiveNowPanel,
    load: async () => ({ games: await myLiveNow() }),
  },
  watch: {
    Component: WatchBoard,
    load: async () => ({ games: await mySlate() }),
  },
  // rankings: ap_rankings, selected BY POLL NAME never by index.
  rankings: {
    Component: RankingsPanel,
    load: async () => ({ poll: await apPollTop(5).catch(() => []) }),
  },
  // schedule / players: user_team_follows / user_player_follows, both of which
  // FK to the shared teams/players tables with no league column.
  schedule: {
    Component: SchedulePanel,
    // followCount distinguishes "no follows" from "follows, nothing scheduled".
    load: async (ids, ctx) => ({
      games: await myFollowedTeamNext(ctx?.userId),
      followCount: ids?.size ?? ids?.length ?? 0,
    }),
  },
  players: {
    Component: YourPlayersPanel,
    load: async (_ids, ctx) => ({ players: await myFollowedPlayers(ctx?.userId) }),
  },
};
