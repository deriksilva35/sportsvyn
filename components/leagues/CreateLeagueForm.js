'use client';

// components/leagues/CreateLeagueForm.js - THE CREATE SHEET (canvas "Leagues V1"
// board Create): what you'll play, how long, how it's scored, the format, the
// details - and a summary bar with CREATE pinned to the bottom.
//
// THE RULES ARE lib/leagues/settings.js's, read here so an option that would be
// refused is greyed before it is tapped (a bundle cannot pick total points; a
// daily span cannot hold a week game; the guillotine and drop-worst need a
// season). The server runs the same validator - this only spares the round trip.

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createLeagueAction } from '@/app/actions/leagues';
import {
  validateLeagueSettings, summaryLine, spanLine, spanHolds, chooseStart, startLabel, GAME_PERIOD,
  MEMBERS_MIN, MEMBERS_MAX, MEMBERS_DEFAULT, SPANS, SPAN_LABEL, rankPointsCopy,
} from '@/lib/leagues/settings';
import { validateLeagueName } from '@/lib/leagues/name';

function Step({ n, title, children }) {
  return (
    <section className="lv-step" aria-labelledby={`lv-step-${n}`}>
      <h2 className="lv-step-head" id={`lv-step-${n}`}>
        <span className="lv-step-n">{n}</span><span className="lv-step-t">{title}</span>
      </h2>
      {children}
    </section>
  );
}

function Radio({ on, title, body, disabled, onPick }) {
  return (
    <button type="button" role="radio" aria-checked={on} className="lv-radio" disabled={disabled} onClick={onPick}>
      <span className="lv-radio-dot" aria-hidden="true" />
      <span className="lv-radio-body">
        <span className="lv-radio-t">{title}</span>
        <span className="lv-note">{body}</span>
      </span>
    </button>
  );
}

