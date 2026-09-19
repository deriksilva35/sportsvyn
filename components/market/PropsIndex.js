// components/market/PropsIndex.js - every priced prop on the slate, by game.
//
// THE INDEX IS THE PROPS BOARD REGROUPED, not a second reader. lib/market/
// propsBoard.js already returns every priced prop with its hit rate computed
// over the WHOLE filtered set before the slice; this draws that in the Daily's
// grammar and groups it by kickoff, which is the order a reader's Saturday
// actually runs in.
//
// FULLY SERVER-RENDERED, like the board it restyles: every chip is a Link and
// every filter is URL state, so a narrowed index is a shareable one.
//
// OBSERVATION VOICE, AND THE HARD LINE. Market is what the books imply. Hit is
// what the last games did. The distance between them is the reader's business:
// there is no Higher, no Lower, no slip, no stance and no desk position here,
// and the footer says so on the page rather than only in this comment.

import Link from 'next/link';
import { shortName, MARKET_LABELS } from '@/lib/market/propsBoard';

const WHEN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit',
});

/** A position we draw a coloured badge for. Everything else gets the neutral one. */
const BADGE = new Set(['QB', 'RB', 'WR', 'TE']);

const pct = (n) => (n == null ? null : `${Number(n).toFixed(1)}%`);

/**
 * THE FIVE BARS, AND THERE ARE NOT ALWAYS FIVE.
 *
 * The mock draws five unconditionally. In CFB week 3 a player has three games,
 * so this draws what exists - and the count beside it says n of N with the
 * real N rather than implying a denominator nobody played.
 *
 * A DNP IS AN OUTLINE, NOT A ZERO. lib/market/propStats.js drops an unmeasured
 * game from the denominator entirely (valueOf returns null when every mapped
 * column is null); a bar drawn at zero for it would read as a player who
 * showed up and did nothing.
 */
function Spark({ chart, line }) {
  if (!chart?.points?.length) return null;
  const pts = chart.points.slice(-5);
  return (
    <span className="px-spark" aria-hidden="true">
      {pts.map((p, i) => {
        const dnp = p.value == null;
        const over = !dnp && p.value > line;
        return (
          <i key={`${p.week ?? i}-${i}`}
            className={dnp ? 'dnp' : over ? 'o' : 'u'}
            style={{ height: dnp ? '40%' : over ? '100%' : '55%' }} />
        );
      })}
    </span>
  );
}

function PropRow({ r, href }) {
  const badge = BADGE.has(String(r.position ?? '').toUpperCase())
    ? String(r.position).toUpperCase() : null;
  const label = MARKET_LABELS[r.marketType] ?? r.marketType;
  const line = r.line == null ? null : Number(r.line);
  const hit = r.hit && r.hit.games > 0 ? r.hit : null;
  const cold = hit ? hit.cleared / hit.games <= 0.4 : false;

  const body = (
    <>
      <span className={`px-pb${badge ? ` ${badge.toLowerCase()}` : ' none'}`}>
        {badge ?? (r.position ? String(r.position).slice(0, 2).toUpperCase() : '·')}
      </span>
      <span className="px-who">
        <b>{shortName(r.selection)}</b>
        <small>
          {r.teamAbbr ? `${r.teamAbbr} · ` : ''}
          <i>{label}{r.side ? ` ${r.side}` : ''}{line != null ? ` ${line}` : ''}</i>
          {/* ONE BOOK IS NOT A CONSENSUS. The count rides the row only where
              more than one shop priced it; at 1 the number is true and the
              phrase is misleading. */}
          {r.numBooks > 1 ? ` · ${r.numBooks} books` : ''}
        </small>
      </span>
      {/* A SPARKLINE IS A CLAIM ABOUT GAMES WE HOLD. An unlinked row has no
          player behind it, so it gets none - the gap is ours, and drawing
          flat bars would hide it. */}
      {r.chart && line != null ? <Spark chart={r.chart} line={line} /> : <span className="px-spark empty" />}
      <span className="px-num">
        {/* AS-OFFERED CARRIES NO PERCENTAGE. It was never de-vigged; a number
            in this column would imply a normalisation that did not happen. */}
        {r.asOffered
          ? <><b className="off">{r.american > 0 ? `+${r.american}` : r.american}</b><span>as offered</span></>
          : <><b>{pct(r.impliedPct) ?? '—'}</b><span>market</span></>}
      </span>
      <span className={`px-num hit${cold ? ' cold' : ''}`}>
        <b>{hit ? `${hit.cleared} of ${hit.games}` : '—'}</b>
        <span>hit</span>
      </span>
    </>
  );

  return href
    ? <Link className="px-row" href={href}>{body}</Link>
    : <div className="px-row">{body}</div>;
}

