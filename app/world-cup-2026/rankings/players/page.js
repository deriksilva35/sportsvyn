/**
 * /world-cup-2026/rankings/players: Tournament MVP (Player Power) rankings.
 *
 * Surface-gated by leagues.metadata.rankings declaring 'players'. URL
 * leaf 'players' maps to ranking_lists.slug 'player-power' via
 * RANKING_LIST_META_BY_URL_LEAF. The empty-state branch stays as the
 * pre-edition fallback for any future cycle; the rows-bearing branch
 * renders the live board.
 *
 * Sibling to the power leaf. The reader joins players on entry.player_id
 * (team-power's reader joins teams on entry.team_id; both share the
 * editorial_blurbs back-pointer for top-N annotation).
 *
 * force-dynamic so each request reads the current edition.
 */

import { notFound } from 'next/navigation';
import SiteHeaderServer from '@/components/SiteHeaderServer';
import SiteFooter from '@/components/SiteFooter';
import FlagSlot from '@/components/FlagSlot';
import { getCurrentEdition, getPlayerRankingsForPage } from '@/lib/rankings';
import { getKnockoutPruneState } from '@/lib/rankings/knockoutState';
import {
  resolveCompetitionBySegment,
  requireRankingsListSurface,
  getRankingListMetaForUrlLeaf,
} from '@/lib/competition';

import './rankings.css';

const COMPETITION_URL_SLUG = 'world-cup-2026';
const RANKING_URL_LEAF     = 'players';

export const metadata = {
  title: 'Tournament MVP · Sportsvyn',
  description: 'The Player-of-the-Tournament conversation, ranked. Production from match events, impact from grounded analysis, recomputed after every matchday.',
};

export const dynamic = 'force-dynamic';

function fmtScore(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtSubScore(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toFixed(1);
}

function fmtUpdated(d) {
  if (!d) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    hour12: true, timeZone: 'America/Los_Angeles',
  }).format(new Date(d)) + ' PT';
}

function MovementPill({ label }) {
  if (label === 'up')           return <span className="mvmt up">{'▲'} UP</span>;
  if (label === 'down')         return <span className="mvmt down">{'▼'} DOWN</span>;
  if (label === 'hold')         return <span className="mvmt hold">{'—'}</span>;
  if (label === 'returning')    return <span className="mvmt new">RETURN</span>;
  if (label === 'needs_review') return <span className="mvmt hold">?</span>;
  return <span className="mvmt new">NEW</span>;
}

function MovementBare({ label }) {
  if (label === 'up')           return <span className="b-mvmt up">{'▲'}</span>;
  if (label === 'down')         return <span className="b-mvmt down">{'▼'}</span>;
  if (label === 'hold')         return <span className="b-mvmt hold">{'—'}</span>;
  if (label === 'returning')    return <span className="b-mvmt">RET</span>;
  if (label === 'needs_review') return <span className="b-mvmt hold">?</span>;
  return <span className="b-mvmt">NEW</span>;
}

function PlayerRankCard({ row }) {
  const isTop3 = row.rank <= 3;
  return (
    <a className={`rank-card pp${isTop3 ? ' top3' : ''}`} href={`/player/${row.player_slug}`}>
      <div className="rc-top">
        <span className="rc-rank">{row.rank}</span>
        {row.team_flag_svg_path ? (
          <FlagSlot
            flagSvgPath={row.team_flag_svg_path}
            colorPrimary={row.team_flag_color_primary}
            size="md"
          />
        ) : null}
        <span className="rc-name">{row.player_name}</span>
        <span className="pos-chip" data-pos={row.player_position}>{row.player_position}</span>
        <span className="rc-score">{fmtScore(row.score)}</span>
        <MovementPill label={row.movement_label} />
      </div>
      <p className="rc-split">
        <span className="lab">PRODUCTION</span>{' '}
        <span className="ed">{fmtSubScore(row.production_score)}</span>
        {' '}{'·'}{' '}
        <span className="lab">IMPACT</span>{' '}
        <span className="si">{fmtSubScore(row.impact_score)}</span>
      </p>
      {row.blurb_body ? (
        <p className="rc-blurb">{row.blurb_body}</p>
      ) : null}
    </a>
  );
}

function PlayerBareRow({ row }) {
  return (
    <a className="bare pp" href={`/player/${row.player_slug}`}>
      <span className="b-rank">{row.rank}</span>
      {row.team_flag_svg_path ? (
        <FlagSlot
          flagSvgPath={row.team_flag_svg_path}
          colorPrimary={row.team_flag_color_primary}
          size="sm"
        />
      ) : null}
      <span className="b-name">{row.player_name}</span>
      <span className="pos-chip" data-pos={row.player_position}>{row.player_position}</span>
      <span className="b-split">
        PR {fmtSubScore(row.production_score)} {'·'} IM {fmtSubScore(row.impact_score)}
      </span>
      <span className="b-score">{fmtScore(row.score)}</span>
      <MovementBare label={row.movement_label} />
    </a>
  );
}

