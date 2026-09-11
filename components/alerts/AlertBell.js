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
import { DEFAULTS, nextRow } from '@/lib/push/prefs';
import { dayHeading, kickoffParts } from '@/lib/gridiron/kickoff';
import { useViewerTz } from '@/components/gridiron/useViewerTz';
import { tzOrUtc } from '@/lib/gridiron/viewerTz';
import { enableAlerts } from './enable';
import { summaryLine } from '@/lib/push/sheetRules';
import './alerts.css';

// The five trigger rows, in the order the sheet draws them. Data, not markup,
// so the order and the copy live in one place. FINAL IS THE FIFTH TRIGGER
// (ALERTS SHEET relay, R2), not a "Final only" mode that silenced the other
// four: every row means exactly what its switch says.
const ROWS = [
  { key: 'kickoff', title: 'Kickoff', trigger: 'When the game goes live' },
  { key: 'score', title: 'Score changes',
    trigger: 'Every score, both teams · "SEA 14, NE 10 · Q2 8:41"',
    latency: 'usually within a minute' },
  { key: 'quarter', title: 'Quarter ends', trigger: 'End of each quarter' },
  { key: 'close', title: 'Close game', trigger: 'Q4, one score apart, under five minutes' },
  { key: 'final', title: 'Final', trigger: 'The result, when the game ends' },
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
    // THE ROW ON SCREEN IS THE ROW THE SERVER WILL KEEP. nextRow() is the
    // route's own rule (R1): a first master tap on a game with no saved row
    // becomes the DEFAULTS row, not the OFF flags the sheet was showing, and
    // a master-off keeps the triggers. The saved match row is the one whose
    // source is 'match' - a team row showing through is not a saved row here.
    const row = nextRow(prefs?.source === 'match' ? prefs : null, next);
    setPrefs({ ...row, source: 'match' });
    setBusy(true); setRowError(null); setSaved(false);
    try {
      // TURNING SOMETHING ON IS THE TAP THE PROMPT FOLLOWS. Only here, and only
      // when the reader has actually asked for an alert. enableAlerts picks the
      // transport from the environment, so the shell never sees a browser
      // message and the browser never reaches for a plugin.
      const asked = row.master
        && Object.keys(DEFAULTS).some((k) => k !== 'master' && row[k]);
      if (asked) {
        const r = await enableAlerts();
        if (!r.ok) { setRowError({ key: rowKey, message: r.error }); setBusy(false); return; }
      }
      const res = await fetch('/api/push/prefs', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ scope: 'match', scopeId: match.id, ...row }),
      });
      if (!res.ok) {
        setRowError({ key: rowKey, message: 'That did not save. Check your connection and try again.' });
        return;
      }
      // The server's answer wins over the optimistic row, should they differ.
      const j = await res.json().catch(() => null);
      if (j?.prefs) setPrefs(j.prefs);
      setSaved(true);
    } catch {
      setRowError({ key: rowKey, message: 'That did not save. Check your connection and try again.' });
    } finally { setBusy(false); }
  };

  const setRow = (key, value) => save({ ...p, [key]: value }, key);

  const p = prefs ?? DEFAULTS;
  // A CHIP MAY ONLY CLAIM KNOWLEDGE: the pill lights only when we have read the
  // prefs and something is actually on.
  const anyOn = Boolean(prefs && p.master
    && (p.kickoff || p.score || p.quarter || p.close || p.final));
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
                {/* THE FIRST LINE SAYS WHAT THE ROW WILL DO (R3) - "Kickoff,
                    score changes and the final", "Final only", "Off" - and it
                    is recomputed on every toggle. Only once the prefs are
                    read: before that the sheet knows nothing and must not
                    claim it does. */}
                <p className="al-summary" aria-live="polite">{prefs ? summaryLine(p) : '\u00a0'}</p>
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

                {/* MASTER OFF DIMS AND DISABLES THE FIVE, it does not hide
                    them: the reader can see what comes back when they turn
                    the game on again. */}
                <div className={`al-rows${p.master ? '' : ' al-dim'}`}>
                  {ROWS.map((r) => (
                    <div className="al-row" key={r.key}>
                      <div className="al-txt">
                        <span className="al-title">{r.title}</span>
                        <span className="al-trig">{r.trigger}</span>
                        {r.latency ? <span className="al-lat">{r.latency}</span> : null}
                        {rowError?.key === r.key
                          ? <span className="al-rowerr">{rowError.message}</span> : null}
                      </div>
                      <Toggle on={Boolean(p[r.key])} label={r.title} disabled={busy || !p.master}
                        onChange={(v) => setRow(r.key, v)} />
                    </div>
                  ))}
                </div>

                {rowError && rowError.key === 'master'
                  ? <p className="al-rowerr al-rowerr--master">{rowError.message}</p> : null}

                <div className="al-foot">
                  {/* THE ROUTE IS /team/[slug], NOT /{league}/team/[slug]
                      (defect 6). This built a league-scoped path that has
                      never existed - app/team/[slug]/page.js is the only
                      team route in the app - so it 404'd for every team in
                      every league, all 243 CFB teams included, not just Ole
                      Miss. The page itself is league-aware and serves CFB
                      fine; only the href was wrong.

                      The link is dropped entirely when there is no slug,
                      rather than pointing at /team/ - a dead link is worse
                      than no link, and that is what the 404 was. */}
                  {match.homeSlug
                    ? (
                      <a className="al-teamlink" href={`/team/${match.homeSlug}`}>
                        Team defaults: {match.homeAbbr} →
                      </a>
                    )
                    : <span className="al-scope">Team defaults unavailable</span>}
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
