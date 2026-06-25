// /app — mobile shell entry. Server Component: fetches all 6 deck
// payloads concurrently from app/app/data.js, then hands them to the
// client deck via a single `cards` prop.
//
// Self-contained: data.js owns its own neon() client. No imports from
// lib/, components/, or any code outside app/app/.

import AppShellClient from './app-shell';
import {
  readTodaysCard,
  readTeamPowerTop5,
  readPlayerPotTop5,
  readWatchScoresToday,
  readTheRead,
  readStatsTopScorers,
} from './data';

export const dynamic = 'force-dynamic';

export default async function AppShellPage() {
  const [todaysCard, power, playerPot, watch, read, stats] = await Promise.all([
    readTodaysCard(),
    readTeamPowerTop5(),
    readPlayerPotTop5(),
    readWatchScoresToday(),
    readTheRead(),
    readStatsTopScorers(),
  ]);

  const cards = { todaysCard, power, playerPot, watch, read, stats };
  return <AppShellClient cards={cards} />;
}
