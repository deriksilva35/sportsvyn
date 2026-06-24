/**
 * /my (My Sportsvyn dashboard) — Phase 1.
 *
 * Server component, force-dynamic (reads auth() cookies, fans out
 * five DB queries per request). No client JS this phase; customize
 * lives in Phase 2 once a prefs migration ships.
 *
 * Unauthenticated requests redirect to /signin with callbackUrl=/my
 * (no inline sign-in prompt here; /my is a logged-in surface by
 * design). Zero-follow state renders an empty card with a path to
 * /bracket to start building the dashboard.
 *
 * Panel order in DOM: LiveNow (only when non-empty), TodayNext,
 * Schedule, Groups, Mentioned. The CSS grid (my.css) handles span
 * widths; the page does not reorder visually.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { getFollowedTeamIds } from '@/lib/follows';
import {
  getFollowedFixtures,
  getTodayAndNext,
  getFollowedGroups,
  getMentionedReads,
  getLiveNow,
} from '@/lib/dashboard';

import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import Wordmark from '@/components/Wordmark';
import TodayNextPanel from '@/components/my/TodayNextPanel';
import SchedulePanel from '@/components/my/SchedulePanel';
import GroupsPanel from '@/components/my/GroupsPanel';
import MentionedPanel from '@/components/my/MentionedPanel';
import LiveNowPanel from '@/components/my/LiveNowPanel';

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
  const [todayAndNext, allFixtures, groups, reads, live] = await Promise.all([
    getTodayAndNext(ids),
    getFollowedFixtures(ids, { limit: 12 }),
    getFollowedGroups(ids),
    getMentionedReads(ids, { limit: 5 }),
    getLiveNow(ids),
  ]);

  // Dedup the two fixtures already in TodayNext.next from the
  // Schedule panel so the same match doesn't render twice on one
  // screen. Live matches stay in Schedule (TodayNext only carries
  // scheduled rows by spec).
  const todayNextIds = new Set(todayAndNext.next.map((f) => f.id));
  const scheduleFixtures = allFixtures.filter((f) => !todayNextIds.has(f.id));

  return (
    <>
      <SiteHeaderServer activeNav="my" />
      <main className="my-shell">
        <PageHeader followedCount={followedCount} />
        <div className="my-grid">
          {live.length > 0 && (
            <LiveNowPanel matches={live} followedSet={followedSet} />
          )}
          <TodayNextPanel
            recent={todayAndNext.recent}
            next={todayAndNext.next}
            followedSet={followedSet}
          />
          <SchedulePanel fixtures={scheduleFixtures} followedSet={followedSet} />
          <GroupsPanel groups={groups} followedSet={followedSet} />
          <MentionedPanel reads={reads} followedSet={followedSet} />
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
