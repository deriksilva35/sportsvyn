/**
 * /world-cup-2026/bracket: namespaced 2026 FIFA World Cup bracket.
 *
 * Sibling of the legacy /bracket route during Phase 2 of the
 * competition-namespacing migration. Same render contract; the
 * differences from the legacy page are:
 *
 *   1. The competition is resolved from the URL segment via
 *      lib/competition.js. The resolver returns the leagues row +
 *      parsed surfaces from leagues.metadata.
 *   2. The bracket SURFACE is gated. If the resolved competition does
 *      not declare bracket=true in its metadata, the route 404s
 *      instead of rendering a partial page.
 *   3. lib/bracket.js readers receive the resolved comp.slug as an
 *      explicit argument. The lib still defaults to 'fifa-wc-2026'
 *      so legacy zero-arg callers keep working, but the namespaced
 *      route does not rely on that default.
 *
 * Render output is byte-identical to the legacy /bracket page modulo
 * the imports above. Same flag rendering, same group cards, same
 * knockout TBD scaffold, same volt-tint on followed-team names.
 *
 * The legacy /bracket folder remains in place this phase; Phase 3
 * wires the redirect /bracket -> /world-cup-2026/bracket in proxy.js
 * and deletes the old folder.
 */

import { notFound } from 'next/navigation';
import { auth } from '@/auth';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import BracketTabBar from '@/components/bracket/BracketTabBar';
import {
  GROUP_LETTERS,
  getGroupTeams,
  getGroupStandings,
  getGroupMatchdayProgress,
  getGroupStageComplete,
  computeAdvancement,
  getKnockoutBracket,
  getRemainingGroupFixtures,
} from '@/lib/bracket';
import { getFollowedTeamIds } from '@/lib/follows';
import {
  resolveCompetitionBySegment,
  requireBracketSurface,
} from '@/lib/competition';

import './bracket.css';

const COMPETITION_URL_SLUG = 'world-cup-2026';

export const metadata = {
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function BracketFlag({ flagSvgPath }) {
  if (flagSvgPath) {
    return (
      <span className="flag" aria-hidden="true">
        <img src={flagSvgPath} alt="" />
      </span>
    );
  }
  return <span className="flag" aria-hidden="true" />;
}

function AdvBadge({ status }) {
  if (status === 'through')      return <span className="adv-badge adv-through">THROUGH</span>;
  if (status === 'in_hunt')      return <span className="adv-badge adv-hunt">IN HUNT</span>;
  if (status === 'third_watch')  return <span className="adv-badge adv-watch">3RD WATCH</span>;
  if (status === 'out')          return <span className="adv-badge adv-out">OUT</span>;
  return <span className="adv-badge adv-empty">{'—'}</span>;
}

function GroupCard({ letter, teams, matchdayComplete, followedSet, advancement }) {
  return (
    <div className="group-card">
      <div className="group-card-header">
        <div className="group-card-label">
          <span className="grp">{letter}</span>
        </div>
        <div className="group-card-meta">{matchdayComplete} of 3</div>
      </div>
      <div className="team-row-v2-header">
        <span></span>
        <span></span>
        <span></span>
        <span>W-D-L</span>
        <span>GD</span>
        <span>PTS</span>
        <span>ADV</span>
      </div>
      {teams.map((team, idx) => {
        const wdl = `${team.wins}-${team.draws}-${team.losses}`;
        const gd  = team.gd > 0 ? `+${team.gd}` : `${team.gd}`;
        const pts = `${team.points}`;
        return (
          <div key={team.team_id} className="team-row-v2">
            <span className="pos">{idx + 1}</span>
            <BracketFlag flagSvgPath={team.flag_svg_path} />
            {team.slug ? (
              <a
                href={`/team/${team.slug}`}
                className={`name team-link${followedSet?.has(team.team_id) ? ' team-name-followed' : ''}`}
              >
                {team.name}
              </a>
            ) : (
              <span className={`name${followedSet?.has(team.team_id) ? ' team-name-followed' : ''}`}>{team.name}</span>
            )}
            <span className="num">{wdl}</span>
            <span className="num">{gd}</span>
            <span className="pts">{pts}</span>
            <AdvBadge status={advancement?.get(team.team_id) ?? null} />
          </div>
        );
      })}
    </div>
  );
}

// Short date label in PT, e.g. "JUL 1" -- matches the existing bracket
// visual language. kickoff_at is a UTC Date; converting to PT before
// formatting keeps the date that displays consistent with what fans see
// locally on the West Coast (where the schedule mostly anchors).
function fmtKoDate(kickoffAt) {
  if (!kickoffAt) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric',
  }).format(new Date(kickoffAt)).toUpperCase();
}