/** One game's header: the two sides, the network slot, kickoff or LIVE. */
function GameHead({ g }) {
  const live = g.status === 'live';
  return (
    <div className="px-gh">
      <b>{g.away} at {g.home}</b>
      <span className="t">
        {live ? <i className="live">LIVE</i> : (g.kickoffAt ? WHEN.format(new Date(g.kickoffAt)).toUpperCase() : '')}
      </span>
    </div>
  );
}

function Chips({ label, items, active, hrefFor }) {
  if (!items.length) return null;
  return (
    <div className="px-frow">
      <span className="l">{label}</span>
      {items.map(([k, text, cls]) => (
        <Link key={String(k)} className={`px-chip${cls ? ` ${cls}` : ''}${String(active) === String(k) ? ' on' : ''}`}
          href={hrefFor(k)}>{text}</Link>
      ))}
    </div>
  );
}

export default function PropsIndex({
  rows, filtered, state, hrefFor, teams = [], stats = [], cardHref,
}) {
  // GROUPED BY KICKOFF when the sort is kickoff; one flat list otherwise,
  // because "highest hit rate" across the slate is a different question from
  // "what is on at nine" and grouping it by game would bury the answer.
  const grouped = (state.sort ?? 'kickoff') === 'kickoff';
  const games = [];
  if (grouped) {
    const by = new Map();
    for (const r of rows) {
      if (!by.has(r.matchId)) {
        by.set(r.matchId, {
          id: r.matchId, away: r.away.abbr || r.away.name, home: r.home.abbr || r.home.name,
          kickoffAt: r.kickoffAt, status: r.matchStatus, rows: [],
        });
        games.push(by.get(r.matchId));
      }
      by.get(r.matchId).rows.push(r);
    }
    games.sort((a, b) => new Date(a.kickoffAt) - new Date(b.kickoffAt));
  }

  return (
    <div className="px">
      <Chips label="Sport" items={[['all', 'ALL'], ['cfb', 'CFB'], ['nfl', 'NFL'], ['epl', 'EPL']]}
        active={state.league} hrefFor={(k) => hrefFor({ league: k, team: null })} />
      <Chips label="Team" items={[['all', 'ALL'], ...teams.map((t) => [t, t])]}
        active={state.team} hrefFor={(k) => hrefFor({ team: k })} />
      <Chips label="Pos" items={[['all', 'ALL'], ['QB', 'QB', 'qb'], ['RB', 'RB', 'rb'], ['WR', 'WR', 'wr'], ['TE', 'TE', 'te']]}
        active={state.pos} hrefFor={(k) => hrefFor({ pos: k })} />
      <Chips label="Stat" items={[['all', 'ALL'], ...stats]}
        active={state.marketType} hrefFor={(k) => hrefFor({ marketType: k })} />
      {/* HIT IS A PERCENTAGE OVER GAMES PLAYED, not over five - in week 3 a
          player has three, and "5 of 5" would be a filter nobody can satisfy. */}
      <Chips label="Hit" items={[[0, 'ANY'], [60, '60%+'], [80, '80%+'], [100, 'ALL OF THEM']]}
        active={state.minHitPct} hrefFor={(k) => hrefFor({ minHitPct: k })} />

      <div className="px-sortrow">
        <span className="l">Sort</span>
        {[['kickoff', 'KICKOFF'], ['implied', 'MARKET %'], ['hit', 'HIT RATE']].map(([k, t]) => (
          <Link key={k} className={`px-chip${(state.sort ?? 'kickoff') === k ? ' on' : ''}`}
            href={hrefFor({ sort: k })}>{t}</Link>
        ))}
        <span className="cnt">{filtered} {filtered === 1 ? 'prop' : 'props'}</span>
      </div>

      {rows.length === 0 ? (
        <div className="px-empty">NOTHING PRICED MATCHES · LOOSEN A FILTER</div>
      ) : grouped ? (
        games.map((g) => (
          <section key={g.id}>
            <GameHead g={g} />
            <div className="px-list">
              {g.rows.map((r, i) => (
                <PropRow key={`${r.matchId}-${r.marketType}-${r.selection}-${r.side ?? ''}-${i}`}
                  r={r} href={cardHref(r)} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <>
          <div className="px-gh"><b>{state.sort === 'hit' ? 'Highest hit rate' : 'Highest market probability'}</b><span className="t">{filtered}</span></div>
          <div className="px-list">
            {rows.map((r, i) => (
              <PropRow key={`${r.matchId}-${r.marketType}-${r.selection}-${r.side ?? ''}-${i}`}
                r={r} href={cardHref(r)} />
            ))}
          </div>
        </>
      )}

      <p className="px-ft">
        <b>Market</b> is the consensus implied probability, de-vigged. <b>Hit</b> is how
        many of the last games cleared this line. Tap a row for the player&rsquo;s card.
        Sportsvyn does not sell picks.
      </p>
    </div>
  );
}
