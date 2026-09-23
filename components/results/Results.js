// components/results/Results.js - one results screen for the four football
// games, rendered from docs/design/mocks/results-grammar-v0_1.html.
//
// ONE COMPONENT, FOUR FRAMES, and the difference is DATA not markup: the header
// is the same three numbers over the same bar in all four, the two-column
// compare is the same rows, the field is the same distribution and the same
// board. What differs is what a ceiling is called (perfect / optimal / best
// draft / best), whether there are two ranks (the Draft), and whether the
// compare is two lineups or a scoreboard (Pick'em).
//
// A SERVER COMPONENT. There is nothing to interact with except a link - the mock
// has no state and no controls, and the board's "tap an entry" is a link to the
// same route with a ?who=, not a client toggle.

import Link from 'next/link';
import './results.css';

const POS_VAR = {
  QB: 'var(--qb)', RB: 'var(--rb)', WR: 'var(--wr)', TE: 'var(--te)',
  K: 'var(--k)', FLEX: 'var(--rb)', FLEX2: 'var(--rb)', DEF: 'var(--k)',
};
const posColor = (p) => POS_VAR[String(p ?? '').toUpperCase()] ?? 'var(--muted-dim)';
const n1 = (v) => (v == null ? '-' : Number(v).toLocaleString('en-US'));

/** THE THREE NUMBERS AND THE BAR. The mock's header, for every game. */
function Header({ v }) {
  const h = v.header ?? {};
  // THE BAR IS THE READER AGAINST THE CEILING, with a tick where the ceiling is.
  // Capped at 100 so an entry that somehow beat its own ceiling cannot paint
  // past the end of the track.
  const pct = Math.max(0, Math.min(100, Number(h.pctOfCeiling ?? 0)));
  return (
    <div className="rs-hd">
      <div className="rs-hd-top">
        <span className="rs-eb">{v.title}{v.subtitle ? ` · ${v.subtitle}` : ''}</span>
        <span className="rs-ed">{v.edition}</span>
      </div>
      <div className="rs-crow">
        {/* THE DRAFT CARRIES TWO RANKS AND BOTH ARE TRUE: the room is what the
            reader played in, the field is the context. */}
        {h.roomRank != null ? (
          <div className="rs-lbl">Room<b>{h.roomRankLabel}</b>
            <small>of {h.roomOf}{h.roomName ? ` · ${h.roomName}` : ''}</small></div>
        ) : null}
        <div className="rs-lbl">Field<b>{h.rankLabel ?? '-'}</b>
          <small>{h.of ? `of ${n1(h.of)}` : 'no field'}{h.topPct != null ? ` · top ${h.topPct}%` : ''}</small></div>
        {h.roomRank == null ? (
          <div className="rs-lbl">Of {v.ceilingWord}<b className="v">{h.pctOfCeiling == null ? '-' : `${h.pctOfCeiling}%`}</b>
            <small>{v.ceilingWord} {n1(h.ceiling)}</small></div>
        ) : null}
        <div className="rs-tot">
          <b className="n">{v.record ?? n1(h.score)}</b>
          <span>{v.game === 'pickem' ? 'Record' : v.game === 'draft' ? 'Best six' : 'Points'}</span>
        </div>
      </div>
      <div className="rs-pct">
        <span>{v.game === 'pickem' ? 'hit rate' : 'you'}</span>
        <div className="rs-bar"><i style={{ width: `${pct}%` }} /><u style={{ left: '100%' }} /></div>
        <b>{v.game === 'pickem'
          ? `${v.bestHitRate ?? '-'}%`
          : `${n1(h.ceiling)}${v.game === 'draft' ? ' · best draft' : ''}`}</b>
      </div>
    </div>
  );
}

