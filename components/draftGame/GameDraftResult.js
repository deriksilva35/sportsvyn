// The per-game Draft's result (fri-1 S2, the mock's RESULT screen): a navy header
// with the lime eyebrow ("SF @ SEA · FINAL 27-24"), the big points, "points · 1st
// of 4", and - once final - "Top N% of everyone who drafted this game"; then your
// four players with stat line and points, the one that does not count faded
// "not counted"; "The room" ranking; "Share" and "Draft another game".
//
// LIVE AND FINAL ARE ONE CARD: the result is computed from the box as it stands
// (lib/draftGame/settle.js liveResult) until the board settles, then read from
// what settle stored. Only the percentile waits for the final.

import { ordinal, ROUNDS } from '@/lib/draftGame/rules';
import DraftResultView from '@/components/draftRoom/DraftResultView';

const pts = (n) => Number(n ?? 0).toFixed(1);

export default function GameDraftResult({ view, eyebrow }) {
  const res = view.result;
  const me = res.seats.find((s) => s.you);
  const final = view.phase === 'final';
  const room = [...res.seats].sort((a, b) => a.place - b.place || a.seat - b.seat);
  const players = [...me.players].sort((a, b) => Number(b.counted) - Number(a.counted) || b.pts - a.pts);
  const shareText = `I scored ${pts(me.score)} drafting ${view.away} @ ${view.home} on Sportsvyn - ${ordinal(me.place)} of ${res.seats.length}.`;
  // THE SHARED RESULT SCREEN (sun-3, components/draftRoom/DraftResultView.js): the
  // weekly Draft's results use the same one.
  return (
    <DraftResultView
      live={!final}
      eyebrow={eyebrow}
      points={me.score}
      placeLine={`points · ${ordinal(me.place)} of ${res.seats.length}${final ? '' : ' · live'}`}
      topLine={final && res.top_pct != null
        ? (res.entrants > 1 ? `Top ${res.top_pct}% of everyone who drafted this game` : 'Nobody else drafted this game yet')
        : null}
      players={players.map((p) => ({ id: p.id, pos: p.pos, name: p.name, sub: p.played ? (p.line ?? 'no stats') : 'did not play', pts: p.pts, counted: p.counted }))}
      countNote={`Best 3 of ${ROUNDS} count.`}
      room={room.map((s) => ({ key: s.seat, place: ordinal(s.place), label: s.label, score: s.score, you: s.you }))}
      shareText={shareText}
      back={{ href: '/draft/game', label: 'Draft another game' }}
    />
  );
}
