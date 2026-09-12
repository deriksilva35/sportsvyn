// lib/games/lobbyV2Shape.js - the Games tab v2 cards, PURE (GAMES TAB v2 relay).
//
// Every card on the lobby is a small object the page renders without
// deciding anything: the reader (lobbyV2.js) fetches, these functions shape,
// app/games/page.js draws. Fixtures in lobbyV2Shape.test.mjs pin each state.
//
// A MISSING STAT IS "–", NEVER 0 (relay 7c): a reader who has not played
// yesterday has no yesterday score, not a score of zero.

export const DASH = '–';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
/** 0..20 as a word, capitalised when `cap`; anything larger stays digits. */
export function numberWord(n, { cap = false } = {}) {
  const k = Number(n);
  const w = Number.isInteger(k) && k >= 0 && k <= 20 ? ONES[k] : String(n);
  return cap ? w[0].toUpperCase() + w.slice(1) : w;
}

const stat = (label, value) => ({ label, value: value == null ? DASH : String(value) });
const fmt1 = (v) => (v == null ? null : Number(v).toFixed(1));

/** "6h 14m left" / "42m left" / "closed" - from two instants, no clock read here. */
export function timeLeft(closesAt, now) {
  if (!closesAt) return null;
  const ms = new Date(closesAt).getTime() - new Date(now).getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms <= 0) return 'closed';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? `${h}h ${m}m left` : `${m}m left`;
}

/**
 * THE DAILY CARD.
 * @param {{ board: {id:number, closesAt:string}|null, run: {startedAt, completedAt, pct, score}|null,
 *   yesterday: {score:number|null}|null, best: number|null, rank: {rank:number, of:number}|null,
 *   edition: number|string|null, playingToday: number, uid: number|null, now: Date|string }} p
 */
export function dailyCard({ board = null, run = null, yesterday = null, best = null, rank = null, edition = null, playingToday = 0, uid = null, now = new Date() } = {}) {
  const editionLine = edition != null ? `Edition ${edition}` : 'The Daily';
  const base = {
    key: 'daily', tag: 'Daily', title: 'The Daily', href: '/daily/board',
    description: 'Eight slots, twelve teams, one secret NFL week. Three minutes. Same board for everyone.',
    edition: editionLine, closesAt: board?.closesAt ?? null,
  };
  if (!board) {
    return { ...base, state: 'none', cta: 'Board opens at midnight ET', stats: [stat('Yesterday', null), stat('Best', null), stat('Rank', null)], timeLeft: null };
  }
  if (uid == null) {
    // GO rider 2: never a 0 on the hero. With nobody in yet the three
    // stats are the board's own shape; once someone has played, it leads.
    const playing = Number(playingToday) || 0;
    return {
      ...base, state: 'signed-out', cta: 'Sign in to play',
      stats: playing > 0
        ? [stat('Playing today', playing), stat('Slots', 8), stat('Teams', 12)]
        : [stat('Slots', 8), stat('Teams', 12), stat('Clock', '3:00')],
      timeLeft: timeLeft(board.closesAt, now),
    };
  }
  const stats = [
    stat('Yesterday', fmt1(yesterday?.score)),
    stat('Best', fmt1(best)),
    // R5: the N of the latest graded edition stays even when this reader
    // has no run on it - "–" of 1,204, not a bare "Rank".
    { label: rank?.of ? `of ${rank.of.toLocaleString('en-US')}` : 'Rank', value: rank?.rank != null ? `#${rank.rank}` : DASH },
  ];
  const tl = timeLeft(board.closesAt, now);
  if (run?.completedAt) return { ...base, state: 'done', cta: 'Done · see your grade', stats, timeLeft: tl };
  if (run?.startedAt) return { ...base, state: 'in-progress', cta: 'In progress', stats, timeLeft: tl };
  return { ...base, state: 'play', cta: "Play today's board", stats, timeLeft: tl };
}

/**
 * THE WEEKLY CARD. No projection exists anywhere in the app (Part A 3b), so
 * the card carries scored + rank only.
 * @param {{ home: {state, filled, remaining, locksAt, firstKickoff, week, score}|null,
 *   scored: number|null, rank: {rank, of}|null, uid }} p
 */
