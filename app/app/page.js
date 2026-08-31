// /app — mobile shell entry. Server Component: fetches all 6 deck
// payloads concurrently from app/app/data.js, then hands them to the
// client deck via a single `cards` prop.
//
// Self-contained: data.js owns its own neon() client. No imports from
// lib/, components/, or any code outside app/app/.
//
// THAT ISOLATION IS NOW BROKEN ON PURPOSE, in one place: the launch guard
// below imports auth and the shell resolver. The rule it enforces cannot be
// local to this directory - it is the same rule the five tabs enforce, and a
// second private copy of it here is how the two would drift apart. (The layout
// already crossed the same line for NativeShellCookie, for the same reason.)
// The DATA layer is untouched; data.js remains self-contained.

import { auth } from '@/auth';
import { resolveShellMode } from '@/lib/shell/shell';
import { redirect } from 'next/navigation';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import AppShellClient from './app-shell';
import {
  readTodaysCard,
  readTeamPowerTop5,
  readPlayerPotTop5,
  readWatchScoresToday,
  readTheRead,
  readStatsTopScorers,
  readSchedule,
} from './data';

export const dynamic = 'force-dynamic';

export default async function AppShellPage({ searchParams }) {
  // ==========================================================================
  // THIS IS THE LAUNCH ROUTE, AND THAT IS WHY SIGNED-OUT LANDED HERE
  // ==========================================================================
  // capacitor.config.ts loads https://sportsvyn.com/app. So the container's
  // first paint is this editorial deck - not a tab, not sign-in - and it is
  // session-unaware: nothing above this line has ever called auth(). A
  // signed-out launch met six cards of scores and reading and no way in.
  //
  // THE FIRST RENDER IS PRE-COOKIE, deliberately unfixed. NativeShellCookie is
  // a client effect, so on a cold launch this page renders once with shell mode
  // still false, writes sv_shell, and reloads - and the redirect fires on that
  // second pass. The reader sees the deck for one paint. Closing that would
  // mean detecting the container server-side on a route that is also a real web
  // URL, which is the bug NativeShellCookie's own header warns about.
  //
  // IT RETURNS TO /games, NOT HERE. Everywhere else the rule is "return to the
  // tab you launched into", and this is the one place that would be wrong: /app
  // mounts no tab bar and no OnboardingGate, so returning a fresh account to it
  // would sign them in and strand them one paint short of picking a handle.
  // /games is the tabs, and the tabs are where the sheet fires.
  //
  // WHAT THIS DOES NOT DO is move the launch URL off this deck. That is a
  // capacitor.config.ts change and therefore a new binary, and whether the
  // container should still open on an editorial shell at all is a product call,
  // not a redirect.
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  requireSignInInShell({ isShell, userId, dest: '/games' });

  // ==========================================================================
  // THE APP OPENS ON GAMES (v0.3.1) - signed-in too, not just post-sign-in
  // ==========================================================================
  // capacitor.config.ts loads THIS route on every cold start and every
  // resumed-session relaunch; it is the container's front door and nothing
  // else. The launch-flow fix sent signed-OUT readers to sign-in (returning
  // to /games after auth), but a signed-IN launch still landed on the
  // editorial deck - a surface with no tab bar and no game. The ruling: the
  // app opens on GAMES, whoever you are. Both redirects resolve the same
  // product sentence: launch -> (sign in if needed) -> the games.
  //
  // WEB UNCHANGED: /app is also a real URL, and a browser visitor who
  // navigates to it still gets the deck - the redirect is shell-gated.
  // PUSH DEEP-LINKS UNAFFECTED: a push tap navigates AFTER launch as its own
  // navigation to the payload's url; this fires only on the /app document
  // itself.
  if (isShell && userId != null) redirect('/games');

  const [todaysCard, power, playerPot, watch, read, stats, schedule] = await Promise.all([
    readTodaysCard(),
    readTeamPowerTop5(),
    readPlayerPotTop5(),
    readWatchScoresToday(),
    readTheRead(),
    readStatsTopScorers(),
    readSchedule(),
  ]);

  const cards = { todaysCard, power, playerPot, watch, read, stats };
  return <AppShellClient cards={cards} schedule={schedule} />;
}
