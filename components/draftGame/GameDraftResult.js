// The per-game Draft's result (fri-1 S2, the mock's RESULT screen): a navy header
// with the lime eyebrow ("SF @ SEA · FINAL 27-24"), the big points, "points · 1st
// of 4", and - once final - "Top N% of everyone who drafted this game"; then your
// four players with stat line and points, the one that does not count faded
// "not counted"; "The room" ranking; "Share" and "Draft another game".
//
// LIVE AND FINAL ARE ONE CARD: the result is computed from the box as it stands
// (lib/draftGame/settle.js liveResult) until the board settles, then read from
// what settle stored. Only the percentile waits for the final.

import Link from 'next/link';
import { ordinal, ROUNDS } from '@/lib/draftGame/rules';
import ShareDraftGame from '@/components/draftGame/ShareDraftGame';

const pts = (n) => Number(n ?? 0).toFixed(1);

export default function GameDraftResult({ view, eyebrow }) {
  const res = view.result;
  const me = res.seats.find((s) => s.you);
  const final = view.phase === 'final';
  const room = [...res.seats].sort((a, b) => a.place - b.place || a.seat - b.seat);
  const players = [...me.players].sort((a, b) => Number(b.counted) - Number(a.counted) || b.pts - a.pts);
  const shareText = `I scored ${pts(me.score)} drafting ${view.away} @ ${view.home} on Sportsvyn - ${ordinal(me.place)} of ${res.seats.length}.`;

  return (
    <section className="dgm-result" data-draft-game-result={final ? 'final' : 'live'}>
      <div className="dgm-hd dgm-hd--result">
        <div className="dgm-eyebrow">{eyebrow}</div>
        <div className="dgm-big n" data-draft-game-points>{pts(me.score)}</div>
        <div className="dgm-hd-sub">points · {ordinal(me.place)} of {res.seats.length}{final ? '' : ' · live'}</div>
        {final && res.top_pct != null && (
          <div className="dgm-top">
            {res.entrants > 1 ? `Top ${res.top_pct}% of everyone who drafted this game` : 'Nobody else drafted this game yet'}
          </div>
        )}
      </div>

      <ul className="dgm-scored" aria-label="Your players">
        {players.map((p) => (
          <li key={p.id} className={`dgm-srow${p.counted ? '' : ' dgm-srow--out'}`}>
            <span className={`dgm-pos dgm-pos--${String(p.pos).toLowerCase()}`}>{p.pos}</span>
            <span className="dgm-who">
              <b>{p.name}</b>
              <small>{p.played ? (p.line ?? 'no stats') : 'did not play'}{p.counted ? '' : ' · not counted'}</small>
            </span>
            <span className="dgm-pts n">{pts(p.pts)}</span>
          </li>
        ))}
        <li className="dgm-note">Best 3 of {ROUNDS} count.</li>
      </ul>

      <h2 className="dgm-h2">The room</h2>
      <ol className="dgm-ranking">
        {room.map((s) => (
          <li key={s.seat} className={s.you ? 'dgm-rank--you' : ''}>
            <span className="dgm-place">{ordinal(s.place)}</span>
            <b>{s.label}</b>
            <span className="dgm-pts n">{pts(s.score)}</span>
          </li>
        ))}
      </ol>

      <div className="dgm-actions">
        <ShareDraftGame text={shareText} />
        <Link className="dgm-pill dgm-pill--outline" href="/draft/game">Draft another game</Link>
      </div>
    </section>
  );
}
