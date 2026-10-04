// lib/games/playLobby.js - the Play tab's multi-sport lobby, PURE (thu-38 + fri-1).
//
// THE REGISTRY READS, THIS FILE DECIDES. lib/games/playRegistry.js turns every
// registered game into zero or more ITEMS (one shape, below); everything the
// screen then does with them - which ones are YOUR MOVE, which carry LOCKS
// SOON, which sports get a chip, which groups collapse, what a chip filters -
// is decided here, from the items and a clock, and nothing else. No read, no
// Date.now(): `now` is always passed, so every boundary is a fixture.
//
// THE ITEM (what a registry reader returns; playRegistry.js builds them):
//   key        unique per item ('nfl-weekly', 'mlb-october', ...)
//   sport      'nfl' | 'cfb' | 'mlb' | 'nba' | 'epl' | 'all' (The Daily)
//   name, mark, href, cta, kicker      the registry entry's own copy
//   title      the card's headline ('Week 4', 'Five a day')
//   status     the one-line status, WITHOUT a time in it
//   at         { iso, words } | null - a time clause the page renders in its
//              own zone after the status ('locks' <time>). Never baked into
//              `status`: the header names the zone and every time must agree.
//   opensAt    ISO | null - null means it is open already (or has no door)
//   locksAt    ISO | null - the NEXT lock the reader can still beat; null when
//              nothing is left to act on (every game kicked, the room locked)
//   settled    true once graded
//   complete   true when the reader has nothing left to do (signed out: false)
//   progress   { done, total } | null
//   right      the row's right cell when there is no progress to show
//   groupNote  the sport group's right-hand note ('Week 4', 'Postseason')

export const SPORT_ORDER = ['nfl', 'mlb', 'nba', 'epl', 'cfb'];
export const SPORT_LABEL = { nfl: 'NFL', mlb: 'MLB', nba: 'NBA', epl: 'EPL', cfb: 'CFB', all: 'ALL SPORTS' };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** LOCKS SOON is a lock UNDER three hours away - 3h exactly is not soon. */
export const LOCKS_SOON_MS = 3 * HOUR;
/** A sport earns a chip with any game in the next fourteen days. */
export const CHIP_WINDOW_MS = 14 * DAY;
/** A sport with nothing open in the next seven days collapses to one line. */
export const COLLAPSE_WINDOW_MS = 7 * DAY;
/** Signed out, YOUR MOVE is the three soonest-locking open games. */
export const SIGNED_OUT_MOVES = 3;

const ms = (iso) => (iso == null ? null : new Date(iso).getTime());
const t = (now) => new Date(now).getTime();

/** ?sport= to a chip key: 'all' or a known sport. Anything else is 'all'. */
export function normalizeSport(v) {
  const s = String(Array.isArray(v) ? v[0] : v ?? '').toLowerCase();
  return SPORT_ORDER.includes(s) ? s : 'all';
}

/**
 * WHERE AN ITEM IS, from its own times and nothing else:
 *   done      settled
 *   upcoming  its door has not opened
 *   open      a lock the reader can still beat is ahead
 *   locked    open no more, not graded yet (in play, grading)
 */
export function phaseOf(item, now) {
  if (!item) return 'locked';
  if (item.settled) return 'done';
  const o = ms(item.opensAt);
  if (o != null && o > t(now)) return 'upcoming';
  const l = ms(item.locksAt);
  if (l != null && l > t(now)) return 'open';
  return 'locked';
}

/** Open, and the reader still has something to do on it. */
export function isActionable(item, now) {
  return phaseOf(item, now) === 'open' && item.complete !== true;
}

/** LOCKS SOON: open, and the next lock is under three hours away. */
export function locksSoon(item, now) {
  if (phaseOf(item, now) !== 'open') return false;
  return ms(item.locksAt) - t(now) < LOCKS_SOON_MS;
}

const byLock = (a, b) => (ms(a.locksAt) ?? Infinity) - (ms(b.locksAt) ?? Infinity) || String(a.key).localeCompare(String(b.key));

/** The chip's filter: ALL keeps everything, a sport keeps its own items only. */
export function filterBySport(items = [], chip = 'all') {
  return chip === 'all' ? [...items] : items.filter((i) => i.sport === chip);
}

/**
 * YOUR MOVE. Signed in: every item the reader can act on, soonest lock first.
 * Signed out: the three soonest-locking OPEN items, whatever the entry says.
 * The selected chip filters it like everything else on the screen.
 */
/**
 * THE YOUR MOVE PREDICATE, one item at a time. Signed in: open and not done.
 * Signed out: open. yourMove() below and the collapsed cards' YOUR MOVE tag
 * (playCards) both read it - one rule, never two copies of it.
 */
export function isMoveCandidate(item, { now, signedIn = false } = {}) {
  return signedIn ? isActionable(item, now) : phaseOf(item, now) === 'open';
}

