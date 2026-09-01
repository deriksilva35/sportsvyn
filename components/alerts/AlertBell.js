'use client';

// components/alerts/AlertBell.js — the bell pill and the sheet behind it.
//
// SAME MECHANISM AS THE LEAGUE SWITCHER, deliberately: dialog semantics, a
// focus trap, Escape closes and returns focus to the trigger, a real button as
// the backdrop. One sheet grammar in this app, not two.
//
// NOTHING BUT THE TRIGGER RENDERS UNTIL IT OPENS, so the scoreboard does not
// ship sixteen copies of a settings panel to draw sixteen pills.
//
// THE PERMISSION PROMPT ONLY EVER FOLLOWS A TAP. Never on load, never on open -
// only when the reader turns something on. A browser prompt the reader did not
// ask for is the fastest way to get permission denied permanently, and denied
// is not recoverable from the page.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULTS } from '@/lib/push/prefs';
import { dayHeading, kickoffParts } from '@/lib/gridiron/kickoff';
import { useViewerTz } from '@/components/gridiron/useViewerTz';
import { tzOrUtc } from '@/lib/gridiron/viewerTz';
import { subscribeThisBrowser } from './subscribe';
import './alerts.css';

// The five rows, in the order the sheet draws them. Data, not markup, so the
// order and the copy live in one place.
const ROWS = [
  { key: 'kickoff', title: 'Kickoff', trigger: 'When the game goes live' },
  { key: 'score', title: 'Score changes',
    trigger: 'Every score, both teams · "SEA 14, NE 10 · Q2 8:41"',
    latency: 'usually within a minute' },
  { key: 'quarter', title: 'Quarter and final', trigger: 'End of each quarter and the final' },
  { key: 'close', title: 'Close game', trigger: 'Q4, one score apart, under five minutes' },
  { key: 'final_only', title: 'Final only', trigger: 'Just the result' },
];

function Toggle({ on, onChange, label, disabled }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label}
      className={`al-tg${on ? ' on' : ''}`} disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <span className="al-knob" />
    </button>
  );
}

export default function AlertBell({ match, signedIn = false, compact = true }) {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const triggerRef = useRef(null);
  const sheetRef = useRef(null);
  const tz = useViewerTz();

  // THE PILL'S STATE IS THE PREFS, so it has to know them before it is tapped.
  // Fetched once when the sheet first opens rather than on mount: sixteen cards
  // on a scoreboard would otherwise be sixteen requests for a panel nobody
  // opened.
  useEffect(() => {
    if (!open || prefs || !signedIn) return;
    let dead = false;
    fetch(`/api/push/prefs?matchId=${match.id}&teamId=${match.homeTeamId ?? ''}`)
      .then((r) => r.json())
      .then((j) => { if (!dead) setPrefs(j.prefs ?? DEFAULTS); })
      .catch(() => { if (!dead) setPrefs(DEFAULTS); });
    return () => { dead = true; };
  }, [open, prefs, signedIn, match.id, match.homeTeamId]);

  const close = useCallback(() => { setOpen(false); triggerRef.current?.focus(); }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key !== 'Tab' || !sheetRef.current) return;
      const f = sheetRef.current.querySelectorAll('button:not([disabled]), a[href]');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const save = async (next) => {
    setPrefs(next);
    setBusy(true); setError(null);
    try {
      // TURNING SOMETHING ON IS THE TAP THE PROMPT FOLLOWS. Only here, and only
      // when the reader has actually asked for an alert.
      if (next.master && Object.keys(DEFAULTS).some((k) => k !== 'master' && k !== 'final_only' && next[k])) {
        const r = await subscribeThisBrowser();
        if (!r.ok) setError(r.error);
      }
      await fetch('/api/push/prefs', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'match', scopeId: match.id, ...next }),
      });
    } catch (e) { setError(String(e?.message ?? e)); }
    finally { setBusy(false); }
  };

  const p = prefs ?? DEFAULTS;
  // A CHIP MAY ONLY CLAIM KNOWLEDGE: the pill lights only when we have read the
  // prefs and something is actually on.
  const anyOn = Boolean(prefs && p.master
    && (p.kickoff || p.score || p.quarter || p.close || p.final_only));
  const kick = kickoffParts(match.kickoffAt, tzOrUtc(tz));
  const day = dayHeading(match.kickoffAt, tzOrUtc(tz));

  return (
    <>
      <button
        ref={triggerRef} type="button"
        className={`al-pill${anyOn ? ' on' : ''}${compact ? '' : ' al-pill--lg'}`}
        aria-haspopup="dialog" aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
      >
        {anyOn ? <span aria-hidden="true">● </span> : null}Alerts
      </button>

      {open ? (
        <>
          <button type="button" className="al-back" aria-label="Close alerts" onClick={close} />
          <div className="al-sheet" role="dialog" aria-modal="true" aria-label="Game alerts" ref={sheetRef}>
            <div className="al-hd">
              <h2 className="al-h1">{match.awayAbbr} at {match.homeAbbr}</h2>
              <button type="button" className="al-x" aria-label="Close" onClick={close}>×</button>
            </div>
            <div className="al-eye">
              Alerts{day ? ` · ${day}` : ''}{kick ? ` · ${kick.time}` : ''}
            </div>

            {!signedIn ? (
              <div className="al-signin">
                <p className="al-note">Push to this phone. This game only.</p>
                <a className="al-cta" href={`/signin?callbackUrl=${encodeURIComponent(`/${match.leagueSlug}/game/${match.slug}`)}`}>
                  Sign in to get alerts
                </a>
              </div>
            ) : (
              <>
                <p className="al-note">
                  Push to this phone. This game only. Your team defaults live on the team page.
                </p>

                <div className="al-row al-row--master">
                  <div className="al-txt">
                    <span className="al-title">Alerts for this game</span>
                    <span className="al-trig">Master · off silences everything below</span>
                  </div>
                  <Toggle on={p.master} label="Alerts for this game" disabled={busy}
                    onChange={(v) => save({ ...p, master: v })} />
                </div>

                <div className={`al-rows${p.master ? '' : ' al-dim'}`}>
                  {ROWS.map((r) => (
                    <div className="al-row" key={r.key}>
                      <div className="al-txt">
                        <span className="al-title">{r.title}</span>
                        <span className="al-trig">{r.trigger}</span>
                        {r.latency ? <span className="al-lat">{r.latency}</span> : null}
                      </div>
                      <Toggle on={Boolean(p[r.key])} label={r.title} disabled={busy || !p.master}
                        onChange={(v) => save({ ...p, [r.key]: v })} />
                    </div>
                  ))}
                </div>

                {error ? <p className="al-err">{error}</p> : null}

                <div className="al-foot">
                  <a className="al-teamlink" href={`/${match.leagueSlug}/team/${match.homeSlug ?? ''}`}>
                    Team defaults: {match.homeAbbr} →
                  </a>
                  <span className="al-scope">Applies to this game</span>
                </div>
              </>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