export function weeklyCard({ home = null, scored = null, rank = null, uid = null } = {}) {
  const base = {
    key: 'weekly', tag: 'Weekly', title: 'The Weekly', href: '/weekly',
    description: "Your best six, full PPR. Each slot locks at its player's kickoff.",
    week: home?.week ?? null, locksAt: home?.locksAt ?? null,
  };
  if (!home || home.state === 'none') {
    return { ...base, state: 'none', sub: 'no board this week', cta: 'See the Weekly', stats: [stat('Scored', null), stat('Rank', null)] };
  }
  const filled = Number(home.filled ?? 0);
  const sub = `Week ${home.week} · ${filled} of 6 set`;
  const stats = [
    stat('Scored', fmt1(scored ?? home.score)),
    { label: rank ? `of ${rank.of.toLocaleString('en-US')}` : 'Rank', value: rank ? `#${rank.rank}` : DASH },
  ];
  if (uid == null) return { ...base, state: 'signed-out', sub: `Week ${home.week}`, cta: 'Sign in to play', stats: [stat('Slots', 6), stat('Scoring', 'PPR')] };
  if (home.state === 'settled') return { ...base, state: 'settled', sub, cta: 'See your grade', stats };
  if (home.state === 'locked') return { ...base, state: 'locked', sub, cta: 'Lineup locked · view', stats };
  if (filled >= 6) return { ...base, state: 'set', sub, cta: 'Lineup set · view', stats };
  return { ...base, state: 'unset', sub, cta: 'Set your six', stats };
}

/**
 * PICK'EM ROW: one row, two sport lines (relay 7e, PICK'EM ROW addendum).
 *
 * THE LINE STATES THE WHOLE BOARD, not the part still open. "0 of 9" on a
 * board of 24 hid fifteen games that had already kicked unpicked, and the
 * denominator shrank all day rather than saying anything true. Once a row
 * has kicked the line reads "<picked> of <total> · <n> still open · next
 * lock <t>"; before any has, "<picked> of <total> · first lock <t>".
 *
 * THE ROW GOES WHERE THE PICKS ARE. The href used to be a hardcoded
 * /pickem/nfl, so a reader who had finished the NFL board and not started
 * the CFB one tapped PICK and landed on the completed board. It now points
 * at the sport with open unpicked rows and the soonest next kickoff; with
 * nothing left to pick, at the soonest-locking board; with one board, that
 * one. Under the rolling lock the next kickoff IS the next lock, which is
 * why one field serves both choices.
 */
export function pickemRow({ nfl = null, cfb = null, uid = null } = {}) {
  const lines = []; let anyOpen = false; let anyPickable = false; let firstLock = null;
  const candidates = [];
  for (const [label, p] of [['NFL', nfl], ['CFB', cfb]]) {
    const sport = p?.sport ?? label.toLowerCase();
    if (!p) { lines.push({ text: `${label} no board yet`, at: null }); continue; }
    if (p.settled) { lines.push({ text: `${label} settled${p.record ? ` · ${p.record.correct} of ${p.record.played}` : ''}`, at: null }); continue; }
    const total = Number(p.total ?? 0);
    const pickable = Number(p.pickable ?? 0);
    const pickedOpen = Number(p.pickedOpen ?? 0);
    const picked = Number(p.picked ?? pickedOpen);
    const at = p.nextKickoff ?? null;
    candidates.push({ sport, open: pickable - pickedOpen, at });
    if (pickable === 0) { lines.push({ text: `${label} all games kicked · grading`, at: null }); continue; }
    anyPickable = true;
    if (firstLock == null || (at && new Date(at) < new Date(firstLock))) firstLock = at ?? firstLock;
    if (pickable - pickedOpen > 0) anyOpen = true;
    const kicked = total - pickable;
    if (uid == null) { lines.push({ text: `${label} ${total} game${total === 1 ? '' : 's'} · ${kicked > 0 ? 'next' : 'first'} lock `, at }); continue; }
    lines.push({
      text: kicked > 0
        ? `${label} ${picked} of ${total} · ${pickable} still open · next lock `
        : `${label} ${picked} of ${total} · first lock `,
      at,
    });
  }
  const pill = !anyPickable ? { label: 'Locked', tone: 'muted' }
    : uid == null ? null
      : anyOpen ? { label: 'Pick', tone: 'volt' } : { label: 'Done', tone: 'jade' };
  return { key: 'pickem', title: "Pick'em", glyph: '✓', href: `/pickem/${pickemHrefSport(candidates)}`, lines, pill, firstLock };
}

/** The sport the row should open: needs picks first, then soonest lock. */
export function pickemHrefSport(candidates = []) {
  const live = candidates.filter((c) => c.sport);
  if (!live.length) return 'nfl';
  if (live.length === 1) return live[0].sport;
  const t = (c) => (c.at ? new Date(c.at).getTime() : Number.MAX_SAFE_INTEGER);
  const needs = live.filter((c) => c.open > 0);
  const pool = needs.length ? needs : live;
  return [...pool].sort((a, b) => t(a) - t(b))[0].sport;
}

/**
 * DRAFT ROW (relay 7e, Part A 3d): draftHomeView's state when a room is
 * open, else the next contest's opening.
 */
