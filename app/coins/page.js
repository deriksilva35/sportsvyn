// app/coins/page.js - THE DRUM (coins-2 B3; mock "Sportsvyn Coins - Weekly
// Raffle" screens 2-3; Rules v0.1 s4-s5).
//
// 404 unless COINS=on. Signed out it still shows the week, the drums and their
// live counts - the odds are public by the rules - with a sign-in line where
// the coins would be. Everything a reader can change goes through
// POST /api/coins/drop (components/coins/DrumClient.js).

import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import DrumClient from '@/components/coins/DrumClient';
import { coinsEnabled } from '@/lib/coins/mint';
import { drumView } from '@/lib/coins/drum';
import { countdown } from '@/lib/coins/copy';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';
import '@/components/coins/coins.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'The Drum - Sportsvyn' };

export default async function CoinsPage() {
  if (!coinsEnabled()) notFound();
  const [session, isShell] = await Promise.all([auth().catch(() => null), resolveShellMode().catch(() => false)]);
  const now = new Date();
  const view = await drumView({ userId: session?.user?.id ?? null, now });
  return (
    <div data-surface="ink">
      <GlobalHeaderServer activeNav="games" />
      <main className="cn">
        <div className="cn-top">
          <Link href="/games" aria-label="Back to Games">Games</Link>
          <h1 className="cn-mono">THE DRUM</h1>
          <Link href="/coins/rules">Rules</Link>
        </div>
        {view.week
          ? <DrumClient view={view} countdownText={countdown(view.week.closesAt, now)} signinHref={shellSigninHref('/coins', isShell)} />
          : <div className="cn-note">The first week of coins opens Tuesday at 9:00 am PT. Every game you play from then fills your coin meter.</div>}
      </main>
      {!isShell && <SiteFooter />}
    </div>
  );
}
