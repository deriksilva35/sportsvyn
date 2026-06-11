/**
 * /bracket — 2026 FIFA World Cup bracket page.
 *
 * Port of the locked v3 design (~/Downloads/sportsvyn-bracket-v3.html,
 * "Option 2 locked, volt logic applied"):
 *   - GROUP STAGE: 12 group cards A–L populated from real teams (joined
 *     via matches.group_code, backfilled by scripts/backfill-groups.mjs).
 *     Each card lists its 4 teams alphabetically pre-tournament. Records
 *     and ADV columns render as honest zeroes / em-dashes — NO fabricated
 *     "% to advance" numbers.
 *   - KNOCKOUT: 9-column symmetric tree (R32→Final) ported as structure
 *     only. Every cell is TBD because the 48-team-format knockout draw
 *     isn't determined until after group stage (~June 24). The volt
 *     favored/pickem/leading/winner/loser classes are wired in the CSS
 *     and will activate once knockout fixtures land in the DB.
 *
 * Server Component. Flags use teams.flag_svg_path (lib/flags.js), not
 * v3's hardcoded .flag-xxx CSS classes — consistent with TeamsHeader on
 * the match page.
 *
 * Pre-tournament state notes (re-read after first group of finals lands):
 *   - group-card-meta: "0 of 3" (computed: floor(group_finals / 2))
 *   - team rows: W-L "0-0", GD "0", PTS "0", ADV "—" (dim)
 *   - No team gets .qualified or .eliminated class until a record exists
 *
 * noindex remains active through the dev-data phase.
 */

import { notFound } from 'next/navigation';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import BracketTabBar from '@/components/bracket/BracketTabBar';
import {
  GROUP_LETTERS,
  getGroupTeams,
  getGroupStandings,
  getGroupMatchdayProgress,
  getGroupStageComplete,
} from '@/lib/bracket';

import './bracket.css';

export const metadata = {
  robots: { index: false, follow: false },
};

// Opt out of static prerender. The page reads matches + teams from the DB on
// every request — without this, Next.js 16's default prerendered the route
// at build time and froze the resulting HTML, so subsequent data imports
// (the WC fixture/team backfill that lands outside the build) would not
// surface until the next deploy. force-dynamic makes /bracket SSR on every
// hit, matching the /match/[slug] behavior (which is dynamic by virtue of
// its slug param).
export const dynamic = 'force-dynamic';

function BracketFlag({ flagSvgPath }) {
  if (flagSvgPath) {
    return (
      <span className="flag" aria-hidden="true">
        <img src={flagSvgPath} alt="" />
      </span>
    );
  }
  // Empty rectangle — IRA collision (Iran, Iraq) and any unmapped team
  // land here. Border + sizing render; no broken-img icon.
  return <span className="flag" aria-hidden="true" />;
}

function GroupCard({ letter, teams, matchdayComplete }) {
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
              <a href={`/team/${team.slug}`} className="name team-link">{team.name}</a>
            ) : (
              <span className="name">{team.name}</span>
            )}
            <span className="num">{wdl}</span>
            <span className="num">{gd}</span>
            <span className="pts">{pts}</span>
            <span className="adv empty">—</span>
          </div>
        );
      })}
    </div>
  );
}

// Knockout TBD cell — placeholder slot labels match v3's intent.
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
        <span className="tscore">—</span>
      </div>
      <div className="match-team-v2 tbd">
        <span className="flag" aria-hidden="true" />
        <span className="tname">{slotB}</span>
        <span className="tscore">—</span>
      </div>
    </div>
  );
}

