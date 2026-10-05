'use client';

// components/six/SixCard.js - TONIGHT'S SIX: the pick room, the live card and
// the final, as one component. Which one renders is a function of the view's
// phase, and the slots carry their own state - a slot in a final game shows
// points while its neighbour in a later game still takes a tap.
//
// THE WEEKLY PICKER'S PATTERN (components/weekly/WeeklyRoom.js, the October
// card's dock): the game chips and the six slots stick together under the site
// bar, the player rows below are the PAGE's one scroll, and the footer is the
// lock bar. Save on change, optimistic, the server's answer wins.
//
// EVERY GREYED ROW SAYS WHY, and the why is lib/six/rules.js refuseReason() -
// the same function the save door calls - run here against the server's
// reading of now, tips and statuses (view.now, view.board), never Date.now().

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { saveSixPickAction, clearSixPickAction } from '@/app/actions/six';
import { sendPicksChanged } from '@/lib/shell/bridge';
import StandaloneTime from '@/components/StandaloneTime';
import { useStickyOffset } from '@/components/games/useStickyOffset';
import VoidAllLabel from '@/components/games/VoidAllLabel';
import {
  SLOTS, SLOT_POS, refuseReason, targetSlot, eligible, countFromTeam,
} from '@/lib/six/rules';

const OUT_REASON = {
  already_on_card: 'on your card',
  max_from_team: 'team cap',
  game_started: 'tipped',
  not_played: 'off tonight',
  player_out: 'out',
  wrong_position: 'no slot',
  slot_locked: 'locked',
};

