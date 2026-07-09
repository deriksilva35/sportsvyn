/**
 * /market — The Market (price read). Slices 1-3 + market expansion.
 *
 * Server component, force-dynamic (paramless DB page; consensus refreshes
 * hourly, the model reads the current ratings edition, and the ledger updates
 * every poll tick, so no caching).
 *
 * The Board: 1X2 selections carry the model % + tag (fair/generous/rich/wide);
 * totals main-line rows are market info only (muted dash for model/gap, a
 * MARKET chip). Scorer prices are single-sided as-offered. The Ledger is the
 * public grade sheet (generous/rich only; wide is graded but excluded).
 * Today's Numbers (curated cards) and the per-row written reads are later slices.
 */

import SiteHeaderServer from '@/components/SiteHeaderServer';
import {
  getModelBoard, getTotalsBoard, getScorerPrices, getBoardUpdatedAt, MODEL_PARAMS,
} from '@/lib/matchProbability';
import { getLedger } from '@/lib/marketLedger';
import BoardSection from './BoardSection';
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

function sinceOpen(openAmerican, american) {
  return openAmerican != null
    ? `${fmtAmerican(openAmerican)} → ${fmtAmerican(american)}`
    : fmtAmerican(american);
}

const TAG_CHIP = { generous: 'gen', rich: 'rich', fair: 'fair', wide: 'wide' };

// "Updated Nm ago" for the filter-row stamp. Server-computed (page is dynamic).
function fmtUpdated(iso) {
  if (!iso) return null;
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'Updated just now';
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `Updated ${hrs}h ago`;
}

