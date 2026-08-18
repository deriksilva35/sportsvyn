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
  requireSignInInShell({
    isShell: await resolveShellMode((await searchParams) ?? {}),
    userId: session?.user?.id ?? null,
    dest: '/games',
  });

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
