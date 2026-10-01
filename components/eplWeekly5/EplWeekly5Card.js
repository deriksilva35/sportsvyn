'use client';

// components/eplWeekly5/EplWeekly5Card.js - EPL Weekly 5's three screens, built
// to Derik's approved canvas (Pick, Live, Final) on the Weekly's picker
// pattern: a sticky slot dock, ONE page scroll, a lock bar at the foot.
//
// ONE COMPONENT, THREE MOMENTS. Which screen renders is view.phase - 'pick'
// before the gameweek's first kickoff, 'live' once one has gone, 'final' when
// it is graded - and the picker stays under the live screen for as long as a
// slot is still open, because a Sunday pick can be swapped on Saturday night.
//
// SAVE ON CHANGE, optimistic, and the SERVER'S ANSWER WINS: a refused or
// unreachable save repaints the slot back with the reason. Every refusal the
// card shows comes from lib/eplWeekly5/rules.js refuseReason(), the function
// the server runs.

import Link from 'next/link';
import { useMemo, useRef, useState, useTransition } from 'react';
import { saveEplWeekly5PickAction, clearEplWeekly5PickAction } from '@/app/actions/eplWeekly5';
import { refuseReason, clubCount, SLOTS, SLOT_LABEL, REASON_TEXT, MAX_PER_CLUB, slotAccepts } from '@/lib/eplWeekly5/rules';
import StandaloneTime from '@/components/StandaloneTime';
import TeamMark from '@/components/team/TeamMark';
import WindowLabel from './WindowLabel';
import { useStickyOffset } from '@/components/games/useStickyOffset';

const FILTERS = [
  { key: 'all', label: 'ALL' },
  { key: 'defgk', label: 'DEF/GK', slot: 'defgk' },
  { key: 'mid', label: 'MID', slot: 'mid' },
  { key: 'fwd', label: 'FWD', slot: 'fwd' },
  { key: 'flex', label: 'FLEX', slot: 'flex1' },
];
const LIST_HEAD = { all: 'ALL PLAYERS', defgk: 'DEFENDERS & KEEPERS', mid: 'MIDFIELDERS', fwd: 'FORWARDS', flex: 'ALL PLAYERS' };
const PAGE = 60;

const surname = (n) => {
  const s = String(n ?? '').trim();
  const parts = s.split(/\s+/);
  return (parts.length > 1 && /^[A-Z]\.$/.test(parts[0]) ? parts.slice(1).join(' ') : parts[parts.length - 1]) || s;
};
const filterOfSlot = (slot) => (slot === 'flex1' || slot === 'flex2' ? 'flex' : slot);

