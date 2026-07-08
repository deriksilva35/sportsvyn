/**
 * /market — The Market (price read). Slice 1+2: hero + The Board + methodology.
 *
 * Server component, force-dynamic (paramless DB page; consensus refreshes
 * hourly and the model reads the current ratings edition, so no caching).
 *
 * Today's Numbers (curated cards), the Ledger, and the per-row written reads
 * are later slices — the structure is here, those sections are omitted.
 *
 * Numbers: market 1X2 is the real de-vigged consensus (odds_markets); the model
 * % is the independent Davidson number from lib/matchProbability. Tags are the
 * locked ruleset (fair / generous / rich / wide + the >80% guard).
 */

import SiteHeaderServer from '@/components/SiteHeaderServer';
import { getModelBoard, MODEL_PARAMS } from '@/lib/matchProbability';
import './market.css';

export const dynamic = 'force-dynamic';

const PT_TZ = 'America/Los_Angeles';

const STAGE_LABELS = {
  group: 'Group Stage',
  round_of_32: 'Round of 32',
  round_of_16: 'Round of 16',
  quarter: 'Quarterfinals',
  semi: 'Semifinals',
  third_place: 'Third-place playoff',
  final: 'Final',
};

function fmtAmerican(odds) {
  if (odds == null) return '';
  return odds > 0 ? `+${odds}` : String(odds);
}

function fmtDatePt(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', timeZone: PT_TZ,
    }).format(new Date(iso)).replace(',', '');
  } catch {
    return '';
  }
}

// tag -> chip class / label, and tag -> gap-number colour class.
const TAG_CHIP = { generous: 'gen', rich: 'rich', fair: 'fair', wide: 'wide' };
const TAG_LABEL = { generous: 'Generous', rich: 'Rich', fair: 'Fair', wide: 'Wide' };
const TAG_GAP = { generous: 'pos', rich: 'neg', fair: 'flat', wide: 'wide' };

function sideLabel(row) {
  if (row.selection === 'home') return `${row.home_name} to win`;
  if (row.selection === 'away') return `${row.away_name} to win`;
  return 'Draw';
}
function sideSub(row) {
  if (row.selection === 'draw') return `Match winner · ${row.home_abbr} v ${row.away_abbr}`;
  return 'Match winner';
}

function BoardRow({ row }) {
  const matchLabel = `${row.home_abbr} v ${row.away_abbr} · ${fmtDatePt(row.kickoff_at)}`;
  const gapStr = `${row.gap >= 0 ? '+' : ''}${row.gap.toFixed(1)}`;
  const sinceOpen = row.open_american != null
    ? `${fmtAmerican(row.open_american)} → ${fmtAmerican(row.american)}`
    : fmtAmerican(row.american);
  return (
    <div className="brow">
      <span className="b-side">{sideLabel(row)}<span className="sub">{sideSub(row)}</span></span>
      <span className="b-match">{matchLabel}</span>
      <span className="b-num price">{fmtAmerican(row.american)}<span className="dec">{row.decimal != null ? row.decimal.toFixed(2) : ''}</span></span>
      <span className="b-pct">{row.market_pct.toFixed(1)}%</span>
      <span className="b-pct model">{row.model_pct.toFixed(1)}%</span>
      <span className={`b-gap ${TAG_GAP[row.tag]}`}>{gapStr}</span>
      <span className="b-open">{sinceOpen}</span>
      <span className="b-tag"><span className={`tag ${TAG_CHIP[row.tag]}`}>{TAG_LABEL[row.tag]}</span></span>
    </div>
  );
}

