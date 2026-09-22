'use client';

// components/october/OctoberCard.js - the five-a-day card, frames 1 and 2 of
// docs/design/mocks/october-v0_2.html.
//
// ONE COMPONENT, TWO FRAMES. The mock's "picking" and "your five" are the same
// card at two moments - a slot that is open takes a tap and a slot that is
// locked shows points - so this renders both and the difference is per SLOT,
// not per screen. A second component would have had to re-derive which half
// of the card was which.
//
// SAVE ON CHANGE, optimistic, the house pattern. There is no submit button:
// the mock's footer button is a COUNT ("2 to go"), not an action, because a
// card with a rolling lock has no single moment to submit at.

import { useState, useTransition } from 'react';
import { saveOctoberPickAction, clearOctoberPickAction } from '@/app/actions/october';

const SLOT_LABEL = { arm: 'ARM', bat1: 'BAT', bat2: 'BAT', bat3: 'BAT', bat4: 'BAT' };

export default function OctoberCard({ view, signedIn = false, signinHref = '/signin' }) {
  const [slots, setSlots] = useState(() => Object.fromEntries(view.slots.map((s) => [s.slot, s])));
  const [openGame, setOpenGame] = useState(() => view.board.find((g) => g.pickable)?.matchId ?? null);
  const [err, setErr] = useState(null);
  const [, start] = useTransition();

  const pool = view.pool?.byGame?.[String(openGame)] ?? [];
  const game = view.board.find((g) => String(g.matchId) === String(openGame)) ?? null;
  const onCard = new Set(Object.values(slots).map((s) => s.playerId).filter(Boolean).map(String));

  // WHICH SLOT A TAP FILLS: the first OPEN slot of that player's kind. The
  // mock's step strip is Game -> Player -> Slot, and the slot step is a
  // formality when only one of its kind is free.
  const targetSlot = (kind) => view.slots
    .map((s) => s.slot)
    .find((s) => (kind === 'arm' ? s === 'arm' : s !== 'arm') && !slots[s]?.playerId && slots[s]?.pip !== 'locked');

  const choose = (p) => {
    if (!signedIn) return;
    const slot = targetSlot(p.kind);
    if (!slot) { setErr(p.kind === 'arm' ? 'Your arm slot is filled.' : 'All four bat slots are filled.'); return; }
    const before = slots[slot];
    setSlots((m) => ({ ...m, [slot]: { ...m[slot], playerId: p.playerId, name: p.short, matchId: p.matchId, pip: 'picked' } }));
    setErr(null);
    start(async () => {
      const r = await saveOctoberPickAction(view.contest.id, slot, p);
      // THE SERVER'S ANSWER WINS. An optimistic paint the server refuses is
      // repainted back, with its reason, rather than left standing as a pick
      // the reader believes they made.
      if (!r?.ok) { setSlots((m) => ({ ...m, [slot]: before })); setErr(reasonText(r, view)); }
    });
  };

  const clear = (slot) => {
    if (!signedIn) return;
    const before = slots[slot];
    setSlots((m) => ({ ...m, [slot]: { slot, pip: 'open' } }));
    start(async () => {
      const r = await clearOctoberPickAction(view.contest.id, slot);
      if (!r?.ok) { setSlots((m) => ({ ...m, [slot]: before })); setErr(reasonText(r, view)); }
    });
  };

  const filled = view.slots.filter((s) => slots[s.slot]?.playerId).length;
  const toGo = view.slots.length - filled;

  return (
    <div className="oc" data-phase={view.phase}>
      <Header view={view} slots={slots} />

      {/* THE STEPS NOTE, and the rules on the card - written once, shown on
          the card, never changed mid-tournament. */}
      <div className="oc-steps">
        <div className="oc-strip">
          <span className={`oc-stp${openGame ? ' done' : ' on'}`}><i>{openGame ? '✓' : '1'}</i><b>Game</b></span>
          <span className="oc-arw" />
          <span className={`oc-stp${openGame ? ' on' : ''}`}><i>2</i><b>Player</b></span>
          <span className="oc-arw" />
          <span className="oc-stp"><i>3</i><b>Slot</b></span>
        </div>
        <p className="oc-note">
          One arm, four bats, only from today&apos;s games{capPhrase(view)}. Each slot
          locks at its game&apos;s first pitch.{' '}
          <b>A player you use is gone for the rest of October.</b>
        </p>
      </div>

      <div className="oc-sh"><h3>Today</h3><span>tap a game</span></div>
      <div className="oc-grid">
        {view.board.map((g) => (
          <button
            key={g.matchId} type="button"
            className={`oc-gc${String(g.matchId) === String(openGame) ? ' on' : ''}${g.status === 'live' ? ' live' : ''}${!g.pickable ? ' lk' : ''}`}
            onClick={() => g.pickable && setOpenGame(g.matchId)}
            disabled={!g.pickable}
            data-game={g.slug}
          >
            <span className="oc-mks">
              <i style={{ background: two(g.away) }} /><i style={{ background: two(g.home) }} />
            </span>
            <b>{g.away.abbr} @ {g.home.abbr}</b>
            <small>{g.status === 'live' ? 'live' : timeOf(g.kickoffAt)}</small>
          </button>
        ))}
      </div>

      {err ? <p className="oc-err" role="alert">{err}</p> : null}

      <div className="oc-duo">
        <div className="oc-field">
          <div className="oc-form">
            {view.slots.map((base) => {
              const s = slots[base.slot] ?? base;
              const locked = s.pip === 'locked';
              const kind = base.slot === 'arm' ? 'p' : 'b';
              return (
                <div key={base.slot}
                  className={`oc-slot ${kind}${s.playerId ? ' filled' : ''}${locked ? ' locked' : ''}${!s.playerId && !locked ? ' elig' : ''}`}
                  data-slot={base.slot} data-state={locked ? 'locked' : s.playerId ? 'filled' : 'open'}>
                  {locked ? <span className="oc-lk">LOCKED</span>
                    : s.playerId && signedIn ? <button type="button" className="oc-x" aria-label={`Clear ${base.slot}`} onClick={() => clear(base.slot)}>×</button>
                      : null}
                  <span className="oc-pos">{SLOT_LABEL[base.slot]}</span>
                  {s.playerId ? <>
                    <span className="oc-nm">{s.name}</span>
                    {/* THE POSTED CARD SAYS HE IS NOT IN IT, AND THE SLOT IS
                        STILL OPEN. It replaces the club-and-time line rather
                        than sitting beside it: a reader with three hours and a
                        benched bat needs one sentence, not two. After the lock
                        this never renders - see notStarting() - because there
                        is nothing left to swap. */}
                    {base.notStarting && !locked
                      ? <span className="oc-tm swap">not starting · swap</span>
                      : <span className="oc-tm">{teamLine(s, view)}</span>}
                    {/* POINTS LAND AS THE BOX SCORE DOES: a number when the
                        line exists, an em-dash while the game is ahead. */}
                    {base.points != null
                      ? <span className={`oc-pts${base.state === 'final' ? ' fin' : ''}`}>{base.points}</span>
                      : base.state === 'pending' && locked ? <span className="oc-pts wait">–</span> : null}
                  </> : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="oc-panel">
          <div className="oc-pan-h">
            <b>{game ? `${game.away.abbr} @ ${game.home.abbr}` : 'Your five'}</b>
            {/* WHAT THE PANEL IS ACTUALLY SHOWING. It used to read "lineups
                in" off the PROBABLES, which are a pitcher and not a lineup at
                all - so it said the lineups were in three hours before either
                club had posted one. */}
            <small>{game ? <>{timeOf(game.kickoffAt)}<br />{lineupWord(game)}</> : <>points land<br />as the box does</>}</small>
          </div>
          <div className="oc-pan-b">
            {pool.length ? pool.slice(0, 12).map((p) => {
              const mine = onCard.has(String(p.playerId));
              const usedOn = view.used?.[String(p.playerId)] ?? null;
              const gone = mine || usedOn != null;
              return (
                <button key={p.playerId} type="button"
                  className={`oc-prow${gone ? ' gone' : ''}`}
                  onClick={() => !gone && choose(p)} disabled={gone || !signedIn}
                  data-player={p.playerId}>
                  <span className={`oc-pb ${p.kind === 'arm' ? 'p' : 'b'}`}>{p.kind === 'arm' ? 'P' : 'B'}</span>
                  <span className="oc-who">
                    <b>{p.short}</b>
                    {/* THE MOCK'S OWN THREE SUB-LINES: the club and position,
                        "on your card", or "used <date>". A spent player is
                        DIMMED, never hidden - the reader has to be able to see
                        where their October went. */}
                    {/* THE MOCK'S OWN SUB-LINE, PLUS THE BATTING ORDER. A
                        posted card is the best thing this row can say about a
                        bat - "bats 4th" beats "RF" - and an arm with no
                        announced start says so rather than looking like a
                        confirmed starter. */}
                    <small>{p.team} · {mine ? 'on your card' : usedOn ? `used ${prettyDay(usedOn)}` : slotWord(p)}</small>
                  </span>
                  <span className="oc-val"><b>{p.ppg ?? '–'}</b><small>PPG</small></span>
                </button>
              );
            }) : <p className="oc-empty">{game ? 'The pool for this game is still building.' : 'Tap a game above.'}</p>}
          </div>
        </div>
      </div>

      <div className="oc-rules">
        <b>Bats</b> {view.contest.rules.bats}<br />
        <b>Arms</b> {view.contest.rules.arms}<br />
        An empty slot at first pitch is a DNF for the day.
      </div>

      <div className="oc-ft">
        <div className="oc-pace">
          {view.isDnf ? <>This day is a <b>DNF</b><br />an empty slot passed its first pitch</>
            : <>Your five so far<br /><b>{view.total}</b>{view.progress.locked ? ` · ${view.progress.locked} in play` : ''}</>}
        </div>
        {!signedIn ? <a className="oc-lock" href={signinHref}>Sign in to play</a>
          : toGo === 0 ? <span className="oc-rcpt">✓ RECEIPT · 5 OF 5</span>
            : <button className="oc-lock" type="button" disabled>{toGo} to go</button>}
      </div>
    </div>
  );
}

function Header({ view, slots }) {
  const next = view.nextLock;
  const pips = view.slots.map((s) => slots[s.slot]?.pip ?? s.pip);
  const filled = pips.filter((p) => p !== 'open').length;
  return (
    <div className="oc-hd">
      <div className="oc-hd-top">
        <span className="oc-eb">October</span>
        {/* THE PREVIEW NAMES ITSELF HERE. stageLabel() falls back to
            "Postseason" on a null stage, which is what a regular-season
            preview day has - so without this the card would have called six
            days of September the postseason. seasonLabel is the contest's own
            word for what it is. */}
        <span className="oc-ed">{view.contest.seasonLabel ?? stageLabel(view.contest.stage)} · {view.contest.games} game{view.contest.games === 1 ? '' : 's'}</span>
      </div>
      <div className="oc-crow">
        {/* THE CLOCK COUNTS TO THE NEXT LOCK, NEVER TO MIDNIGHT - each slot
            locks at its own first pitch, so the only deadline worth showing is
            the soonest one the reader can still act on. */}
        {next ? <Clock msAway={next.msAway} /> : null}
        <div className="oc-lbl">{next ? <>next lock<b>{next.slug.toUpperCase()} · {timeOf(next.kickoffAt)}</b></> : <>all locked<b>points only</b></>}</div>
        <div className="oc-tot"><b>{filled}</b><span>of {view.slots.length}</span></div>
      </div>
      <div className="oc-pips">
        {pips.map((p, i) => <i key={i} className={`oc-pip${p === 'locked' ? ' lk' : p === 'picked' ? ' on' : ''}`} />)}
      </div>
      <div className="oc-sub">
        <span>{view.progress.locked} locked · {view.progress.picked} picked · {view.progress.open} open</span>
        <span>{Object.keys(view.used ?? {}).length} used in October</span>
      </div>
    </div>
  );
}

/**
 * The Daily's flip digits. A STATIC READING, taken on the server and shipped
 * as a number - see octoberView()'s nextLock.msAway. Deriving it here with
 * Date.now() was impure during render and would have hydrated to a different
 * minute than it rendered.
 */
function Clock({ msAway }) {
  const mins = Math.max(0, Math.floor((Number(msAway) || 0) / 60000));
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return (
    <span className="oc-clk" aria-label={`${hh} hours ${mm} minutes to the next lock`}>
      <i className="oc-dg">{hh[0]}</i><i className="oc-dg">{hh[1]}</i>
      <span className="oc-cl">:</span>
      <i className="oc-dg">{mm[0]}</i><i className="oc-dg">{mm[1]}</i>
    </span>
  );
}

/**
 * WHAT A PICKER ROW SAYS ABOUT ITSELF. The batting order when the card is up,
 * "starter not announced" for an arm offered before a probable exists, and the
 * position otherwise - which is all the mock ever had.
 */
function slotWord(p) {
  if (p?.order != null) return `bats ${ordinal(p.order)}`;
  if (p?.probablePending) return 'starter not announced';
  return p?.position ?? '';
}

/** "lineup posted" is a per-side fact and the panel covers two clubs. */
function lineupWord(game) {
  const l = game?.lineupPosted ?? null;
  if (l?.away && l?.home) return 'lineups posted';
  if (l?.away || l?.home) return 'one lineup posted';
  return 'lineup not posted yet';
}

const ordinal = (n) => {
  const i = Number(n);
  if (!Number.isFinite(i)) return String(n);
  const t = i % 100;
  if (t >= 11 && t <= 13) return `${i}th`;
  return `${i}${({ 1: 'st', 2: 'nd', 3: 'rd' })[i % 10] ?? 'th'}`;
};

const two = (t) => (t?.c1 && t?.c2 ? `linear-gradient(to bottom, ${t.c1} 0 58%, ${t.c2} 58%)` : 'var(--ink-3)');
const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
const prettyDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const stageLabel = (s) => ({ wild_card: 'Wild Card', division: 'Division Series', championship: 'Championship Series', world_series: 'World Series' }[s] ?? 'Postseason');
const teamLine = (s, view) => {
  const g = view.board.find((x) => String(x.matchId) === String(s.matchId));
  if (!g) return '';
  const t = s.team ?? '';
  return `${t}${t ? ' · ' : ''}${g.status === 'live' ? 'live' : g.status === 'final' ? 'F' : timeOf(g.kickoffAt)}`;
};

/**
 * THE CAP IS THE DAY'S AND THE CARD SAYS IT. It is the one rule of this game
 * that is not the same every day - ceil(5 / games) - and on a one-game night
 * "two from one game" would be describing a rule that makes the card
 * impossible. A day whose cap is five has no cap worth naming.
 */
function capPhrase(view) {
  const cap = view?.contest?.maxPerGame ?? 2;
  const games = view?.board?.length ?? 0;
  if (games <= 1 || cap >= 5) return '';
  return `, at most ${cap} from any one game`;
}

const REASON = {
  signed_out: 'Sign in to play.',
  used: 'You already used that player this October.',
  already_on_card: 'That player is already on your card.',
  max_from_game: 'That is the most this slate allows from one game.',
  game_started: 'That game has started.',
  slot_locked: 'That slot locked at its first pitch.',
  wrong_kind: 'That slot takes a different kind of player.',
  not_today: 'That player is not in today\'s games.',
  settled: 'This day is already graded.',
  not_open: 'This card has not opened yet.',
};
function reasonText(r, view) {
  if (r?.reason === 'used' && r.usedOn) return `You used that player on ${prettyDay(r.usedOn)}.`;
  void view;
  return REASON[r?.reason] ?? 'That pick did not save.';
}
