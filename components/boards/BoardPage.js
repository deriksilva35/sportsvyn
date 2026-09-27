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
import { myLeagues, leagueMemberIds } from '@/lib/leagues/core';

export const BOARD_REVALIDATE_SEC = 30;

// THE CACHE KEY CARRIES THE LEAGUE: unstable_cache keys on its arguments, so
// National and each league are separate 30 s entries.
const cachedBoard = unstable_cache(
  async (game, memberIds = null) => gameBoard(game, { now: new Date(), memberIds }),
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

export default async function BoardPage({ game, searchParams = null }) {
  const g = BOARD_GAMES[game];
  const session = await auth();
  const uid = session?.user?.id ?? null;
  const shell = await resolveShellMode().catch(() => null);
  const signinHref = shellSigninHref(g.path, shell?.isShell ?? false);
  // ?league=<id> PICKS ONE OF THE READER'S OWN LEAGUES; anything else is
  // National. The filter is built from their memberships, never from the URL,
  // so a guessed id shows National rather than somebody else's league.
  const q = (await searchParams) ?? {};
  const leagues = uid == null ? [] : await myLeagues(Number(uid)).catch(() => []);
  const picked = leagues.find((l) => String(l.id) === String(q.league ?? '')) ?? null;
  const memberIds = picked ? (await leagueMemberIds(picked.id).catch(() => [])).map(Number).sort((a, b) => a - b) : null;
  const b = await cachedBoard(game, memberIds).catch(() => null) ?? { state: 'none', rows: [], contest: null };
  const chips = [{ label: 'National', href: g.path, on: picked == null },
    ...leagues.map((l) => ({ label: l.name, href: `${g.path}?league=${l.id}`, on: picked?.id === l.id }))];
  const view = boardView(b.rows ?? [], uid, { top: 10 });
  return (
    <div className="lbpage">
      <GlobalHeaderServer activeNav="games" />
      {b.state === 'live' ? <LiveRefresh /> : null}
      <LiveBoard
        title={g.title} state={b.state} view={view} week={b.contest?.week ?? null}
        homeHref={g.home} signedIn={uid != null} signinHref={signinHref}
        firstKickoffLabel={etLabel(b.firstKickoff)} minutes={MOVEMENT_MIN}
        liveNote={LIVE_NOTE[game]} chips={chips}
      />
      <SiteFooter />
    </div>
  );
}
