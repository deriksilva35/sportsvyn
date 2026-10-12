'use client';

// components/mockNfl/MockNflDraft.js - the NFL mock draft, played in the browser (mon-3).
//
// THE NBA MOCK'S ROOM AND ENGINE (components/mockNba/MockNbaDraft.js,
// lib/mockNba/draft.js) with the NFL's kit: roster slots QB/RB/WR/TE/FLEX/K/D/ST
// (lib/mockNfl/roster.js), PPR / Half PPR / Standard / custom scoring, SVP =
// projected points per game x games left (lib/mockNfl/rank.js), and a player card
// with this season's and last season's lines.
//
// SETUP (dropdowns): teams 8-14, rounds (= roster spots), draft slot, scoring
// (three presets or custom point values), roster (two presets or a count per
// slot), pick clock. The setup is SAVED - to the account when signed in, to this browser
// when not - and the next mock opens with it; "Reset to default" undoes it.
//
// THE ROOM: the pool ranked under the chosen scoring (lib/mockNfl/rank.js), sorted
// by ADP (the market's order) or SVP (ours); a row opens the PLAYER CARD; picks are
// TAP THEN CONFIRM (or Draft on the card). With a clock, running out picks for you.
// "Auto-draft the rest" finishes the draft for you; "Restart" goes back to setup.
// The whole draft is pure state here (lib/mockNba/draft.js), so it plays signed
// out; a finished draft's picks are recorded ANONYMOUSLY.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  createMock, runBots, applyPick, legalFor, onClock, isDone, nextPick, roundOf, seatAt, totalPicks,
  autoPickOnExpiry, autoDraftRest, keyOf, mustStartNow,
} from '@/lib/mockNba/draft';
import * as KIT from '@/lib/mockNfl/roster';
import { SCORING_PRESETS, STATS, fppgOf } from '@/lib/mockNfl/scoring';
import { rankPool, projection, EARLY_GAMES } from '@/lib/mockNfl/rank';
import { gradeMock } from '@/lib/mockNba/grade';
import { encodeShare } from '@/lib/mockNfl/share';
import {
  DEFAULT_SETTINGS, TEAMS_MIN, TEAMS_MAX, CLOCKS, STORAGE_KEY,
  normalizeSettings, weightsOf, countsOf, slotsOf, serializeSettings, parseSettings,
} from '@/lib/mockNfl/settings';
import { recordMockDraftAction, saveMockSettingsAction } from '@/app/actions/mockNba';
import SetupLibrary from '@/components/mockNba/SetupLibrary';

const { SLOT_KEYS, SLOT_MAX, BENCH_MAX, SLOT_LABEL, ROSTER_PRESETS, checkFillable, eligible, posLabel } = KIT;
const SPORT = 'nfl';
const SVP_INFO = 'SVP: our projection. Fantasy points per game (this season blended with last: 50/50 until 4 games played, then 80/20) x the games his team has left.';
const POS_FILTERS = ['ALL', 'QB', 'RB', 'WR', 'TE', 'FLEX', 'K', 'DST'];
const FA = (p) => p.team ?? 'FA';
const surname = (n) => String(n ?? '').split(/\s+/).slice(1).join(' ') || n;
const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
const clockText = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const adpText = (v) => (v == null ? '-' : (Number(v) >= 100 ? String(Math.round(v)) : Number(v).toFixed(1)));
const num = (v) => (v == null ? '-' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 }));
// The stat columns the card shows, by position (totals for the season).
const CARD_STATS = {
  QB: [['passYds', 'Pass yds'], ['passTd', 'Pass TD'], ['int', 'INT'], ['rushYds', 'Rush yds'], ['rushTd', 'Rush TD']],
  RB: [['rushYds', 'Rush yds'], ['rushTd', 'Rush TD'], ['rec', 'Rec'], ['recYds', 'Rec yds'], ['recTd', 'Rec TD']],
  WR: [['rec', 'Rec'], ['recYds', 'Rec yds'], ['recTd', 'Rec TD'], ['rushYds', 'Rush yds'], ['fumblesLost', 'Fum lost']],
  TE: [['rec', 'Rec'], ['recYds', 'Rec yds'], ['recTd', 'Rec TD'], ['fumblesLost', 'Fum lost']],
  K: [['fgm', 'FG made'], ['xp', 'XP made']],
  DST: [['sacks', 'Sacks'], ['defInt', 'INT'], ['fr', 'Fum rec'], ['defTd', 'TD']],
};
// IN SEASON THE ADP IS PRESEASON (mon-5): the source's boards shrink once the real
// drafts are done (lib/mockNfl/pool.js), so the column says which board it is.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (iso) => (iso ? `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}` : null);
function ranksLine(p, adpOn, word = 'ADP') {
  const parts = [];
  if (adpOn) parts.push(`${word} ${adpText(p.adp)}`);
  parts.push(`SVP ${p.svp}`);
  return parts.join(' · ');
}
const sub = (p, adpOn, word) => `${FA(p)}${p.bye ? ` · bye ${p.bye}` : ''} · ${ranksLine(p, adpOn, word)}${p.rookie ? ' · Rookie' : ''}`;
// Out / IR / Susp on the injury report: a badge only, SVP is unchanged.
const OutBadge = ({ p }) => (p.inj ? <span className="mnb-out" data-mock-nfl-out>{p.inj}</span> : null);

