// components/games/SeasonBoard.js - the season leaderboard, frame 3 of the
// games-experience mock: a prize, not a table.
//
// ONE DEFINITION, BOTH SCOPES: the lobby's global board and the league page's
// member-scoped board render THIS component with their own `overall` tables -
// a league of 2 gets a 2-card podium, never a ghost third. Server component,
// no state; every number arrives from the revealed-only reader.
//
// THE VIEWER'S ROW PINS AT THE BOTTOM wherever they rank, and STAYS in the
// list when it is already visible - the pinned copy is the persistent
// reference (ratified lean), not a replacement.
//
// Tier chip colors come from tierClass (lib/daily/reveal) - config, never
// hand-written hex in this file or its css.

import { tierClass } from '@/lib/daily/reveal';
import './season.css';

const initialOf = (name) => String(name ?? '?').replace(/^@/, '').charAt(0).toUpperCase();

function Move({ move }) {
  if (move == null || move === 0) return <span className="sb-mv fl">-</span>;
  if (move > 0) return <span className="sb-mv up">&#9650;{move}</span>;
  return <span className="sb-mv dn">&#9660;{Math.abs(move)}</span>;
}

function TierChip({ best }) {
  if (!best) return null;
  return <span className={`sb-tier ${tierClass(best)}`}>{best}</span>;
}

function Pod({ r, me, first }) {
  return (
    <div className={`sb-pod${first ? ' first' : ''}`}>
      <div className="sb-rk">{r.rank}</div>
      <div className={`sb-ava${me ? ' me' : ''}`}>{initialOf(r.name)}</div>
      <div className="sb-h">{r.name}</div>
      <div className="sb-pv">{r.points}</div>
      <TierChip best={r.best} />
    </div>
  );
}

function Row({ r, me, pinned = false }) {
  return (
    <div className={`sb-row${pinned ? ' you' : ''}`}>
      <span className="sb-rank">{r.rank}</span>
      <span className={`sb-ava sm${me ? ' me' : ''}`}>{initialOf(r.name)}</span>
      <span className="sb-who">
        <span className="sb-h">{r.name}{pinned ? ' · you' : ''}</span>
        <span className="sb-sub">{r.played} {r.played === 1 ? 'day' : 'days'} played</span>
      </span>
      <Move move={r.move} />
      <span className="sb-pts">{r.points}<small> pts</small></span>
    </div>
  );
}

export default function SeasonBoard({ table, userId = null }) {
  if (!table?.top?.length) return null;
  const uid = userId == null ? null : Number(userId);
  const podium = table.top.slice(0, 3);
  const rest = table.top.slice(3);
  // The podium renders 2nd-1st-3rd so first sits center and taller; with
  // fewer than three, whoever exists keeps their slot and nothing ghosts.
  const order = [podium[1], podium[0], podium[2]].filter(Boolean);
  const mine = table.top.find((r) => r.userId === uid) ?? table.self ?? null;
  return (
    <div className="sb">
      <div className="sb-podium">
        {order.map((r) => <Pod key={r.userId} r={r} me={r.userId === uid} first={r === podium[0]} />)}
      </div>
      {rest.map((r) => <Row key={r.userId} r={r} me={r.userId === uid} />)}
      {mine && uid != null && <Row r={mine} me pinned />}
    </div>
  );
}
