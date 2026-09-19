// components/market/PlayerPropCard.js - one player, one game, his priced props.
//
// THE ROW OPENED. Each prop states the market's implied probability and what
// our own game logs did against that line, and draws the last five he played.
// The distance between the two numbers is the reader's business.
//
// THE HARD LINE, ON THE PAGE. No Higher, no Lower, no slip, no stance, no desk
// position - and the footer says so rather than leaving it to a code comment.
// A published position on a priced line is a pick, and there is no store for
// one in this codebase because we do not sell them.

import Link from 'next/link';
import { shortName, MARKET_LABELS } from '@/lib/market/propsBoard';

const WHEN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
});

/**
 * THE FIVE BARS. Heights are relative to the tallest of the window AND the
 * line, so "above the line" is true on the page and not only in the data.
 *
 * A DNP IS A DASHED OUTLINE. It was not measured; it did not fail. It is also
 * absent from the hit rate's denominator (lib/market/propStats.js valueOf),
 * so the bars and the count agree about what counts.
 */
function Bars({ series }) {
  if (!series?.points?.length) return null;
  const vals = series.points.map((p) => p.value).filter((v) => v != null);
  const max = Math.max(...vals, series.line, 1);
  return (
    <div className="ppc-chart">
      <div className="ppc-line" style={{ bottom: `${Math.min(100, (series.line / max) * 100) * 0.62}px` }}>
        <span>{series.line}</span>
      </div>
      {series.points.map((p, i) => {
        const dnp = p.value == null;
        const over = !dnp && p.value > series.line;
        return (
          <div key={`${p.season}-${p.week}-${i}`}
            className={`ppc-bar${dnp ? ' dnp' : over ? ' over' : ''}`}
            style={{ height: dnp ? '14px' : `${Math.max(4, (p.value / max) * 62)}px` }}>
            <span className="v">{dnp ? '—' : p.value}</span>
            <span className="w">{p.opponent ?? (p.week != null ? `W${p.week}` : '')}</span>
          </div>
        );
      })}
    </div>
  );
}

function Prop({ p, live }) {
  const label = MARKET_LABELS[p.marketType] ?? p.marketType;
  const hit = p.hit && p.hit.games > 0 ? p.hit : null;
  return (
    <section className="ppc-prop">
      <div className="ppc-ph">
        <b>{label}{p.side ? ` ${p.side}` : ''}{p.line != null ? ` ${p.line}` : ''}</b>
        {p.numBooks > 1 ? <span className="bk">{p.numBooks} books</span> : null}
      </div>
      <div className="ppc-cells">
        <div className="c">
          {/* AS-OFFERED CARRIES NO PERCENTAGE - it was never de-vigged. And
              once the game is on, the consensus has stopped updating, so the
              cell says the number is a pre-kick stamp rather than letting a
              stale price read as a live quote. Same words the index uses. */}
          {p.asOffered
            ? <><b className="off">{p.american > 0 ? `+${p.american}` : p.american}</b>
                <span>{live ? 'as offered · pre-kick' : 'as offered'}</span></>
            : <><b>{p.impliedPct == null ? '—' : `${p.impliedPct.toFixed(1)}%`}</b>
                <span>{live ? 'pre-kick' : 'market says'}</span></>}
        </div>
        <div className={`c hit${hit && hit.cleared / hit.games <= 0.4 ? ' cold' : ''}`}>
          <b>{hit ? `${hit.cleared} of ${hit.games}` : '—'}</b>
          <span>{hit ? 'last games cleared' : 'no logs held'}</span>
        </div>
      </div>
      <Bars series={p.series} />
      {/* THE CAPTION SAYS WHEN THE WINDOW CROSSES A SEASON. The hit rate above
          is ONE season by rule (propStats.hitRate) and this chart is the last
          five he played, so on an early-season card the two windows genuinely
          differ - and the page says so rather than letting them look
          inconsistent. */}
      {/* "PLAYED" IS A CLAIM ABOUT EVERY BAR IN THE WINDOW. A DNP rides the
          chart as a dashed outline so the gap is visible, which means the
          window is the last five GAMES and he played fewer - saying "last 5
          played" over a chart with a dash in it states something the chart
          itself contradicts. The stronger word is kept only where it is true. */}
      {p.series ? (
        <p className="ppc-cap">
          Last {p.series.points.length}{p.series.points.every((x) => x.value != null) ? ' played' : ' games'}
          {p.series.crossed ? ` · ${p.series.seasons.join(' and ')}` : ''}
          {hit ? ` · hit rate is ${hit.games === 1 ? 'the' : 'this season’s'} ${hit.games} game${hit.games === 1 ? '' : 's'}` : ''}
        </p>
      ) : null}
    </section>
  );
}

export default function PlayerPropCard({ card }) {
  const { player, game, props } = card;
  const live = game.status === 'live';
  return (
    <div className="ppc">
      <Link className="ppc-strip" href={`/${game.leagueSlug}/game/${game.slug}`}>
        <b>{game.away.abbr} at {game.home.abbr}</b>
        <span>
          {live ? <i className="live">LIVE</i>
            : (game.kickoffAt ? WHEN.format(new Date(game.kickoffAt)).toUpperCase() : '')}
        </span>
      </Link>

      <div className="ppc-who">
        <h1>{shortName(player.name)}</h1>
        <p>
          {[player.position, player.teamAbbr].filter(Boolean).join(' · ')}
          {/* NO RB1. Nothing in this codebase stores a positional rank within
              a team, so the line is the position we hold and the season the
              one scorer produced - never an invented depth chart. */}
          {player.seasonLine
            ? ` · ${player.seasonLine.gp} game${player.seasonLine.gp === 1 ? '' : 's'} · ${player.seasonLine.ppg} ppg`
            : ''}
        </p>
      </div>

      {props.map((p, i) => <Prop key={`${p.marketType}-${p.side ?? ''}-${i}`} p={p} live={live} />)}

      <p className="ppc-ft">
        <b>Market says</b> is the consensus implied probability, de-vigged across
        the books that priced it. <b>Cleared</b> counts our own box scores against
        this line. Sportsvyn does not sell picks.
      </p>
    </div>
  );
}
