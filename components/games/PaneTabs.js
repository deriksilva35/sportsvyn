'use client';

/**
 * components/games/PaneTabs.js - the lobby's pane switcher.
 *
 * THE WIRE DOES NOT CHANGE. The panes stay URL params and stay
 * server-rendered - that was chosen so each pane's payload can be fetched and
 * leak-tested independently, which is the guarantee holding the standings law
 * on this page. lib/games/lobbyLeak.test.mjs and personalLeak.test.mjs assert
 * on gamesLobby()'s serialized output and are untouched by this file. Only the
 * PAINT changes.
 *
 * WHY THERE WAS A FLASH. These were plain <a> tags, so every tab was a full
 * document navigation: the browser tore down the page and painted the next one
 * from scratch, with a blank frame in between. next/link does a soft
 * navigation instead - React keeps the current tree mounted and swaps the
 * server payload in when it arrives, so the outgoing pane stays on screen
 * until the incoming one is ready. No blank frame, no layout jump.
 *
 * PREFETCH IS THE OTHER HALF. Four panes on one screen, all cheap; prefetching
 * means the swap is usually instant rather than a round trip.
 *
 * THE PENDING STATE IS ON THE TAB THAT WAS TAPPED, not a page-wide spinner. A
 * reader who taps LEADERBOARDS wants to know THAT tap registered; dimming the
 * whole pane to say so would reintroduce the flash it is here to remove.
 */

import { useTransition, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PANES, PANE_LABEL } from '@/lib/games/lobby';

export default function PaneTabs({ pane }) {
  const [isPending, startTransition] = useTransition();
  const [wanted, setWanted] = useState(null);
  const router = useRouter();

  const href = (p) => (p === 'games' ? '/games' : `/games?pane=${p}`);

  return (
    <nav className="ptabs" aria-label="Games sections" data-pending={isPending ? '1' : undefined}>
      {PANES.map((p) => {
        const on = p === pane;
        // The tab that was tapped, until its payload lands. Cleared when the
        // transition ends - which is also when `pane` becomes this tab.
        const loading = isPending && wanted === p && !on;
        return (
          <Link
            key={p}
            href={href(p)}
            prefetch
            className={`pt${on ? ' pt--on' : ''}${loading ? ' pt--load' : ''}`}
            aria-current={on ? 'page' : undefined}
            onClick={(e) => {
              // The href stays real, so this still works without JS and still
              // opens in a new tab on a modifier-click - the handler only takes
              // over the plain-tap case to add the pending state.
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              if (on) return;
              setWanted(p);
              startTransition(() => router.push(href(p)));
            }}
          >
            {PANE_LABEL[p]}
          </Link>
        );
      })}
    </nav>
  );
}
