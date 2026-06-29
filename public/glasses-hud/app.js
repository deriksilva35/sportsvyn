'use strict';

/* Sportsvyn glasses HUD — plain static app. Polls /api/live, renders a
   live-first carousel. Input: D-pad arrows + pinch(Enter) + back(Escape) —
   the SAME arrow keys work for desktop browser preview, no glasses needed. */

// ─── CONFIG ────────────────────────────────────────────────────────────────
// API base resolved at runtime. A SAME-ORIGIN relative '' is the proven path in
// any normal browser — the page is served from sportsvyn.com (prod) or a local
// dev server, where '/api/live' resolves directly (no CORS involved). Hard-
// coding an absolute base regressed that (the browser fell back to SAMPLE_DATA),
// so we only use the absolute URL for the Meta glasses WebView, whose sandbox
// origin is NOT one of these and where a relative path can't resolve; the
// endpoint serves CORS '*' for that case.
function resolveApiBase() {
  try {
    const o = (typeof location !== 'undefined' && location.origin) || '';
    if (o.includes('sportsvyn.com') || o.includes('localhost') || o.includes('127.0.0.1')) return '';
    return 'https://sportsvyn.com';
  } catch (_e) {
    return 'https://sportsvyn.com';
  }
}

const CONFIG = {
  API_BASE: resolveApiBase(),
  POLL_MS: 60000,                 // 60s live scores, per the perf budget
  BOARD_POLL_MS: 300000,          // 5min for /api/board — bracket changes per-round, stats per-match
  AUTO_ADVANCE_ON_LIVE: true,     // toggle: auto-skip the beat into Live HUD when a match is live
  BEAT_MS: 2600,                  // how long the home beat holds before deciding
};

const SURFACES = ['live', 'schedule', 'bracket', 'rankings', 'stats'];

// ─── SAMPLE FIXTURES (render offline; mirror the /api/live shape) ───────────
const SAMPLE_DATA = {
  updatedAt: '2026-06-28T19:42:00.000Z',
  dateline: 'Sun, Jun 28',
  matches: [
    { id: 1, slug: 'arg-bra', home: { name: 'Argentina', abbr: 'ARG', flag: 'https://flagcdn.com/ar.svg' },
      away: { name: 'Brazil', abbr: 'BRA', flag: 'https://flagcdn.com/br.svg' },
      homeScore: 2, awayScore: 1, status: 'live', minute: "67'", statusShort: '2H', watchScore: 8.6, watchTrend: 'up' },
    { id: 2, slug: 'fra-ger', home: { name: 'France', abbr: 'FRA', flag: 'https://flagcdn.com/fr.svg' },
      away: { name: 'Germany', abbr: 'GER', flag: 'https://flagcdn.com/de.svg' },
      homeScore: 1, awayScore: 1, status: 'ft' },
    { id: 3, slug: 'esp-ned', home: { name: 'Spain', abbr: 'ESP', flag: 'https://flagcdn.com/es.svg' },
      away: { name: 'Netherlands', abbr: 'NED', flag: 'https://flagcdn.com/nl.svg' },
      homeScore: null, awayScore: null, status: 'scheduled', kickoff: '2026-06-28T22:00:00.000Z' },
  ],
  rankingsTop5: [
    { rank: 1, team: 'France', abbr: 'FRA', flag: 'https://flagcdn.com/fr.svg', score: 8.62, delta: 'up' },
    { rank: 2, team: 'Spain', abbr: 'ESP', flag: 'https://flagcdn.com/es.svg', score: 8.36, delta: 'hold' },
    { rank: 3, team: 'Argentina', abbr: 'ARG', flag: 'https://flagcdn.com/ar.svg', score: 8.21, delta: 'down' },
    { rank: 4, team: 'Brazil', abbr: 'BRA', flag: 'https://flagcdn.com/br.svg', score: 7.79, delta: 'hold' },
    { rank: 5, team: 'Netherlands', abbr: 'NED', flag: 'https://flagcdn.com/nl.svg', score: 7.63, delta: 'hold' },
  ],
};

