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
import { enableAlerts } from './enable';
import { SILENCED_BY_FINAL_ONLY, silencedByFinalOnly, applyRowToggle } from '@/lib/push/sheetRules';
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
  // ERRORS BELONG TO THE ROW THAT FAILED. One red line under the sheet cannot
  // say which toggle did not take, so the reader turns the wrong one back off.
  const [rowError, setRowError] = useState(null);
  const [saved, setSaved] = useState(false);
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

  // ROWS SAVE ON CHANGE. No Save button to forget, so the sheet's only exit is
  // Done and there is no state that exists on screen and not on the server.
  const save = async (next, rowKey) => {
    setPrefs(next);
    setBusy(true); setRowError(null); setSaved(false);
    try {
      // TURNING SOMETHING ON IS THE TAP THE PROMPT FOLLOWS. Only here, and only
      // when the reader has actually asked for an alert. enableAlerts picks the
      // transport from the environment, so the shell never sees a browser
      // message and the browser never reaches for a plugin.
      const asked = next.master
        && Object.keys(DEFAULTS).some((k) => k !== 'master' && next[k]);
      if (asked) {
        const r = await enableAlerts();
        if (!r.ok) { setRowError({ key: rowKey, message: r.error }); setBusy(false); return; }
      }
      const res = await fetch('/api/push/prefs', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'match', scopeId: match.id, ...next }),
      });
      if (!res.ok) {
        setRowError({ key: rowKey, message: 'That did not save. Check your connection and try again.' });
        return;
      }
      setSaved(true);
    } catch {
      setRowError({ key: rowKey, message: 'That did not save. Check your connection and try again.' });
    } finally { setBusy(false); }
  };

  // FINAL ONLY IS A SILENCER, AND TOUCHING WHAT IT SILENCES TURNS IT OFF.
  // Otherwise a reader taps Score changes, watches the toggle move, and gets
  // nothing - the row says on and the game says silent. Master and Final only
  // can never both read as "everything on".
  const setRow = (key, value) => save(applyRowToggle(p, key, value), key);

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
              <span>Alerts{day ? ` · ${day}` : ''}{kick ? ` · ${kick.time}` : ''}</span>
              {/* SAVED FADES. It is an acknowledgement, not a status: a badge
                  that stayed would become part of the furniture and stop
                  meaning "that one took". Keyed on the write so each save
                  restarts the animation. */}
              {saved ? <span className="al-saved" key={String(saved)}>Saved</span> : null}
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
                    onChange={(v) => save({ ...p, master: v }, 'master')} />
                </div>

                <div className={`al-rows${p.master ? '' : ' al-dim'}`}>
                  {ROWS.map((r) => {
                    const silenced = silencedByFinalOnly(p, r.key);
                    return (
                      <div className={`al-row${silenced ? ' al-silenced' : ''}`} key={r.key}>
                        <div className="al-txt">
                          <span className="al-title">{r.title}</span>
                          <span className="al-trig">
                            {silenced ? 'Silenced by Final only' : r.trigger}
                          </span>
                          {r.latency && !silenced ? <span className="al-lat">{r.latency}</span> : null}
                          {rowError?.key === r.key
                            ? <span className="al-rowerr">{rowError.message}</span> : null}
                        </div>
                        {/* A SILENCED ROW STAYS TAPPABLE. Dimming says "this is
                            doing nothing"; disabling would say "you cannot
                            change this", and turning it on is precisely how a
                            reader gets out of Final only. */}
                        <Toggle on={Boolean(p[r.key])} label={r.title} disabled={busy || !p.master}
                          onChange={(v) => setRow(r.key, v)} />
                      </div>
                    );
                  })}
                </div>

                {rowError && rowError.key === 'master'
                  ? <p className="al-rowerr al-rowerr--master">{rowError.message}</p> : null}

                <div className="al-foot">
                  <a className="al-teamlink" href={`/${match.leagueSlug}/team/${match.homeSlug ?? ''}`}>
                    Team defaults: {match.homeAbbr} →
                  </a>
                  <span className="al-scope">Applies to this game</span>
                </div>
                {/* DONE, NOT SAVE. Every row is already written; this only
                    closes the sheet, and calling it Save would imply the taps
                    before it had not counted. */}
                <button type="button" className="al-done" onClick={close}>Done</button>
              </>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
