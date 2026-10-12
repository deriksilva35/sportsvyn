// lib/results/draftLook.js - the weekly Draft's settled results in THE DRAFT LOOK
// (sun-3): lib/results/draft.js's reader, shaped into components/draftRoom/
// DraftResultView's props - the same screen Game Drafts shows. PURE.
//
// "points · 2nd of 12" is the ROOM (the reader against the eleven bots, as settle
// stored it); "Top N% of everyone who drafted this week" is the FIELD rank. The
// eight players are the reader's picks, the six that counted first, the two that
// did not faded; each sub-line is where he went ("1.06 · +3 value").

import { competitionRankOrdinal } from './draftLookRank.js';

export function weeklyDraftResultProps(v) {
  if (!v?.played) return null;
  const score = v.header?.score ?? null;
  const rank = v.header?.rank ?? null;
  const played = v.field?.played ?? null;
  const roomSeats = v.roomSeats ?? [];
  const placed = competitionRankOrdinal(roomSeats.map((s) => ({ key: s.seat, score: Number(s.score) || 0, you: s.user === true })));
  const me = placed.find((s) => s.you);
  const of = roomSeats.length || v.header?.roomOf || null;
  const picks = [...(v.myPicks ?? [])].sort((a, b) => Number(b.counted) - Number(a.counted) || (Number(b.points) || 0) - (Number(a.points) || 0));
  const counting = picks.filter((p) => p.counted).length;
  return {
    eyebrow: `THE DRAFT · NFL WEEK ${v.week ?? ''} · FINAL`,
    points: Number(score) || 0,
    placeLine: me && of ? `points · ${me.place} of ${of}` : 'points',
    topLine: rank != null && played ? `Top ${Math.max(1, Math.ceil((rank / played) * 100))}% of everyone who drafted this week` : null,
    players: picks.map((p, i) => ({
      id: `${p.overall ?? i}`, pos: p.pos, name: p.name,
      sub: [p.at, p.gapLabel].filter(Boolean).join(' · ') || null,
      pts: p.points ?? 0, counted: p.counted === true,
    })),
    countNote: `Best ${counting || 6} of ${picks.length || 8} count.`,
    room: placed.map((s) => ({ key: s.key, place: s.place, label: s.you ? 'You' : `Seat ${s.key}`, score: s.score, you: s.you })),
    shareText: `I scored ${(Number(score) || 0).toFixed(1)} in The Draft, NFL week ${v.week ?? ''} on Sportsvyn${me && of ? ` - ${me.place} of ${of} in my room` : ''}.`,
    back: { href: '/draft', label: 'Back to The Draft' },
  };
}
