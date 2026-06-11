/**
 * /rankings — Team Power Rankings article page.
 *
 * Renders the current is_current+published edition of the team-power
 * list (lib/rankings.getCurrentEdition + getRankingsForPage). Layout
 * matches sportsvyn-rankings-article-v1.html:
 *   · article hero (kicker + h1 + dek + meta row, edition meta dynamic)
 *   · methodology strip (weights pulled from edition row)
 *   · top 10 = blurbed cards (rank chip, abbreviation, name, score,
 *     ED/SI split, movement, blurb-when-present)
 *   · 11–48 = bare rows (rank, name, ED/SI mini, score, movement)
 *
 * Blurbs come from editorial_blurbs.body (blurb_type='ranking_row_blurb',
 * status='editor_approved', is_current=true) joined via ranking_entry_id.
 * Zero rows exist at Part 1 ship — the helper returns blurb_body=null
 * and the card renders without the blurb paragraph. Part 2 generates
 * the row-blurb prose; once approved, those rows render automatically
 * without any code change here.
 *
 * Movement: edition 1 carries movement_label='new' for every row (no
 * prior edition to diff against). The 'new' case renders the NEW pill
 * with no arrow glyph — see RankPill below.
 *
 * Trigram chip = teams.abbreviation. This inherits the STAGE C
 * abbreviation corrections (IRN/IRQ/CUW/RSA/…) — single source of
 * truth, same column the schedule / sidebar / match pages read.
 */

import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import FlagSlot from '@/components/FlagSlot';
import { getCurrentEdition, getRankingsForPage } from '@/lib/rankings';

import './rankings.css';

export const metadata = {
  title: 'Power Rankings · Sportsvyn',
  description: 'Forty-eight nations, ranked. Sportsvyn reads FIFA and ESPN, scores the squads itself, and forms its own order.',
};

export const dynamic = 'force-dynamic';

const LIST_SLUG   = 'team-power';
const LEAGUE_SLUG = 'fifa-wc-2026';

function fmtScore(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtUpdated(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'America/Los_Angeles',
  }).format(new Date(d)) + ' PT';
}

// Movement pill — voltNew for edition-1 entrants (no arrow), jade for
// up, terra for down. 'hold' renders as a muted dash. The 'new' branch
// honors the "don't render ▲/▼ when movement_label='new'" rule.
function MovementPill({ label }) {
  if (label === 'up')   return <span className="mvmt up">▲ UP</span>;
  if (label === 'down') return <span className="mvmt down">▼ DOWN</span>;
  if (label === 'hold') return <span className="mvmt hold">—</span>;
  if (label === 'returning')    return <span className="mvmt new">RETURN</span>;
  if (label === 'needs_review') return <span className="mvmt hold">?</span>;
  return <span className="mvmt new">NEW</span>;
}

// Bare-row variant — same logic, smaller footprint to match the mock's
// .b-mvmt treatment (volt small caps, no border chip).
function MovementBare({ label }) {
  if (label === 'up')   return <span className="b-mvmt up">▲</span>;
  if (label === 'down') return <span className="b-mvmt down">▼</span>;
  if (label === 'hold') return <span className="b-mvmt hold">—</span>;
  if (label === 'returning')    return <span className="b-mvmt">RET</span>;
  if (label === 'needs_review') return <span className="b-mvmt hold">?</span>;
  return <span className="b-mvmt">NEW</span>;
}

function RankCard({ row }) {
  const isTop3 = row.rank <= 3;
  return (
    <a className={`rank-card${isTop3 ? ' top3' : ''}`} href={`/team/${row.team_slug}`}>
      <div className="rc-top">
        <span className="rc-rank">{row.rank}</span>
        <FlagSlot
          flagSvgPath={row.team_flag_svg_path}
          colorPrimary={row.team_flag_color_primary}
          size="md"
        />
        <span className="rc-name">{row.team_name}</span>
        <span className="rc-score">{fmtScore(row.score)}</span>
        <MovementPill label={row.movement_label} />
      </div>
      <p className="rc-split">
        <span className="lab">EDITORIAL</span>{' '}
        <span className="ed">{fmtScore(row.editorial_composite)}</span>
        {' '}·{' '}
        <span className="lab">SITES</span>{' '}
        <span className="si">{fmtScore(row.sites_composite)}</span>
      </p>
      {row.blurb_body ? (
        <p className="rc-blurb">{row.blurb_body}</p>
      ) : null}
    </a>
  );
}

