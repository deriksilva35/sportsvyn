// lib/games/v3Rows.js - THE FOUR ROWS THE v3 SCREEN DRAWS. PURE.
//
// One line per game, and R1 governs every number in it: the site already
// computes it, or it does not appear. Everything here is a shape over readers
// that exist - liveEntryRows, pickemCardData, the Daily's run rows, the room
// counter - except two pieces of arithmetic that had to be written, and those
// are the two the tests lean on hardest.
//
// ============================================================================
// THE PICK'EM RECORD IS THE ONE THAT COULD HAVE LIED
// ============================================================================
// A board's results are written at SETTLE (contests.perfect.results), so there
// is no live grader and no stored mid-week record. The mock asks for
// "NFL 1-0 · 15 pending" on a Friday morning, and the only honest way to build
// it is from FINAL games against the reader's own picks. A live game leading
// 21-0 is not a win: counting it would put a number on screen that the site
// does not compute and that can still change.
//
// PUSHES LEAVE THE DENOMINATOR ALONE, the same rule pickemTable already uses
// (lib/games/read.js): a cancelled or tied game is off the numerator AND the
// denominator, not a loss.

const n1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
const join = (...p) => p.filter((x) => x != null && x !== '').join(' · ') || null;

function ord(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v) % 100;
  if (a >= 11 && a <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][Math.min(Math.abs(v) % 10, 4)] ?? 'th';
}
const rankOf = (r, of) => (r != null && of != null ? `${r}${ord(r)} of ${of}` : null);

// ---------------------------------------------------------------------------
// WEEKLY
// ---------------------------------------------------------------------------
/**
 * Surnames, because the row is one line on a phone.
 *
 * A SUFFIX IS NOT A SURNAME - "Kenneth Walker III" is Walker and "Odell
 * Beckham Jr." is Beckham - and a CLUB IS NOT A PERSON: a defense keeps its
 * whole name, because "Texans D/ST" shortened to "D/ST" names nobody.
 */
const SUFFIX = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v']);
export function surnamesOf(rows = []) {
  return (rows ?? []).map((r) => {
    const name = String(r?.name ?? '').trim();
    if (!name) return null;
    if (/D\/ST$/.test(name)) return name.split(/\s+/).slice(-2).join(' ');
    const parts = name.split(/\s+/);
    while (parts.length > 1 && SUFFIX.has(parts[parts.length - 1].toLowerCase())) parts.pop();
    return parts[parts.length - 1];
  }).filter(Boolean);
}

/**
 * @param {{rows: Array, state: string, filled?: number, live?: boolean,
 *          scored?: number, toPlay?: number, rank?: number, of?: number}} p
 *   rows are liveEntryRows' six: { slot, name, points, played }
 */
export function weeklyRowV3({ rows = [], state = 'none', filled = 0, live = false,
  scored = null, toPlay = null, rank = null, of = null } = {}) {
  const base = { key: 'weekly', mark: 'W', name: 'The Weekly', href: '/weekly' };

  if (live) {
    // THE BEST OF THE SIX, and only once somebody has played. Before the first
    // kickoff every row is a zero and "best" would be an arbitrary pick of six
    // identical numbers - the same rule the Draft card's hero already follows.
    const played = (rows ?? []).filter((r) => r?.played);
    const best = played.length
      ? played.reduce((a, b) => (Number(b.points) > Number(a.points) ? b : a))
      : null;
    return {
      ...base,
      line: join(best ? `${surnamesOf([best])[0]} ${n1(best.points)}` : null,
        toPlay != null ? `${toPlay} to play` : null,
        rankOf(rank, of)),
      right: scored != null ? String(n1(scored)) : null, rightLabel: 'live',
      tone: 'live',
    };
  }

  if (state === 'settled') {
    return {
      ...base,
      line: join(rankOf(rank, of), scored != null ? String(n1(scored)) : null),
      right: rank != null ? `${rank}${ord(rank)}` : null,
      rightLabel: of != null ? `of ${of}` : 'final', tone: 'done',
    };
  }

  const names = surnamesOf(rows).slice(0, 3);
  const extra = Math.max(0, (filled || rows.length) - names.length);
  return {
    ...base,
    line: join(names.length ? names.join(' · ') + (extra > 0 ? ` +${extra}` : '') : null),
    right: `${filled}/6`, rightLabel: filled >= 6 ? 'set' : 'to fill', tone: null,
  };
}

