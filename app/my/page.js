/**
 * /my (My Sportsvyn dashboard) — Phase 1.
 *
 * Server component, force-dynamic (reads auth() cookies, fans out one
 * DB query per active panel per request). No client JS this phase;
 * customize lives in Phase 2 once the write-action ships.
 *
 * Unauthenticated requests redirect to /signin with callbackUrl=/my
 * (no inline sign-in prompt here; /my is a logged-in surface by
 * design). Zero-follow state renders an empty card with a path to
 * /bracket to start building the dashboard.
 *
 * Panels are driven by the modular spine: getResolvedLayout resolves
 * the user's 'my'-scope layout (DEFAULT_ACTIVE when no row) against the
 * registry, PANEL_BINDINGS loads + renders each built panel. Render
 * order floats active conditional panels that have data (Live Now in
 * play) to the top, then the non-conditional panels in stored order.
 * The CSS grid (my.css) handles span widths via each panel's own
 * .panel-X wrapper; the page adds no inline grid-column.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getFollowedTeamIds } from '@/lib/follows';
import { getResolvedLayout } from '@/lib/dashboardLayout';
import { PANELS } from '@/lib/panels';
import { PANEL_BINDINGS } from '@/lib/panelLoaders';

import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import Wordmark from '@/components/Wordmark';

import './my.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'My Sportsvyn',
  robots: { index: false, follow: false },
};

function PageHeader({ followedCount }) {
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
        Following {followedCount} {followedCount === 1 ? 'team' : 'teams'}
      </div>
    </header>
  );
}

function EmptyState() {
  return (
    <section className="my-empty">
      <h2 className="my-empty-headline">Follow teams and they build your dashboard.</h2>
      <p className="my-empty-body">
        Tap the star on any team to follow them. Their fixtures, group,
        and coverage will gather here.
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

  const followedSet = await getFollowedTeamIds(userId);
  const followedCount = followedSet.size;

  if (followedCount === 0) {
    return (
      <>
        <SiteHeaderServer activeNav="my" />
        <main className="my-shell">
          <PageHeader followedCount={0} />
          <EmptyState />
        </main>
        <SiteFooter />
      </>
    );
  }

  const ids = Array.from(followedSet);
  const resolved = await getResolvedLayout(userId, 'my'); // /my is the 'my' scope
  const activeBound = resolved.filter((p) => PANEL_BINDINGS[p.id]); // only built panels render; unbuilt skipped
  const results = await Promise.all(activeBound.map((p) => PANEL_BINDINGS[p.id].load(ids)));
  const loaded = {};
  activeBound.forEach((p, i) => {
    loaded[p.id] = results[i];
  });

  // Page-level dedup: drop the fixtures already surfaced in Today & Next's
  // "next" list from the Schedule panel so one match never renders twice on a
  // screen. Cross-panel concern reconciled here (the schedule loader returns
  // the full list by design). Skip when either panel is inactive -- schedule
  // then shows all, which is correct.
  if (loaded.today && loaded.schedule) {
    const todayNextIds = new Set((loaded.today.next ?? []).map((f) => f.id));
    loaded.schedule.fixtures = loaded.schedule.fixtures.filter((f) => !todayNextIds.has(f.id));
  }

  // Render order with live float-to-top: active conditional panels that HAVE
  // data render first (in stored order), then all non-conditional active panels
  // (in stored order). A conditional with no data renders nothing. Which panels
  // are conditional comes from the registry flag, not a hardcoded id; a panel
  // "has data" when its loaded props carry a non-empty array. This reproduces
  // prod exactly: Live Now first when in play, absent otherwise, everything
  // else in DEFAULT_ACTIVE order.
  const hasData = (props) =>
    props != null && Object.values(props).some((v) => Array.isArray(v) && v.length > 0);
  const conditionalsWithData = activeBound.filter(
    (p) => PANELS[p.id].conditional && hasData(loaded[p.id]),
  );
  const nonConditionals = activeBound.filter((p) => !PANELS[p.id].conditional);
  const renderOrder = [...conditionalsWithData, ...nonConditionals];

  return (
    <>
      <SiteHeaderServer activeNav="my" />
      <main className="my-shell">
        <PageHeader followedCount={followedCount} />
        <div className="my-grid">
          {renderOrder.map((p) => {
            const { Component } = PANEL_BINDINGS[p.id];
            return (
              <Component
                key={p.id}
                {...loaded[p.id]}
                followedSet={followedSet}
              />
            );
          })}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