// PLACEHOLDER sample data — Bracket + Stats are NOT in /api/live yet (follow-up).
const SAMPLE_BRACKET = {
  convergence: [
    { where: 'Semifinal · MetLife', a: 'France', b: 'Spain' },
    { where: 'Semifinal · SoFi', a: 'Argentina', b: 'Brazil' },
  ],
  road: [
    { rd: 'R16', opp: 'def. Morocco 2–0' },
    { rd: 'QF', opp: 'def. England 1–0' },
    { rd: 'SF', opp: 'vs Spain' },
  ],
};
const SAMPLE_STATS = {
  goldenBoot: {
    leader: { name: 'K. Mbappé', team: 'FRA', goals: 7 },
    chasers: [ { name: 'L. Messi', team: 'ARG', goals: 6 }, { name: 'H. Kane', team: 'ENG', goals: 5 } ],
  },
};

// ─── STATE ───────────────────────────────────────────────────────────────
const state = {
  data: SAMPLE_DATA,   // current render data (last-good or sample)
  lastGood: null,      // last successful /api/live payload
  board: null,         // last successful /api/board payload ({ bracket, stats })
  surface: 0,
  inCarousel: false,
  stale: false,
  pollId: null,
  boardPollId: null,
  bracketMode: 'convergence', // convergence | road  (ArrowUp/Down/Enter toggles)
};

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function flagImg(url, cls = '') {
  return `<img class="flag ${cls}" src="${esc(url)}" alt="" onerror="this.style.visibility='hidden'">`;
}
function liveMatch(d) {
  const live = (d.matches || []).filter((m) => m.status === 'live');
  if (!live.length) return null;
  return live.slice().sort((a, b) => (b.watchScore || 0) - (a.watchScore || 0))[0];
}
function fmtKickoff(iso) {
  if (!iso) return { when: '—', sub: '' };
  const d = new Date(iso);
  const when = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const mins = Math.round((d - Date.now()) / 60000);
  let sub = '';
  if (mins > 0) sub = mins >= 60 ? `in ${Math.floor(mins / 60)}h ${mins % 60}m` : `in ${mins}m`;
  else if (mins > -130) sub = 'now';
  return { when, sub };
}
const trendGlyph = (t) => (t === 'up' ? '▲' : t === 'down' ? '▼' : '▪');
const deltaGlyph = (d) => (d === 'up' ? '▲' : d === 'down' ? '▼' : '–');

// ─── RENDER: surfaces ──────────────────────────────────────────────────────
function renderLive() {
  const m = liveMatch(state.data);
  const el = $('surf-live');
  if (!m) {
    // calm fallback: next scheduled, else "no match live"
    const next = (state.data.matches || []).find((x) => x.status === 'scheduled');
    el.innerHTML = `
      <div class="shead"><span class="title">Live</span><span class="sub">${esc(state.data.dateline || '')}</span></div>
      <div class="lh-empty">
        <div class="big">No match live</div>
        ${next ? `<div class="sub" style="color:var(--muted)">Next: ${esc(next.home.abbr)} v ${esc(next.away.abbr)} · ${esc(fmtKickoff(next.kickoff).when)}</div>` : ''}
      </div>`;
    return;
  }
  const hLead = (m.homeScore ?? 0) > (m.awayScore ?? 0);
  const aLead = (m.awayScore ?? 0) > (m.homeScore ?? 0);
  el.innerHTML = `
    <div class="shead">
      <span class="tag live">Live</span>
      <span class="live-clock">${esc(m.minute || m.statusShort || '')}</span>
    </div>
    <div class="lh-teams">
      <div class="lh-row ${hLead ? 'lead' : ''}">
        ${flagImg(m.home.flag, 'lg')}
        <div><div class="abbr">${esc(m.home.abbr)}</div><div class="name">${esc(m.home.name)}</div></div>
        <div class="score">${m.homeScore ?? 0}</div>
      </div>
      <div class="lh-row ${aLead ? 'lead' : ''}">
        ${flagImg(m.away.flag, 'lg')}
        <div><div class="abbr">${esc(m.away.abbr)}</div><div class="name">${esc(m.away.name)}</div></div>
        <div class="score">${m.awayScore ?? 0}</div>
      </div>
    </div>
    <div class="lh-watch">
      <div><div class="lbl">Watch Score</div><div class="big">${m.watchScore != null ? m.watchScore : '—'}</div></div>
      ${m.watchTrend ? `<div class="trend ${esc(m.watchTrend)}">${trendGlyph(m.watchTrend)}</div>` : ''}
    </div>`;
}

