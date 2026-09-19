/**
 * /games - the arcade's front door, and the app's Games tab through the shell.
 *
 * ONE SURFACE, TWO DOORS. The homepage is the publication's door and keeps the
 * Daily module and yesterday strip; this is the arcade's. Per app mock v0.2 the
 * same lobby renders as the native Games tab, so it is built once here rather
 * than twice.
 *
 * v3 IS THE WHOLE PAGE NOW (docs/design/mocks/games-v3.html). v2 answered "what
 * is there"; v3 answers "what should I do" - one now card, four game rows, four
 * chips - and there is no toggle between them, because two lobbies is two sets
 * of numbers to keep honest.
 *
 * CHIPS ARE URL PARAMS, NOT AN ISLAND, for the three reasons v2's panes were:
 * no hydration flash, a shareable link to any chip, and each chip's payload
 * fetched and leak-tested on its own. normalizeChip() maps every v2 ?pane=
 * value onto one of the four, so no bookmark that exists today breaks.
 *
 * THE STANDINGS LAW APPLIES TO EVERY NUMBER HERE. See lib/games/read.js: every
 * figure comes from a revealed day or a settled contest, with the single
 * exception of the viewer's own state in the game they are playing.
 */

import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import { resolveShellMode, simViewport } from '@/lib/shell/shell';
import { requireSignInInShell } from '@/lib/shell/signedOut';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { lobbyV3 } from '@/lib/games/lobbyV3';
import LobbyV3 from '@/components/games/LobbyV3';
import { normalizeChip } from '@/lib/games/lobby';
import './games.css';
import './lobbyV3.css';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'The Games - Sportsvyn',
  description: 'Game day, every day. One account. One handle. Every board.',
};

export async function generateViewport() {
  return simViewport(await resolveShellMode());
}

export default async function GamesPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const chip = normalizeChip(sp.pane);
  const boardKey = sp.b == null ? null : String(sp.b);
  const session = await auth();
  const userId = session?.user?.id ?? null;
  const isShell = await resolveShellMode();
  // GAMES WAS THE ODD ONE: no signed-out branch at all, so a stranger in the
  // container got the lobby - four cards, none of them playable. Same rule.
  requireSignInInShell({ isShell, userId, dest: '/games' });

  const v = await lobbyV3(userId, { chip, boardKey }).catch(() => null);

  return (
    <>
      <GlobalHeaderServer activeNav="games" />
      <main className="lob lv" data-surface="ink">
        {v
          ? (
            <LobbyV3
              v={v}
              chip={chip}
              signedIn={userId != null}
              signinHref={(dest) => shellSigninHref(dest, isShell)}
              userId={userId == null ? null : Number(userId)}
            />
          )
          : (
            <section className="mod">
              <p className="muted">The lobby is having a moment. Try again shortly.</p>
            </section>
          )}
      </main>
      <SiteFooter />
    </>
  );
}
