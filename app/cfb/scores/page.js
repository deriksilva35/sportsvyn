// app/cfb/scores/page.js — retired to /scores?sport=cfb (tue-12, post-flip).
//
// proxy.js answers this path with a bare 308 before Next ever routes here, so
// this file is the SECOND LINE, for the day the matcher is narrowed (the same
// arrangement as /membership). The league-pinned ScoresView it used to mount is
// gone: one board, and the league is a chip on it. lib/scores/leagueScoreboards.js
// holds the destination for both.
import { permanentRedirect } from 'next/navigation';
import { scoreboardRedirectFromParams } from '@/lib/scores/leagueScoreboards';

export const dynamic = 'force-dynamic';

export default async function CFBScores({ searchParams }) {
  permanentRedirect(scoreboardRedirectFromParams('/cfb/scores', (await searchParams) ?? {}));
}
