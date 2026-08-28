// components/market/PropsBoard.js — the full props board, per mock v0.5.
//
// FULLY SERVER-RENDERED. Every control is a Link and every filter is URL state,
// so a board a reader has narrowed is a board they can share. FULL SEASON is a
// LINK to the player page's game-log section rather than an expand-in-place
// fetch: that page shipped yesterday and already renders every season we hold,
// so the capability is relocated rather than cut, and the first client fetch on
// a new board does not debut on a freeze day.
//
// OBSERVATION VOICE. The stats say what happened; the price says what the
// market thinks. The distance between them is the reader's business and the
// copy never closes it. play / take / bet / lean appear nowhere.

import Link from 'next/link';
import { barsFor } from '@/lib/gridiron/gameChart';
import { shortName, MARKET_GROUPS, SORTS } from '@/lib/market/propsBoard';

const WHEN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
});
const american = (n) => (n == null ? '—' : n > 0 ? `+${n}` : `${n}`);
const pct = (n) => (n == null ? '' : `${n.toFixed(1)}%`);

function Move({ v }) {
  if (v == null || v === 0) return <span className="mv mut">—</span>;
  return <span className={`mv ${v > 0 ? 'jade' : 'terra'}`}>{v > 0 ? '▲' : '▼'}{Math.abs(v).toFixed(1)}</span>;
}

/**
 * THE CHART, WITH THE THRESHOLD LINE — the one thing this surface has that the
 * player page does not, because this is the only surface where a price exists
 * to draw a line at. The .over brightness step comes back with it: over is a
 * property of a line, and here there is one.
 */
function Chart({ chart }) {
  const bars = barsFor(chart.points.map((p, i) => ({
    season: chart.season, week: p.week ?? i, opponent: p.opponent, v: p.value,
  })), { key: 'v' });
  if (!bars) return null;
  const max = Math.max(...chart.points.map((p) => p.value), chart.line, 0);
  // The dashed line sits at the same scale the bars do, so "above the line"
  // is true on the page and not only in the data.
  const linePct = max > 0 ? Math.min(100, (chart.line / max) * 100) : 0;
  return (
    <div className="pb-chartwrap">
      <div className="pb-chart">
        <div className="pb-thline" style={{ bottom: `${(linePct * 54) / 100}px` }}>
          <span className="tl">{chart.line}</span>
        </div>
        {bars.map((b, i) => (
          <div key={b.key} className={`pb-bar${chart.points[i].value > chart.line ? ' over' : ''}`}
            style={{ height: `${b.height}px` }}>
            <span className="v">{b.value}</span>
            <span className="op">{b.opponent ?? `W${chart.points[i].week ?? '—'}`}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ r }) {
  const away = r.away.abbr || r.away.name || 'TBD';
  const home = r.home.abbr || r.home.name || 'TBD';
  return (
    <div className="pb-row">
      <div className="who">
        <div className="nm">
          {r.playerId ? (
            <Link href={`/player/${r.playerSlug}`}>{shortName(r.selection)}</Link>
          ) : shortName(r.selection)}
          {r.onBoard ? <span className="boardpill">Board</span> : null}
        </div>
        <div className="gm">
          {away} at {home} · {r.leagueSlug.toUpperCase()}
          {r.kickoffAt ? ` · ${WHEN.format(new Date(r.kickoffAt)).toUpperCase()}` : ''}
        </div>
        {/* UNLINKED ROWS READ IDENTICALLY MINUS THIS LINE. Same grammar, same
            sort position, no demotion - a missing chart is our gap, not the
            player's, and ranking on it would editorialize our own coverage. */}
        {r.context ? <div className="ctx">{r.context}</div> : null}
        {r.chart ? (
          <>
            <Chart chart={r.chart} />
            {/* A null season means EPL, whose matches carry no season_year;
                the link goes to the log section without asserting a year. */}
            {r.playerSlug ? (
              <Link className="pb-full"
                href={r.chart.season == null
                  ? `/player/${r.playerSlug}#gamelog`
                  : `/player/${r.playerSlug}?season=${r.chart.season}#gamelog`}>
                Full season &rarr;
              </Link>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="mkt">
        <div className="k">{r.marketLabel}</div>
        {r.side ? <div className="s">{r.side}</div> : null}
      </div>
      <div className="ln">{r.line ?? '—'}</div>
      <div className="px">{american(r.american)}</div>
      {r.asOffered
        ? <div className="asoff">as offered</div>
        : <div className="imp">{pct(r.impliedPct)}</div>}
      <Move v={r.moveProb} />
    </div>
  );
}

function Chips({ label, items, active, hrefFor }) {
  return (
    <div className="pb-frow">
      <span className="flbl">{label}</span>
      {items.map(([k, text]) => (
        <Link key={k} className={`ch ${active === k ? 'on' : ''}`} href={hrefFor(k)}>{text}</Link>
      ))}
    </div>
  );
}

export default function PropsBoard({ rows, total, state, hrefFor, leagueChips }) {
  return (
    <section>
      <Chips label="League" items={leagueChips} active={state.league} hrefFor={(k) => hrefFor({ f: k })} />
      <Chips label="Market"
        items={[['all', 'All'], ...MARKET_GROUPS.map((g) => [g.key, g.label])]}
        active={state.group} hrefFor={(k) => hrefFor({ g: k })} />
      <Chips label="Sort" items={SORTS} active={state.sort} hrefFor={(k) => hrefFor({ s: k })} />
      <div className="pb-frow">
        <span className="flbl" />
        <Link className={`ch ${state.boardOnly ? 'on' : ''}`} href={hrefFor({ board: state.boardOnly ? null : '1' })}>Board games</Link>
        <Link className={`ch ${state.moversOnly ? 'on' : ''}`} href={hrefFor({ movers: state.moversOnly ? null : '1' })}>Movers only</Link>
        <form className="pb-search" action="/market" method="get">
          <input type="hidden" name="tab" value="props" />
          {state.league !== 'all' ? <input type="hidden" name="f" value={state.league} /> : null}
          <input name="q" defaultValue={state.q} placeholder="Search player or team" aria-label="Search player or team" />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="emptyband">No priced props match those filters.</div>
      ) : (
        <div className="pb-board">
          <div className="pb-head">
            <span>Player · game · the stats</span>
            <span>Market</span><span>Line</span>
            <span className="r">Price</span><span className="r">Imp%</span><span className="r">24h</span>
          </div>
          {rows.map((r) => <Row key={`${r.matchId}|${r.marketType}|${r.selection}|${r.side ?? ''}`} r={r} />)}
          <p className="pb-foot">
            Anytime and one-sided prices are as offered, not de-vigged - several players can
            score, so those do not sum to 100. Stat lines are our own game logs speaking; the
            price is the market&apos;s answer. We show both.
          </p>
        </div>
      )}
      {total > rows.length ? (
        <p className="pb-more">Showing {rows.length} of {total} priced selections.</p>
      ) : null}
    </section>
  );
}
