/**
 * /leagues/new - the create sheet (canvas "Leagues V1", board Create).
 *
 * Signed in only: a signed-out reader goes to sign-in and comes back HERE
 * (web and app alike - there is nothing to see on this page without an account).
 * The games offered are lib/leagues/settings.js leagueGameChoices(): the
 * registry minus Survivor while its flag is off. The start anchors are read
 * once, server-side, so the "Week 5 to Week 18" line is the schedule's.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { leagueGameChoices } from '@/lib/leagues/settings';
import { loadStartAnchors } from '@/lib/leagues/start';
import { survivorOn } from '@/lib/survivor/flag';
import CreateLeagueForm from '@/components/leagues/CreateLeagueForm';
import '../leaguesV1.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New league - Sportsvyn' };

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function NewLeaguePage() {
  const session = await auth();
  const isShell = await resolveShellMode();
  if (!session?.user?.id) redirect(shellSigninHref('/leagues/new', isShell));
  const anchors = await loadStartAnchors().catch(() => ({ nfl: null, day: null }));
  const survivor = survivorOn();
  return <CreateLeagueForm choices={leagueGameChoices({ survivor })} anchors={anchors} survivor={survivor} />;
}