function ScorerBlock({ group }) {
  // A single book's price must never read as consensus, so the label states the
  // exact book count (built as a JS string; the apostrophe is not JSX text).
  const n = group.num_books ?? 1;
  const srcLabel = `Priced by ${n} ${n === 1 ? 'book' : 'books'} · as offered · includes the book's margin`;
  return (
    <div className="scorer-block">
      <div className="scorer-head">{group.home_abbr} v {group.away_abbr}<span className="scorer-when">{fmtDatePt(group.kickoff_at)}</span></div>
      <div className="scorer-src">{srcLabel}</div>
      <div className="scorer-rows">
        {group.players.map((p) => (
          <div className="scorer-row" key={p.player}>
            <span className="sc-name">{p.player}</span>
            <span className="sc-price">{fmtAmerican(p.american)}</span>
            <span className="sc-impl">{p.implied.toFixed(1)}%</span>
            <span className="sc-open">{sinceOpen(p.open_american, p.american)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LedgerRow({ r }) {
  let number;
  if (r.market_type === 'total_goals') {
    const [side, line] = r.selection_label.split('_');
    number = `${side === 'over' ? 'Over' : 'Under'} ${line} goals`;
  } else {
    number = r.selection_label === 'draw' ? 'Draw'
      : `${r.selection_label === 'home' ? r.home_name : r.away_name} to win`;
  }
  const sub = `${STAGE_LABELS[r.stage] ?? ''} · ${r.home_abbr} v ${r.away_abbr}`;
  const resCls = r.result === 'hit' ? 'hit' : r.result === 'miss' ? 'miss' : 'pend';
  const resText = r.result === 'hit' ? 'Landed ✓' : r.result === 'miss' ? 'Missed ✗' : 'Open';
  return (
    <div className="lrow">
      <span className="d">{fmtDatePt(r.kickoff_at)}</span>
      <span className="s">{number}<span className="sub">{sub}</span></span>
      <span className="num">{fmtAmerican(r.price_american)}</span>
      <span className="num impl">{r.implied_pct.toFixed(1)}%</span>
      <span className="num"><span className={`tag ${TAG_CHIP[r.tag]}`}>{r.tag === 'generous' ? 'Gen' : 'Rich'}</span></span>
      <span className={`res ${resCls}`}>{resText}</span>
    </div>
  );
}

function LedgerSection({ ledger }) {
  const { stats, rows } = ledger;
  const has = rows.length > 0;
  return (
    <section className="sec">
      <div className="sechead">
        <span className="t">The Ledger</span>
        <span className="n">Every number we tagged, graded in public</span>
      </div>
      {!has ? (
        <div className="ledger-empty">
          <p>The ledger opens with the quarterfinals. Every tag freezes at kickoff and grades itself at the whistle.</p>
        </div>
      ) : (
        <>
          <div className="ledstats">
            <div className="stat"><div className="v">{stats.tagged}</div><div className="l">Numbers tagged</div></div>
            <div className="stat hit"><div className="v">{stats.landed}<span className="of"> of {stats.graded}</span></div><div className="l">Landed{stats.hit_rate_pct != null ? ` · ${stats.hit_rate_pct}%` : ''}</div></div>
            <div className="stat"><div className="v">{stats.implied_expectation_pct != null ? `${stats.implied_expectation_pct}%` : '-'}</div><div className="l">What the prices implied</div></div>
          </div>
          <div className="ledger">
            <div className="lrow-head">
              <span>Date</span><span>The number</span>
              <span style={{ textAlign: 'right' }}>Price</span>
              <span style={{ textAlign: 'right' }}>Implied</span>
              <span style={{ textAlign: 'right' }}>Tag</span>
              <span style={{ textAlign: 'right' }}>Result</span>
            </div>
            {rows.map((r) => (
              <LedgerRow key={`${r.match_id}-${r.selection_label}`} r={r} />
            ))}
          </div>
        </>
      )}
      <p className="lednote">How grading works: a generous call lands when the outcome hits, because we said the probability was bigger than the price. A rich call lands when the outcome misses, because we said the price was overpaying. The third stat is the honesty check: at the prices we tagged, that is what the market itself expected to land. If our hit rate and that number converge over time, our reads are adding nothing, and this page will say so.</p>
    </section>
  );
}

export default async function MarketPage() {
  const [board, totals, scorers, ledger, updatedAt] = await Promise.all([
    getModelBoard(),
    getTotalsBoard(),
    getScorerPrices(),
    getLedger(),
    getBoardUpdatedAt(),
  ]);
  const stageForRound = board[0]?.stage ?? totals[0]?.stage ?? null;
  const round = stageForRound ? (STAGE_LABELS[stageForRound] ?? 'World Cup') : 'World Cup';

  // Serialize board + totals into one client-filterable list; derive the match /
  // team / market-type option sets from the data (never hardcoded). The client
  // BoardSection filters this in the browser (no round trips).
  const rows = [
    ...board.map((r) => ({ ...r, _kind: 'mw', market_type: 'match_winner' })),
    ...totals.map((r) => ({ ...r, _kind: 'total', market_type: 'total' })),
  ];
  const matchMap = new Map();
  for (const r of board) {
    if (!matchMap.has(r.match_id)) matchMap.set(r.match_id, { id: r.match_id, label: `${r.home_name} v ${r.away_name} · ${fmtDatePt(r.kickoff_at)}`, kickoff: r.kickoff_at });
  }
  for (const r of totals) {
    if (!matchMap.has(r.match_id)) matchMap.set(r.match_id, { id: r.match_id, label: `${r.home_abbr} v ${r.away_abbr} · ${fmtDatePt(r.kickoff_at)}`, kickoff: r.kickoff_at });
  }
  const matchOptions = [...matchMap.values()].sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
  const teamMap = new Map();
  for (const r of board) {
    if (!teamMap.has(r.home_abbr)) teamMap.set(r.home_abbr, { abbr: r.home_abbr, name: r.home_name });
    if (!teamMap.has(r.away_abbr)) teamMap.set(r.away_abbr, { abbr: r.away_abbr, name: r.away_name });
  }
  for (const r of totals) {
    if (!teamMap.has(r.home_abbr)) teamMap.set(r.home_abbr, { abbr: r.home_abbr, name: r.home_abbr });
    if (!teamMap.has(r.away_abbr)) teamMap.set(r.away_abbr, { abbr: r.away_abbr, name: r.away_abbr });
  }
  const teamOptions = [...teamMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  const marketOptions = [];
  if (board.length > 0) marketOptions.push({ value: 'match_winner', label: 'Match winner' });
  if (totals.length > 0) marketOptions.push({ value: 'total', label: 'Total goals' });
  const updatedLabel = fmtUpdated(updatedAt);

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
          {rows.length === 0 ? (
            <div className="board">
              <div className="brow"><span className="b-match">No priced markets right now.</span></div>
            </div>
          ) : (
            <BoardSection
              rows={rows}
              matchOptions={matchOptions}
              teamOptions={teamOptions}
              marketOptions={marketOptions}
              updatedLabel={updatedLabel}
            />
          )}
        </section>

        {/* SCORER PRICES */}
        {scorers.length > 0 && (
          <section className="sec">
            <div className="sechead">
              <span className="t">Scorer prices</span>
              <span className="n">Anytime goal scorer, single-sided</span>
            </div>
            <div className="scorer-grid">
              {scorers.map((g) => (
                <ScorerBlock key={g.match_id} group={g} />
              ))}
            </div>
          </section>
        )}

        {/* THE LEDGER */}
        <LedgerSection ledger={ledger} />

        {/* METHODOLOGY */}
        <div className="method">
          <div className="method-label">How this is read</div>
          <p><b>The market number.</b> Prices are the median across 13 sportsbooks, refreshed hourly, with the bookmaker margin removed so the implied percentages sum to 100. What remains is the market probability, stated plainly.</p>
          <p><b>The model number.</b> Our probability is a Davidson three-outcome model driven by the Sportsvyn team power ratings alone. No form term, no host adjustment, no market input. The two parameters, k of {MODEL_PARAMS.k} and nu of {MODEL_PARAMS.nu}, were fit on 95 completed World Cup matches. It is our read of the game, computed before we ever look at the price.</p>
          <p><b>The tags.</b> Gap is our probability minus the market number. When the gap is 3.5 to 8 points in our favor the number is generous, and 3.5 to 8 points against us it is rich. Inside 3.5 points the price is fair and we leave it alone. One guard: above an 80 percent model probability we never call a number generous, because our calibration is unproven that high. The threshold is fixed and applies to every market on the board.</p>
          <p><b>The wide state.</b> Gaps beyond 8 points are disclosed as model-market disagreement, not value. At that distance our model is more often the limitation than the price, usually a stale or thin rating, so we flag the gap and trust it less, rather than dress it up as an edge.</p>
          <p><b>What we cover.</b> Tags appear only where our model prices the market. The match result carries the Davidson model. Our totals model is calibrated at the tail lines (over/under 1.5 and 3.5), proven walk-forward; the main line is shown as market information because the model has no demonstrated edge there. Tail lines appear on the board only when the model has a read. Scorer prices are single-sided and shown as offered, so they still carry the book margin. Model coverage expands only by a stated projection and calibration, never by default.</p>
          <p><b>What this is not.</b> A generous tag is a statement about a price, not a prediction of an outcome. Most generous underdogs still lose; the claim is that they win more often than the price pays. Nothing on this page tells you what to do, sizes a stake, or links to a book. We publish the gaps and the ledger, and the ledger grades us.</p>
          <div className="chips">
            <span className="chip">Consensus <b>Median · 13 books · de-vigged</b></span>
            <span className="chip">Model <b>Davidson · ratings only · k {MODEL_PARAMS.k} nu {MODEL_PARAMS.nu}</b></span>
            <span className="chip">Tag band <b>3.5 to 8 pts · wide beyond 8</b></span>
            <span className="chip">Guard <b>No generous above 80%</b></span>
          </div>
        </div>

      </main>
    </>
  );
}
