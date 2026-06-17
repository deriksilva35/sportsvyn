/**
 * /world-cup-2026/rankings/power: namespaced Team Power Rankings.
 *
 * Sibling of the legacy /power-rankings route during Phase 2 of the
 * competition-namespacing migration. Render contract is identical to
 * the legacy page; the differences are:
 *
 *   1. Competition is resolved from the URL segment via
 *      lib/competition.js. The leagueSlug ('fifa-wc-2026') comes from
 *      the resolved comp, not a module constant.
 *   2. The 'power' URL leaf is mapped to the canonical
 *      ranking_lists.slug ('team-power') via
 *      getRankingListMetaForUrlLeaf. The page does not hardcode the
 *      list slug.
 *   3. The route 404s if the resolved competition does not declare
 *      'power' in its rankings surfaces. This way /nfl/rankings/power
 *      will not render against the wrong list.
 *
 * The legacy /power-rankings folder remains in place this phase;
 * Phase 3 wires the redirect /power-rankings -> /world-cup-2026/rankings/power
 * in proxy.js and deletes the old folder.
 */

import { notFound } from 'next/navigation';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import FlagSlot from '@/components/FlagSlot';
import { getCurrentEdition, getRankingsForPage } from '@/lib/rankings';
import {
  resolveCompetitionBySegment,
  requireRankingsListSurface,
  getRankingListMetaForUrlLeaf,
} from '@/lib/competition';

import './rankings.css';

const COMPETITION_URL_SLUG = 'world-cup-2026';
const RANKING_URL_LEAF     = 'power';

export const metadata = {
  title: 'Power Rankings · Sportsvyn',
  description: 'Forty-eight nations, ranked. Sportsvyn reads FIFA and ESPN, scores the squads itself, and forms its own order.',
};

export const dynamic = 'force-dynamic';

function fmtScore(n) {
  if (n == null || Number.isNaN(Number(n))) return '\u2014';
  return Number(n).toFixed(2);
}

function fmtUpdated(d) {
  if (!d) return '\u2014';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'America/Los_Angeles',
  }).format(new Date(d)) + ' PT';
}

function MovementPill({ label }) {
  if (label === 'up')   return <span className="mvmt up">{'▲'} UP</span>;
  if (label === 'down') return <span className="mvmt down">{'▼'} DOWN</span>;
  if (label === 'hold') return <span className="mvmt hold">{'\u2014'}</span>;
  if (label === 'returning')    return <span className="mvmt new">RETURN</span>;
  if (label === 'needs_review') return <span className="mvmt hold">?</span>;
  return <span className="mvmt new">NEW</span>;
}

function MovementBare({ label }) {
  if (label === 'up')   return <span className="b-mvmt up">{'▲'}</span>;
  if (label === 'down') return <span className="b-mvmt down">{'▼'}</span>;
  if (label === 'hold') return <span className="b-mvmt hold">{'\u2014'}</span>;
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
        {' '}{'·'}{' '}
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
        ED {fmtScore(row.editorial_composite)} {'·'} SI {fmtScore(row.sites_composite)}
      </span>
      <span className="b-score">{fmtScore(row.score)}</span>
      <MovementBare label={row.movement_label} />
    </a>
  );
}

export default async function PowerRankingsLeafPage() {
  const comp = await resolveCompetitionBySegment(COMPETITION_URL_SLUG);
  if (!requireRankingsListSurface(comp, RANKING_URL_LEAF)) notFound();

  const leafMeta = getRankingListMetaForUrlLeaf(RANKING_URL_LEAF);
  if (!leafMeta) notFound();

  const [edition, allRows] = await Promise.all([
    getCurrentEdition({ listSlug: leafMeta.listSlug, leagueSlug: comp.slug }),
    getRankingsForPage({ listSlug: leafMeta.listSlug, leagueSlug: comp.slug, limit: 48 }),
  ]);

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
          <div className="kicker">Power Rankings {'·'} {editionLabel}</div>
          <h1>The board before<br />a ball is <span className="accent">kicked.</span></h1>
          <p className="dek">
            Forty-eight nations, ranked. Sportsvyn reads FIFA and ESPN, scores the squads itself, and forms its own order, the composite is the argument. Here is where the tournament stands the night before it starts.
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
            Each team{'’'}s score blends two layers: Sportsvyn{'’'}s own five-dimension editorial read, and the consensus of FIFA{'’'}s and ESPN{'’'}s rankings converted to a 0-10 scale. Pre-tournament, only the dimensions you can judge before kickoff are live, squad and coherence, so results, process, and momentum hold until the first whistle.
          </p>
          <div className="layers">
            <span className="layer">EDITORIAL <span className="w">{edWeightPct}%</span></span>
            <span className="layer">SITES <span className="w">{sitesWeightPct}%</span></span>
            <span className="layer off">USER {'\u2014'} <span className="w">Phase 2</span></span>
          </div>
        </div>

        <div className="list-head">
          <h2>Team Power Rankings</h2>
          <span className="count">TOP 10 ANNOTATED {'·'} 11-{allRows.length} LISTED</span>
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
          <p>Explain, don{'’'}t pick. {'\u2014'} Sportsvyn</p>
        </div>

      </main>
      <SiteFooter />
    </>
  );
}
