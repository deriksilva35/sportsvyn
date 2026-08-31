// app/nfl/scores/page.js — the board, inside the league.
//
// NOT A SECOND SCOREBOARD. This mounts the same ScoresView /scores mounts,
// with the league pinned by one prop, under the league header. /scores stays
// exactly as it was: the network surface, three codes, global header, league
// chips intact. Two wearings of one component, and neither is a copy.
//
// INSIDE A LEAGUE THE LEAGUE NEVER DISAPPEARS. That is the whole reason this
// route exists: tapping Scores from /nfl used to land on the network board,
// where the league header was gone and the only way back was the browser.
import { ScoresView } from '@/app/scores/page';
import LeagueHeader from '@/components/league/LeagueHeader';
import '@/components/league/league.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'NFL Scores - Sportsvyn' };

export default async function NFLScores({ searchParams }) {
  const sp = (await searchParams) ?? {};
  return (
    <>
      <LeagueHeader label="NFL" leagueSlug="nfl" pathname="/nfl/scores" />
      {await ScoresView({ sp, pinned: 'nfl' })}
    </>
  );
}