export function yourMove(items = [], { now, signedIn = false, chip = 'all' } = {}) {
  const pool = filterBySport(items, chip);
  const moves = pool.filter((i) => isMoveCandidate(i, { now, signedIn }));
  const sorted = moves.sort(byLock);
  const picked = signedIn ? sorted : sorted.slice(0, SIGNED_OUT_MOVES);
  return picked.map((i) => ({ ...i, locksSoon: locksSoon(i, now) }));
}

/**
 * THE CHIPS: ALL, then each sport with any game in the next fourteen days.
 *
 * "A game" is either a real fixture (`nextGameBySport`: sport -> the ISO of its
 * next kickoff, or of a game live now) or a registered game whose door or lock
 * falls inside the window - an open October card counts even on a day the
 * fixtures read has not caught up. A sport the reader is already ON keeps its
 * chip, so ?sport=nba never renders a screen with no chip selected.
 */
export function sportChips(items = [], { now, nextGameBySport = {}, chip = 'all' } = {}) {
  const end = t(now) + CHIP_WINDOW_MS;
  const within = (iso) => { const x = ms(iso); return x != null && x <= end; };
  const has = new Set();
  for (const [sport, iso] of Object.entries(nextGameBySport ?? {})) if (within(iso)) has.add(sport);
  for (const i of items) {
    if (!SPORT_ORDER.includes(i.sport)) continue;
    const p = phaseOf(i, now);
    if (p === 'open') has.add(i.sport);
    else if (p === 'upcoming' && within(i.opensAt)) has.add(i.sport);
  }
  if (chip !== 'all') has.add(chip);
  return ['all', ...SPORT_ORDER.filter((s) => has.has(s))];
}

/**
 * THE GROUPS, one per sport, and the collapsed lines.
 *
 *   order     by the sport's soonest OPEN lock; a sport with nothing open now
 *             but a door opening inside seven days follows, by that door
 *   collapse  nothing open now and no door inside seven days -> one line at
 *             the bottom, naming the next door if there is one
 *   chip      a selected sport is never collapsed (it is what the reader asked
 *             to see), and only its group is drawn; The Daily ('all') is a
 *             group of its own on ALL only
 *   chips     when given, a sport with no chip and no door is left out
 *             entirely rather than collapsed - its items are a past season's
 *
 * @returns {{ groups: [{sport, label, note, rows}], daily: {rows}|null, collapsed: [{sport, label, opensAt, href, note}] }}
 */
export function groupsFor(items = [], { now, chip = 'all', chips = null } = {}) {
  const horizon = t(now) + COLLAPSE_WINDOW_MS;
  const bySport = new Map();
  for (const i of filterBySport(items, chip)) {
    if (!bySport.has(i.sport)) bySport.set(i.sport, []);
    bySport.get(i.sport).push(i);
  }
  const groups = []; const collapsed = [];
  for (const sport of SPORT_ORDER) {
    const rows = bySport.get(sport);
    if (!rows?.length) continue;
    const withPhase = rows.map((r) => ({ ...r, phase: phaseOf(r, now), locksSoon: locksSoon(r, now) }));
    const open = withPhase.filter((r) => r.phase === 'open');
    const doors = withPhase.filter((r) => r.phase === 'upcoming').map((r) => ms(r.opensAt)).sort((a, b) => a - b);
    const nextDoor = doors[0] ?? null;
    const note = rows.find((r) => r.groupNote)?.groupNote ?? null;
    const base = { sport, label: SPORT_LABEL[sport], note };
    const active = open.length > 0 || (nextDoor != null && nextDoor <= horizon);
    if (!active && chip === 'all') {
      // A SPORT WITH NO CHIP AND NO DOOR IS NOT A LINE: its only items are a
      // finished season's (October 2025 on a September 2026 screen).
      if (chips && !chips.includes(sport) && nextDoor == null) continue;
      const first = withPhase.find((r) => ms(r.opensAt) === nextDoor) ?? withPhase[0];
      collapsed.push({ ...base, opensAt: nextDoor == null ? null : new Date(nextDoor).toISOString(), href: first.href, rows: withPhase });
      continue;
    }
    groups.push({
      ...base,
      rows: withPhase,
      // the sort key: an open lock beats any door, then the soonest door
      _k: open.length ? [0, Math.min(...open.map((r) => ms(r.locksAt)))] : [1, nextDoor ?? Infinity],
    });
  }
  groups.sort((a, b) => a._k[0] - b._k[0] || a._k[1] - b._k[1] || SPORT_ORDER.indexOf(a.sport) - SPORT_ORDER.indexOf(b.sport));
  collapsed.sort((a, b) => (ms(a.opensAt) ?? Infinity) - (ms(b.opensAt) ?? Infinity) || SPORT_ORDER.indexOf(a.sport) - SPORT_ORDER.indexOf(b.sport));
  const dailyRows = chip === 'all' ? (bySport.get('all') ?? []).map((r) => ({ ...r, phase: phaseOf(r, now), locksSoon: locksSoon(r, now) })) : [];
  return {
    groups: groups.map(({ _k, ...g }) => g),
    daily: dailyRows.length ? { sport: 'all', label: SPORT_LABEL.all, rows: dailyRows } : null,
    collapsed,
  };
}