export default function CreateLeagueForm({ choices, anchors, survivor = false }) {
  const router = useRouter();
  const [games, setGames] = useState([]);
  const [span, setSpan] = useState('season');
  const [scoring, setScoring] = useState('rank');
  const [format, setFormat] = useState('table');
  const [dropWorst, setDropWorst] = useState(false);
  const [maxMembers, setMaxMembers] = useState(MEMBERS_DEFAULT);
  const [lateJoins, setLateJoins] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const ordered = choices.map((c) => c.key).filter((k) => games.includes(k));
  const bundle = ordered.length > 1;
  const weekly = ordered.some((k) => GAME_PERIOD[k] === 'week') || !ordered.length;
  const unit = weekly ? 'week' : 'day';
  const effScoring = bundle ? 'rank' : scoring;
  const effSpan = spanHolds(span, ordered) ? span : 'season';
  const effFormat = effSpan === 'season' ? format : 'table';
  const effDrop = dropWorst && effSpan === 'season' && effFormat === 'table';
  const settings = { games: ordered, span: effSpan, scoring: effScoring, format: effFormat, dropWorst: effDrop, maxMembers, lateJoins };
  const check = validateLeagueSettings(settings, { survivor });
  const nameOk = validateLeagueName(name);
  const when = startLabel(chooseStart(ordered, anchors));

  const toggle = (k) => setGames((g) => (g.includes(k) ? g.filter((x) => x !== k) : [...g, k]));

  async function submit() {
    setErr(null);
    if (!ordered.length) { setErr('Pick at least one game'); return; }
    if (!nameOk.ok) { setErr(`Name: ${nameOk.reason}`); return; }
    if (!check.ok) { setErr(check.reason); return; }
    setBusy(true);
    const fd = new FormData();
    fd.set('name', name);
    fd.set('games', ordered.join(','));
    fd.set('span', effSpan); fd.set('scoring', effScoring); fd.set('format', effFormat);
    fd.set('dropWorst', effDrop ? 'on' : ''); fd.set('maxMembers', String(maxMembers)); fd.set('lateJoins', lateJoins ? 'on' : '');
    const res = await createLeagueAction(fd).catch(() => ({ ok: false, reason: 'Could not create the league' }));
    if (!res.ok) { setBusy(false); setErr(res.reason); return; }
    // Land on the league with the invite sheet open - a league of one is a
    // league whose first job is the group chat.
    router.replace(`/leagues/${res.leagueId}?invite=1`);
  }

  return (
    <div className="lv lv-create">
      <div className="lv-topbar">
        <Link href="/leagues">Cancel</Link>
        <span className="lv-topbar-title">New league</span>
        <span style={{ minWidth: 52 }} />
      </div>

      <Step n={1} title="What you'll play">
        <div className="lv-games">
          {choices.map((g) => {
            const on = games.includes(g.key);
            return (
              <button key={g.key} type="button" className="lv-game" aria-pressed={on} onClick={() => toggle(g.key)} data-game={g.key}>
                <span className="lv-game-name">{g.label}{on ? ' ✓' : ''}</span>
                <span className="lv-game-sub">{g.sub}</span>
              </button>
            );
          })}
        </div>
        <p className="lv-note">Pick one game, or more for a bundle. A bundle ranks everyone in each game, then adds up the places.</p>
      </Step>

      <Step n={2} title="How long">
        <div className="lv-seg" role="group" aria-label="How long">
          {SPANS.map((s) => (
            <button key={s} type="button" aria-pressed={effSpan === s} disabled={!spanHolds(s, ordered)} onClick={() => setSpan(s)}>
              {SPAN_LABEL[s]}
            </button>
          ))}
        </div>
        <p className="lv-note">{spanLine(effSpan, ordered.length ? ordered : ['pickem'], anchors)}</p>
      </Step>

      <Step n={3} title="How it's scored">
        <div role="radiogroup" aria-label="How it's scored" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Radio on={effScoring === 'rank'} title="Rank points" onPick={() => setScoring('rank')}
            body={`${rankPointsCopy(unit)} Required for bundles.`} />
          <Radio on={effScoring === 'total'} title="Total points" disabled={bundle} onPick={() => setScoring('total')}
            body="Add up each game's own score. One game only." />
        </div>
        <label className={`lv-toggle${effSpan === 'season' && effFormat === 'table' ? '' : ' lv-toggle--off'}`}>
          <span>Drop each player&rsquo;s worst {unit}</span>
          <input type="checkbox" checked={effDrop} disabled={!(effSpan === 'season' && effFormat === 'table')}
            onChange={(e) => setDropWorst(e.target.checked)} />
        </label>
      </Step>

      <Step n={4} title="Format">
        <div role="radiogroup" aria-label="Format" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Radio on={effFormat === 'table'} title="Table" onPick={() => setFormat('table')}
            body="Everyone against everyone. Best total wins." />
          <Radio on={effFormat === 'guillotine'} title="Guillotine" disabled={effSpan !== 'season'} onPick={() => setFormat('guillotine')}
            body={`Lowest score each ${unit} gets chopped. Last one left wins.`} />
        </div>
      </Step>

      <Step n={5} title="Details">
        <label className="lv-field">Name
          <input className="lv-input" value={name} maxLength={40} placeholder="Sunday Crew" autoComplete="off"
            onChange={(e) => setName(e.target.value)} name="name" />
        </label>
        <div className="lv-stepper">
          <span>Max members</span>
          <span className="lv-stepper-ctl">
            <button type="button" aria-label="Fewer" disabled={maxMembers <= MEMBERS_MIN} onClick={() => setMaxMembers((n) => Math.max(MEMBERS_MIN, n - 1))}>&minus;</button>
            <span className="lv-stepper-n" data-max-members={maxMembers}>{maxMembers}</span>
            <button type="button" aria-label="More" disabled={maxMembers >= MEMBERS_MAX} onClick={() => setMaxMembers((n) => Math.min(MEMBERS_MAX, n + 1))}>+</button>
          </span>
        </div>
        <label className="lv-toggle">
          <span>Let people join after it starts{when ? ` (${when})` : ''}</span>
          <input type="checkbox" checked={lateJoins} onChange={(e) => setLateJoins(e.target.checked)} />
        </label>
        <p className="lv-note">Private: only people with the invite link or code can join.</p>
      </Step>

      <div className="lv-bar">
        <div className="lv-bar-in">
          {err && <p className="lv-err" role="alert">{err}</p>}
          <p className="lv-bar-sum" data-summary>{ordered.length ? summaryLine(settings) : 'Pick a game to start'}</p>
          <button type="button" className="lv-btn lv-btn--primary lv-btn--block" disabled={busy || !ordered.length} onClick={submit}>
            {busy ? 'Creating…' : 'Create league'}
          </button>
        </div>
      </div>
    </div>
  );
}