export default function EplWeekly5Card({ view, signedIn = false, signinHref = '/signin', boardHref = '/epl-weekly-5/board' }) {
  const { phase } = view;
  const openSlots = view.slots.filter((s) => s.pip !== 'locked');
  return (
    <div className="e5" data-phase={phase}>
      {phase === 'final' ? <FinalScreen view={view} boardHref={boardHref} /> : null}
      {phase === 'live' ? <LiveScreen view={view} /> : null}
      {phase === 'pick' ? <Picker view={view} signedIn={signedIn} signinHref={signinHref} /> : null}
      {phase === 'live' && openSlots.length && signedIn ? (
        <details className="e5-more" data-group="swap">
          <summary>Change an open pick · {openSlots.length} still before kickoff</summary>
          <Picker view={view} signedIn={signedIn} signinHref={signinHref} compact />
        </details>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PICK
// ---------------------------------------------------------------------------
function Picker({ view, signedIn, signinHref, compact = false }) {
  const [slots, setSlots] = useState(() => Object.fromEntries(view.slots.map((s) => [s.slot, s])));
  const [active, setActive] = useState(() => view.slots.find((s) => !s.playerId && s.pip !== 'locked')?.slot ?? null);
  const [filter, setFilter] = useState(() => filterOfSlot(view.slots.find((s) => !s.playerId && s.pip !== 'locked')?.slot ?? 'all'));
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [err, setErr] = useState(null);
  const [, start] = useTransition();
  const rootRef = useRef(null);
  useStickyOffset(rootRef);

  const lineup = useMemo(() => Object.fromEntries(Object.entries(slots).filter(([, s]) => s.playerId)
    .map(([k, s]) => [k, { playerId: s.playerId, matchId: s.matchId, clubId: s.clubId, pos: s.pos }])), [slots]);
  const onCard = new Set(Object.values(lineup).map((p) => String(p.playerId)));

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (view.pool ?? []).filter((p) => {
      if (filter === 'defgk' && !(p.pos === 'GK' || p.pos === 'DEF')) return false;
      if (filter === 'mid' && p.pos !== 'MID') return false;
      if (filter === 'fwd' && p.pos !== 'FWD') return false;
      if (needle && !`${p.name} ${p.club}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [view.pool, filter, q]);

  // WHICH SLOT AN ADD FILLS: the active slot if it takes him, else the first
  // open, unlocked slot that does.
  const target = (p) => {
    const free = (s) => slots[s]?.pip !== 'locked' && !slots[s]?.playerId;
    if (active && slots[active]?.pip !== 'locked' && slotAccepts(active, p.pos)) return active;
    return SLOTS.find((s) => free(s) && slotAccepts(s, p.pos)) ?? null;
  };

  const opts = () => ({
    board: view.board,
    now: new Date(),
    kickoffBy: new Map(view.board.map((g) => [String(g.match_id), g.kickoff_at])),
    statusBy: new Map(view.board.map((g) => [String(g.match_id), g.status])),
  });

  const add = (p) => {
    if (!signedIn) return;
    const slot = target(p);
    if (!slot) { setErr(`No open slot takes a ${p.pos}.`); return; }
    const player = { playerId: p.playerId, matchId: p.matchId, clubId: p.clubId, pos: p.pos };
    const why = refuseReason(lineup, slot, player, opts());
    if (why) { setErr(REASON_TEXT[why] ?? 'That pick did not save.'); return; }
    const before = slots[slot];
    setSlots((m) => ({ ...m, [slot]: { ...m[slot], ...player, name: p.name, club: p.club, kickoffAt: p.kickoffAt, pip: 'picked' } }));
    setErr(null);
    const nextOpen = SLOTS.find((s) => s !== slot && !slots[s]?.playerId && slots[s]?.pip !== 'locked') ?? null;
    setActive(nextOpen);
    if (nextOpen) setFilter(filterOfSlot(nextOpen));
    start(async () => {
      let r;
      try { r = await saveEplWeekly5PickAction(view.contest.id, slot, p.playerId); } catch { r = { ok: false, reason: 'unreachable' }; }
      if (!r?.ok) { setSlots((m) => ({ ...m, [slot]: before })); setErr(REASON_TEXT[r?.reason] ?? 'That pick did not save.'); }
    });
  };

  const clear = (slot) => {
    if (!signedIn) return;
    const before = slots[slot];
    setSlots((m) => ({ ...m, [slot]: { slot, label: SLOT_LABEL[slot], pip: 'open' } }));
    setActive(slot);
    setFilter(filterOfSlot(slot));
    start(async () => {
      let r;
      try { r = await clearEplWeekly5PickAction(view.contest.id, slot); } catch { r = { ok: false, reason: 'unreachable' }; }
      if (!r?.ok) { setSlots((m) => ({ ...m, [slot]: before })); setErr(REASON_TEXT[r?.reason] ?? 'That did not save.'); }
    });
  };

  const tapSlot = (slot) => {
    if (slots[slot]?.pip === 'locked') return;
    setActive(slot);
    setFilter(filterOfSlot(slot));
    setShown(PAGE);
  };

  const pips = SLOTS.map((s) => slots[s]?.pip ?? 'open');
  const filled = pips.filter((p) => p !== 'open').length;

  return (
    <div className={`e5-pick${compact ? ' compact' : ''}`} ref={rootRef}>
      {!compact ? (
        <>
          <p className="e5-window">
            <WindowLabel first={view.contest.firstKickoff} last={view.contest.lastKickoff} /> · each pick locks at its kickoff
          </p>
          <details className="e5-how">
            <summary>How it works</summary>
            <p>Pick five: one DEF/GK, one MID, one FWD and two FLEX (any position). At most {MAX_PER_CLUB} from one club.
              Each pick locks at its own kickoff; swap freely before it.</p>
            <ul>{view.contest.rules.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        </>
      ) : null}

      <div className="e5-dock">
        <div className="e5-slots">
          {SLOTS.map((slot) => {
            const s = slots[slot] ?? {};
            const locked = s.pip === 'locked';
            const on = active === slot && !locked;
            return (
              <div key={slot} className={`e5-slot${s.playerId ? ' filled' : ''}${on ? ' on' : ''}${locked ? ' locked' : ''}`}
                data-slot={slot} data-state={locked ? 'locked' : s.playerId ? 'filled' : 'open'}>
                <button type="button" className="e5-slot-b" onClick={() => tapSlot(slot)} disabled={locked}>
                  <span className="e5-slot-l">{SLOT_LABEL[slot]}</span>
                  {s.playerId ? <>
                    <b className="e5-slot-n">{surname(s.name).toUpperCase()}</b>
                    <small>{s.club} · {s.kickoffAt ? <StandaloneTime iso={s.kickoffAt} weekday zone={false} /> : ''}</small>
                  </> : <b className="e5-slot-e">{on ? 'PICK BELOW' : 'TAP TO FILL'}</b>}
                </button>
                {locked ? <span className="e5-lk" role="img" aria-label="locked">LOCKED</span>
                  : s.playerId && signedIn ? <button type="button" className="e5-x" aria-label={`Clear ${SLOT_LABEL[slot]}`} onClick={() => clear(slot)}>×</button> : null}
              </div>
            );
          })}
          <span className="e5-cap">max {MAX_PER_CLUB}<br />per club</span>
        </div>
      </div>

      <div className="e5-filters" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" role="tab" aria-selected={filter === f.key}
            className={`e5-chip${filter === f.key ? ' on' : ''}`}
            onClick={() => { setFilter(f.key); setShown(PAGE); if (f.slot) { const s = f.slot === 'flex1' && slots.flex1?.playerId ? 'flex2' : f.slot; if (slots[s]?.pip !== 'locked') setActive(s); } }}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="e5-search">
        <input type="search" placeholder="Search players" value={q} onChange={(e) => { setQ(e.target.value); setShown(PAGE); }} aria-label="Search players" />
      </div>
      {err ? <p className="e5-err" role="alert">{err}</p> : null}
      <div className="e5-lh"><span>{LIST_HEAD[filter]} · BY PTS/GAME</span><span>THIS SEASON</span></div>
      <div className="e5-list">
        {rows.slice(0, shown).map((p) => {
          const mine = onCard.has(String(p.playerId));
          const slot = target(p);
          const fromClub = clubCount(lineup, p.clubId, slot);
          const max = !mine && fromClub >= MAX_PER_CLUB;
          const gone = !p.open;
          const state = mine ? 'mine' : gone ? 'started' : max ? 'max' : 'open';
          return (
            <div key={p.playerId} className={`e5-row ${state}`} data-player={p.playerId} data-state={state}>
              <span className="e5-pos">{p.pos}</span>
              <TeamMark abbr={p.club} size={24} leagueSlug="epl" />
              <span className="e5-who">
                <b>{p.name}{p.flag ? <em className={`e5-flag ${p.flag.kind}`} title={p.flag.reason ?? undefined}>{p.flag.label}</em> : null}</b>
                <small>
                  {p.club} · {p.opp} · <StandaloneTime iso={p.kickoffAt} weekday zone={false} />
                  {max ? ` · ${fromClub} from ${p.club} already` : ''}
                  {p.flag?.reason ? ` · ${p.flag.reason}` : ''}
                </small>
              </span>
              <span className="e5-ppg"><b>{p.ppg ?? '–'}</b><small>PTS/G</small></span>
              {!signedIn ? <a className="e5-add" href={signinHref}>ADD</a>
                : <button type="button" className={`e5-add${state === 'open' ? '' : ' off'}`} disabled={state !== 'open'} onClick={() => add(p)}>
                  {mine ? 'IN' : gone ? 'LOCKED' : max ? 'MAX' : 'ADD'}
                </button>}
            </div>
          );
        })}
        {rows.length > shown ? (
          <button type="button" className="e5-showmore" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>
        ) : null}
        {!rows.length ? <p className="e5-empty">No players match.</p> : null}
      </div>

      {!compact ? (
        <div className="e5-lockbar">
          <div className="e5-pips">{pips.map((p, i) => <i key={i} className={`e5-pip ${p}`} />)}</div>
          <span>
            {!signedIn ? <a href={signinHref}>Sign in to play</a> : <>{filled} of 5</>}
            {view.nextLock ? <> · next lock <StandaloneTime iso={view.nextLock.kickoffAt} weekday /></> : ' · all locked'}
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LIVE and FINAL share the five rows
// ---------------------------------------------------------------------------
function FiveRows({ view, final = false }) {
  return (
    <div className="e5-five">
      <div className="e5-sh"><span>YOUR FIVE</span></div>
      {view.slots.map((s) => (
        <div key={s.slot} className={`e5-fr ${s.state}`} data-slot={s.slot} data-state={s.state}>
          <div className="e5-fr-top">
            <span className="e5-fr-l">{SLOT_LABEL[s.slot]}</span>
            {s.playerId ? <TeamMark abbr={s.club} size={24} leagueSlug="epl" /> : <span className="e5-fr-dot" />}
            <b className="e5-fr-n">{s.playerId ? s.name : 'No pick'}</b>
            {s.playerId ? (
              <span className={`e5-st ${s.chip?.kind ?? 'ko'}`}>
                {final ? (s.state === 'off' ? 'OFF' : 'FT') : s.chip ? s.chip.text : s.kickoffAt ? <StandaloneTime iso={s.kickoffAt} weekday zone={false} /> : ''}
              </span>
            ) : null}
            <span className="e5-fr-p">{s.points ?? 0}</span>
          </div>
          {s.parts?.length ? (
            <div className="e5-parts">{s.parts.map((p, i) => <span key={i} className={`e5-part${p.pts < 0 ? ' neg' : ''}`}>{p.text}</span>)}</div>
          ) : s.state === 'pending' && s.kickoffAt ? (
            <div className="e5-parts"><span className="e5-part">Kicks off <StandaloneTime iso={s.kickoffAt} weekday /></span></div>
          ) : s.state === 'live' ? (
            <div className="e5-parts"><span className="e5-part">On the bench so far</span></div>
          ) : s.state === 'final' && s.playerId ? (
            <div className="e5-parts"><span className="e5-part">Did not play</span></div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function LiveScreen({ view }) {
  const pct = Math.round((view.played / 5) * 100);
  return (
    <>
      <div className="e5-hero">
        <div className="e5-hero-t">
          <span className="e5-kick">{view.contest.label.toUpperCase()} · LIVE</span>
          <span>{view.played} of 5 played</span>
        </div>
        <div className="e5-hero-big">
          <b>{view.total}</b>
          <span>pts{view.rank?.rank ? ` · #${view.rank.rank.toLocaleString('en-US')} of ${view.rank.of.toLocaleString('en-US')} so far` : ''}</span>
        </div>
        <div className="e5-bar"><i style={{ width: `${pct}%` }} /></div>
      </div>
      <FiveRows view={view} />
      <p className="e5-note">Stats can be corrected after the final whistle. Scores re-check the next day.</p>
    </>
  );
}

function FinalScreen({ view, boardHref }) {
  const me = view.rank;
  const top = view.top ?? [];
  const inTop = top.some((r) => r.mine);
  return (
    <>
      <div className="e5-hero">
        <div className="e5-hero-t">
          <span className="e5-kick">{view.contest.label.toUpperCase()} · FINAL</span>
          <span>{view.contest.settledAt ? <>settled <StandaloneTime iso={view.contest.settledAt} weekday zone={false} /></> : ''}</span>
        </div>
        <div className="e5-tri">
          <div><small>YOUR FIVE</small><b>{view.score ?? view.total}</b></div>
          <div><small>RANK</small><b>{me?.rank ? `#${me.rank.toLocaleString('en-US')}` : '–'}</b></div>
          <div><small>PERFECT FIVE</small><b className="e5-perf">{view.contest.perfect ?? '–'}</b></div>
        </div>
      </div>
      <FiveRows view={view} final />
      {view.contest.perfectPlayers?.length ? (
        <details className="e5-more" data-group="perfect">
          <summary>The perfect five · {view.contest.perfect}</summary>
          <ol className="e5-perfect">
            {view.contest.perfectPlayers.map((p) => (
              <li key={p.playerId}><span className="e5-fr-l">{p.slot}</span><b>{p.name}</b><small>{p.club}</small><span className="e5-fr-p">{p.points}</span></li>
            ))}
          </ol>
        </details>
      ) : null}
      <div className="e5-sh e5-bh"><span>NATIONAL BOARD</span><Link href={boardHref}>ALL ›</Link></div>
      <div className="e5-board">
        {top.map((r) => (
          <div key={`${r.rank}-${r.handle}`} className={`e5-br${r.mine ? ' you' : ''}`}><span className="e5-br-r">{r.rank}</span><b>{r.mine ? 'You' : `@${r.handle}`}</b><span className="e5-br-t">{r.total}</span></div>
        ))}
        {me?.rank && !inTop ? (
          <div className="e5-br you"><span className="e5-br-r">{me.rank.toLocaleString('en-US')}</span><b>You</b><span className="e5-br-t">{me.total}</span></div>
        ) : null}
      </div>
    </>
  );
}
