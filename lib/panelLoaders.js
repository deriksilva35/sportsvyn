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
} from './dashboard.js';
import TodayNextPanel from '@/components/my/TodayNextPanel';
import SchedulePanel from '@/components/my/SchedulePanel';
import GroupsPanel from '@/components/my/GroupsPanel';
import MentionedPanel from '@/components/my/MentionedPanel';
import LiveNowPanel from '@/components/my/LiveNowPanel';

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
};