export function draftRow({ home = null, next = null, seats = 12, rounds = 8, clock = '30s' } = {}) {
  const line1 = `${seats} seats · ${rounds} rounds · ${clock} clock`;
  const base = { key: 'draft', title: 'The Draft', glyph: String(seats), href: '/draft' };
  if (!home) {
    if (next?.opensAt) {
      const day = new Date(next.opensAt).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'America/New_York' });
      return { ...base, lines: [{ text: line1 }, { text: `Week ${next.week} rooms open `, at: next.opensAt }], pill: { label: day, tone: 'muted' } };
    }
    return { ...base, lines: [{ text: line1 }, { text: 'no room yet' }], pill: { label: 'Locked', tone: 'muted' } };
  }
  const wk = home.week != null ? `Week ${home.week}` : 'This week';
  switch (home.state) {
    case 'rules': return { ...base, lines: [{ text: line1 }, { text: `${wk} · room open · locks `, at: home.locksAt }], pill: { label: 'Draft', tone: 'volt' } };
    case 'waiting': return { ...base, lines: [{ text: line1 }, { text: `${wk} · your seat · ${home.picks ?? 0} picks in` }], pill: { label: 'Open', tone: 'volt' } };
    case 'drafting': return { ...base, lines: [{ text: line1 }, { text: `${wk} · drafting${home.seat != null ? ` · seat ${home.seat}` : ''}` }], pill: { label: 'Live', tone: 'volt' } };
    case 'locked': return { ...base, lines: [{ text: line1 }, { text: `${wk} · ${home.entered ? 'your roster is in' : 'locked'}` }], pill: { label: 'Locked', tone: 'muted' } };
    case 'settled': return { ...base, lines: [{ text: line1 }, { text: `${wk} · settled` }], pill: { label: 'Done', tone: 'jade' } };
    default: return { ...base, lines: [{ text: line1 }, { text: wk }], pill: null };
  }
}

/**
 * THE INTRO LINE (relay 7b, GO rider 1). Rows lock at their own kickoff, so
 * the second sentence names the FIRST kickoff, never a shared lock:
 *   { open: 'Two boards open.', lock: { count: 14, toPick: 14, league: 'NFL', at: iso } | null, live: 0 }
 *   -> "Two boards open. First of fourteen NFL games kicks <StandaloneDate/>."
 * With a game live the page says instead:
 *   -> "<live> live now. <toPick> <league> games still to pick."
 * `open` counts boards a reader can act on right now; `toPick` is the
 * pickable games of that league not yet picked (all of them signed out).
 */
export function introLine({ daily = null, weekly = null, pickem = null, draft = null, liveCount = 0 } = {}) {
  let open = 0;
  if (daily && (daily.state === 'play' || daily.state === 'in-progress' || daily.state === 'signed-out')) open += 1;
  if (weekly && (weekly.state === 'unset' || weekly.state === 'set' || weekly.state === 'signed-out')) open += 1;
  if (pickem?.pill?.label === 'Pick' || (pickem && pickem.pill == null && pickem.firstLock)) open += 1;
  if (draft && (draft.pill?.label === 'Draft' || draft.pill?.label === 'Open')) open += 1;
  const openLine = open === 0 ? 'No boards open.' : `${numberWord(open, { cap: true })} board${open === 1 ? '' : 's'} open.`;
  let lock = null;
  for (const [league, p] of [['NFL', pickem?.sports?.nfl], ['CFB', pickem?.sports?.cfb]]) {
    if (!p || p.settled || !p.nextKickoff || !(Number(p.pickable) > 0)) continue;
    if (!lock || new Date(p.nextKickoff) < new Date(lock.at)) {
      lock = { count: Number(p.pickable), toPick: Number(p.pickable) - Number(p.pickedOpen ?? 0), league, at: p.nextKickoff };
    }
  }
  return { open: openLine, lock, live: Number(liveCount) || 0 };
}

/**
 * THE TONIGHT TITLE (GO rider 3): "Live now" when any card is live, "Tonight"
 * when the first card kicks after 5:00 PM today in the viewer's zone (the
 * sv_tz cookie, ET before it exists - the same path the times use),
 * "Up next" otherwise.
 */
export function tonightTitle({ games = [], now = new Date(), tz = 'America/New_York' } = {}) {
  if (games.some((g) => g.status === 'live')) return 'Live now';
  const first = games.find((g) => g.kickoffAt);
  if (!first) return 'Up next';
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false });
  const parts = (d) => Object.fromEntries(fmt.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  const k = parts(first.kickoffAt), n = parts(now);
  const sameDay = k.year === n.year && k.month === n.month && k.day === n.day;
  return sameDay && Number(k.hour) >= 17 ? 'Tonight' : 'Up next';
}