// The guest's saved setup is read with useSyncExternalStore (as AppBanner does):
// localStorage exists only in the browser, and this keeps the server render and
// hydration in agreement.
const subscribeLocal = (cb) => { window.addEventListener('storage', cb); return () => window.removeEventListener('storage', cb); };
function readLocalText() {
  try { return window.localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeLocal(s) {
  try { if (s) window.localStorage.setItem(STORAGE_KEY, serializeSettings(s)); else window.localStorage.removeItem(STORAGE_KEY); } catch { /* private window */ }
}

function Select({ label, value, onChange, children, disabled, name }) {
  return (
    <label className="mnb-field">
      <span className="mnb-label">{label}</span>
      <select className="mnb-select" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} name={name}>{children}</select>
    </label>
  );
}

export default function MockNflDraft({ pool, builtAt, adpAsOf = null, adpOn = true, signedIn = false, saved = null, setups = [] }) {
  // IN SEASON (mon-5): this season's games are in the pool. The bots and
  // auto-draft then pick by SVP + need (ADP is a September board by now), the
  // list opens sorted by SVP, and ADP is named for what it is.
  const inSeason = pool.some((p) => Number(p.s?.gp) > 0);
  const adpLabel = inSeason && adpAsOf ? `Preseason ADP (${shortDate(adpAsOf)})` : 'ADP';
  const adpWord = inSeason ? 'Preseason ADP' : 'ADP';
  const localText = useSyncExternalStore(subscribeLocal, readLocalText, () => null);
  const [edited, setEdited] = useState(null);
  const settings = useMemo(
    () => edited ?? normalizeSettings(saved ?? (localText ? parseSettings(localText) : DEFAULT_SETTINGS)),
    [edited, saved, localText],
  );
  const [st, setSt] = useState(null);
  const [armed, setArmed] = useState(null);
  const [tab, setTab] = useState('players');
  const [pos, setPos] = useState('ALL');
  const [sort, setSort] = useState(adpOn && !inSeason ? 'adp' : 'svp');
  const [q, setQ] = useState('');
  const [card, setCard] = useState(null);
  const [left, setLeft] = useState(null);
  const [shared, setShared] = useState(null);
  const [savedNote, setSavedNote] = useState(null);
  const recorded = useRef(false);

  const set = (patch) => { const next = normalizeSettings({ ...settings, ...patch }); writeLocal(next); setEdited(next); };
  const slots = useMemo(() => slotsOf(settings), [settings]);
  const fill = useMemo(() => checkFillable(pool, slots, settings.teams), [pool, slots, settings.teams]);

  function resetDefaults() {
    const d = normalizeSettings(DEFAULT_SETTINGS);
    setEdited(d); writeLocal(null);
    if (signedIn) saveMockSettingsAction(null, SPORT).catch(() => {});
    setSavedNote('Back to the default setup');
  }

  function start() {
    if (!fill.ok) return;
    if (signedIn) saveMockSettingsAction(settings, SPORT).catch(() => {});
    writeLocal(settings);
    const ranked = rankPool(pool, weightsOf(settings));
    const seat = settings.seat === 'random' ? Math.floor(Math.random() * settings.teams) : Number(settings.seat) - 1;
    const seed = Math.floor(Math.random() * 2 ** 32);
    recorded.current = false;
    setSt(runBots(createMock(ranked, { userSeat: seat, seed, teams: settings.teams, slots, botKey: adpOn && !inSeason ? 'adp' : 'svp', kit: KIT })));
    setArmed(null); setTab('players'); setShared(null); setCard(null); setSavedNote(null);
  }

  function take(id) {
    setSt((s) => runBots(applyPick(s, id, 'user')));
    setArmed(null); setCard(null);
  }
  function tap(p) { if (armed !== p.id) { setArmed(p.id); return; } take(p.id); }

  const done = st ? isDone(st) : false;
  const n = st ? nextPick(st) : 0;
  const yourTurn = st && !done && onClock(st) === st.userSeat;

  // THE PICK CLOCK: counts down on your pick only; at zero your pick is made for
  // you. `left` is keyed to the pick it counts for, so a new pick starts full.
  const clockOn = Boolean(yourTurn && settings.clock);
  useEffect(() => {
    if (!clockOn) return undefined;
    const ends = Date.now() + settings.clock * 1000;
    const t = setInterval(() => {
      const s = Math.max(0, Math.ceil((ends - Date.now()) / 1000));
      setLeft({ n, s });
      if (s === 0) { clearInterval(t); setSt((x) => autoPickOnExpiry(x)); setArmed(null); setCard(null); }
    }, 250);
    return () => clearInterval(t);
  }, [clockOn, n, settings.clock]);
  const secs = clockOn ? (left?.n === n ? left.s : settings.clock) : null;

  // A finished draft is recorded once, anonymously.
  useEffect(() => {
    if (!st || !done || recorded.current) return;
    recorded.current = true;
    recordMockDraftAction({
      sport: SPORT, teams: st.teams, rounds: st.slots.length, scoring: settings.scoring, roster: settings.roster,
      userSeat: st.userSeat + 1, grade: gradeMock(st).grade, picks: st.picks.map((p) => Number(p.id)),
    }).catch(() => {});
  }, [st, done, settings.scoring, settings.roster]);

  const legal = useMemo(() => (st && !done ? new Set(legalFor(st, st.userSeat).map((p) => p.id)) : new Set()), [st, done]);
  const rows = useMemo(() => {
    if (!st) return [];
    const needle = q.trim().toLowerCase();
    const key = sort === 'adp' && adpOn ? (p) => keyOf(p, 'adp') : (p) => p.svp;
    return st.pool
      .filter((p) => !st.taken.has(p.id)
        && (pos === 'ALL' || eligible(p).has(pos))
        && (!needle || p.name.toLowerCase().includes(needle) || String(p.team ?? '').toLowerCase() === needle))
      .sort((a, b) => key(a) - key(b))
      .slice(0, 150);
  }, [st, pos, q, sort, adpOn]);

  // ---------- SETUP ----------
  if (!st) {
    const rounds = slots.length;
    return (
      <section className="mnb-setup" data-mock-nfl-setup>
        <div className="dgm-hd">
          <div className="dgm-eyebrow">NFL MOCK DRAFT · {settings.teams} TEAMS · {rounds} ROUNDS</div>
          <h1 className="dgm-hd-title">NFL Mock Draft 2026</h1>
          <div className="dgm-hd-sub">You against {settings.teams - 1} bots. Set it up your way; we remember it for next time.</div>
        </div>

        <SetupLibrary settings={settings} onApply={(s) => { const n = normalizeSettings(s); writeLocal(n); setEdited(n); }} signedIn={signedIn} initialSetups={setups} sport={SPORT} />

        <div className="mnb-form">
          <Select label="Teams" name="teams" value={settings.teams} onChange={(v) => set({ teams: Number(v) })}>
            {Array.from({ length: TEAMS_MAX - TEAMS_MIN + 1 }, (_, i) => TEAMS_MIN + i).map((t) => <option key={t} value={t}>{t} teams</option>)}
          </Select>
          <Select label="Rounds" name="rounds" value={rounds} onChange={() => {}} disabled>
            <option value={rounds}>{rounds} (one per roster spot)</option>
          </Select>
          <Select label="Draft slot" name="seat" value={settings.seat} onChange={(v) => set({ seat: v === 'random' ? 'random' : Number(v) })}>
            <option value="random">Random</option>
            {Array.from({ length: settings.teams }, (_, i) => <option key={i} value={i + 1}>Pick {i + 1}</option>)}
          </Select>
          <Select label="Pick clock" name="clock" value={settings.clock} onChange={(v) => set({ clock: Number(v) })}>
            {CLOCKS.map((c) => <option key={c} value={c}>{c ? `${c} seconds` : 'Off'}</option>)}
          </Select>
          <Select label="Scoring" name="scoring" value={settings.scoring} onChange={(v) => set({ scoring: v })}>
            {Object.entries(SCORING_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            <option value="custom">Custom</option>
          </Select>
          <Select label="Roster" name="roster" value={settings.roster} onChange={(v) => set({ roster: v })}>
            {Object.entries(ROSTER_PRESETS).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
            <option value="custom">Custom</option>
          </Select>
        </div>

        {settings.scoring === 'custom' && (
          <fieldset className="mnb-custom" data-mock-nfl-custom-scoring>
            <legend>Points per stat</legend>
            {STATS.map(({ key, label }) => (
              <label key={key} className="mnb-crow">
                <span>{label}</span>
                <input
                  className="mnb-num" type="number" inputMode="decimal" step="0.01" min="-10" max="10"
                  value={settings.customWeights[key]}
                  onChange={(e) => set({ customWeights: { ...settings.customWeights, [key]: e.target.value } })}
                />
              </label>
            ))}
          </fieldset>
        )}

        {settings.roster === 'custom' && (
          <fieldset className="mnb-custom mnb-custom--grid" data-mock-nfl-custom-roster>
            <legend>Spots per position</legend>
            {SLOT_KEYS.map((k) => (
              <Select key={k} label={k === 'BN' ? 'Bench' : SLOT_LABEL[k]} value={settings.customCounts[k]} onChange={(v) => set({ customCounts: { ...settings.customCounts, [k]: Number(v) } })}>
                {Array.from({ length: (k === 'BN' ? BENCH_MAX : SLOT_MAX) + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </Select>
            ))}
          </fieldset>
        )}

        <p className="dgm-sub mnb-roster-line">Roster: {slots.map((x) => SLOT_LABEL[x]).join(' ') || 'none'}</p>
        {!fill.ok && <p className="dgm-err" role="alert" data-mock-nfl-unfillable>{fill.message}</p>}

        <button type="button" className="dgm-pill dgm-pill--lime mnb-start" onClick={start} disabled={!fill.ok} data-mock-nfl-start>Start the draft</button>
        <div className="mnb-setup-foot">
          <button type="button" className="mnb-link" onClick={resetDefaults} data-mock-nfl-reset>Reset to default</button>
          <span className="mnb-saved">{savedNote ?? (signedIn ? 'Saved to your account' : 'Saved on this device')}</span>
        </div>
        <p className="dgm-foot">{SVP_INFO} &ldquo;Out&rdquo; and &ldquo;IR&rdquo; mark a player on today&apos;s injury report. Kickers score field goals flat and defenses score sacks, takeaways and touchdowns only (distance and points allowed are not in our data). {inSeason ? ' In season the bots and auto-draft pick by SVP and roster need.' : ''} Pool: the top {pool.length} by ADP{adpAsOf ? ` (ADP as of ${adpAsOf})` : ''}{builtAt ? `, updated ${builtAt.slice(0, 10)}` : ''}.</p>
      </section>
    );
  }

  const teams = st.teams; const rounds = st.slots.length; const total = totalPicks(st);
  const weights = weightsOf(settings);
  const cardP = card != null ? st.pool.find((p) => p.id === card) : null;

  const sheet = cardP && (
    <div className="mnb-scrim" onClick={() => setCard(null)} data-mock-nfl-card-sheet>
      <div className="mnb-sheet" role="dialog" aria-modal="true" aria-label={cardP.name} onClick={(e) => e.stopPropagation()}>
        <div className="mnb-sheet-hd">
          <span className="dgm-pos">{posLabel(cardP)}</span>
          <div className="dgm-who"><b className="mnb-sheet-name">{cardP.name} <OutBadge p={cardP} /></b><small>{cardP.team ?? 'Free agent'}{cardP.bye ? ` · bye week ${cardP.bye}` : ''} · {ranksLine(cardP, adpOn, adpWord)}</small></div>
          <button type="button" className="mnb-x" onClick={() => setCard(null)} aria-label="Close">×</button>
        </div>
        {(() => {
          const pj = projection(cardP, weights);
          const cols = CARD_STATS[cardP.pos] ?? CARD_STATS.WR;
          const seasons = [['2026', cardP.s], ['2025', cardP.s2]];
          const mix = pj.now != null && pj.last != null
            ? `${Math.round(pj.wNow * 100)}% this season over ${pj.gp} game${pj.gp === 1 ? '' : 's'}${pj.gp < EARLY_GAMES ? ' (under 4, so 50/50)' : ''}, ${Math.round((1 - pj.wNow) * 100)}% last season`
            : (pj.now != null ? 'this season only' : (pj.last != null ? 'last season only' : null));
          return (
            <>
              <div className="mnb-sheet-cap">Season totals</div>
              <div className="mnb-board mnb-seasons">
                <table>
                  <thead><tr><th>Season</th><th>GP</th>{cols.map(([, l]) => <th key={l}>{l}</th>)}<th>FP/G</th></tr></thead>
                  <tbody>
                    {seasons.map(([y, line]) => (
                      <tr key={y}><th>{y}</th>{line
                        ? <><td>{line.gp}</td>{cols.map(([k]) => <td key={k}>{num(line.t?.[k])}</td>)}<td>{fppgOf(line, weights)?.toFixed(1) ?? '-'}</td></>
                        : <td colSpan={cols.length + 2}>No games</td>}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="dgm-note mnb-proj" data-mock-nfl-proj>{mix
                ? `Projection: ${pj.fppg?.toFixed(1)} FP/G (${mix}) x ${pj.games} game${pj.games === 1 ? '' : 's'} left = ${cardP.sv.toLocaleString('en-US')} points.`
                : 'No NFL games in either season yet: he ranks after every projected player, in ADP order.'}</p>
              <div className="mnb-sheet-big">
                <div><span className="n">{pj.fppg?.toFixed(1) ?? '-'}</span><small>Projected FP/G ({settings.scoring === 'custom' ? 'custom' : SCORING_PRESETS[settings.scoring].label})</small></div>
                <div><span className="n">{cardP.svp}</span><small>SVP</small></div>
                {adpOn && <div><span className="n">{adpText(cardP.adp)}</span><small>{adpLabel}</small></div>}
              </div>
            </>
          );
        })()}
        <p className="dgm-note">{SVP_INFO}</p>
        {yourTurn && !st.taken.has(cardP.id) && (
          legal.has(cardP.id)
            ? <button type="button" className="dgm-pill dgm-pill--lime mnb-start" onClick={() => take(cardP.id)} data-mock-nfl-card-draft>Draft {surname(cardP.name)}</button>
            : <p className="dgm-note">Your remaining picks must fill your empty starting slots.</p>
        )}
      </div>
    </div>
  );

  // ---------- RESULT ----------
  if (done) {
    const g = gradeMock(st);
    const mine = st.rosters[st.userSeat];
    const ids = st.picks.filter((p) => p.seat === st.userSeat).map((p) => p.id);
    const cardUrl = `/mock/nfl/card?d=${encodeShare({ grade: g.grade, seat: st.userSeat + 1, ids, counts: countsOf(settings), teams })}`;
    const text = `My NFL mock draft: ${g.grade} (${ordinal(g.place)} of ${teams}) from pick ${st.userSeat + 1} on Sportsvyn. sportsvyn.com/mock/nfl`;
    async function share() {
      try {
        if (navigator.share) { await navigator.share({ title: 'My NFL mock draft', text }); return; }
        await navigator.clipboard.writeText(text); setShared('Copied');
      } catch { /* closed */ }
    }
    return (
      <section className="mnb-result" data-mock-nfl-result>
        <div className="dgm-hd dgm-hd--result">
          <div className="dgm-eyebrow">NFL MOCK DRAFT · PICK {st.userSeat + 1} · TEAM GRADE</div>
          <div className="dgm-big n" data-mock-nfl-grade>{g.grade}</div>
          <div className="dgm-hd-sub">Projected points {g.value.toLocaleString('en-US')} · {ordinal(g.place)} of {teams}</div>
          {g.steal && <div className="dgm-top">Steal: {g.steal.name}, SVP {g.steal.svp}, taken {ordinal(g.steal.n)}</div>}
        </div>
        <ul className="dgm-scored" aria-label="Your team">
          {mine.map((r, i) => {
            const auto = r.player && st.picks.find((p) => p.id === r.player.id)?.by === 'auto';
            return (
              <li key={i} className={`dgm-srow${r.slot === 'BN' ? ' dgm-srow--out' : ''}`}>
                <span className="dgm-pos">{SLOT_LABEL[r.slot]}</span>
                <button type="button" className="dgm-who mnb-whobtn" onClick={() => r.player && setCard(r.player.id)}>
                  <b>{r.player?.name ?? 'Empty'}</b><small>{r.player ? `${sub(r.player, adpOn, adpWord)}${auto ? ' · auto' : ''}` : ''}</small>
                </button>
                <span className="dgm-pts n">{r.player?.sv ?? ''}</span>
              </li>
            );
          })}
        </ul>
        <div className="dgm-actions">
          <button type="button" className="dgm-pill dgm-pill--lime" onClick={share}>{shared ?? 'Share'}</button>
          <a className="dgm-pill dgm-pill--outline" href={cardUrl} target="_blank" rel="noreferrer" data-mock-nfl-card>Get the card</a>
          <button type="button" className="dgm-pill dgm-pill--outline" onClick={() => setSt(null)}>Draft again</button>
        </div>
        {sheet}
      </section>
    );
  }

  // ---------- ROOM ----------
  const lastBySeat = new Map(st.picks.map((p) => [p.seat, p]));
  const mustStart = mustStartNow(st, st.userSeat);
  const myNext = (() => { for (let k = n; k <= total; k += 1) if (seatAt(k, teams) === st.userSeat) return k; return null; })();
  const byId = new Map(st.pool.map((p) => [p.id, p]));

  return (
    <section className="mnb-room" data-mock-nfl-room>
      <div className="dgm-hd">
        <div className="dgm-eyebrow">NFL MOCK DRAFT · {teams} TEAMS · {rounds} ROUNDS</div>
        <h1 className="dgm-hd-title" data-room-header>Round {roundOf(n, teams)} of {rounds} · {yourTurn ? 'your pick' : 'on deck'}</h1>
        <div className="dgm-hd-sub">
          Pick {n} of {total}
          {secs != null && <span className={`mnb-clock n${secs <= 10 ? ' mnb-clock--low' : ''}`} data-mock-nfl-clock> · {clockText(secs)}</span>}
        </div>
      </div>
      <div className="mnb-strip" data-seat-strip="scroll">
        {Array.from({ length: teams }, (_, i) => {
          const p = lastBySeat.get(i);
          const pl = p ? byId.get(p.id) : null;
          return (
            <div key={i} className={`dgm-tile${i === st.userSeat ? ' dgm-tile--you' : ''}`}>
              <b>{i === st.userSeat ? 'You' : `Team ${i + 1}`}</b>
              <span className="mnb-tile-sub">{pl ? surname(pl.name) : '-'}</span>
            </div>
          );
        })}
      </div>

      <div className="mnb-tabs" role="tablist">
        {[['players', 'Players'], ['team', 'My team'], ['board', 'Board']].map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`mnb-tab${tab === k ? ' mnb-tab--on' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'players' && (
        <>
          <input className="mnb-search" type="search" placeholder="Search players" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search players" />
          <div className="mnb-filters">
            <Select label="Position" name="pos" value={pos} onChange={setPos}>
              {POS_FILTERS.map((c) => <option key={c} value={c}>{c === 'ALL' ? 'All' : SLOT_LABEL[c]}</option>)}
            </Select>
            <Select label="Sort" name="sort" value={adpOn ? sort : 'svp'} onChange={setSort} disabled={!adpOn}>
              {adpOn && <option value="adp">{adpLabel}</option>}
              <option value="svp">SVP</option>
            </Select>
          </div>
          <p className="dgm-note mnb-info">{SVP_INFO}</p>
          {mustStart && <p className="dgm-note">Your remaining picks must fill your empty starting slots.</p>}
          <ul className="dgm-pool" aria-label="Available players">
            {rows.map((p) => {
              const ok = legal.has(p.id);
              const isArmed = armed === p.id;
              return (
                <li key={p.id} className={`dgm-prow${isArmed ? ' mnb-prow--armed' : ''}`} data-armed={isArmed ? '1' : undefined}>
                  <span className="dgm-pos">{posLabel(p)}</span>
                  <button type="button" className="dgm-who mnb-whobtn" onClick={() => setCard(p.id)} data-mock-nfl-row>
                    <b>{p.name} <OutBadge p={p} /></b><small>{sub(p, adpOn, adpWord)}</small>
                  </button>
                  <button type="button" className={`dgm-pill dgm-pill--sm${isArmed ? ' dgm-pill--lime' : ''}`} disabled={!yourTurn || !ok} onClick={() => tap(p)}>
                    {isArmed ? 'Confirm' : 'Draft'}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {tab === 'team' && (
        <>
          <ul className="dgm-scored" aria-label="Your team">
            {st.rosters[st.userSeat].map((r, i) => (
              <li key={i} className="dgm-srow">
                <span className="dgm-pos">{SLOT_LABEL[r.slot]}</span>
                <span className="dgm-who"><b>{r.player?.name ?? 'Empty'}</b><small>{r.player ? sub(r.player, adpOn, adpWord) : ''}</small></span>
                <span className="dgm-pts n">{r.player?.sv ?? ''}</span>
              </li>
            ))}
          </ul>
          {myNext != null && <p className="dgm-note">Your next pick: {myNext}</p>}
        </>
      )}

      {tab === 'board' && (
        <div className="mnb-board">
          <table>
            <thead><tr><th>Rd</th>{Array.from({ length: teams }, (_, i) => <th key={i} className={i === st.userSeat ? 'mnb-you' : ''}>{i === st.userSeat ? 'YOU' : i + 1}</th>)}</tr></thead>
            <tbody>
              {Array.from({ length: rounds }, (_, r) => (
                <tr key={r}>
                  <th>{r + 1}</th>
                  {Array.from({ length: teams }, (_, seat) => {
                    const pk = st.picks.find((p) => p.seat === seat && roundOf(p.n, teams) === r + 1);
                    const pl = pk ? byId.get(pk.id) : null;
                    return <td key={seat} className={seat === st.userSeat ? 'mnb-you' : ''}>{pl ? surname(pl.name) : ''}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="dgm-actions mnb-finish">
        <button type="button" className="dgm-pill dgm-pill--lime" onClick={() => { setSt((s) => autoDraftRest(s)); setArmed(null); setCard(null); }} data-mock-nfl-autodraft>Auto-draft the rest</button>
        <button type="button" className="dgm-pill dgm-pill--outline" onClick={() => setSt(null)} data-mock-nfl-restart>Restart</button>
      </div>
      {sheet}
    </section>
  );
}
