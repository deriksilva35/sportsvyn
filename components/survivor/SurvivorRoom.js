'use client';

/**
 * components/survivor/SurvivorRoom.js - the Survivor pick room, in the Weekly
 * room's one-scroll grammar (components/weekly/WeeklyRoom.js, thu-2 / thu-6):
 *
 *   one sticky header line   <- Survivor · Week N · one team, no reuse
 *   one status line          <- still alive, lives, the next lock
 *   How it works, folded     <- open only on a first visit
 *   the PATH, sticky         <- every week from the start: team + W/L
 *   the list header, sticky  <- "Pick your winner · favorites first"
 *   the list = the page      <- every team playing this week, by its line
 *   the lock bar, sticky     <- your pick and when it locks, in one sentence
 *
 * IT DECIDES NOTHING. The model (lib/survivor/view.js roomModel) is computed on
 * the server and handed in; a tap calls the server action, whose checks are the
 * rules (lib/survivor/pick.js), and the page re-renders from the database. The
 * only client state is the tap in flight and the sentence a refusal earns.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import StandaloneTime from '@/components/StandaloneTime';
import { pickSurvivorTeam } from '@/app/actions/survivor';
import { REFUSALS } from '@/lib/survivor/rules';
import { SURVIVOR_SEEN_COOKIE, centerScrollLeft } from '@/lib/survivor/view';

export default function SurvivorRoom({ poolId, week, model, alive = null, entries = null, lives = 1, livesLeft = null, firstVisit = false, signedIn = true, signinHref = '/signin' }) {
  const router = useRouter();
  const rootRef = useRef(null);
  const [busy, setBusy] = useState(null);
  const [err, setErr] = useState(null);
  const { list, path, bar, out } = model;
  const stripRef = useRef(null);
  const [shown, setShown] = useState(null);
  const shownCell = path.find((c) => c.week === shown) ?? null;

  // THE CURRENT WEEK, CENTRED ON LOAD - by the strip's own scrollLeft, so the
  // page itself never moves.
  useEffect(() => {
    const strip = stripRef.current;
    const cell = strip?.querySelector('[data-current="yes"]');
    if (!strip || !cell) return;
    strip.scrollLeft = centerScrollLeft({
      cellLeft: cell.offsetLeft - strip.offsetLeft, cellWidth: cell.offsetWidth,
      stripWidth: strip.clientWidth, scrollWidth: strip.scrollWidth,
    });
  }, [week]);

  // THE STICKY LAYERS START UNDER THE SITE'S OWN STICKY BAR - measured, the
  // Weekly room's way (WeeklyRoom.js), never typed.
  useEffect(() => {
    const el = rootRef.current;
    const head = document.querySelector('.gi-head');
    if (!el || !head || getComputedStyle(head).position !== 'sticky') return undefined;
    const set = () => el.style.setProperty('--wkv-stick', `${Math.round(head.getBoundingClientRect().height)}px`);
    set();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    ro?.observe(head);
    return () => ro?.disconnect();
  }, []);

  useEffect(() => {
    try { document.cookie = `${SURVIVOR_SEEN_COOKIE}=1; path=/; max-age=31536000; samesite=lax`; } catch { /* blocked */ }
  }, []);

  async function pick(teamId) {
    // SIGNED OUT, THE BOARD IS READ-ONLY and a tap is the way in (the October
    // card's sign-in law): the slate and the lines are public facts.
    if (!signedIn) { router.push(signinHref); return; }
    setBusy(teamId); setErr(null);
    const r = await pickSurvivorTeam(poolId, teamId).catch(() => ({ ok: false, reason: 'failed' }));
    setBusy(null);
    if (!r?.ok) setErr(REFUSALS[r?.reason] ?? REFUSALS.failed);
    router.refresh();
  }

  const nextLock = bar.kind === 'picked' ? bar.kickoff_at : null;

  return (
    <section className="wkv svv" ref={rootRef}>
      <header className="wkv-top">
        <Link className="wkv-back" href="/games" aria-label="Back to Games">&larr;</Link>
        <h1 className="wkv-title"><b>Survivor &middot; Week {week}</b> &middot; one team, no reuse</h1>
      </header>

      <div className="wkv-prog">
        <div className="wkv-sub">
          <span className="wkv-when">
            {alive != null && entries ? <><b className="n">{alive}</b> of {entries} alive</> : 'Lose once and you are out'}
            {livesLeft != null && lives > 1 ? <> &middot; {livesLeft} of {lives} lives</> : null}
          </span>
          <span className="wkv-save">
            {nextLock ? <>locks <StandaloneTime iso={nextLock} weekday /></> : 'each team locks at its kickoff'}
          </span>
        </div>
        {err && <p className="wkv-err" role="alert">{err}</p>}
      </div>

      <details className="wkv-how" open={firstVisit || undefined}>
        <summary>How it works</summary>
        <div className="wkv-how-b">
          <div className="row"><span>Each week</span><span className="r">pick one team to win</span></div>
          <div className="row"><span>Your pick</span><span className="r">locks at its kickoff</span></div>
          <div className="row"><span>Each team</span><span className="r">once a season</span></div>
          <div className="row"><span>A loss or a tie</span><span className="r">{lives > 1 ? 'costs a life' : "and you're out"}</span></div>
          <div className="row"><span>No pick</span><span className="r">we pick the biggest favorite left</span></div>
          <p className="wkv-note">
            Change your pick as often as you like until its game kicks off. Without one,
            at the week&rsquo;s first kickoff you get <b>the biggest favorite you have not used</b> among
            the games still to come - and you can still change it until that game starts.
            A game that is cancelled or not played that week counts as a survival, and the team is used.
          </p>
        </div>
      </details>

      {/* THE PATH, sticky where the Weekly's lineup sticks. */}
      <div className="wkv-dock svv-dock">
        {!signedIn ? (
          <p className="svv-pitch"><b>One team a week.</b> Never the same one twice. Lose and you&rsquo;re out.</p>
        ) : (
        <>
          {/* THE STRIP: all eighteen weeks, swiped sideways (scroll-snap x) -
              the only horizontal scroller on the page, and nothing in the room
              scrolls vertically but the page. The current week is centred on
              load. A past week is a button: its game shows in the line below,
              in place - no navigation, no sheet. */}
          <ol className="svv-path" aria-label="Your path, weeks 1 to 18" ref={stripRef}>
            {path.map((c) => {
              const tappable = c.detail != null;
              const inner = (
                <>
                  <span className="svv-wk">WK {c.week}</span>
                  <span className="svv-tm">{c.label ?? ''}{c.mark ? <> {c.mark}</> : null}</span>
                </>
              );
              return (
                <li key={c.week} className={`svv-cell ${c.state}${shown === c.week ? ' open' : ''}`}
                  data-state={c.state} data-week={c.week} data-current={c.current ? 'yes' : undefined}>
                  {tappable ? (
                    <button type="button" className="svv-cell-b" aria-pressed={shown === c.week}
                      onClick={() => setShown(shown === c.week ? null : c.week)}>{inner}</button>
                  ) : <span className="svv-cell-b">{inner}</span>}
                </li>
              );
            })}
          </ol>
          <p className="svv-detail" aria-live="polite">
            {shownCell?.detail ?? 'Tap a past week for its result'}
          </p>
        </>
        )}
      </div>

      <div className="wkv-panel">
        <div className="wkv-pan-h">
          <b>{out ? 'You are out' : 'Pick your winner · favorites first'}</b>
          <span className="wkv-srt">line</span>
        </div>
        <div className="wkv-list">
          {list.map((r) => (
            <button key={r.team_id} type="button"
              className={`wkv-prow svv-row${r.state === 'mine' ? ' sel' : ''}${r.disabled && r.state !== 'mine' ? ' gone' : ''}`}
              data-state={r.state}
              disabled={r.disabled || busy != null}
              onClick={() => pick(r.team_id)}>
              <span className="svv-ab">{r.abbr}</span>
              <span className="wkv-who">
                <b>{r.name ?? r.abbr}</b>
                <small>
                  {r.home ? 'vs' : 'at'} {r.opp_abbr} &middot;{' '}
                  {r.state === 'tbd' ? 'time TBD' : <StandaloneTime iso={r.kickoff_at} weekday zone={false} />}
                </small>
              </span>
              <span className="wkv-val">
                {r.state === 'mine' ? <span className="svv-tag on">{busy === r.team_id ? '…' : 'YOUR PICK'}</span>
                  : r.state === 'used' ? <span className="svv-tag">USED WK {r.usedWeek}</span>
                    : r.state === 'locked' ? <span className="svv-tag">LOCKED</span>
                      : r.state === 'tbd' ? <span className="svv-tag">TBD</span>
                        : <b className="n">{busy === r.team_id ? '…' : (r.spreadLabel ?? '')}</b>}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="wkv-bar svv-bar" data-bar={bar.kind}>
        <span className="svv-line">
          {!signedIn ? <Link className="svv-signin" href={signinHref}>Sign in to pick</Link>
            : bar.kind === 'out' ? <><b>You&rsquo;re out</b> &middot; week {bar.week}</>
            : bar.kind === 'closed' ? <><b>Entries closed</b>{bar.week != null ? <> at week {bar.week} kickoff</> : null}</>
              : bar.kind === 'missed' ? <><b>No pick this week</b> &middot; a life is gone</>
                : bar.kind === 'locked' ? <><b>{bar.abbr}</b> &middot; locked in</>
                  : bar.kind === 'picked' ? <><b>{bar.abbr}</b>{bar.auto ? ' (auto)' : ''} &middot; change it until <StandaloneTime iso={bar.kickoff_at} weekday zone={false} /></>
                    : <><b>No pick yet</b> &middot; tap a team</>}
        </span>
      </div>
    </section>
  );
}