function SlotRow({ p, hit }) {
  return (
    <div className={`rs-srow${hit ? ' hit' : ''}${!hit && p?.name ? ' miss' : ''}`}>
      <span className="rs-pb" style={{ background: posColor(p?.pos ?? p?.slot) }}>{p?.pos ?? p?.slot ?? ''}</span>
      <span className="rs-who">{p?.short ?? p?.name ?? '—'}
        <small>{[p?.team, p?.meta].filter(Boolean).join(' · ')}</small></span>
      <span className="rs-v n">{p?.points == null ? '-' : p.points}</span>
    </div>
  );
}

/** YOU VS THE CEILING. Two columns, the matched slots lit on both sides. */
function Compare({ v }) {
  const matched = v.matched ?? 0;
  const of = v.slotCount ?? (v.mine?.length ?? 0);
  return (
    <div className="rs-mod">
      <div className="rs-mh">
        <b>You vs {v.ceilingWord}</b>
        <small>{matched} of {of} slots matched<br />
          {v.toCeiling == null ? '' : `${v.toCeiling > 0 ? '−' : ''}${Math.abs(v.toCeiling)} to the ceiling`}</small>
      </div>
      <div className="rs-vs">
        <div className="rs-col">
          <h4>Your {of === 6 ? 'six' : `${of}`} <b className="n">{n1(v.header?.score)}</b></h4>
          {(v.mine ?? []).map((p, i) => <SlotRow key={`m${i}`} p={p} hit={p.hit} />)}
        </div>
        <div className="rs-col perf">
          <h4>{v.ceilingWord === 'perfect' ? 'Perfect' : 'Optimal'} <b className="n">{n1(v.header?.ceiling)}</b></h4>
          {(v.ceiling ?? []).map((p, i) => <SlotRow key={`c${i}`} p={p} hit={p.hit} />)}
        </div>
      </div>
      {v.lostIt?.length ? (
        <div className="rs-delta">
          <span>Where you lost it: {v.lostIt.map((l, i) => (
            <span key={i}>{i ? ' · ' : ''}{i === 0 ? <b>{l.phrase}</b> : l.phrase}{' '}
              <span className="t">−{Math.abs(l.delta)}</span></span>
          ))}</span>
        </div>
      ) : null}
    </div>
  );
}

/** THE DRAFT'S PICK LIST: at · ADP · taken Nth · value, on every pick. */
function Picks({ title, sub, picks }) {
  return (
    <div className="rs-mod">
      <div className="rs-mh"><b>{title}</b><small>{sub}</small></div>
      {picks.map((p, i) => (
        <div className={`rs-pk${p.counted ? '' : ' out'}`} key={`${p.at}-${i}`}>
          <span className="rs-at">{p.at ?? '-'}</span>
          <span className="rs-pb" style={{ background: posColor(p.pos) }}>{p.pos ?? ''}</span>
          <span className="rs-who">{p.short ?? p.name}
            <small>{[p.adp == null ? null : `ADP ${p.adp}`, p.takenLabel].filter(Boolean).join(' · ')}</small></span>
          <span className="rs-v n">{p.points == null ? '-' : p.points}
            <small className={p.counted ? (p.reach ? 'r' : '') : ''}>
              {p.counted ? (p.gapLabel ?? '') : 'not counted'}</small></span>
        </div>
      ))}
    </div>
  );
}

