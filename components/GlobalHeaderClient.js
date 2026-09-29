'use client';

/**
 * GlobalHeaderClient - GlobalHeader for a PRERENDERED page.
 *
 * GlobalHeaderServer calls auth() and reads the shell cookie, and either one
 * makes the page that renders it dynamic - which is how /market and, through
 * the root not-found, EVERY route had stopped being static. This wrapper is the
 * same client header fed from the browser instead: the shell flag from the
 * sv_shell cookie (AppTabBar's read), the session from /api/session after
 * mount. The static HTML is the signed-out header; a signed-in reader's label
 * and MEMBER chip arrive on hydration.
 *
 * OnboardingGate is NOT mounted here: it is a server component (auth + one
 * read). A handle-less reader still meets the sheet on the tabs, which is where
 * the shell sends every launch.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import GlobalHeader from '@/components/GlobalHeader';
import PushReRegister from '@/components/push/PushReRegister';
import { isShellClient } from '@/lib/shell/appTabs';

const subscribe = () => () => {};
const getShell = () => isShellClient({ cookie: document.cookie });
const getServerShell = () => false;

// `arcade` comes from the SERVER page that renders this (arcadeOn() there) - a
// client component cannot read the flag. tue-3.
export default function GlobalHeaderClient({ activeNav = null, arcade = false }) {
  const shell = useSyncExternalStore(subscribe, getShell, getServerShell);
  const [me, setMe] = useState({ user: null, isMember: false });
  useEffect(() => {
    let dead = false;
    fetch('/api/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!dead && j?.user) setMe(j); })
      .catch(() => {});
    return () => { dead = true; };
  }, []);
  return (
    <>
      <GlobalHeader
        session={me.user ? { user: me.user } : null}
        activeNav={activeNav}
        shell={shell}
        isMember={!!me.isMember}
        arcade={arcade}
      />
      <PushReRegister />
    </>
  );
}
