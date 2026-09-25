'use client';

// components/run/RunRoster.js - the nine, frames 1 and 2 of
// docs/design/mocks/the-run-v0_1.html.
//
// ONE COMPONENT, TWO FRAMES. The lock is the CLUB'S: a slot seals when its
// player's club starts the round, a started club leaves the grid, and the
// header counts down to the next club still ahead. The card turns to its live
// frame only once every club in the round has started.
//
// SAVE ON CHANGE. The footer button is a COUNT ("2 to go"), not an action: a
// roster that seals on a clock has no submit moment.

import { useState, useTransition } from 'react';
import { saveRunPickAction, clearRunPickAction } from '@/app/actions/run';
import { ptTime } from '@/lib/gridiron/kickoff';
import TeamMark from '@/components/team/TeamMark';

export default function RunRoster({ view, signedIn = false, signinHref = '/signin', leagueLine = null }) {
  const [slots, setSlots] = useState(() => Object.fromEntries(view.slots.map((s) => [s.slot, s])));
  const [openClub, setOpenClub] = useState(() => (view.clubs.find((c) => !c.bye && !c.started)
    ?? view.clubs.find((c) => !c.bye))?.teamId ?? null);
  const [err, setErr] = useState(null);
  const [, start] = useTransition();

  const live = view.phase !== 'open';
  const club = view.clubs.find((c) => String(c.teamId) === String(openClub)) ?? null;
  const players = view.pool?.byClub?.[String(openClub)] ?? [];
  const onRoster = new Set(Object.values(slots).map((s) => s.playerId).filter(Boolean).map(String));
  const counts = countByClub(slots);

  // WHICH SLOT A TAP FILLS: the first open slot of that player's kind.
  const targetSlot = (kind) => view.slots.map((s) => s.slot)
    .find((s) => (kind === 'arm' ? s.startsWith('arm') : s.startsWith('bat')) && !slots[s]?.playerId);

  const choose = (p) => {
    if (!signedIn || live) return;
    const slot = targetSlot(p.kind);
    if (!slot) { setErr(p.kind === 'arm' ? 'Both arm slots are filled.' : 'All seven bat slots are filled.'); return; }
    const before = slots[slot];
    setSlots((m) => ({ ...m, [slot]: { ...m[slot], playerId: p.playerId, name: p.short, teamId: p.teamId, team: p.team } }));
    setErr(null);
    start(async () => {
      // A THROW IS A REFUSAL TOO. `await action()` rejects on a network drop or
      // a redeploy mid-flight, and a rollback reached only on `ok: false` left
      // the optimistic paint standing - the card then believed a pick the server
      // never took, and the next tap refused a slot that was actually free. It
      // cost October a "All four bat slots are filled" over a card with three.
      let r;
      try { r = await saveRunPickAction(view.contest.id, slot, p); }
      catch { r = { ok: false, reason: 'unreachable' }; }
      if (!r?.ok) { setSlots((m) => ({ ...m, [slot]: before })); setErr(reasonText(r)); }
    });
  };

  const clear = (slot) => {
    if (!signedIn || live || view.slots.find((s) => s.slot === slot)?.locked) return;
    const before = slots[slot];
    setSlots((m) => ({ ...m, [slot]: { slot } }));
    start(async () => {
      let r;
      try { r = await clearRunPickAction(view.contest.id, slot); }
      catch { r = { ok: false, reason: 'unreachable' }; }
      if (!r?.ok) { setSlots((m) => ({ ...m, [slot]: before })); setErr(reasonText(r)); }
    });
  };

  const filled = view.slots.filter((s) => slots[s.slot]?.playerId).length;
  const toGo = view.slots.length - filled;

  return (
    <div className="rn" data-phase={view.phase}>
      <Header view={view} filled={filled} leagueLine={leagueLine} />

      {!live ? (
        <div className="rn-steps">
          <div className="rn-strip">
            <span className={`rn-stp${openClub ? ' done' : ' on'}`}><i>{openClub ? '✓' : '1'}</i><b>Club</b></span>
            <span className="rn-arw" />
            <span className={`rn-stp${openClub ? ' on' : ''}`}><i>2</i><b>Player</b></span>
            <span className="rn-arw" />
            <span className="rn-stp"><i>3</i><b>Slot</b></span>
          </div>
          <p className="rn-note">
            Your nine score every game their club plays this round - a sweep is three
            games, a full series five. <b>Anyone you use is gone for the rest of October.</b>
            {view.contest.round === 'wild_card' ? ' The 1 and 2 seeds sit this round out.' : ''}
          </p>
        </div>
      ) : null}

      {!live ? (
        <>
          <div className="rn-sh"><h3>Clubs</h3><span>3 max per club</span></div>
          <div className="rn-grid">
            {view.clubs.map((c) => (
              <button
                key={c.teamId} type="button"
                className={`rn-tc${String(c.teamId) === String(openClub) ? ' on' : ''}${c.bye ? ' bye' : ''}${c.started ? ' started' : ''}`}
                onClick={() => !c.bye && setOpenClub(c.teamId)} disabled={c.bye}
                data-club={c.abbr} data-bye={c.bye ? '1' : '0'} data-started={c.started ? '1' : '0'}>
                {counts.get(String(c.teamId)) ? <span className="rn-cnt">{counts.get(String(c.teamId))}</span> : null}
                <span className="rn-mk"><TeamMark primary={c.colors?.primary} secondary={c.colors?.secondary}
                  abbr={c.abbr} size={21} title={c.name ?? c.abbr} leagueSlug="mlb" /></span>
                <b>{c.abbr}</b>
                <small>{c.bye ? c.seed ?? '' : c.started ? 'started' : `${c.seed ?? ''}${c.opponent ? ` · vs ${c.opponent}` : ''}`.trim()}</small>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {err ? <p className="rn-err" role="alert">{err}</p> : null}

      <div className="rn-duo">
        <div className="rn-field">
          <div className="rn-form">
            {view.slots.map((base) => {
              const s = slots[base.slot] ?? base;
              const arm = base.slot.startsWith('arm');
              const out = base.state === 'out';
              // SEALED PER SLOT: his club has started. The whole card is only
              // sealed once every club has (live).
              const sealed = live || (base.locked && s.playerId === base.playerId);
              return (
                <div key={base.slot}
                  className={`rn-slot ${arm ? 'p' : 'b'}${s.playerId ? ' filled' : ''}${out ? ' out' : ''}${sealed ? ' locked' : ''}${!s.playerId && !live ? ' elig' : ''}`}
                  data-slot={base.slot} data-state={out ? 'out' : s.playerId ? 'filled' : 'open'}>
                  {/* THE SAME BADGE IN THE SAME CORNER AS OCTOBER'S, and on this
                      3x3 it is always the dot: every tile here is about 52px.
                      A slot wears it the moment its club starts - per club,
                      not all nine at once. */}
                  {sealed && s.playerId ? (
                    <span className="rn-lk" aria-label="locked" role="img">
                      <i aria-hidden="true" /><b>LOCKED</b>
                    </span>
                  ) : s.playerId && signedIn && !sealed ? (
                    <button type="button" className="rn-x" aria-label={`Clear ${base.slot}`} onClick={() => clear(base.slot)}>×</button>
                  ) : null}
                  <span className="rn-pos">{arm ? 'ARM' : 'BAT'}</span>
                  {s.playerId ? <>
                    <span className="rn-nm">{s.name}</span>
                    {/* THE POSTED CARD SAYS HE IS NOT IN IT, AND HIS SLOT CAN
                        STILL MOVE. October's sentence, October's colour, the
                        same server-side check - see notStarting(). It cannot
                        render once his club has started, because there is
                        nothing left to swap. */}
                    {base.notStarting && !sealed
                      ? <span className="rn-tm swap">not starting · swap</span>
                      : <span className="rn-tm">{s.team}{out ? ' · out' : base.games ? ` · ${base.games}g` : ''}</span>}
                    {/* A SWEPT CLUB'S SLOT KEEPS ITS POINTS. Nothing is zeroed. */}
                    {base.points != null ? <span className={`rn-pts${out ? ' out' : ''}`}>{base.points}</span> : null}
                  </> : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="rn-panel">
          <div className="rn-pan-h">
            {live ? <b>Your nine</b> : <>
              <span className="rn-mk"><TeamMark primary={club?.colors?.primary} secondary={club?.colors?.secondary}
                abbr={club?.abbr} size={21} title={club?.name ?? club?.abbr} leagueSlug="mlb" /></span>
              <b>{club?.name ?? club?.abbr ?? 'Clubs'}</b>
            </>}
            <small>{live
              ? <>{view.aliveCount} alive · {view.outCount} done</>
              : <>{counts.get(String(openClub)) ?? 0} of 3 used<br />{club?.opponent ? `vs ${club.opponent}${club.bestOf ? ` · best of ${club.bestOf}` : ''}` : ''}<br />{club?.lineupPosted ? 'lineup posted' : 'lineup not posted yet'}<br />
                <span className="rn-pan-n">arms {players.filter((p) => p.kind === 'arm').length} · bats {players.filter((p) => p.kind === 'bat').length}</span></>}</small>
          </div>
          <div className="rn-pan-b">
            {live
              ? view.slots.filter((s) => s.playerId).slice(0, 6).map((s) => (
                <div key={s.slot} className={`rn-prow${s.state === 'out' ? ' gone' : ''}`} data-slot={s.slot}>
                  <span className={`rn-pb ${s.slot.startsWith('arm') ? 'p' : 'b'}`}>{s.slot.startsWith('arm') ? 'P' : 'B'}</span>
                  <span className="rn-who"><b>{s.name}</b><small>{[s.line, s.state === 'out' ? `${s.team} out` : null].filter(Boolean).join(' · ')}</small></span>
                  <span className={`rn-val${s.state === 'live' ? ' live' : ''}`}>
                    <b>{s.points ?? '–'}</b><small>{s.state === 'out' ? 'OUT' : s.state === 'live' ? 'LIVE' : '—'}</small>
                  </span>
                </div>
              ))
              // EVERY ROW, AND THE PANEL SCROLLS (October's fix). A cut at ten
              // served twelve Yankee arms and not one bat.
              : players.length ? players.map((p) => {
                const mine = onRoster.has(String(p.playerId));
                const usedIn = view.used?.[String(p.playerId)] ?? null;
                const gone = mine || usedIn != null || club?.started === true;
                return (
                  <button key={p.playerId} type="button"
                    className={`rn-prow${gone ? ' gone' : ''}`}
                    onClick={() => !gone && choose(p)} disabled={gone || !signedIn}
                    data-player={p.playerId} data-kind={p.kind}{...(p.probable ? { 'data-probable': '1' } : {})}>
                    <span className={`rn-pb ${p.kind === 'arm' ? 'p' : 'b'}`}>{p.kind === 'arm' ? 'P' : 'B'}</span>
                    <span className="rn-who">
                      <b>{p.short}</b>
                      {/* THE BATTING ORDER WHEN THE CARD IS UP - "bats 4th"
                          beats "RF" - then the G1 flag, then the position. */}
                      <small>{mine ? 'on your nine' : usedIn ? `used in the ${roundWord(usedIn)}` : club?.started ? 'game started' : slotWord(p)}</small>
                    </span>
                    <span className="rn-val"><b>{p.ppg ?? '–'}</b><small>PPG</small></span>
                  </button>
                );
              }) : <p className="rn-empty">The pool for this club is still building.</p>}
          </div>
        </div>
      </div>

      {live ? (
        <div className="rn-rules">
          Round {view.contest.week} scores every game these clubs play.{' '}
          <b>Your used nine are gone for the rest of October.</b>
        </div>
      ) : (
        <div className="rn-rules">
          <b>Bats</b> {view.contest.rules.bats}<br />
          <b>Arms</b> {view.contest.rules.arms}<br />
          Each player locks when his club&apos;s first game starts. A slot still
          empty when the round ends is a DNF.
        </div>
      )}

      <div className="rn-ft">
        <div className="rn-pace">
          {view.isDnf ? <>This round is a <b>DNF</b><br />no slot was filled</>
            : live ? <>Round {view.contest.week} so far<br /><b>{view.total}</b> · {view.aliveCount} still playing</>
              : leagueLine ?? <>Set your nine<br /><b>{filled}</b> of {view.slots.length}</>}
        </div>
        {!signedIn ? <a className="rn-lock" href={signinHref}>Sign in to play</a>
          : live ? <span className="rn-rcpt">✓ LOCKED · {filled} OF {view.slots.length}</span>
            : toGo === 0 ? <span className="rn-rcpt">✓ SET · {filled} OF {view.slots.length}</span>
            : <button className="rn-lock" type="button" disabled>{toGo} to go</button>}
      </div>
    </div>
  );
}

function Header({ view, filled, leagueLine }) {
  return (
    <div className="rn-hd">
      <div className="rn-hd-top">
        <span className="rn-eb">The Run</span>
        {/* A LEAGUE NAME IF THERE IS ONE, else what this round IS - and for a
            preview that is its own season label, not the round's name. */}
        <span className="rn-ed">{leagueLine ?? view.contest.seasonLabel ?? view.contest.label}</span>
      </div>
      <div className="rn-crow">
        {/* THE CLOCK COUNTS TO THE NEXT CLUB LOCK - October's header, per club:
            the soonest first pitch of a club nobody is locked out of yet. */}
        {view.phase === 'open' && view.nextLock ? <Clock ms={view.nextLock.msAway} /> : null}
        <div className="rn-lbl">
          {view.phase === 'open' && view.nextLock
            ? <>next lock<b>{view.nextLock.label ?? ''}{view.nextLock.label ? ' · ' : ''}{ptTime(view.nextLock.kickoffAt) ?? ''}</b></>
            : <>round<b>{view.contest.label}</b></>}
        </div>
        <div className="rn-tot">
          <b>{view.phase === 'open' ? filled : view.total}</b>
          <span>{view.phase === 'open' ? `of ${view.slots.length}` : 'Round'}</span>
        </div>
      </div>
      {/* FOUR PIPS, LABELLED - jade done, volt current. */}
      <div className="rn-rounds">
        {view.pips.map((r) => (
          <span key={r.round} className={`rn-rd ${r.state}`} data-round={r.round}>
            <i /><b>{r.label}</b>
          </span>
        ))}
      </div>
      <div className="rn-sub">
        <span>2 arms · 7 bats · 3 max per club</span>
        <span>{view.clubs.filter((c) => !c.bye).length} clubs in this round</span>
      </div>
    </div>
  );
}

/** Static reading, taken on the server - see runView's nextLock.msAway. */
function Clock({ ms }) {
  const mins = Math.max(0, Math.floor((Number(ms) || 0) / 60000));
  const hh = String(Math.min(99, Math.floor(mins / 60))).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return (
    <span className="rn-clk" aria-label={`${hh} hours ${mm} minutes to the next lock`}>
      <i className="rn-dg">{hh[0]}</i><i className="rn-dg">{hh[1]}</i>
      <span className="rn-cl">:</span>
      <i className="rn-dg">{mm[0]}</i><i className="rn-dg">{mm[1]}</i>
    </span>
  );
}

/**
 * WHAT A PANEL ROW SAYS ABOUT ITSELF. Today's probable, then the batting order
 * when the club's card is up, then the G1 flag, then the position - October's
 * slotWord with The Run's extra cases.
 */
function slotWord(p) {
  if (p?.probable) return "today's starter";
  if (p?.order != null) return `bats ${ordinal(p.order)}`;
  if (p?.g1) return 'G1 starter';
  return p?.position ?? '';
}

const ordinal = (n) => {
  const i = Number(n);
  if (!Number.isFinite(i)) return String(n);
  const t = i % 100;
  if (t >= 11 && t <= 13) return `${i}th`;
  return `${i}${({ 1: 'st', 2: 'nd', 3: 'rd' })[i % 10] ?? 'th'}`;
};

const countByClub = (slots) => {
  const m = new Map();
  for (const s of Object.values(slots)) {
    if (!s?.playerId || s.teamId == null) continue;
    m.set(String(s.teamId), (m.get(String(s.teamId)) ?? 0) + 1);
  }
  return m;
};
const roundWord = (r) => ({ wild_card: 'Wild Card', division: 'Division round',
  championship: 'LCS', world_series: 'World Series' }[r] ?? r);

const REASON = {
  signed_out: 'Sign in to play.',
  used: 'You already used that player this October.',
  already_on_roster: 'That player is already on your nine.',
  max_per_club: 'Three from one club is the limit.',
  club_has_bye: 'That club has a bye - they are not in this round.',
  club_not_alive: 'That club is not in this round.',
  game_started: 'That club has started this round - it is locked.',
  wrong_kind: 'That slot takes a different kind of player.',
  settled: 'This round is already graded.',
  not_open: 'This round has not opened yet.',
  unreachable: 'That pick did not reach the server. Tap it again.',
};
function reasonText(r) {
  if (r?.reason === 'used' && r.usedIn) return `You used that player in the ${roundWord(r.usedIn)}.`;
  return REASON[r?.reason] ?? 'That pick did not save.';
}