function renderSchedule() {
  const ms = state.data.matches || [];
  const rows = ms.map((m) => {
    const k = fmtKickoff(m.kickoff);
    let when, st, stCls = '';
    if (m.status === 'live') { when = m.minute || 'LIVE'; st = 'Live'; stCls = 'live'; }
    else if (m.status === 'ft') { when = 'FT'; st = 'Full Time'; }
    else { when = k.when; st = k.sub || 'Scheduled'; }
    const hWin = m.status !== 'scheduled' && (m.homeScore ?? 0) > (m.awayScore ?? 0);
    const aWin = m.status !== 'scheduled' && (m.awayScore ?? 0) > (m.homeScore ?? 0);
    const side = (s, win, score) => `
      <div class="sch-side ${win ? 'win' : ''}">${flagImg(s.flag)}<span class="abbr">${esc(s.abbr)}</span>
        <span class="sc">${score != null ? score : ''}</span></div>`;
    return `<div class="sch-row">
        <div class="pair">${side(m.home, hWin, m.homeScore)}${side(m.away, aWin, m.awayScore)}</div>
        <div class="sch-meta"><div class="when">${esc(when)}</div><div class="st ${stCls}">${esc(st)}</div></div>
      </div>`;
  }).join('');
  $('surf-schedule').innerHTML = `
    <div class="shead"><span class="title">Today</span><span class="sub">${esc(state.data.dateline || '')} · ${ms.length}</span></div>
    <div class="sch-list">${rows || '<div class="lh-empty" style="margin:auto">No matches today</div>'}</div>`;
}

function renderRankings() {
  const rows = (state.data.rankingsTop5 || []).map((r) => `
    <div class="rk-row">
      <span class="rk-rank">${r.rank}</span>
      ${flagImg(r.flag)}
      <span class="rk-team">${esc(r.team)}</span>
      <span class="rk-score">${r.score != null ? r.score : '—'}</span>
      <span class="rk-delta ${esc(r.delta)}">${deltaGlyph(r.delta)}</span>
    </div>`).join('');
  $('surf-rankings').innerHTML = `
    <div class="shead"><span class="title">Power</span><span class="sub">Top 5</span></div>
    ${rows || '<div class="lh-empty" style="margin:auto">No rankings</div>'}`;
}

function renderBracket() {
  const real = state.board && state.board.bracket;
  const b = real || SAMPLE_BRACKET;          // real when loaded; sample only offline
  const conv = b.convergence || [];
  const road = b.road || [];
  let body;
  if (state.bracketMode === 'convergence') {
    body = conv.length
      ? `<div class="bk-conv">${conv.map((c) => `
      <div class="bk-meet"><div class="where">${esc(c.where)}</div>
        <div class="bk-feed">${esc(c.a)} <span class="vs">v</span> ${esc(c.b)}</div></div>`).join('')}</div>`
      : '<div class="lh-empty" style="margin:auto">Semifinals not set</div>';
  } else {
    body = road.length
      ? `<div class="bk-road">${road.map((r) => `
      <div class="bk-leg"><span class="rd">${esc(r.rd)}</span><span class="opp">${esc(r.opp)}</span></div>`).join('')}</div>`
      : '<div class="lh-empty" style="margin:auto">No knockout results yet</div>';
  }
  $('surf-bracket').innerHTML = `
    <div class="shead"><span class="title">Bracket</span>
      <span class="bk-mode">${state.bracketMode === 'convergence' ? 'Convergence' : 'Results'} · ↑↓</span></div>
    ${body}
    ${real ? '' : '<div class="ph-note">offline · sample</div>'}`;
}

function renderStats() {
  const real = state.board && state.board.stats && state.board.stats.goldenBoot;
  const g = real || SAMPLE_STATS.goldenBoot;   // real when loaded; sample only offline
  $('surf-stats').innerHTML = `
    <div class="shead"><span class="title">Golden Boot</span>${real ? '' : '<span class="tag placeholder">sample</span>'}</div>
    <div class="st-hero"><div class="num">${g.leader.goals}</div>
      <div class="who">${esc(g.leader.name)} · ${esc(g.leader.team)}</div><div class="lbl">goals · leader</div></div>
    ${(g.chasers || []).map((c) => `<div class="st-chaser"><span class="who">${esc(c.name)} · ${esc(c.team)}</span><span class="g">${c.goals}</span></div>`).join('')}
    ${real ? '' : '<div class="ph-note">offline · sample</div>'}`;
}

function renderDots() {
  $('dots').innerHTML = SURFACES.map((_, i) => `<span class="dot ${i === state.surface ? 'on' : ''}"></span>`).join('');
}
function renderAll() {
  renderLive(); renderSchedule(); renderBracket(); renderRankings(); renderStats();
  renderDots();
  $('stale').classList.toggle('hidden', !state.stale);
}

