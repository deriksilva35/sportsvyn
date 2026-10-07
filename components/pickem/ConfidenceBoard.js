'use client';

// components/pickem/ConfidenceBoard.js - the CONFIDENCE board (ruling tue-7).
//
// One sheet, one button. Every game is a row: a rank chip, two team pills (tap
// one to pick it) and small up / down buttons that move the row along the
// ranking. The sheet is pre-filled 1..N in kickoff order (latest kickoff = 1,
// so the earliest game starts on the biggest number) and "Save picks" writes
// the picks and the whole ranking in ONE call (saveSheetAction).
//
// A STARTED GAME IS FROZEN: dimmed, "Locked", its pills and arrows dead, and
// its number stays where it is. The arrows skip over locked rows - moving a row
// "up" swaps it with the nearest UNLOCKED row above, so a swap across a locked
// game never touches the locked game's own number. The server checks the same
// rule against its own clock (lib/pickem/confidence.js validateSheet); this
// clock only decides what looks tappable.

import { useEffect, useMemo, useState } from 'react';
import { saveSheetAction } from '@/app/actions/pickem';
import { sendPicksChanged } from '@/lib/shell/bridge';
import { useHandleGate } from '@/components/handle/HandleGate';
import TeamMark from '@/components/team/TeamMark';
import StandaloneTime from '@/components/StandaloneTime';
import { dayLabel } from '@/lib/nba/dayRules';
import { orderFor } from '@/lib/gridiron/teamOrder';
import { moveRank } from '@/lib/pickem/confidence';