// ===========================================================================
// THE COLLAPSED CARDS (sun-19) - one card per group, closed by default
// ===========================================================================
// Every group above becomes ONE CARD: its name, a game count, a one-line
// summary built from the rows it already carries (no read of its own), and a
// YOUR MOVE tag. Order is the groups' order (soonest open lock first), then the
// out-of-season sports, dimmed with their door, then the cross-sport card.

/** The cross-sport group's card id - not 'all', which is the ALL chip (everything closed). */
export const ALL_SPORTS_CARD = 'all-sports';

/**
 * ONE CARD'S SUMMARY, from its rows' own fields. Parts are words plus at most
 * an instant (a door), so the component renders every time in the page's
 * zone; `nextLock` is the soonest open lock in the group.
 *   open      'The Weekly 6/6' with progress, else the name
 *   upcoming  'Pick'em opens' + the door
 *   locked    'The Run locked' (signed in; signed out an unopened row is just its name)
 *   done      'The Weekly final'
 */
export function cardSummary(rows = [], { signedIn = false } = {}) {
  const parts = [];
  let nextLock = null;
  for (const r of rows) {
    if (r.phase === 'open') {
      const l = ms(r.locksAt);
      if (l != null && (nextLock == null || l < ms(nextLock))) nextLock = r.locksAt;
    }
    const p = r.progress;
    if (r.phase === 'upcoming' && r.opensAt) parts.push({ key: r.key, text: `${r.name} opens`, opensAt: r.opensAt });
    else if (r.phase === 'done') parts.push({ key: r.key, text: `${r.name} final` });
    else if (r.phase === 'locked' && signedIn) parts.push({ key: r.key, text: `${r.name} locked` });
    else if (p && p.total > 0) parts.push({ key: r.key, text: `${r.name} ${p.done}/${p.total}` });
    else parts.push({ key: r.key, text: r.name });
  }
  return { parts, nextLock };
}

/**
 * THE CARDS, from a playLobby() view. `move` is true when any of the card's
 * rows is one of the view's own YOUR MOVE items - the very list the YOUR MOVE
 * cards draw, filtered by isMoveCandidate() - so the tag and the cards cannot
 * disagree.
 */
export function playCards({ groups = [], collapsed = [], daily = null, yourMove: moves = [] } = {}, { signedIn = false } = {}) {
  const moveKeys = new Set(moves.map((m) => m.key));
  const card = (g, { id = g.sport, dim = false } = {}) => {
    const rows = g.rows ?? [];
    return {
      id, sport: g.sport, label: g.label, count: rows.length, dim,
      opensAt: dim ? g.opensAt ?? null : null,
      move: rows.some((r) => moveKeys.has(r.key)),
      summary: cardSummary(rows, { signedIn }),
      rows,
    };
  };
  return [
    ...groups.map((g) => card(g)),
    ...collapsed.map((g) => card(g, { dim: true })),
    ...(daily ? [card(daily, { id: ALL_SPORTS_CARD })] : []),
  ];
}

/** ?sport= to the open card: one of the cards' ids, or 'all' (every card closed). */
export function normalizeOpen(v, ids = []) {
  const s = String(Array.isArray(v) ? v[0] : v ?? '').toLowerCase();
  return ids.includes(s) ? s : 'all';
}

/**
 * THE WHOLE SCREEN'S SHAPE, from the items. The component draws this and
 * decides nothing.
 */
export function playLobby(items = [], { now, signedIn = false, chip = 'all', nextGameBySport = {} } = {}) {
  const sport = normalizeSport(chip);
  const chips = sportChips(items, { now, nextGameBySport, chip: sport });
  const view = {
    chip: sport,
    chips,
    yourMove: yourMove(items, { now, signedIn, chip: sport }),
    ...groupsFor(items, { now, chip: sport, chips }),
  };
  return { ...view, cards: playCards(view, { signedIn }) };
}

/**
 * THE COLLAPSED LOBBY (sun-19): every sport's card, with ?sport= naming the ONE
 * that is open. Unlike the old chip filter, nothing is filtered - YOUR MOVE
 * and every card stay on the screen; the chip only opens its card. A sport
 * the reader is on keeps its chip (sportChips' rule).
 */
export function playLobbyOpen(items = [], { now, signedIn = false, open = 'all', nextGameBySport = {} } = {}) {
  const view = playLobby(items, { now, signedIn, chip: 'all', nextGameBySport });
  const ids = view.cards.map((c) => c.id);
  const o = normalizeOpen(open, ids);
  const chips = SPORT_ORDER.includes(o) ? sportChips(items, { now, nextGameBySport, chip: o }) : view.chips;
  return { ...view, chips, chip: SPORT_ORDER.includes(o) ? o : 'all', open: o };
}