export default async function PlayerRankingsLeafPage() {
  const comp = await resolveCompetitionBySegment(COMPETITION_URL_SLUG);
  if (!requireRankingsListSurface(comp, RANKING_URL_LEAF)) notFound();

  const leafMeta = getRankingListMetaForUrlLeaf(RANKING_URL_LEAF);
  if (!leafMeta) notFound();

  const [edition, allRows, pruneState] = await Promise.all([
    getCurrentEdition({ listSlug: leafMeta.listSlug, leagueSlug: comp.slug }),
    getPlayerRankingsForPage({ listSlug: leafMeta.listSlug, leagueSlug: comp.slug, limit: 50 }),
    getKnockoutPruneState({ leagueSlug: comp.slug }),
  ]);

  const hasRows = !!edition && allRows.length > 0;

  if (!hasRows) {
    return (
      <>
        <SiteHeaderServer activeNav="rankings" />
        <main className="rankings-wrap">
          <header className="hero">
            <div className="kicker">Tournament MVP</div>
            <h1>Coming with kickoff.</h1>
            <p className="dek">
              Sportsvyn keeps a separate read on the players inside each squad. The first Tournament MVP edition lands once the tournament is underway and there is real tape to score against.
            </p>
            <div className="meta-row">
              <span>By <span className="v">Derik Silva</span></span>
              <span><span className="v">Pre-tournament</span></span>
            </div>
          </header>

          <div className="method">
            <div className="method-label">Why no rankings yet</div>
            <p>
              The team rankings can be honest pre-tournament because the squad list and FIFA / ESPN context exist before a ball is kicked. Players need minutes against this opponent set. The ranking flips on after matchday 1 and recomputes after every fixture from there.
            </p>
          </div>

          <div className="foot">
            <p>Looking for the team board? <a href="/world-cup-2026/rankings/power">Team Power Rankings</a>.</p>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  const editionLabel = edition.edition_label
    ? `Edition ${edition.edition_number} · ${edition.edition_label}`
    : `Edition ${edition.edition_number}`;
  const prodWeightPct   = Math.round((edition.editorial_weight ?? 0) * 100);
  const impactWeightPct = Math.round((edition.sites_weight ?? 0) * 100);

  // PRUNE (read-time, no recompute): hold the board to the FROZEN round-of-32
  // team field for the whole tournament — a player STAYS even after his team is
  // knocked out (frozen-field rule, not eliminated-pruned). Renumber 1..N
  // contiguous, score unchanged. Guard: only filter once the R32 field is
  // populated, so the board never blanks before the bracket is drawn.
  const r32Field = pruneState.r32FieldTeamIds;
  const ranked = (r32Field.size > 0
    ? allRows.filter((r) => r.team_id != null && r32Field.has(r.team_id))
    : allRows
  ).map((r, i) => ({ ...r, rank: i + 1 }));

  const blurbed = ranked.filter((r) => r.rank <= 10);
  const bare    = ranked.filter((r) => r.rank > 10);

  return (
    <>
      <SiteHeaderServer activeNav="rankings" />
      <main className="rankings-wrap">

        <header className="hero">
          <div className="kicker">Tournament MVP {'·'} {editionLabel}</div>
          <h1>The Player-of-the-Tournament<br />conversation, <span className="accent">ranked.</span></h1>
          <p className="dek">
            Sportsvyn reads what the players have actually done at this tournament: every goal, every assist, every red card, against the strength of the opposition. The composite is the argument. The board recomputes after every matchday.
          </p>
          <div className="meta-row">
            <span>By <span className="v">Derik Silva</span></span>
            <span>Updated <span className="v">{fmtUpdated(edition.published_at)}</span></span>
            <span><span className="v">{allRows.length}</span> players ranked</span>
          </div>
        </header>

        <div className="method">
          <div className="method-label">How this is scored</div>
          <p>
            Each player{'’'}s score blends two layers. Production is deterministic from match events, weighting open-play goals over penalties, crediting assists, and docking red cards. Impact is a grounded read of the actual matches the player has been part of: was the goal decisive, did they carry the team, did the opposition resist. Production keeps the board honest; impact separates the hat-trick-in-a-rout from the late winner against a top side.
          </p>
          <p>
            <strong>Match stakes.</strong> Goals and assists are weighted by what the match had at stake. Strikes in knockout matches, and in group matches that still bore on qualification, count in full. Strikes in dead rubbers {'—'} group matches where both teams had already secured their place in the knockout round before kickoff {'—'} are weighted at 70%, because a goal that cannot change either side{'’'}s advancement is worth less to a tournament-impact ranking than one scored under live stakes. Stakes are derived structurally from the standings at kickoff, not from any judgment of effort or opponent strength; a team that could still reach the knockouts, including via a best-third place, counts as full stakes.
          </p>
          <div className="layers">
            <span className="layer">PRODUCTION <span className="w">{prodWeightPct}%</span></span>
            <span className="layer">IMPACT <span className="w">{impactWeightPct}%</span></span>
            <span className="layer off">STATURE {'—'} <span className="w">future</span></span>
          </div>
        </div>

        <div className="list-head">
          <h2>Tournament MVP</h2>
          <span className="count">TOP 10 ANNOTATED {'·'} 11-{ranked.length} LISTED</span>
        </div>

        {blurbed.map((row) => (
          <PlayerRankCard key={row.ranking_entry_id} row={row} />
        ))}

        <div className="bare-rows">
          {bare.map((row) => (
            <PlayerBareRow key={row.ranking_entry_id} row={row} />
          ))}
        </div>

        <div className="foot">
          <p>Recomputed after every matchday. Production from match events; impact grounded in this-tournament fact only.</p>
          <p>Explain, don{'’'}t pick. {'—'} Sportsvyn</p>
        </div>

      </main>
      <SiteFooter />
    </>
  );
}
