// components/boards/BoardPage.js - the route body both /weekly/board and
// /draft/board render: read the game's board, pick out the reader, draw it.
//
// THE READ IS SHARED, THE "YOU" IS NOT. gameBoard() has no viewer in it, so one
// 30 s cache entry per game serves every reader (the /market lesson of 25 Sep:
// a page everyone refreshes must not be one database round trip per viewer).
// boardView() then picks the reader's row out of the cached rows per request.
//
// A LIVE BOARD REFRESHES ITSELF: LiveRefresh (the scoreboard's 30 s
// router.refresh, paused while the tab is hidden) is mounted only while live.

import { unstable_cache } from 'next/cache';
import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import LiveRefresh from '@/components/scores/LiveRefresh';
import LiveBoard from '@/components/boards/LiveBoard';
import { gameBoard, boardView, BOARD_GAMES, MOVEMENT_MIN } from '@/lib/boards/live';
import { resolveShellMode } from '@/lib/shell/shell';
import { shellSigninHref } from '@/lib/shell/signinHref';

export const BOARD_REVALIDATE_SEC = 30;

const cachedBoard = unstable_cache(
  async (game) => gameBoard(game, { now: new Date() }),
  ['boards:gameBoard:v1'],
  { revalidate: BOARD_REVALIDATE_SEC, tags: ['live-boards'] },
);

const LIVE_NOTE = {
  weekly: 'Live totals of all six, before drop-worst, from the box scores (about five minutes behind play). The settle\'s score is the ruling.',
  draft: 'Live best-ball six from the box scores (about five minutes behind play) - the best six as of now, which can change. The settle\'s score is the ruling.',
};

const etLabel = (iso) => (iso ? new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
}).format(new Date(iso)) + ' ET' : null);

export default async function BoardPage({ game }) {
  const g = BOARD_GAMES[game];
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const shell = await resolveShellMode().catch(() => null);
  const signinHref = shellSigninHref(g.path, shell?.isShell ?? false);
  const b = await cachedBoard(game).catch(() => null) ?? { state: 'none', rows: [], contest: null };
  const view = boardView(b.rows ?? [], uid, { top: 10 });
  return (
    <div className="lbpage">
      <GlobalHeaderServer activeNav="games" />
      {b.state === 'live' ? <LiveRefresh /> : null}
      <LiveBoard
        title={g.title} state={b.state} view={view} week={b.contest?.week ?? null}
        homeHref={g.home} signedIn={uid != null} signinHref={signinHref}
        firstKickoffLabel={etLabel(b.firstKickoff)} minutes={MOVEMENT_MIN}
        liveNote={LIVE_NOTE[game]}
      />
      <SiteFooter />
    </div>
  );
}