// ---------------------------------------------------------------------------
// PICK'EM
// ---------------------------------------------------------------------------
/**
 * The reader's record from FINAL games only, plus what is still to come.
 *
 * @param {{picks: Record<string,string>, games: Array<{id, status, winner}>}} p
 * @returns {{correct: number, played: number, pending: number}}
 */
export function pickemRecord({ picks = {}, games = [] } = {}) {
  let correct = 0; let played = 0; let pending = 0;
  for (const g of games ?? []) {
    const pick = picks?.[g?.id] ?? picks?.[String(g?.id)] ?? null;
    if (pick == null) continue;              // not yours to be waiting on
    if (g.status !== 'final') { pending += 1; continue; }
    if (g.winner == null) continue;          // push: off both sides
    played += 1;
    if (g.winner === pick) correct += 1;
  }
  return { correct, played, pending };
}

export function pickemRowV3({ nfl = null, cfb = null } = {}) {
  const parts = [];
  for (const [label, p] of [['NFL', nfl], ['CFB', cfb]]) {
    if (!p?.record) continue;
    const { correct, played, pending } = p.record;
    if (played > 0) parts.push(`${label} ${correct}-${played - correct}`);
    if (pending > 0) parts.push(played > 0 ? `${pending} pending` : `${label} ${pending} pending`);
  }
  const tot = ['nfl', 'cfb'].reduce((a, k) => {
    const r = (k === 'nfl' ? nfl : cfb)?.record;
    return r ? { c: a.c + r.correct, p: a.p + r.played } : a;
  }, { c: 0, p: 0 });
  return {
    key: 'pickem', mark: 'P', name: "Pick'em", href: '/pickem/nfl',
    line: parts.join(' · ') || null,
    right: tot.p > 0 ? `${tot.c}-${tot.p - tot.c}` : null,
    rightLabel: tot.p > 0 ? 'record' : null, tone: null,
  };
}

// ---------------------------------------------------------------------------
// DAILY
// ---------------------------------------------------------------------------
/** "2:43" from the two stamps daily_board_runs already carries (migration 097). */
export function elapsedOf({ startedAt = null, completedAt = null } = {}) {
  const a = startedAt == null ? null : new Date(startedAt).getTime();
  const b = completedAt == null ? null : new Date(completedAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
  const s = Math.round((b - a) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function dailyRowV3({ pct = null, matched = null, slots = 8, streak = 0, state = 'play', opensAt = null } = {}) {
  return {
    key: 'daily', mark: 'D', name: 'The Daily', href: '/daily/board',
    line: join(
      pct != null ? `yesterday ${pct}` : null,
      matched != null ? `${matched} of ${slots} matched` : null,
      Number(streak) > 0 ? `${streak}-day streak` : null,
    ),
    right: pct ?? null, rightLabel: pct != null ? 'yesterday' : null,
    tone: state === 'done' ? 'done' : null, opensAt,
  };
}

// ---------------------------------------------------------------------------
// DRAFT
// ---------------------------------------------------------------------------
export function draftRowV3({ state = 'none', onTheClock = false, pick = null, roundsToGo = null,
  roomRank = null, roomOf = null, score = null, fieldRank = null, fieldOf = null,
  bestSix = null, toPlay = null } = {}) {
  const base = { key: 'draft', mark: 'R', name: 'The Draft', href: '/draft' };

  if (onTheClock) {
    return {
      ...base,
      line: join('on the clock', pick ? `pick ${pick}` : null,
        roundsToGo != null ? `${roundsToGo} round${roundsToGo === 1 ? '' : 's'} to go` : null),
      right: pick, rightLabel: 'your pick', tone: 'live',
    };
  }
  if (state === 'settled') {
    return {
      ...base,
      // THE FIELD RANK ONLY WHEN IT EXISTS (addendum 3). There is no per-week
      // draft field board before a contest settles, so the clause is absent
      // rather than guessed.
      line: join(roomRank != null ? `${roomRank}${ord(roomRank)} in room` : null,
        score != null ? String(n1(score)) : null,
        fieldRank != null && fieldOf != null ? `${fieldRank}${ord(fieldRank)} of ${fieldOf} field` : null),
      right: roomRank != null ? `${roomRank}${ord(roomRank)}` : null,
      rightLabel: 'room', tone: 'done',
    };
  }
  if (bestSix != null) {
    return {
      ...base,
      line: join('best six', toPlay != null ? `${toPlay} to play` : null),
      right: String(n1(bestSix)), rightLabel: 'best six', tone: 'live',
    };
  }
  return { ...base, line: null, right: null, rightLabel: null, tone: null };
}
