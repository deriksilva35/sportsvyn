/**
 * /my (My Sportsvyn dashboard) — Phase 1.
 *
 * Server component, force-dynamic (reads auth() cookies, fans out one
 * DB query per BOUND panel per request). The server renders every bound
 * panel to an element and hands the { [id]: node } map plus the resolved
 * active layout to <DashboardCustomizer> (client), which owns normal-vs-
 * edit rendering, the Live Now float-to-top, and the .my-grid wrapper.
 * page.js no longer renders the grid itself.
 *
 * Unauthenticated requests redirect to /signin with callbackUrl=/my
 * (no inline sign-in prompt here; /my is a logged-in surface by
 * design). Zero-follow state renders an empty card with a path to
 * /bracket to start building the dashboard.
 *
 * Render-all-bound: we render EVERY bound panel (not just the active
 * ones) so a panel the user removed stays rendered-but-hidden and
 * toggling it back on is instant. The one exception is the conditional
 * 'live', omitted from the map when it has no matches (LiveNow has no
 * self empty-state). getResolvedLayout supplies the ordered active list
 * as the customizer's initialActive.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getFollowedTeamIds, getFollowedPlayerIds } from '@/lib/follows';
import { getResolvedLayout } from '@/lib/dashboardLayout';
import { PANELS } from '@/lib/panels';
import { PANEL_BINDINGS } from '@/lib/panelLoaders';

import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import Wordmark from '@/components/Wordmark';
import DashboardCustomizer from './CustomizeClient';

import './my.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'My Sportsvyn',
  robots: { index: false, follow: false },
};

function PageHeader({ teamCount = 0, playerCount = 0 }) {
  // The H1 reuses the macron pattern from components/Wordmark.js
  // (volt Y with an absolutely-positioned bar). Inline rather than
  // extending Wordmark because the prefix "MY " is dashboard-only
  // and Wordmark is invoked from many other surfaces unchanged.
  return (
    <header className="my-header">
      <div className="my-eyebrow">My Account</div>
      <h1 className="my-title">
        <span className="my-title-prefix">My </span>
        <span>Sportsv</span>
        <span className="my-title-y-wrap">
          Y
          <span aria-hidden="true" className="my-title-macron" />
        </span>
        <span>n</span>
      </h1>
      <div className="my-follow-count">
        Following {teamCount} {teamCount === 1 ? 'team' : 'teams'}
        {playerCount > 0 && (
          <> · {playerCount} {playerCount === 1 ? 'player' : 'players'}</>
        )}
      </div>
    </header>
  );
}

function EmptyState() {
  return (
    <section className="my-empty">
      <h2 className="my-empty-headline">Follow teams and players and they build your dashboard.</h2>
      <p className="my-empty-body">
        Tap the star on any team to follow them, and their fixtures, group, and
        coverage gather here. Or follow a player from any player page to track
        their output.
      </p>
      <a className="my-empty-cta" href="/world-cup-2026/bracket">Browse the bracket</a>
    </section>
  );
}

export default async function MyPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect('/signin?callbackUrl=/my');
  }
  const userId = session.user.id;

  const [followedSet, followedPlayerSet] = await Promise.all([
    getFollowedTeamIds(userId),
    getFollowedPlayerIds(userId),
  ]);
  const teamCount = followedSet.size;
  const playerCount = followedPlayerSet.size;

  // Gate on TOTAL follows: a player-only user (zero teams) passes and renders
  // (their Your Players panel populates; team panels show their own empty states).
  if (teamCount + playerCount === 0) {
    return (
      <>
        <SiteHeaderServer activeNav="my" />
        <main className="my-shell">
          <PageHeader teamCount={0} playerCount={0} />
          <EmptyState />
        </main>
        <SiteFooter />
      </>
    );
  }

  const ids = Array.from(followedSet);
  const followedPlayerIds = Array.from(followedPlayerSet);
  // Second arg to every loader. The five shipped loaders take only (followedIds)
  // and ignore it; the players loader reads ctx.followedPlayerIds.
  const ctx = { followedPlayerIds, followedPlayerSet };
  const resolved = await getResolvedLayout(userId, 'my'); // ordered active list -> initialActive

  // Render-all-bound: run EVERY bound panel's loader (not just the active ones)
  // so a panel the user removed stays rendered-but-hidden and re-adding it is
  // instant. The conditional 'live' is handled below (omitted when it has no
  // data). Today boundIds === DEFAULT_ACTIVE, so this loads the same set as the
  // active-only path did; the distinction only matters once a user customizes.
  const boundIds = Object.keys(PANEL_BINDINGS);
  const results = await Promise.all(boundIds.map((id) => PANEL_BINDINGS[id].load(ids, ctx)));
  const loadedProps = {};
  boundIds.forEach((id, i) => {
    loadedProps[id] = results[i];
  });

  // Page-level dedup (server-side data op): drop the fixtures already surfaced
  // in Today & Next's "next" list from Schedule so one match never renders twice.
  // Reconciled here because the schedule loader returns the full list by design.
  if (loadedProps.today && loadedProps.schedule) {
    const todayNextIds = new Set((loadedProps.today.next ?? []).map((f) => f.id));
    loadedProps.schedule.fixtures = loadedProps.schedule.fixtures.filter(
      (f) => !todayNextIds.has(f.id),
    );
  }

  // Build the { [id]: element } map the customizer places by id. Non-conditional
  // panels always render; a conditional panel ('live') is omitted when it has no
  // data, so the customizer treats it as not-showing (an empty LiveNow would
  // leave a stray header -- it has no self empty-state). "Has data" mirrors the
  // old float-gate: any loaded prop that is a non-empty array.
  const panels = {};
  for (const id of boundIds) {
    const props = loadedProps[id];
    if (PANELS[id].conditional) {
      const hasData =
        props && Object.values(props).some((v) => Array.isArray(v) && v.length > 0);
      if (!hasData) continue;
    }
    const { Component } = PANEL_BINDINGS[id];
    panels[id] = <Component key={id} {...props} followedSet={followedSet} followedPlayerSet={followedPlayerSet} />;
  }

  return (
    <>
      <SiteHeaderServer activeNav="my" />
      <main className="my-shell">
        <PageHeader teamCount={teamCount} playerCount={playerCount} />
        <DashboardCustomizer panels={panels} initialActive={resolved} />
      </main>
      <SiteFooter />
    </>
  );
}
