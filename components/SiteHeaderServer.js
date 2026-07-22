/**
 * SiteHeaderServer — server shell that resolves the session and
 * prop-drills it into the client SiteHeader.
 *
 * Pages (app/match/[slug]/page.js + app/bracket/page.js) import THIS,
 * not the client SiteHeader directly. await auth() runs on the server,
 * the returned session (or null) is passed as a prop so the client
 * header can flip "Sign In · Become a Member" → "{email-local-part} ·
 * Sign out" without ever calling useSession() or needing
 * SessionProvider. Database sessions, server-resolved, no hydration
 * round-trip for session state — the cookie's already validated on the
 * server.
 */

import { auth } from '@/auth';
import { isMember } from '@/lib/fantasy/drafts';
import SiteHeader from '@/components/SiteHeader';

export default async function SiteHeaderServer({ activeNav = null }) {
  const session = await auth();
  // Only members hide the MEMBER upgrade link; signed-out visitors are
  // non-members. One indexed lookup, and only when there's a user to check.
  const member = session?.user?.id ? await isMember(session.user.id) : false;
  return <SiteHeader session={session} activeNav={activeNav} member={member} />;
}