// ─── POLL (start on demand, stop when hidden) ───────────────────────────────
async function fetchLive() {
  try {
    const res = await fetch(CONFIG.API_BASE + '/api/live', { cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    const json = await res.json();
    state.data = json; state.lastGood = json; state.stale = false;
  } catch (err) {
    // Surface the REAL reason in the console (glasses + browser) instead of
    // failing silently into SAMPLE_DATA — names the resolved URL it tried.
    console.error('[hud] /api/live fetch failed:', CONFIG.API_BASE + '/api/live', err);
    // graceful: keep last-good; if never succeeded, fall back to SAMPLE_DATA
    if (state.lastGood) state.data = state.lastGood;
    else state.data = SAMPLE_DATA;
    state.stale = true;
  }
  renderAll();
}
// /api/board — bracket + stats (real data; slower poll). Same graceful pattern
// as fetchLive: keep last-good board on failure, fall back to SAMPLE only when
// no board has ever loaded (handled in renderBracket/renderStats via state.board).
async function fetchBoard() {
  try {
    const res = await fetch(CONFIG.API_BASE + '/api/board', { cache: 'no-store' });
    if (!res.ok) throw new Error('http ' + res.status);
    const json = await res.json();
    if (json && json.bracket) state.board = json; // ignore graceful-error payloads (bracket null)
  } catch (err) {
    console.error('[hud] /api/board fetch failed:', CONFIG.API_BASE + '/api/board', err);
    // keep last-good state.board; renderers fall back to SAMPLE if it's still null
  }
  renderBracket(); renderStats();
}
function startPoll() {
  stopPoll();
  fetchLive();  state.pollId = setInterval(fetchLive, CONFIG.POLL_MS);
  fetchBoard(); state.boardPollId = setInterval(fetchBoard, CONFIG.BOARD_POLL_MS);
}
function stopPoll() {
  if (state.pollId) { clearInterval(state.pollId); state.pollId = null; }
  if (state.boardPollId) { clearInterval(state.boardPollId); state.boardPollId = null; }
}
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPoll(); else startPoll(); });

// ─── NAVIGATION (D-pad arrows + pinch/Enter + back/Escape) ─────────────────
function applyCarousel() { $('track').style.transform = `translateX(${-state.surface * 600}px)`; renderDots(); }
function move(d) { state.surface = clamp(state.surface + d, 0, SURFACES.length - 1); applyCarousel(); }
function enterCarousel(at) {
  state.inCarousel = true;
  $('beat').classList.add('hidden');
  $('carousel').classList.remove('hidden');
  state.surface = at ?? 0;
  applyCarousel();
}
function exitToBeat() {
  state.inCarousel = false;
  $('carousel').classList.add('hidden');
  $('beat').classList.remove('hidden');
}
function toggleWithin(key) {
  // Bracket: ArrowUp/Down or pinch toggles convergence <-> road.
  if (SURFACES[state.surface] === 'bracket') {
    state.bracketMode = state.bracketMode === 'convergence' ? 'road' : 'convergence';
    renderBracket();
  }
}
document.addEventListener('keydown', (e) => {
  if (!state.inCarousel) {
    if (e.key === 'Enter') { enterCarousel(liveMatch(state.data) ? 0 : 1); e.preventDefault(); }
    return;
  }
  switch (e.key) {
    case 'ArrowRight': move(1); e.preventDefault(); break;
    case 'ArrowLeft':  move(-1); e.preventDefault(); break;
    case 'ArrowUp': case 'ArrowDown': toggleWithin(e.key); e.preventDefault(); break;
    case 'Enter': toggleWithin('Enter'); e.preventDefault(); break;
    case 'Escape': exitToBeat(); e.preventDefault(); break;
  }
});

// ─── BOOT: smart home beat ─────────────────────────────────────────────────
function init() {
  renderAll();          // paint with SAMPLE_DATA immediately (no blank)
  startPoll();          // fetch once + every 60s
  setTimeout(() => {
    if (state.inCarousel) return;                 // user already pinched in
    if (CONFIG.AUTO_ADVANCE_ON_LIVE && liveMatch(state.data)) {
      enterCarousel(0);                           // a match is live → Live HUD
    }
    // else: hold on the beat; pinch enters at Schedule (handled in keydown)
  }, CONFIG.BEAT_MS);
}
init();
