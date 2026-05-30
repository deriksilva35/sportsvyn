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
import { sql } from '@/lib/db';
import Wordmark from '@/components/Wordmark';

import './bracket.css';

export const metadata = {
  robots: { index: false, follow: false },
};

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

async function getGroupTeams() {
  const rows = await sql`
    WITH wc_league AS (
      SELECT id FROM leagues WHERE slug = 'fifa-wc-2026' LIMIT 1
    ),
    wc_group_teams AS (
      SELECT m.group_code, m.home_team_id AS team_id
      FROM matches m, wc_league
      WHERE m.league_id = wc_league.id AND m.stage = 'group' AND m.group_code IS NOT NULL
      UNION
      SELECT m.group_code, m.away_team_id AS team_id
      FROM matches m, wc_league
      WHERE m.league_id = wc_league.id AND m.stage = 'group' AND m.group_code IS NOT NULL
    )
    SELECT
      wgt.group_code,
      t.id, t.name, t.slug, t.flag_svg_path
    FROM wc_group_teams wgt
    JOIN teams t ON t.id = wgt.team_id
    ORDER BY wgt.group_code, t.name
  `;
  // Bucket by group letter
  const byLetter = new Map();
  for (const r of rows) {
    if (!byLetter.has(r.group_code)) byLetter.set(r.group_code, []);
    byLetter.get(r.group_code).push(r);
  }
  return byLetter;
}

async function getGroupMatchdayProgress() {
  // matchday_complete = floor(finals_count / 2), because each group plays 2
  // matches per matchday (4 teams = 2 simultaneous pairings).
  const rows = await sql`
    SELECT
      group_code,
      count(*) FILTER (WHERE status = 'final')::int AS finals
    FROM matches
    WHERE league_id = (SELECT id FROM leagues WHERE slug = 'fifa-wc-2026')
      AND stage = 'group'
      AND group_code IS NOT NULL
    GROUP BY group_code
  `;
  const byLetter = new Map();
  for (const r of rows) {
    byLetter.set(r.group_code, Math.floor(r.finals / 2));
  }
  return byLetter;
}

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
        <span>W-L</span>
        <span>GD</span>
        <span>PTS</span>
        <span>ADV</span>
      </div>
      {teams.map((team, idx) => (
        <div key={team.id} className="team-row-v2">
          <span className="pos">{idx + 1}</span>
          <BracketFlag flagSvgPath={team.flag_svg_path} />
          <span className="name">{team.name}</span>
          <span className="num">0-0</span>
          <span className="num">0</span>
          <span className="pts">0</span>
          <span className="adv empty">—</span>
        </div>
      ))}
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

function SiteHeader() {
  return (
    <header className="site-header">
      <div className="brand-row">
        <Wordmark sizeClassName="text-[22px]" />
      </div>
      <div className="nav">
        <a href="/">Home</a>
        <a href="/bracket" className="active">Bracket</a>
        <a href="#">Rankings</a>
        <a href="#">Reads</a>
      </div>
      <div className="header-cta">
        <a href="#" className="signin">Sign In</a>
        <button type="button" className="member-btn">Become a Member</button>
      </div>
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="footer-brand">
          <Wordmark sizeClassName="text-[28px]" />
          <p className="tagline">Read the Game. Editorial sports coverage that takes the reader seriously.</p>
          <p className="copyright">© 2026 Sportsvyn · Considered Network</p>
        </div>
        <div className="footer-links">
          <div className="footer-col">
            <h4>Read</h4>
            <a href="#">Daily Card</a>
            <a href="/bracket">Bracket</a>
            <a href="#">Rankings</a>
            <a href="#">Stats</a>
          </div>
          <div className="footer-col">
            <h4>About</h4>
            <a href="#">Methodology</a>
            <a href="#">Voice Bible</a>
          </div>
          <div className="footer-col">
            <h4>Follow</h4>
            <a href="#">Newsletter</a>
            <a href="#">RSS</a>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default async function BracketPage() {
  const [groupTeams, matchdayProgress] = await Promise.all([
    getGroupTeams(),
    getGroupMatchdayProgress(),
  ]);

  // If literally no group data exists (e.g. WC import never ran on this env),
  // 404 rather than render an empty page. /match/[slug] uses the same pattern.
  if (groupTeams.size === 0) notFound();

  return (
    <>
      <SiteHeader />

      <main className="bracket-page">
        <div className="breadcrumb">
          <a href="/">Home</a>
          <span className="sep">/</span>
          <a href="#">FIFA World Cup 2026</a>
          <span className="sep">/</span>
          <span className="current">Bracket</span>
        </div>

        {/* ============ GROUP STAGE ============ */}
        <section className="group-strip">
          <div className="group-strip-header">
            <div className="group-strip-title">Group Stage</div>
            <div className="group-strip-stat">
              Group stage begins <span className="accent">June 11</span>
              {' · '}Standings populate as matches play
            </div>
          </div>
          <div className="groups-grid">
            {GROUP_LETTERS.map((letter) => {
              const teams = groupTeams.get(letter) ?? [];
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
        <section className="bracket-container">
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
