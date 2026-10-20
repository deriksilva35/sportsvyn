'use client';

// components/coins/DrumClient.js - THE DRUM (mock screens 2 and 3).
//
// The steppers plan a drop; nothing is sent until the confirm sheet's "Drop
// them". The minus button only takes back coins PLANNED in this visit - a coin
// already in a drum stays there (Rules s4), so the floor of every stepper is
// what is already in. The server re-checks everything (POST /api/coins/drop).
// A reader who cannot enter (under 18, no date of birth on file, staff) sees
// the drums and the counts, no steppers, and "18+ to win".

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { tileLabel, drumTitle, earningLine } from '@/lib/coins/copy';

const perCoin = (coins, count) => (coins ? Math.max(1, Math.round(coins / Math.max(1, count))) : null);

export default function DrumClient({ view, countdownText, signinHref = '/signin' }) {
  const me = view.me ?? null;
  const [mine, setMine] = useState(me?.mine ?? {});
  const [inHand, setInHand] = useState(me?.inHand ?? 0);
  const [plan, setPlan] = useState({});
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [added, setAdded] = useState({});
  const planned = useMemo(() => Object.values(plan).reduce((s, n) => s + n, 0), [plan]);
  const left = inHand - planned;
  const canStep = Boolean(me?.eligible) && inHand > 0;
  const low = view.drums.find((d) => d.lowest);

  const drop = async () => {
    setBusy(true); setError(null);
    const drops = Object.entries(plan).filter(([, q]) => q > 0).map(([prize_key, qty]) => ({ prize_key, qty }));
    const res = await fetch('/api/coins/drop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ drops }) })
      .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) })).catch(() => null);
    setBusy(false);
    if (!res || res.status !== 200) { setError(res?.body?.error === 'not enough coins in hand' ? 'You do not have that many coins in hand any more.' : 'That did not drop. Try again.'); return; }
    setAdded((a) => { const n = { ...a }; for (const d of drops) n[d.prize_key] = (n[d.prize_key] ?? 0) + d.qty; return n; });
    setMine(res.body.mine ?? {}); setInHand(res.body.inHand ?? 0); setPlan({}); setSheet(false);
  };

  const wk = view.week;
  const summary = view.drums.filter((d) => (mine[d.prize_key] ?? 0) + (plan[d.prize_key] ?? 0) > 0)
    .map((d) => `${tileLabel(d) === 'CAP' ? 'Cap' : `${tileLabel(d)} drum`} ${(mine[d.prize_key] ?? 0) + (plan[d.prize_key] ?? 0)}`).join(' · ');

  return (
    <>
      <div className="cn-hero">
        <div className="cn-hero-text">
          <div className="cn-eyebrow cn-mono">WEEK {wk.ordinal} · DRAWN TUE 9:00 AM PT</div>
          <p>
            Closes in {countdownText}.
            {me && !me.eligible ? ' You are earning coins; you can enter once you are 18.'
              : low ? ` Coins still in your hand at close drop into the ${tileLabel(low)} drum for you.` : ''}
          </p>
        </div>
        {me && (
          <div className="cn-hand">
            <b className="cn-mono" aria-label={`${left} coins in hand`}>{left}</b>
            <small className="cn-mono">IN HAND</small>
          </div>
        )}
      </div>

      <div className="cn-sub">
        <span className="cn-mono">{me ? (me.eligible ? `DROP YOUR ${inHand} COIN${inHand === 1 ? '' : 'S'}` : '18+ TO WIN') : 'THIS WEEK\'S DRUMS'}</span>
        <span>{me?.eligible ? 'All in one drum, or spread them' : `${view.drums.reduce((s, d) => s + d.count, 0)} prizes`}</span>
      </div>

      <div className="cn-cards">
        {view.drums.map((d) => {
          const have = (mine[d.prize_key] ?? 0);
          const p = plan[d.prize_key] ?? 0;
          const coins = d.coins + (added[d.prize_key] ?? 0) + p;
          const odds = perCoin(coins, d.count);
          return (
            <section key={d.prize_key} className="cn-card" aria-label={drumTitle(d)}>
              <div className="cn-card-head">
                <div className={`cn-tile cn-mono${d.kind === 'merch' ? ' merch' : ''}`}>{tileLabel(d)}</div>
                <div>
                  <div className="cn-card-title cn-mono">{drumTitle(d)}</div>
                  <div className="cn-card-meta">{coins ? `${coins} coin${coins === 1 ? '' : 's'} in · about 1 in ${odds} per coin` : 'No coins in yet'}</div>
                </div>
              </div>
              {me && (
                <div className="cn-card-row">
                  <div className="cn-chips">
                    {Array.from({ length: Math.min(have + p, 6) }, (_, i) => <span key={i} className="cn-coin cn-mono" aria-hidden="true">SV</span>)}
                    <span className="cn-yours">{have + p} of yours here</span>
                  </div>
                  {canStep && (
                    <div className="cn-step">
                      <button type="button" aria-label={`Take one planned coin out of the ${tileLabel(d)} drum`} disabled={p === 0}
                        onClick={() => setPlan((x) => ({ ...x, [d.prize_key]: Math.max(0, (x[d.prize_key] ?? 0) - 1) }))}>-</button>
                      <output className="cn-mono" aria-live="polite">{have + p}</output>
                      <button type="button" aria-label={`Drop one more coin in the ${tileLabel(d)} drum`} disabled={left <= 0}
                        onClick={() => setPlan((x) => ({ ...x, [d.prize_key]: (x[d.prize_key] ?? 0) + 1 }))}>+</button>
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      {me && (
        <>
          <div className="cn-sub"><span className="cn-mono">HOW YOU EARNED THEM</span><span>{me.minted} coin{me.minted === 1 ? '' : 's'} this week</span></div>
          <div className="cn-meter">
            <div className="cn-meter-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={me.meter.into} aria-label="Points toward your next coin">
              <span style={{ width: `${me.meter.into}%` }} />
            </div>
            <small>{me.meter.toNext} points to your next coin · 100 points = 1 coin, up to {view.cap} a week</small>
          </div>
          {me.earned.length > 0 && (
            <div className="cn-list" style={{ marginTop: 10 }}>
              {me.earned.map((r, i) => { const l = earningLine(r); return (
                <div key={i}><div><b>{l.title}</b><small>{l.sub}</small></div><span className="cn-mono">+{l.points}</span></div>
              ); })}
            </div>
          )}
        </>
      )}

      {!me && (
        <div className="cn-note" style={{ marginTop: 14 }}>
          <Link href={signinHref}>Sign in</Link> to see your coins. Every game you play fills your coin meter.
        </div>
      )}

      <div className="cn-fine">
        Coins are earned by playing, never sold, and have no cash value. Each coin is one entry in the drum it sits in.
        Winners are drawn at random Tuesday 9:00 am PT and told by push and email. US residents 18+ to win. <Link href="/coins/rules">Official rules</Link>
      </div>

      {canStep && (
        <div className="cn-bar">
          <div className="cn-bar-inner">
            <div className="cn-bar-sum"><span>{summary || 'Nothing in a drum yet'}</span><b>{left} left in hand</b></div>
            <button type="button" className="cn-go cn-mono" disabled={planned === 0} onClick={() => { setError(null); setSheet(true); }}>
              {planned ? `DROP ${planned} COIN${planned === 1 ? '' : 'S'}` : 'PICK A DRUM'}
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <div className="cn-scrim" role="dialog" aria-modal="true" aria-label="Confirm your drop" onClick={(e) => { if (e.target === e.currentTarget && !busy) setSheet(false); }}>
          <div className="cn-sheet">
            <span className="cn-grab" aria-hidden="true" />
            <div>
              <div className="cn-kick cn-mono">WEEK {wk.ordinal} · DROPPING {planned} COIN{planned === 1 ? '' : 'S'}</div>
              <h2 className="cn-mono">YOUR DROP</h2>
              <p>Once they&apos;re in, they stay in. Drawn Tuesday 9:00 am PT.</p>
            </div>
            <div className="cn-list">
              {view.drums.filter((d) => (plan[d.prize_key] ?? 0) > 0).map((d) => {
                const q = plan[d.prize_key];
                return (
                  <div key={d.prize_key}>
                    <div><b className="cn-mono" style={{ fontSize: 11 }}>{drumTitle(d)}</b><small>1 in {perCoin(d.coins + (added[d.prize_key] ?? 0) + q, d.count)} per coin</small></div>
                    <span className="cn-mono">{q}</span>
                  </div>
                );
              })}
            </div>
            <div className="cn-note" style={{ fontSize: 12, color: 'var(--arcade-muted)' }}>
              Coins you earn after this land back in your hand. Drop them before Tuesday 9:00 am PT, or they go in the {low ? tileLabel(low) : 'lowest'} drum for you.
            </div>
            {error && <div className="cn-err" role="alert">{error}</div>}
            <button type="button" className="cn-go cn-mono" disabled={busy} onClick={drop}>{busy ? 'DROPPING' : 'DROP THEM'}</button>
            <button type="button" className="cn-link" disabled={busy} onClick={() => setSheet(false)}>Change it</button>
          </div>
        </div>
      )}
    </>
  );
}
