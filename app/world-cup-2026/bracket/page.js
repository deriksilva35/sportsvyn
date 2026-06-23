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

function TbdCell({ date, label, slotA, slotB }) {
  return (
    <div className="match-cell-v2 tbd">
      <div className="match-cell-v2-meta">
        <span>{date}</span>
        <span className="final-label">{label}</span>
      </div>
      <div className="match-team-v2 tbd">
        <span className="flag" aria-hidden="true" />
        <span className="tname">{slotA}</span>
        <span className="tscore">{'\u2014'}</span>
      </div>
      <div className="match-team-v2 tbd">
        <span className="flag" aria-hidden="true" />
        <span className="tname">{slotB}</span>
        <span className="tscore">{'\u2014'}</span>
      </div>
    </div>
  );
}

export default async function BracketPage() {
  const comp = await resolveCompetitionBySegment(COMPETITION_URL_SLUG);
  if (!requireBracketSurface(comp)) notFound();

  const session = await auth();
  const userId = session?.user?.id ?? null;

  const [groupTeams, groupStandings, matchdayProgress, groupStageComplete, followedSet, remainingFixtures] = await Promise.all([
    getGroupTeams(comp.slug),
    getGroupStandings(comp.slug),
    getGroupMatchdayProgress(comp.slug),
    getGroupStageComplete(comp.slug),
    getFollowedTeamIds(userId),
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

          <div className="bracket-b">
            {/* LEFT SIDE R32 */}
            <div className="round-col col-r32-l">
              <div className="round-header">R32</div>
              <TbdCell date="JUN 28" label="TBD" slotA="W A" slotB="2B" />
              <TbdCell date="JUN 28" label="TBD" slotA="W B" slotB="2A" />
              <TbdCell date="JUN 28" label="TBD" slotA="W C" slotB="2D" />
              <TbdCell date="JUN 28" label="TBD" slotA="W D" slotB="2C" />
              <TbdCell date="JUN 30" label="TBD" slotA="W E" slotB="2F" />
              <TbdCell date="JUN 30" label="TBD" slotA="W F" slotB="2E" />
              <TbdCell date="JUL 1"  label="TBD" slotA="3rd ABCD" slotB="3rd EFGH" />
              <TbdCell date="JUL 1"  label="TBD" slotA="3rd IJKL" slotB="3rd ABCD" />
            </div>

            {/* LEFT R16 */}
            <div className="round-col col-r16-l">
              <div className="round-header">R16</div>
              <TbdCell date="JUL 4" label="TBD" slotA="W1" slotB="W2" />
              <TbdCell date="JUL 4" label="TBD" slotA="W3" slotB="W4" />
              <TbdCell date="JUL 5" label="TBD" slotA="W5" slotB="W6" />
              <TbdCell date="JUL 5" label="TBD" slotA="W7" slotB="W8" />
            </div>

            {/* LEFT QF */}
            <div className="round-col col-qf-l">
              <div className="round-header">QF</div>
              <TbdCell date="JUL 10" label="TBD" slotA="QF1" slotB="QF1" />
              <TbdCell date="JUL 10" label="TBD" slotA="QF2" slotB="QF2" />
            </div>

            {/* LEFT SF */}
            <div className="round-col col-sf-l">
              <div className="round-header">SF</div>
              <TbdCell date="JUL 14" label="TBD" slotA="SF1" slotB="SF1" />
            </div>

            {/* TROPHY / FINAL */}
            <div className="round-col col-trophy">
              <div className="trophy-cell">
                <div className="label">The Final</div>
                <div className="icon">19.JUL</div>
                <div className="who">MetLife {'·'} 3PM</div>
              </div>
              <div style={{ marginTop: 16, width: '100%' }} className="match-cell-v2 tbd">
                <div className="match-cell-v2-meta">
                  <span>JUL 18</span>
                  <span className="final-label">3RD</span>
                </div>
                <div className="match-team-v2 tbd">
                  <span className="flag" aria-hidden="true" />
                  <span className="tname">L SF1</span>
                  <span className="tscore">{'\u2014'}</span>
                </div>
                <div className="match-team-v2 tbd">
                  <span className="flag" aria-hidden="true" />
                  <span className="tname">L SF2</span>
                  <span className="tscore">{'\u2014'}</span>
                </div>
              </div>
            </div>

            {/* RIGHT SF */}
            <div className="round-col col-sf-r">
              <div className="round-header">SF</div>
              <TbdCell date="JUL 15" label="TBD" slotA="SF2" slotB="SF2" />
            </div>

            {/* RIGHT QF */}
            <div className="round-col col-qf-r">
              <div className="round-header">QF</div>
              <TbdCell date="JUL 11" label="TBD" slotA="QF3" slotB="QF3" />
              <TbdCell date="JUL 11" label="TBD" slotA="QF4" slotB="QF4" />
            </div>

            {/* RIGHT R16 */}
            <div className="round-col col-r16-r">
              <div className="round-header">R16</div>
              <TbdCell date="JUL 6" label="TBD" slotA="W9"  slotB="W10" />
              <TbdCell date="JUL 6" label="TBD" slotA="W11" slotB="W12" />
              <TbdCell date="JUL 7" label="TBD" slotA="W13" slotB="W14" />
              <TbdCell date="JUL 7" label="TBD" slotA="W15" slotB="W16" />
            </div>

            {/* RIGHT SIDE R32 */}
            <div className="round-col col-r32-r">
              <div className="round-header">R32</div>
              <TbdCell date="JUN 29" label="TBD" slotA="W G" slotB="2H" />
              <TbdCell date="JUN 29" label="TBD" slotA="W H" slotB="2G" />
              <TbdCell date="JUN 29" label="TBD" slotA="W I" slotB="2J" />
              <TbdCell date="JUN 29" label="TBD" slotA="W J" slotB="2I" />
              <TbdCell date="JUN 30" label="TBD" slotA="W K" slotB="2L" />
              <TbdCell date="JUN 30" label="TBD" slotA="W L" slotB="2K" />
              <TbdCell date="JUL 1"  label="TBD" slotA="3rd EFGH" slotB="3rd IJKL" />
              <TbdCell date="JUL 1"  label="TBD" slotA="3rd ABCD" slotB="TBD" />
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