function BareRow({ row }) {
  return (
    <a className="bare" href={`/team/${row.team_slug}`}>
      <span className="b-rank">{row.rank}</span>
      <FlagSlot
        flagSvgPath={row.team_flag_svg_path}
        colorPrimary={row.team_flag_color_primary}
        size="sm"
      />
      <span className="b-name">{row.team_name}</span>
      <span className="b-split">
        ED {fmtScore(row.editorial_composite)} · SI {fmtScore(row.sites_composite)}
      </span>
      <span className="b-score">{fmtScore(row.score)}</span>
      <MovementBare label={row.movement_label} />
    </a>
  );
}

export default async function RankingsPage() {
  const [edition, allRows] = await Promise.all([
    getCurrentEdition({ listSlug: LIST_SLUG, leagueSlug: LEAGUE_SLUG }),
    getRankingsForPage({ listSlug: LIST_SLUG, leagueSlug: LEAGUE_SLUG, limit: 48 }),
  ]);

  // No published current edition → graceful empty state. This shouldn't
  // hit pre-launch (edition 1 is live) but we handle it for the future
  // between-editions case.
  if (!edition || allRows.length === 0) {
    return (
      <>
        <SiteHeaderServer activeNav="rankings" />
        <main className="rankings-wrap">
          <header className="hero">
            <div className="kicker">Power Rankings</div>
            <h1>Coming soon.</h1>
            <p className="dek">The next edition is being prepared.</p>
          </header>
        </main>
        <SiteFooter />
      </>
    );
  }

  const editionLabel = edition.edition_label
    ? `Edition ${edition.edition_number} · ${edition.edition_label}`
    : `Edition ${edition.edition_number}`;
  const edWeightPct    = Math.round((edition.editorial_weight ?? 0) * 100);
  const sitesWeightPct = Math.round((edition.sites_weight ?? 0) * 100);

  const blurbed = allRows.filter((r) => r.rank <= 10);
  const bare    = allRows.filter((r) => r.rank > 10);

  return (
    <>
      <SiteHeaderServer activeNav="rankings" />
      <main className="rankings-wrap">

        <header className="hero">
          <div className="kicker">Power Rankings · {editionLabel}</div>
          <h1>The board before<br />a ball is <span className="accent">kicked.</span></h1>
          <p className="dek">
            Forty-eight nations, ranked. Sportsvyn reads FIFA and ESPN, scores the squads itself, and forms its own order — the composite is the argument. Here is where the tournament stands the night before it starts.
          </p>
          <div className="meta-row">
            <span>By <span className="v">Derik Silva</span></span>
            <span>Updated <span className="v">{fmtUpdated(edition.published_at)}</span></span>
            <span><span className="v">{allRows.length}</span> teams ranked</span>
          </div>
        </header>

        <div className="method">
          <div className="method-label">How this is scored</div>
          <p>
            Each team's score blends two layers: Sportsvyn's own five-dimension editorial read, and the consensus of FIFA's and ESPN's rankings converted to a 0–10 scale. Pre-tournament, only the dimensions you can judge before kickoff are live — squad and coherence — so results, process, and momentum hold until the first whistle.
          </p>
          <div className="layers">
            <span className="layer">EDITORIAL <span className="w">{edWeightPct}%</span></span>
            <span className="layer">SITES <span className="w">{sitesWeightPct}%</span></span>
            <span className="layer off">USER — <span className="w">Phase 2</span></span>
          </div>
        </div>

        <div className="list-head">
          <h2>Team Power Rankings</h2>
          <span className="count">TOP 10 ANNOTATED · 11–{allRows.length} LISTED</span>
        </div>

        {blurbed.map((row) => (
          <RankCard key={row.ranking_entry_id} row={row} />
        ))}

        <div className="bare-rows">
          {bare.map((row) => (
            <BareRow key={row.ranking_entry_id} row={row} />
          ))}
        </div>

        <div className="foot">
          <p>Recomputed after every matchday during the tournament. Editorial layer scored by Sportsvyn; sites layer blends FIFA and ESPN.</p>
          <p>Explain, don't pick. — Sportsvyn</p>
        </div>

      </main>
      <SiteFooter />
    </>
  );
}