export default function SixCard({ view, signedIn = false, signinHref = '/signin' }) {
  const [lineup, setLineup] = useState(() => Object.fromEntries(view.slots.filter((s) => s.playerId)
    .map((s) => [s.slot, { playerId: s.playerId, matchId: s.matchId, teamId: s.teamId, position: s.position, name: s.name, team: s.team, opp: s.opp }])));
  const [game, setGame] = useState('all');
  const [prefer, setPrefer] = useState(null);
  const [err, setErr] = useState(null);
  const [, start] = useTransition();
  const rootRef = useRef(null);
  useStickyOffset(rootRef);

  // THE RULES' INPUTS, AS THE SERVER READ THEM.
  const rules = useMemo(() => ({
    board: view.board.map((g) => ({ match_id: g.matchId, home_team_id: g.homeTeamId, away_team_id: g.awayTeamId, kickoff_at: g.tipAt })),
    now: view.now,
    statusBy: new Map(view.board.map((g) => [String(g.matchId), g.status])),
    kickoffBy: new Map(view.board.map((g) => [String(g.matchId), g.tipAt])),
    outIds: new Set(Object.values(view.pool?.byGame ?? {}).flat().filter((r) => r.out).map((r) => String(r.playerId))),
  }), [view]);
  const locked = useMemo(() => new Set(view.slots.filter((s) => s.pip === 'locked').map((s) => s.slot)), [view]);

  const rows = useMemo(() => {
    const all = Object.values(view.pool?.byGame ?? {}).flat();
    const pick = game === 'all' ? all : all.filter((r) => String(r.matchId) === String(game));
    const want = prefer ? pick.filter((r) => eligible(prefer, r.position)) : pick;
    return [...want].sort((a, b) => (a.out === b.out ? 0 : a.out ? 1 : -1) || (b.fppg ?? -Infinity) - (a.fppg ?? -Infinity));
  }, [view, game, prefer]);

  /** Why this row cannot be tapped, or null. Same function as the server's. */
  const whyNot = (p) => {
    if (Object.values(lineup).some((x) => String(x?.playerId) === String(p.playerId))) return 'already_on_card';
    const slot = targetSlot(lineup, p.position, { locked, prefer });
    if (!slot) return 'wrong_position';
    return refuseReason(lineup, slot, p, rules);
  };

  const choose = (p) => {
    if (!signedIn) return;
    const slot = targetSlot(lineup, p.position, { locked, prefer });
    if (!slot) { setErr(`No open slot takes a ${p.position || 'player'} - clear one first.`); return; }
    const r0 = refuseReason(lineup, slot, p, rules);
    if (r0) { setErr(REASON[r0] ?? 'That pick did not save.'); return; }
    const before = lineup[slot];
    setLineup((m) => ({ ...m, [slot]: { playerId: p.playerId, matchId: p.matchId, teamId: p.teamId, position: p.position, name: p.short, team: p.team, opp: p.opp } }));
    setPrefer(null); setErr(null);
    start(async () => {
      let r;
      try { r = await saveSixPickAction(view.contest.id, slot, p); } catch { r = { ok: false, reason: 'unreachable' }; }
      if (!r?.ok) { setLineup((m) => ({ ...m, [slot]: before })); setErr(REASON[r?.reason] ?? 'That pick did not save.'); } else sendPicksChanged('six');
    });
  };

  const clear = (slot) => {
    if (!signedIn) return;
    const before = lineup[slot];
    setLineup((m) => { const n = { ...m }; delete n[slot]; return n; });
    start(async () => {
      let r;
      try { r = await clearSixPickAction(view.contest.id, slot); } catch { r = { ok: false, reason: 'unreachable' }; }
      if (!r?.ok) { setLineup((m) => ({ ...m, [slot]: before })); setErr(REASON[r?.reason] ?? 'That did not save.'); } else sendPicksChanged('six');
    });
  };

  const filled = SLOTS.filter((s) => lineup[s]?.playerId).length;
  const final = view.phase === 'final';
  const showChips = view.phase !== 'open';
  const slotView = (s) => view.slots.find((x) => x.slot === s);

  // A NEW FILTER STARTS THE LIST AT ITS TOP, under the stuck dock.
  const dockRef = useRef(null); const listRef = useRef(null); const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const d = dockRef.current; const l = listRef.current;
    if (!d || !l || typeof window.scrollBy !== 'function') return;
    const gap = l.getBoundingClientRect().top - d.getBoundingClientRect().bottom;
    if (gap < 0) window.scrollBy(0, gap);
  }, [game, prefer]);

  return (
    <div className="sx" data-phase={view.phase} ref={rootRef}>
      <Header view={view} lineup={lineup} locked={locked} />

      {!final ? (
        <details className="sx-how">
          <summary>How it works</summary>
          <p>
            Six players from tonight&apos;s NBA games: two guards, two forwards, a
            center and a utility. At most <b>{view.contest.cap} from any one team</b>.
            Each slot locks at its player&apos;s tip; swap freely before it. A slot
            on a postponed or cancelled game never locks - swap him out. A
            player who sits after his tip scores 0, and so does an empty slot -
            the rest of your card still counts. <b>Tomorrow is a new six.</b>
          </p>
        </details>
      ) : null}

      <div className="sx-dock" ref={dockRef}>
        <div className="sx-games" role="tablist" aria-label="Tonight's games">
          {!final ? (
            <button type="button" className={`sx-gc all${game === 'all' ? ' on' : ''}`} onClick={() => setGame('all')}>
              <b>All</b><small>{view.board.length} game{view.board.length === 1 ? '' : 's'}</small>
            </button>
          ) : null}
          {view.board.map((g) => (
            <button key={g.matchId} type="button" data-game={g.slug}
              className={`sx-gc${String(game) === String(g.matchId) ? ' on' : ''}${g.status === 'live' ? ' live' : ''}${g.status === 'final' ? ' fin' : ''}${g.void ? ' off' : ''}`}
              onClick={() => !final && setGame(g.matchId)}>
              <b>{g.away.abbr} @ {g.home.abbr}</b>
              <small>{g.void ? 'OFF' : g.status === 'final' ? `F ${g.score?.away}-${g.score?.home}`
                : g.status === 'live' ? `${g.chip} · ${g.score?.away}-${g.score?.home}` : <StandaloneTime iso={g.tipAt} zone={false} />}</small>
            </button>
          ))}
        </div>

        <div className="sx-form">
          {SLOTS.map((s) => {
            const p = lineup[s];
            const v = slotView(s);
            const isLocked = locked.has(s);
            const on = prefer === s;
            return (
              <div key={s} data-slot={s}
                data-state={isLocked ? 'locked' : p ? 'filled' : 'open'}
                className={`sx-slot${p ? ' filled' : ''}${isLocked ? ' locked' : ''}${on ? ' on' : ''}${!p && !isLocked && !final ? ' elig' : ''}`}
                onClick={() => !p && !isLocked && !final && setPrefer(on ? null : s)}>
                <span className="sx-pos">{SLOT_POS[s]}</span>
                {isLocked ? <span className="sx-lk" aria-label="locked" role="img"><i aria-hidden="true" /></span>
                  : p && signedIn && !final ? <button type="button" className="sx-x" aria-label={`Clear ${SLOT_POS[s]}`} onClick={(e) => { e.stopPropagation(); clear(s); }}>×</button> : null}
                {p ? <>
                  <span className="sx-nm">{p.name}</span>
                  <span className="sx-tm">{v?.dnp ? 'DNP' : v?.state === 'void' && !final ? 'GAME OFF · SWAP' : `${p.team ?? ''}${p.opp ? ` v ${p.opp}` : ''}`}</span>
                  {showChips && v?.points != null ? <span className={`sx-pts${v.state === 'final' ? ' fin' : ''}`}>{v.points}</span> : null}
                </> : <span className="sx-em">{final || view.nightState === 'closed' ? 'empty · 0' : on ? 'pick below' : 'open'}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {err ? <p className="sx-err" role="alert">{err}</p> : null}

      {showChips ? <YourSix view={view} /> : null}

      {final ? <Final view={view} /> : (
        <div className="sx-pool" ref={listRef}>
          <div className="sx-pool-h">
            <b>{prefer ? `${SLOT_POS[prefer]} eligible` : game === 'all' ? 'Every player tonight' : labelOf(view, game)}</b>
            <small>FP/G</small>
          </div>
          {rows.length ? rows.map((p) => {
            const why = signedIn ? whyNot(p) : null;
            const fromTeam = countFromTeam(lineup, p.teamId);
            return (
              <button key={`${p.matchId}:${p.playerId}`} type="button" data-player={p.playerId}
                className={`sx-row${why ? ' dim' : ''}${p.out ? ' out' : ''}`} disabled={Boolean(why) || !signedIn}
                onClick={() => choose(p)}>
                <span className={`sx-pb ${posClass(p.position)}`}>{p.position || '–'}</span>
                <span className="sx-who">
                  <b>{p.short}{p.injury && !p.out ? <em className="sx-q">{p.injury[0]}</em> : null}</b>
                  <small>
                    {p.team} {p.home ? 'v' : '@'} {p.opp} · <StandaloneTime iso={tipOfMatch(view, p.matchId)} zone={false} />
                    {why ? <i className={`sx-why ${why}`}> · {why === 'max_from_team' ? `${fromTeam} from ${p.team} · cap` : OUT_REASON[why] ?? 'locked'}</i> : null}
                  </small>
                </span>
                {p.out ? <span className="sx-out">OUT</span> : null}
                <span className="sx-val"><b>{p.fppg ?? '–'}</b>{p.fppgSeason != null && p.fppgSeason !== seasonOf(view) ? <small>last szn</small> : null}</span>
              </button>
            );
          }) : <p className="sx-empty">{view.pool ? 'Nobody fits that filter.' : 'The pool is still building.'}</p>}
        </div>
      )}

      <div className="sx-rules"><b>Scoring</b> {view.contest.rules}</div>

      <div className="sx-ft">
        <div className="sx-pace">
          {final ? <>Final<br /><b>{view.total}</b>{view.rank ? ` · ${ordinal(view.rank)} of ${view.of}` : ''}</>
            : <>Your six so far<br /><b>{view.total}</b>{view.progress.locked ? ` · ${view.progress.locked} in play` : ''}</>}
        </div>
        {!signedIn ? <a className="sx-lock" href={signinHref}>Sign in to play</a>
          : final ? null
            : filled === SLOTS.length ? <span className="sx-rcpt">✓ 6 OF 6</span>
              : view.nightState === 'closed' ? <span className="sx-rcpt">{filled} OF 6 · empty slots score 0</span>
              : <button className="sx-lock" type="button" disabled>{SLOTS.length - filled} to go</button>}
      </div>
    </div>
  );
}

function Header({ view, lineup, locked }) {
  const filled = SLOTS.filter((s) => lineup[s]?.playerId).length;
  const pips = SLOTS.map((s) => (locked.has(s) ? 'locked' : lineup[s]?.playerId ? 'picked' : 'open'));
  const next = view.nextLock;
  return (
    <div className="sx-hd">
      <div className="sx-hd-top">
        <span className="sx-eb">Tonight&apos;s Six</span>
        <span className="sx-ed">{view.contest.dayLabel ? `${view.contest.dayLabel} · ` : ''}{view.contest.games} game{view.contest.games === 1 ? '' : 's'} · cap {view.contest.cap}/team</span>
      </div>
      <div className="sx-crow">
        {view.phase === 'final' && view.contest.voidAll ? (
          <VoidAllLabel as="div" className="sx-lbl" />
        ) : view.phase === 'final' ? (
          <div className="sx-lbl">graded<b>{view.perfect?.score != null ? `perfect six ${view.perfect.score}` : 'the night is in'}</b></div>
        ) : next ? <>
          <Clock msAway={next.msAway} />
          <div className="sx-lbl">next tip<b>{next.label} · <StandaloneTime iso={next.tipAt} /></b></div>
        </> : <div className="sx-lbl">all tipped<b>points only</b></div>}
        <div className="sx-tot">
          {view.phase === 'open' ? <><b>{filled}</b><span>of 6</span></> : <><b>{view.total ?? '–'}</b><span>{view.phase === 'final' ? 'final' : 'live'}</span></>}
        </div>
      </div>
      <div className="sx-pips">{pips.map((p, i) => <i key={i} className={`sx-pip${p === 'locked' ? ' lk' : p === 'picked' ? ' on' : ''}`} />)}</div>
      <div className="sx-sub">
        <span>{pips.filter((p) => p === 'locked').length} locked · {pips.filter((p) => p === 'picked').length} picked · {pips.filter((p) => p === 'open').length} open</span>
        {/* A RANK ONLY ONCE THERE ARE POINTS: before the first tip every card is 0. */}
        <span>{view.me && view.phase !== 'open' ? `${ordinal(view.me.rank)} of ${view.me.of}` : ''}</span>
      </div>
    </div>
  );
}

/** The live/final list: each player with a chip per stat. */
function YourSix({ view }) {
  const slots = view.slots.filter((s) => s.playerId);
  if (!slots.length) return null;
  return (
    <div className="sx-six" data-block="your-six">
      <div className="sx-sh"><h3>Your six</h3><span>{view.phase === 'final' ? 'final' : view.anyLive ? 'live' : 'as the box lands'}</span></div>
      {slots.map((s) => (
        <div key={s.slot} className={`sx-line ${s.state}`} data-line={s.slot}>
          <div className="sx-line-h">
            <span className={`sx-pb ${posClass(s.position)}`}>{s.pos}</span>
            <b>{s.name}</b>
            <small>{s.team}{s.opp ? ` v ${s.opp}` : ''} · {stateWord(s, view)}</small>
            <span className="sx-line-p">{s.points ?? '–'}</span>
          </div>
          {s.chips?.length ? (
            <div className="sx-chips">
              {s.chips.map((c) => (
                <span key={c.key} className={`sx-chip${c.points ? '' : ' z'}${c.key === 'dd' || c.key === 'td' ? ' bonus' : ''}`} data-chip={c.key}>
                  {c.key === 'dd' || c.key === 'td' ? c.label : `${c.label} ${c.count}`}<i>{c.points > 0 ? `+${c.points}` : c.points}</i>
                </span>
              ))}
            </div>
          ) : s.dnp ? <p className="sx-dnp">Did not play - scores 0, the slot still counts.</p>
            : s.state === 'void' ? <p className="sx-dnp">Game not played tonight - scores 0.{view.phase !== 'final' ? ' The slot never locks: swap him out.' : ''}</p> : null}
        </div>
      ))}
    </div>
  );
}

function Final({ view }) {
  const p = view.perfect;
  const b = view.boardRows;
  return (
    <>
      <div className="sx-res" data-block="result">
        <div><b>{view.total}</b><span>your six</span></div>
        <div><b>{view.rank ? ordinal(view.rank) : '–'}</b><span>of {view.of}</span></div>
        <div><b>{p?.score ?? '–'}</b><span>perfect six</span></div>
      </div>
      {p?.players?.length ? (
        <div className="sx-perfect" data-block="perfect">
          <div className="sx-sh"><h3>The perfect six</h3><span>best legal card tonight</span></div>
          {p.players.map((x) => (
            <div key={x.slot} className="sx-pr">
              <span className={`sx-pb ${posClass(x.position)}`}>{SLOT_POS[x.slot]}</span>
              <b>{x.name}</b><small>{x.team}</small><span>{x.points}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="sx-board" data-block="board">
        <div className="sx-sh"><h3>Tonight&apos;s board</h3><span>{b?.count ?? 0} played</span></div>
        {b?.head?.length ? [...b.head, ...(b.gap ? [null] : []), ...b.around].map((r, i) => (r == null
          ? <div key={`gap-${i}`} className="sx-br gap" aria-hidden="true"><span /><span>· · ·</span><span /></div>
          : (
            <div key={r.userId} className={`sx-br${r.isMe ? ' you' : ''}`} data-rank={r.rank}>
              <span className="rk">{r.rank}</span>
              <span>{r.isMe ? 'you' : r.handle}{r.house ? <i> · house</i> : null}</span>
              <span className="t">{r.points}</span>
            </div>
          ))) : <div className="sx-br"><span className="rk">–</span><span>Nobody played tonight.</span><span /></div>}
      </div>
    </>
  );
}

function Clock({ msAway }) {
  const mins = Math.max(0, Math.floor((Number(msAway) || 0) / 60000));
  const hh = String(Math.min(99, Math.floor(mins / 60))).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return (
    <span className="sx-clk" aria-label={`${hh} hours ${mm} minutes to the next tip`}>
      <i className="sx-dg">{hh[0]}</i><i className="sx-dg">{hh[1]}</i>
      <span className="sx-cl">:</span>
      <i className="sx-dg">{mm[0]}</i><i className="sx-dg">{mm[1]}</i>
    </span>
  );
}

function stateWord(s, view) {
  if (s.state === 'final') return s.dnp ? 'DNP' : 'final';
  if (s.state === 'void') return 'off';
  if (s.state === 'live') return view.board.find((g) => String(g.matchId) === String(s.matchId))?.chip ?? 'live';
  return 'waiting on the tip';
}

const posClass = (pos) => {
  const p = String(pos ?? '').toUpperCase();
  if (p.startsWith('C')) return 'c';
  if (p.startsWith('F')) return 'f';
  if (p.startsWith('G')) return 'g';
  return 'u';
};
const tipOfMatch = (view, id) => view.board.find((g) => String(g.matchId) === String(id))?.tipAt ?? null;
const labelOf = (view, id) => { const g = view.board.find((x) => String(x.matchId) === String(id)); return g ? `${g.away.abbr} @ ${g.home.abbr}` : ''; };
const seasonOf = (view) => view.contest.season ?? null;
const ordinal = (n) => {
  const i = Number(n); if (!Number.isFinite(i)) return String(n);
  const t = i % 100; if (t >= 11 && t <= 13) return `${i}th`;
  return `${i}${({ 1: 'st', 2: 'nd', 3: 'rd' })[i % 10] ?? 'th'}`;
};

const REASON = {
  signed_out: 'Sign in to play.',
  already_on_card: 'That player is already on your card.',
  max_from_team: 'That is the most tonight allows from one team.',
  game_started: 'That game has tipped.',
  not_played: 'That game is not being played tonight.',
  player_out: 'That player is listed out tonight.',
  wrong_position: 'That slot takes a different position.',
  slot_locked: 'That slot locked at its tip.',
  not_in_pool: 'That player is not in tonight\'s pool.',
  not_tonight: 'That player is not in tonight\'s games.',
  unreachable: 'That pick did not reach the server. Tap it again.',
  settled: 'Tonight is already graded.',
  not_open: 'Tonight\'s card has not opened yet.',
  bad_slot: 'That slot does not exist.',
  bad_player: 'That player could not be read.',
};
