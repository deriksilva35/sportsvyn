// /app — mobile shell entry. Server Component: fetches all 6 deck
// payloads concurrently from app/app/data.js, then hands them to the
// client deck via a single `cards` prop.
//
// Self-contained: data.js owns its own neon() client. No imports from
// lib/, components/, or any code outside app/app/.

import AppShellClient from './app-shell';
import {
  readNextUp,
  readTeamPowerTop5,
  readPlayerPotTop5,
  readWatchScoresToday,
  readTheRead,
  readTheMarket,
} from './data';

export const dynamic = 'force-dynamic';

export default async function AppShellPage() {
  const [nextUp, power, playerPot, watch, read, market] = await Promise.all([
    readNextUp(),
    readTeamPowerTop5(),
    readPlayerPotTop5(),
    readWatchScoresToday(),
    readTheRead(),
    readTheMarket(),
  ]);

  const cards = { nextUp, power, playerPot, watch, read, market };
  return <AppShellClient cards={cards} />;
}