/** THE FIELD: the distribution, the axis, and the board. */
function Field({ v, href }) {
  const f = v.field ?? {};
  const d = f.distribution ?? { bars: [] };
  return (
    <div className="rs-mod">
      <div className="rs-mh"><b>The field</b>
        <small>{n1(f.played)} played{f.dnf ? ` · ${f.dnf} DNF` : ''}<br />median {n1(f.median)}</small></div>
      <div className="rs-dist">
        {d.bars.map((b) => (
          <i key={b.key} className={`${b.me ? 'me' : ''}${b.top ? ' top' : ''}${b.dnf ? ' dnf' : ''}`.trim() || undefined}
            style={{ height: `${Math.max(2, b.pct)}%` }} />
        ))}
      </div>
      <div className="rs-axis">{(f.axis ?? []).map((a, i) => <span key={i}>{a}</span>)}</div>
      {(f.rows ?? []).map((r) => {
        const row = (
          <>
            <span className="rs-rk">{r.rank}</span>
            <span className="rs-nm">{r.you ? 'you' : r.name}{r.house ? <span className="rs-h"> · house</span> : null}
              {r.sub ? <small>{r.sub}</small> : null}</span>
            <span className="rs-s n">{r.pct == null ? '' : `${r.pct}%`}</span>
            <span className="rs-t n">{n1(r.score)}</span>
          </>
        );
        const cls = `rs-lr${r.you ? ' you' : ''}${r.rank === 1 ? ' best' : ''}`;
        // TAP AN ENTRY -> ITS LINEUP, which is this same route with a ?who=.
        // A link, not a client toggle: the mock has no state.
        return r.userId != null && href
          ? <Link key={`${r.rank}-${r.userId}`} href={`${href}?who=${r.userId}`} className={cls}>{row}</Link>
          : <div className={cls} key={`${r.rank}-${r.name}`}>{row}</div>;
      })}
    </div>
  );
}

/** PICK'EM: a scoreboard, one square per game. */
function Scoreboard({ v }) {
  const sb = v.scoreboard ?? { games: [], rows: [] };
  // EIGHT COLUMNS AT A TIME, which is what fits - the mock says "swipe the
  // squares for all 16" and the grid scrolls sideways rather than shrinking the
  // squares to nothing.
  return (
    <div className="rs-mod">
      <div className="rs-sbw">
        <div className="rs-sbg" style={{ '--games': sb.games.length }}>
          <div className="rs-sb h">
            <span /><span>entry</span>
            {sb.games.map((g) => <span key={g.key}>{g.away ?? ''}</span>)}
            <span className="rs-t">W-L</span>
          </div>
          {sb.rows.map((r) => (
            <div className={`rs-sb${r.you ? ' you' : ''}`} key={r.userId}>
              <span className="rs-rk">{r.rank}</span>
              <span>{r.you ? 'you' : r.name}{r.house ? <span className="rs-h"> · house</span> : null}</span>
              {r.squares.map((s) => <i key={s.key} className={s.state === 'win' ? 'w' : s.state === 'loss' ? 'l' : 'p'} />)}
              <span className="rs-t n" style={r.rank === 1 ? { color: 'var(--jade)' } : undefined}>{r.record}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Results({ v, href = null }) {
  return (
    <div className="rs" data-game={v.game}>
      <Header v={v} />
      {v.game === 'pickem' ? <Scoreboard v={v} /> : null}
      {v.game === 'draft' ? (
        <>
          {v.best ? (
            <Picks title="The best draft"
              sub={`${v.best.name}${v.best.house ? ' · house' : ''}${v.best.seat != null ? ` · seat ${v.best.seat}` : ''}`
                + `\n${v.best.score} · ${v.best.of} picks, ${v.best.counted} counted`}
              picks={v.bestPicks ?? []} />
          ) : null}
          <Picks title="Your draft"
            sub={`${v.seat != null ? `seat ${v.seat}` : 'seat unknown'}\n${n1(v.header?.score)}`
              + `${v.toCeiling == null ? '' : ` · ${v.toCeiling} to best`}`}
            picks={v.myPicks ?? []} />
        </>
      ) : null}
      {v.game === 'daily' || v.game === 'weekly' ? <Compare v={v} /> : null}
      <Field v={v} href={href} />
      {v.game === 'weekly' ? (
        <p className="rs-foot">Tap any entry to see its six. <b>Optimal</b> is the best six
          anyone could have set from the slate at lock - it is the ceiling, not a person.</p>
      ) : null}
      {v.game === 'draft' ? (
        <p className="rs-foot"><b>Seat</b> tells you where a draft happened - a 1.06 Barkley is a
          different draft from a 1.01.</p>
      ) : null}
      {v.game === 'pickem' ? (
        <p className="rs-foot">Swipe the squares for all {v.scoreboard?.games?.length ?? 0}. A dashed
          square is a game not yet decided.</p>
      ) : null}
    </div>
  );
}