export default async function BracketPage() {
  const [groupTeams, groupStandings, matchdayProgress, groupStageComplete] = await Promise.all([
    getGroupTeams(),
    getGroupStandings(),
    getGroupMatchdayProgress(),
    getGroupStageComplete(),
  ]);

  // If literally no group data exists (e.g. WC import never ran on this env),
  // 404 rather than render an empty page. /match/[slug] uses the same pattern.
  if (groupTeams.size === 0) notFound();

  // State-aware initial tab. Server-computed so the SSR render lands on
  // the correct panel; no flash of the wrong tab on first paint. Hash
  // present on load overrides this in BracketTabBar's mount effect.
  const defaultTab = groupStageComplete ? 'tournament' : 'group';

  return (
    <>
      <SiteHeaderServer activeNav="bracket" />

      <main className="bracket-page">
        <div className="breadcrumb">
          <a href="/">Home</a>
          <span className="sep">/</span>
          <a href="#">FIFA World Cup 2026</a>
          <span className="sep">/</span>
          <span className="current">Bracket</span>
        </div>

        <BracketTabBar defaultTab={defaultTab} />

        {/* ============ GROUP STAGE ============ */}
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
                />
              );
            })}
          </div>
        </section>

        {/* ============ KNOCKOUT BRACKET (structure only — TBD until draw) ============ */}
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
            {/* ===== LEFT SIDE R32 ===== */}
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

            {/* ===== LEFT R16 ===== */}
            <div className="round-col col-r16-l">
              <div className="round-header">R16</div>
              <TbdCell date="JUL 4" label="TBD" slotA="W1" slotB="W2" />
              <TbdCell date="JUL 4" label="TBD" slotA="W3" slotB="W4" />
              <TbdCell date="JUL 5" label="TBD" slotA="W5" slotB="W6" />
              <TbdCell date="JUL 5" label="TBD" slotA="W7" slotB="W8" />
            </div>

            {/* ===== LEFT QF ===== */}
            <div className="round-col col-qf-l">
              <div className="round-header">QF</div>
              <TbdCell date="JUL 10" label="TBD" slotA="QF1" slotB="QF1" />
              <TbdCell date="JUL 10" label="TBD" slotA="QF2" slotB="QF2" />
            </div>

            {/* ===== LEFT SF ===== */}
            <div className="round-col col-sf-l">
              <div className="round-header">SF</div>
              <TbdCell date="JUL 14" label="TBD" slotA="SF1" slotB="SF1" />
            </div>

            {/* ===== TROPHY / FINAL ===== */}
            <div className="round-col col-trophy">
              <div className="trophy-cell">
                <div className="label">The Final</div>
                <div className="icon">19.JUL</div>
                <div className="who">MetLife · 3PM</div>
              </div>
              <div style={{ marginTop: 16, width: '100%' }} className="match-cell-v2 tbd">
                <div className="match-cell-v2-meta">
                  <span>JUL 18</span>
                  <span className="final-label">3RD</span>
                </div>
                <div className="match-team-v2 tbd">
                  <span className="flag" aria-hidden="true" />
                  <span className="tname">L SF1</span>
                  <span className="tscore">—</span>
                </div>
                <div className="match-team-v2 tbd">
                  <span className="flag" aria-hidden="true" />
                  <span className="tname">L SF2</span>
                  <span className="tscore">—</span>
                </div>
              </div>
            </div>

            {/* ===== RIGHT SF ===== */}
            <div className="round-col col-sf-r">
              <div className="round-header">SF</div>
              <TbdCell date="JUL 15" label="TBD" slotA="SF2" slotB="SF2" />
            </div>

            {/* ===== RIGHT QF ===== */}
            <div className="round-col col-qf-r">
              <div className="round-header">QF</div>
              <TbdCell date="JUL 11" label="TBD" slotA="QF3" slotB="QF3" />
              <TbdCell date="JUL 11" label="TBD" slotA="QF4" slotB="QF4" />
            </div>

            {/* ===== RIGHT R16 ===== */}
            <div className="round-col col-r16-r">
              <div className="round-header">R16</div>
              <TbdCell date="JUL 6" label="TBD" slotA="W9"  slotB="W10" />
              <TbdCell date="JUL 6" label="TBD" slotA="W11" slotB="W12" />
              <TbdCell date="JUL 7" label="TBD" slotA="W13" slotB="W14" />
              <TbdCell date="JUL 7" label="TBD" slotA="W15" slotB="W16" />
            </div>

            {/* ===== RIGHT SIDE R32 ===== */}
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