export default function ConfidenceBoard({
  view, signedIn, signinHref, hasHandle = true, sportSwitch = null, season = null,
}) {
  const { guard, modal: handleModal } = useHandleGate(hasHandle);
  const { contest, games: initial } = view;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [picks, setPicks] = useState(() => Object.fromEntries(initial.filter((g) => g.my_side).map((g) => [g.match_id, g.my_side])));
  const [ranks, setRanks] = useState(() => Object.fromEntries(initial.map((g) => [g.match_id, g.my_rank])));
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState('idle');            // idle | saving | saved | error
  const [msg, setMsg] = useState(null);

  const games = useMemo(() => initial.map((g) => ({
    ...g,
    kicked: g.kicked || new Date(g.kickoff_at).getTime() <= now,
  })), [initial, now]);
  const rows = useMemo(() => [...games].sort((a, b) => ranks[b.match_id] - ranks[a.match_id]), [games, ranks]);

  const n = games.length;
  const live = games.filter((g) => !g.void);
  const upForGrabs = live.reduce((s, g) => s + (ranks[g.match_id] ?? 0), 0);
  const pickedCount = games.filter((g) => picks[g.match_id]).length;
  const banked = games.reduce((s, g) => s + (g.my_points ?? 0), 0);
  const anyOpen = games.some((g) => !g.kicked);

  function pick(g, side) {
    if (!signedIn || g.kicked) return;
    setPicks((p) => ({ ...p, [g.match_id]: side }));
    setDirty(true); setState('idle'); setMsg(null);
  }
  function move(g, dir) {
    setRanks((r) => moveRank(r, games, g.match_id, dir));
    setDirty(true); setState('idle'); setMsg(null);
  }

  async function save() {
    if (state === 'saving') return;
    setState('saving'); setMsg(null);
    const res = await saveSheetAction(contest.id, picks, ranks).catch(() => ({ ok: false, reason: 'network' }));
    if (!res.ok) {
      setState('error');
      setMsg(res.reason === 'game_locked' || res.reason === 'rank_locked'
        ? 'A game just started - its pick and number are sealed. Reload to see the board as it stands.'
        : 'That did not save. Try again.');
      setNow(Date.now());
      return;
    }
    setRanks(res.ranks);
    setDirty(false); setState('saved');
    sendPicksChanged('pickem');
  }

  return (
    <>
      {handleModal}
      <header className="pkv-hd cfd-hd">
        <div className="pkv-hd-top">
          <span className="pkv-eb">Pick&rsquo;em</span>
          <span className="pkv-ed">
            Board {contest.boardNumber ?? ''} &middot; {contest.sport.toUpperCase()}
            {contest.displayWeek != null && <> Week {contest.displayWeek}</>}
            {contest.dayEt ? <> &middot; {dayLabel(contest.dayEt)}</> : null}
          </span>
        </div>
        <h1 className="cfd-h">Pick winners, then rank them.</h1>
        <p className="cfd-sub">Your surest pick is worth <b className="n">{n}</b>. Right picks score their number.</p>
        <div className="cfd-chips">
          <span className="cfd-chip"><b className="n">{upForGrabs}</b> points up for grabs</span>
          <span className="cfd-chip"><b className="n">{pickedCount}</b> of {n} picked</span>
          {banked > 0 ? <span className="cfd-chip cfd-chip--up"><b className="n">{banked}</b> banked</span> : null}
          {season?.avg ? <span className="cfd-chip"><b className="n">{season.avg}</b> season</span> : null}
        </div>
      </header>

      {sportSwitch}

      <div className="cfd-list">
        {rows.map((g, idx) => {
          const locked = g.kicked;
          const sideOf = picks[g.match_id] ?? null;
          const top3 = ranks[g.match_id] > n - 3;
          const graded = g.my_points != null;
          return (
            <div className={`cfd-row${locked ? ' locked' : ''}${g.void ? ' void' : ''}`} key={g.match_id} data-match={g.match_id}>
              <div className={`cfd-rk n${top3 ? ' top' : ''}`} aria-label={`Rank ${ranks[g.match_id]}`}>{ranks[g.match_id]}</div>
              <div className="cfd-mid">
                <div className="cfd-pills">
                  {orderFor(contest.sport).map((side, slot) => {
                    const name = side === 'away' ? g.away : g.home;
                    const colors = side === 'away' ? g.away_colors : g.home_colors;
                    const abbr = side === 'away' ? g.away_abbr : g.home_abbr;
                    const dressed = Boolean(g.home_colors?.primary && g.away_colors?.primary);
                    const on = sideOf === side;
                    const won = on && g.graded === 'W';
                    const lost = on && g.graded === 'L';
                    const cls = `cfd-pill${won ? ' won' : lost ? ' lost' : on ? ' picked' : ''}`;
                    const body = (
                      <>
                        <TeamMark
                          primary={dressed ? colors.primary : null} secondary={dressed ? colors.secondary : null}
                          abbr={abbr ?? name} size={22} title={name} leagueSlug={contest.sport}
                          facing={slot === 1 ? 'left' : 'right'}
                        />
                        <b>{name}</b>
                      </>
                    );
                    return !signedIn && !locked
                      ? <a key={side} className={cls} href={signinHref}>{body}</a>
                      : <button key={side} type="button" className={cls} disabled={locked} aria-pressed={on} onClick={() => pick(g, side)}>{body}</button>;
                  })}
                </div>
                <div className="cfd-foot">
                  {locked
                    ? <span className="cfd-lk">{g.void ? 'Void' : 'Locked'}</span>
                    : <span><StandaloneTime iso={g.kickoff_at} tbd={g.kickoff_tbd === true} /></span>}
                  {graded ? <span className={`cfd-pts ${g.my_points > 0 ? 'j' : 't'} n`}>{g.my_points > 0 ? `+${g.my_points}` : '0'}</span> : null}
                  {g.void ? <span className="cfd-pts v">void</span> : null}
                  {locked && !graded && !g.void && sideOf == null ? <span className="cfd-pts v">no pick</span> : null}
                </div>
              </div>
              <div className="cfd-mv">
                <button type="button" aria-label="Move up" disabled={locked || !signedIn || idx === 0} onClick={() => move(g, +1)}>&uarr;</button>
                <button type="button" aria-label="Move down" disabled={locked || !signedIn || idx === rows.length - 1} onClick={() => move(g, -1)}>&darr;</button>
              </div>
            </div>
          );
        })}
      </div>

      {msg ? <p className="pk-lockedmsg">{msg}</p> : null}
      {!signedIn ? (
        <a className="pk-signin" href={signinHref}>Sign in to make your picks &rarr;</a>
      ) : null}

      <div className="pkv-ft">
        <div className="pkv-pace">
          {state === 'saved' ? <><b>Saved</b><br />change either until a game starts</>
            : <>No spread<br />Unpicked games score <b>0</b></>}
        </div>
        {signedIn && anyOpen ? (
          <button type="button" className="pkv-lock cfd-save" disabled={!dirty || state === 'saving'} onClick={() => guard(save, 'sheet')}>
            {state === 'saving' ? 'Saving…' : 'Save picks'}
          </button>
        ) : null}
      </div>
    </>
  );
}
