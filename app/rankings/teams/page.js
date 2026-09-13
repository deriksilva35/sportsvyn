// app/rankings/teams/page.js - ALL 138 / ALL 32, the one list.
//
// THIS IS THE FOLLOW UI (item 3). Reached from Your teams and the conference
// module, never from Our Top 25 - that module is a ranking, not a directory.
//
// THE LEFT COLUMN IS THE AP RANK, dash where there is none (R2). There is no
// 138-team power ranking on PROD and inventing an order would be pretending.

import GlobalHeaderServer from '@/components/GlobalHeaderServer';
import AllTeams from '@/components/rankings/AllTeams';
import { auth } from '@/auth';
import { getFollowedTeamIds } from '@/lib/follows';
import { getLeagueRecords } from '@/lib/standings/read';
import { apTop25 } from '@/lib/rankings/reads';
import { resolveSeasonYear } from '@/lib/pollers/seasonResolver';
import { shellSigninHref } from '@/lib/shell/signinHref';
import { resolveShellMode } from '@/lib/shell/shell';
import { LEAGUE_LABEL, LEAGUES } from '@/lib/rankings/view';
import '@/components/gridiron/gridiron.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'All teams - Sportsvyn' };

const one = (v) => (Array.isArray(v) ? v[0] : v);

export default async function AllTeamsPage({ searchParams }) {
  const sp = (await searchParams) ?? {};
  const league = LEAGUES.includes(one(sp.league)) ? one(sp.league) : 'nfl';
  const season = resolveSeasonYear(new Date());
  const [session, isShell] = await Promise.all([auth().catch(() => null), resolveShellMode().catch(() => false)]);
  const userId = session?.user?.id ?? null;
  const [rows, followed, ap] = await Promise.all([
    getLeagueRecords(league, season, league === 'cfb' ? { classification: 'fbs' } : {}).catch(() => []),
    userId == null ? Promise.resolve(new Set()) : getFollowedTeamIds(userId).catch(() => new Set()),
    league === 'cfb' ? apTop25().catch(() => null) : Promise.resolve(null),
  ]);
  const apByTeam = new Map((ap?.rows ?? []).map((r) => [r.teamId, r.rank]));
  const teams = rows.map((r) => ({
    id: r.team_id, name: r.short_name ?? r.name, fullName: r.name,
    abbreviation: r.abbreviation ?? null,
    colors: { primary: r.color_primary ?? null, secondary: r.color_secondary ?? null },
    group: league === 'nfl' ? [r.conference, r.division].filter(Boolean).join(' ') : (r.conference ?? 'Other'),
    record: `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}`,
    apRank: apByTeam.get(r.team_id) ?? null,
  })).sort((a, b) => (a.apRank ?? 999) - (b.apRank ?? 999) || a.name.localeCompare(b.name));
  return (
    <div className="gi" data-surface="ink">
      <GlobalHeaderServer activeNav="rankings" />
      <AllTeams
        league={league} label={LEAGUE_LABEL[league]} teams={teams}
        initialFollowed={[...followed]} signedIn={userId != null}
        signinHref={shellSigninHref(`/rankings/teams?league=${league}`, isShell)}
      />
    </div>
  );
}
