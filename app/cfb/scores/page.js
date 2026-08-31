// app/cfb/scores/page.js — the board, inside the league.
//
// NOT A SECOND SCOREBOARD. This mounts the same ScoresView /scores mounts,
// with the league pinned by one prop, under the league header. /scores stays
// exactly as it was: the network surface, three codes, global header, league
// chips intact. Two wearings of one component, and neither is a copy.
//
// INSIDE A LEAGUE THE LEAGUE NEVER DISAPPEARS. That is the whole reason this
// route exists: tapping Scores from /cfb used to land on the network board,
// where the league header was gone and the only way back was the browser.
import { ScoresView } from '@/app/scores/page';
import LeagueHeader from '@/components/league/LeagueHeader';
import '@/components/league/league.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'CFB Scores - Sportsvyn' };

export default async function CFBScores({ searchParams }) {
  const sp = (await searchParams) ?? {};
  // The view renders the wordmark band and then this, so the order on screen is
  // global header, league header, page - the same as every other league route.
  return ScoresView({
    sp,
    pinned: 'cfb',
    leagueHeader: await LeagueHeader({ label: 'CFB', leagueSlug: 'cfb', pathname: '/cfb/scores' }),
  });
}
