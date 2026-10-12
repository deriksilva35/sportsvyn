// components/draftRoom/DraftResultView.js - THE DRAFT LOOK's result screen
// (sun-3), shared by Game Drafts and the weekly Draft's results: a navy header
// with the lime eyebrow, the big points, "points · 2nd of 12", the field line
// ("Top N% of everyone who drafted ..."), your players with their sub-line and
// points - the ones that did not count faded "not counted" - then "The room"
// ranking, and Share (lime) beside the way back.
//
// Presentational: each game builds the props from its own settle data.
import Link from 'next/link';
import ShareDraftGame from '@/components/draftGame/ShareDraftGame';
import '@/app/draft/game/game.css';
import './draftRoom.css';

const pts = (n) => Number(n ?? 0).toFixed(1);

/**
 * @param eyebrow   node - "SF @ SEA · FINAL 27-24" / "THE DRAFT · NFL WEEK 6 · FINAL"
 * @param points    number
 * @param placeLine string - "points · 2nd of 4"
 * @param topLine   string|null - "Top 12% of everyone who drafted this game"
 * @param players   [{ id, pos, name, sub, pts, counted }] counted first
 * @param countNote string - "Best 3 of 4 count."
 * @param room      [{ key, place, label, score, you }]
 * @param shareText string
 * @param back      { href, label }
 */
export default function DraftResultView({ eyebrow, points, placeLine, topLine = null, players, countNote, room, shareText, back, live = false }) {
  return (
    <section className="dgm-result" data-draft-result={live ? 'live' : 'final'} data-draft-game-result={live ? 'live' : 'final'}>
      <div className="dgm-hd dgm-hd--result">
        <div className="dgm-eyebrow">{eyebrow}</div>
        <div className="dgm-big n" data-draft-game-points>{pts(points)}</div>
        <div className="dgm-hd-sub">{placeLine}</div>
        {topLine && <div className="dgm-top">{topLine}</div>}
      </div>

      <ul className="dgm-scored" aria-label="Your players">
        {players.map((p) => (
          <li key={p.id} className={`dgm-srow${p.counted ? '' : ' dgm-srow--out'}`}>
            <span className={`dgm-pos dgm-pos--${String(p.pos).toLowerCase()}`}>{p.pos}</span>
            <span className="dgm-who">
              <b>{p.name}</b>
              <small>{[p.sub, p.counted ? null : 'not counted'].filter(Boolean).join(' · ')}</small>
            </span>
            <span className="dgm-pts n">{pts(p.pts)}</span>
          </li>
        ))}
        <li className="dgm-note">{countNote}</li>
      </ul>

      <h2 className="dgm-h2">The room</h2>
      <ol className="dgm-ranking">
        {room.map((s) => (
          <li key={s.key} className={s.you ? 'dgm-rank--you' : ''}>
            <span className="dgm-place">{s.place}</span>
            <b>{s.label}</b>
            <span className="dgm-pts n">{pts(s.score)}</span>
          </li>
        ))}
      </ol>

      <div className="dgm-actions">
        <ShareDraftGame text={shareText} />
        {back && <Link className="dgm-pill dgm-pill--outline" href={back.href}>{back.label}</Link>}
      </div>
    </section>
  );
}
