// app/you/page.js - the You tab.
//
// IT ABSORBS /account's CONTENT, and /account is untouched this relay (Q1):
// two pages overlap briefly, which is safer than landing a redirect in the
// same merge as a new route. The redirect, the shell chip repoint and
// YourDrafts' new home are the relay after this one.
//
// SIGNED OUT IS A REAL PAGE, not a redirect. /account throws a signed-out
// reader at /signin; this tab shows them what an account is for first, which
// is the only reason a stranger would want one.

import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import You from '@/components/you/You';
import { youView } from '@/lib/you/reads';
import { auth } from '@/auth';
import { readViewerTz } from '@/lib/gridiron/serverTz';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'You - Sportsvyn', robots: { index: false, follow: false } };

export default async function YouPage() {
  const [session, tz, isShell] = await Promise.all([
    auth().catch(() => null),
    readViewerTz().catch(() => null),
    resolveShellMode().catch(() => false),
  ]);
  const v = await youView({ userId: session?.user?.id ?? null, tz });
  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav="you" />
      <You v={v} signinHref={shellSigninHref('/you', isShell)} />
      {!isShell && <SiteFooter />}
    </div>
  );
}
