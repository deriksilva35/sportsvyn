// components/gridiron/TodayShell.js - the /nfl and /cfb Today tab.
//
// THIS IS THE LEAGUE DAY PAGE. The container's bar went to four (Play /
// Scores / Rankings / You) and the Today tab went with the fifth slot, so
// /nfl, /cfb and /epl now light SCORES - activeTabFor says so, and the way in
// is the Scores tab's league chips. The web header's TODAY is a different page
// at "/" and is untouched by this.
//
// IT REPLACES TodayPage's BODY, NOT ITS CHROME. The global header, the league
// header with its week eyebrow and live pill, and the section sub-nav are the
// league's furniture and every league route wears them; only what sits under
// them is the rebuild.
//
// THE SESSION IS RESOLVED ONCE, HERE. todayV2() takes a userId like every
// other reader in this tree, which is also what makes it testable without a
// request; isShell is resolved here too because a client component cannot
// read the cookie.

import { auth } from '@/auth';
import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import LeagueHeader from '@/components/league/LeagueHeader';
import TodayV2 from '@/components/gridiron/TodayV2';
import { todayV2 } from '@/lib/gridiron/todayV2';
import { resolveShellMode } from '@/lib/shell/shell';
import '@/components/league/league.css';

export default async function TodayShell({ leagueSlug, leagueLabel }) {
  const [session, isShell] = await Promise.all([
    auth().catch(() => null),
    resolveShellMode().catch(() => false),
  ]);
  const userId = session?.user?.id ?? null;
  const now = new Date();
  const v = await todayV2({ leagueSlug, userId, now });
  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav={leagueSlug} />
      <LeagueHeader
        label={leagueLabel}
        week={v.week}
        phase={v.phase}
        games={[]}
        leagueSlug={leagueSlug}
        pathname={`/${leagueSlug}`}
      />
      <TodayV2 v={v} isShell={isShell} />
    </div>
  );
}