export default async function MarketPage() {
  const board = await getModelBoard();
  const round = board.length ? (STAGE_LABELS[board[0].stage] ?? 'World Cup') : 'World Cup';

  return (
    <>
      <SiteHeaderServer activeNav="market" />
      <main className="market-page">

        <div className="hero-kicker">The Market · {round}</div>
        <h1>Read the<br />prices.</h1>
        <p className="dek">Every price is a claim about probability. We check the claim against our own model, built on the Sportsvyn power ratings and computed before we ever look at the price. When a number is <b>generous</b>, the market is paying more than the probability deserves. When it is <b>rich</b>, you are paying for certainty that is not there. We say which is which, and we keep score on ourselves below.</p>
        <div className="brandline">No picks. No units. No sportsbook links. A generous number is information about the market, not advice about your money.</div>

        {/* THE BOARD */}
        <section className="sec">
          <div className="sechead">
            <span className="t">The Board</span>
            <span className="n">All {round.toLowerCase()} markets · median of 13 books, de-vigged</span>
          </div>
          <div className="board">
            <div className="brow-head">
              <span>Side</span><span>Match</span>
              <span style={{ textAlign: 'right' }}>Price</span>
              <span style={{ textAlign: 'right' }}>Market</span>
              <span style={{ textAlign: 'right' }}>Model</span>
              <span style={{ textAlign: 'right' }}>Gap</span>
              <span style={{ textAlign: 'right' }}>Since open</span>
              <span style={{ textAlign: 'right' }}>Tag</span>
            </div>
            {board.length === 0 && (
              <div className="brow"><span className="b-match">No priced markets right now.</span></div>
            )}
            {board.map((row) => (
              <BoardRow key={`${row.match_id}-${row.selection}`} row={row} />
            ))}
          </div>
        </section>

        {/* METHODOLOGY */}
        <div className="method">
          <div className="method-label">How this is read</div>
          <p><b>The market number.</b> Prices are the median across 13 sportsbooks, refreshed hourly, with the bookmaker margin removed so the implied percentages sum to 100. What remains is the market probability, stated plainly.</p>
          <p><b>The model number.</b> Our probability is a Davidson three-outcome model driven by the Sportsvyn team power ratings alone. No form term, no host adjustment, no market input. The two parameters, k of {MODEL_PARAMS.k} and nu of {MODEL_PARAMS.nu}, were fit on 95 completed World Cup matches. It is our read of the game, computed before we ever look at the price.</p>
          <p><b>The tags.</b> Gap is our probability minus the market number. When the gap is 3.5 to 8 points in our favor the number is generous, and 3.5 to 8 points against us it is rich. Inside 3.5 points the price is fair and we leave it alone. One guard: above an 80 percent model probability we never call a number generous, because our calibration is unproven that high. The threshold is fixed and applies to every market on the board.</p>
          <p><b>The wide state.</b> Gaps beyond 8 points are disclosed as model-market disagreement, not value. At that distance our model is more often the limitation than the price, usually a stale or thin rating, so we flag the gap and trust it less, rather than dress it up as an edge.</p>
          <p><b>What this is not.</b> A generous tag is a statement about a price, not a prediction of an outcome. Most generous underdogs still lose; the claim is that they win more often than the price pays. Nothing on this page tells you what to do, sizes a stake, or links to a book. We publish the gaps and the ledger, and the ledger grades us.</p>
          <div className="chips">
            <span className="chip">Consensus <b>Median · 13 books · de-vigged</b></span>
            <span className="chip">Model <b>Davidson · ratings only · k {MODEL_PARAMS.k} nu {MODEL_PARAMS.nu}</b></span>
            <span className="chip">Tag band <b>3.5 to 8 pts · wide beyond 8</b></span>
            <span className="chip">Guard <b>No generous above 80%</b></span>
          </div>
        </div>

        <div className="footnote">
          <b>Slice 1 and 2.</b> The model library and The Board. The Numbers strip, the Ledger, and the per-row written reads are later slices. Market 1X2 numbers are the real de-vigged consensus; the model number is the independent Davidson rating model. Every tag is about a price (generous, fair, rich, wide), never an outcome.
        </div>

      </main>
    </>
  );
}