// Drop "Stadium"/"Field"/"Park" suffix in tight cells; the venue value is
// shown in the cell meta line. Falls back to full name if shortening would
// produce an empty string.
function shortVenue(name) {
  if (!name) return '';
  const stripped = name
    .replace(/\bStadium\b/g, '')
    .replace(/\bField\b/g, '')
    .replace(/\bPark\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || name;
}

// Data-driven cell. `match` is one row from getKnockoutBracket(). When
// home/away are unresolved (slot label only), renders as tbd-styled rows.
// When resolved (team_id set, post-resolver), renders flag + team name +
// score for finals.
function KnockoutCell({ match }) {
  if (!match) return null;
  const date = fmtKoDate(match.kickoff_at);
  const venue = shortVenue(match.venue);
  const bothResolved = match.home.resolved && match.away.resolved;
  return (
    <div className={`match-cell-v2${bothResolved ? '' : ' tbd'}`}>
      <div className="match-cell-v2-meta">
        <span>{date}</span>
        <span className="final-label">{venue}</span>
      </div>
      <KnockoutTeamRow side={match.home} score={match.home_score} status={match.status} />
      <KnockoutTeamRow side={match.away} score={match.away_score} status={match.status} />
    </div>
  );
}

function KnockoutTeamRow({ side, score, status }) {
  if (side.resolved) {
    return (
      <div className="match-team-v2">
        <BracketFlag flagSvgPath={side.flag_svg_path} />
        <span className="tname">{side.name}</span>
        <span className="tscore">{status === 'final' ? score : '\u2014'}</span>
      </div>
    );
  }
  return (
    <div className="match-team-v2 tbd">
      <span className="flag" aria-hidden="true" />
      <span className="tname">{side.label}</span>
      <span className="tscore">{'\u2014'}</span>
    </div>
  );
}

export default async function BracketPage() {
  const comp = await resolveCompetitionBySegment(COMPETITION_URL_SLUG);
  if (!requireBracketSurface(comp)) notFound();

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const [groupTeams, groupStandings, matchdayProgress, groupStageComplete, followedSet, knockoutBracket, remainingFixtures] = await Promise.all([
    getGroupTeams(comp.slug),
    getGroupStandings(comp.slug),
    getGroupMatchdayProgress(comp.slug),
    getGroupStageComplete(comp.slug),
    getFollowedTeamIds(userId),
    getKnockoutBracket(comp.slug),
    getRemainingGroupFixtures(comp.slug),
  ]);

  if (groupTeams.size === 0) notFound();

  // Pure JS over the standings + remaining fixtures already fetched.
  const advancement = computeAdvancement(groupStandings, remainingFixtures);

  const defaultTab = groupStageComplete ? 'tournament' : 'group';

  return (
    <>
      <SiteHeaderServer activeNav="bracket" />

      <main className="bracket-page">
        <div className="breadcrumb">
          <a href="/">Home</a>
          <span className="sep">/</span>
          <a href="/world-cup-2026/bracket">{comp.name}</a>
          <span className="sep">/</span>
          <span className="current">Bracket</span>
        </div>

        <BracketTabBar defaultTab={defaultTab} />

        {/* GROUP STAGE */}
        <section
          data-tab-panel="group"
          className={`group-strip tab-panel${defaultTab === 'group' ? ' active' : ''}`}
        >
          <div className="group-strip-header">
            <div className="group-strip-title">Group Stage</div>
            <div className="group-strip-stat">
              Group stage begins <span className="accent">June 11</span>
              {' · '}Standings populate as matches play
            </div>
          </div>
          <div className="groups-grid">
            {GROUP_LETTERS.map((letter) => {
              const teams = groupStandings.get(letter) ?? groupTeams.get(letter) ?? [];
              const matchdayComplete = matchdayProgress.get(letter) ?? 0;
              return (
                <GroupCard
                  key={letter}
                  letter={letter}
                  teams={teams}
                  matchdayComplete={matchdayComplete}
                  followedSet={followedSet}
                  advancement={advancement}
                />
              );
            })}
          </div>
        </section>

        {/* KNOCKOUT BRACKET, structure only until the draw is set */}
        <section
          data-tab-panel="tournament"
          className={`bracket-container tab-panel${defaultTab === 'tournament' ? ' active' : ''}`}
        >
          <div className="bracket-container-header">
            <div className="bracket-container-title">Knockout Bracket</div>
            <div className="group-strip-stat">
              R32 begins <span style={{ color: 'var(--volt)' }}>June 28</span>
              {' · '}Matchups set after group stage
            </div>
          </div>

          {/* Canonical WC 2026 bracket layout. Match numbers within each
              side are ordered so adjacent R32 cells feed the same R16,
              R16 cells feed the same QF, etc. force-dynamic on this page
              + getKnockoutBracket reading live ensures resolved teams
              show up automatically once the (step-2) resolver fills the
              home_team_id / away_team_id columns. */}
          <div className="bracket-b">
            <div className="round-col col-r32-l">
              <div className="round-header">R32</div>
              {[73, 75, 74, 77, 83, 84, 81, 82].map((mn) => (
                <KnockoutCell key={mn} match={knockoutBracket.get(mn)} />
              ))}
            </div>

            <div className="round-col col-r16-l">
              <div className="round-header">R16</div>
              {[89, 90, 93, 94].map((mn) => (
                <KnockoutCell key={mn} match={knockoutBracket.get(mn)} />
              ))}
            </div>

            <div className="round-col col-qf-l">
              <div className="round-header">QF</div>
              {[97, 98].map((mn) => (
                <KnockoutCell key={mn} match={knockoutBracket.get(mn)} />
              ))}
            </div>

            <div className="round-col col-sf-l">
              <div className="round-header">SF</div>
              <KnockoutCell match={knockoutBracket.get(101)} />
            </div>

            <div className="round-col col-trophy">
              <div className="trophy-cell">
                <div className="label">The Final</div>
                <div className="icon">{fmtKoDate(knockoutBracket.get(104)?.kickoff_at)}</div>
                <div className="who">{shortVenue(knockoutBracket.get(104)?.venue)}</div>
              </div>
              <div style={{ marginTop: 16, width: '100%' }}>
                <KnockoutCell match={knockoutBracket.get(103)} />
              </div>
            </div>

            <div className="round-col col-sf-r">
              <div className="round-header">SF</div>
              <KnockoutCell match={knockoutBracket.get(102)} />
            </div>

            <div className="round-col col-qf-r">
              <div className="round-header">QF</div>
              {[99, 100].map((mn) => (
                <KnockoutCell key={mn} match={knockoutBracket.get(mn)} />
              ))}
            </div>

            <div className="round-col col-r16-r">
              <div className="round-header">R16</div>
              {[91, 92, 95, 96].map((mn) => (
                <KnockoutCell key={mn} match={knockoutBracket.get(mn)} />
              ))}
            </div>

            <div className="round-col col-r32-r">
              <div className="round-header">R32</div>
              {[76, 78, 79, 80, 86, 88, 85, 87].map((mn) => (
                <KnockoutCell key={mn} match={knockoutBracket.get(mn)} />
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
