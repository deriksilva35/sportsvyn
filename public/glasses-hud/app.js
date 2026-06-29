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

// OFFLINE fallback only — shape mirrors /api/board's bracket { matches, teamRanks }.
// Real data comes from /api/board; this renders something plausible when offline.
const SAMPLE_BRACKET = {
  matches: [
    { match_number: 73, stage: 'round_of_32', status: 'final', home_score: 0, away_score: 1, home_penalties: null, away_penalties: null,
      home: { resolved: true, name: 'South Africa', flag: 'https://flagcdn.com/za.svg' },
      away: { resolved: true, name: 'Canada', flag: 'https://flagcdn.com/ca.svg' },
      slot_home: { type: 'group_runner_up', label: '2A', match: null }, slot_away: { type: 'group_winner', label: '1B', match: null }, feeds_match: 89 },
    { match_number: 75, stage: 'round_of_32', status: 'scheduled', home_score: null, away_score: null, home_penalties: null, away_penalties: null,
      home: { resolved: true, name: 'Netherlands', flag: 'https://flagcdn.com/nl.svg' },
      away: { resolved: true, name: 'Morocco', flag: 'https://flagcdn.com/ma.svg' },
      slot_home: { type: 'group_winner', label: '1C', match: null }, slot_away: { type: 'group_runner_up', label: '2D', match: null }, feeds_match: 89 },
    { match_number: 89, stage: 'round_of_16', status: 'scheduled', home_score: null, away_score: null, home_penalties: null, away_penalties: null,
      home: { resolved: false, label: 'W73' }, away: { resolved: false, label: 'W75' },
      slot_home: { type: 'winner_of', label: 'W73', match: 73 }, slot_away: { type: 'winner_of', label: 'W75', match: 75 }, feeds_match: 97 },
  ],
  teamRanks: [ { name: 'Netherlands', rank: 5 }, { name: 'Morocco', rank: 7 }, { name: 'Canada', rank: 17 } ],
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
  bracketMode: 0,      // 0 Next round · 1 Full tree · 2 Team road  (ArrowUp/Down cycles)
  roadTeamIdx: 0,      // which alive team's road (Enter cycles, in mode 2)
  rankMode: 'team',    // team | player  (ArrowUp/Down toggles on Rankings surface)
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

// Live events feed — one row per event, mirroring the web Key Moments rows
// (icon by kind, the deriveHeadlines() headline, gloss sub-line). The server
// (/api/live) already computed `kind`/`headline`/`gloss` from the web vocabulary.
function eventGlyph(kind) {
  switch (kind) {
    case 'goal':   return '<span style="color:var(--volt)">&#9679;</span>';   // ● volt
    case 'yellow': return '<span style="color:#f4c430">&#9646;</span>';        // ▮ yellow
    case 'red':    return '<span style="color:var(--live)">&#9646;</span>';    // ▮ red
    case 'sub':    return '<span style="color:var(--muted)">&#8644;</span>';   // ⇄ sub
    case 'var':    return '<span style="color:var(--muted)">&#9707;</span>';   // ◻ VAR
    case 'missed': return '<span style="color:var(--muted)">&#10005;</span>';  // ✕ missed pen
    default:       return '<span style="color:var(--muted)">&#8226;</span>';
  }
}
function eventRow(e) {
  // Goal rows volt-highlight the scorer (the headline's leading segment) — the
  // web's .scored treatment.
  const up = e.scorer ? e.scorer.toUpperCase() : '';
  const head = (e.kind === 'goal' && up && e.headline.startsWith(up))
    ? `<span style="color:var(--volt)">${esc(up)}</span>${esc(e.headline.slice(up.length))}`
    : esc(e.headline);
  return `<div style="display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="color:var(--muted);font-size:11px;min-width:30px">${esc(e.minute)}</span>
      <span style="min-width:14px;text-align:center;font-size:13px">${eventGlyph(e.kind)}</span>
      <div style="flex:1">
        <div style="font-size:12px;letter-spacing:.3px">${head}</div>
        ${e.gloss ? `<div style="color:var(--muted);font-style:italic;font-size:11px;margin-top:2px">${esc(e.gloss)}</div>` : ''}
      </div></div>`;
}

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
  // Score-hero pinned on top (tightened) + the live EVENTS FEED beneath it —
  // same events + vocabulary as the web match page, newest-first, Up/Down scrolls.
  const hLead = (m.homeScore ?? 0) > (m.awayScore ?? 0);
  const aLead = (m.awayScore ?? 0) > (m.homeScore ?? 0);
  const events = m.events || [];
  el.innerHTML = `
    <div class="shead">
      <span class="tag live">Live</span>
      <span class="live-clock">${esc(m.minute || m.statusShort || '')}</span>
    </div>
    <div style="display:flex;align-items:center;justify-content:center;gap:14px;margin:10px 0 6px">
      <div style="text-align:center;min-width:64px">${flagImg(m.home.flag, 'lg')}<div class="abbr" style="margin-top:2px">${esc(m.home.abbr)}</div></div>
      <div style="font-size:40px;font-weight:800;letter-spacing:-2px;line-height:1">
        <span style="${hLead ? 'color:var(--volt)' : ''}">${m.homeScore ?? 0}</span><span style="color:var(--muted);margin:0 5px">–</span><span style="${aLead ? 'color:var(--volt)' : ''}">${m.awayScore ?? 0}</span>
      </div>
      <div style="text-align:center;min-width:64px">${flagImg(m.away.flag, 'lg')}<div class="abbr" style="margin-top:2px">${esc(m.away.abbr)}</div></div>
    </div>
    <div style="text-align:center;color:var(--muted);font-size:12px;margin-bottom:8px">
      Watch Score <b style="color:#fff">${m.watchScore != null ? m.watchScore : '—'}</b>
      ${m.watchTrend ? `<span class="trend ${esc(m.watchTrend)}">${trendGlyph(m.watchTrend)}</span>` : ''}
    </div>
    ${events.length
      ? `<div id="live-feed" style="overflow-y:auto;max-height:368px;text-align:left;padding:0 6px;border-top:1px solid rgba(255,255,255,.08)">${events.map(eventRow).join('')}</div>`
      : '<div class="sub" style="text-align:center;color:var(--muted);font-size:12px;margin-top:8px">No events yet</div>'}`;
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
  const isPlayer = state.rankMode === 'player';
  const list = isPlayer ? (state.data.playerRankingsTop5 || []) : (state.data.rankingsTop5 || []);
  const rows = list.map((r) => `
    <div class="rk-row">
      <span class="rk-rank">${r.rank}</span>
      ${flagImg(r.flag)}
      <span class="rk-team">${esc(isPlayer ? r.player : r.team)}</span>
      <span class="rk-score">${r.score != null ? r.score : '—'}</span>
      <span class="rk-delta ${esc(r.delta)}">${deltaGlyph(r.delta)}</span>
    </div>`).join('');
  $('surf-rankings').innerHTML = `
    <div class="shead"><span class="title">Power</span><span class="sub">${isPlayer ? 'Players' : 'Teams'} · Top 5 · ↑↓</span></div>
    ${rows || '<div class="lh-empty" style="margin:auto">No rankings</div>'}`;
}

// ─── BRACKET: feeder resolution (build once, all 3 modes use it) ────────────
const STAGE_ORDER = ['round_of_32', 'round_of_16', 'quarter', 'semi', 'final'];
const STAGE_SHORT = { round_of_32: 'R32', round_of_16: 'R16', quarter: 'QF', semi: 'SF', third_place: '3rd', final: 'F' };
const STAGE_LABEL = { round_of_32: 'Round of 32', round_of_16: 'Round of 16', quarter: 'Quarterfinals', semi: 'Semifinals', third_place: '3rd Place', final: 'Final' };

function bracketData() {
  const b = state.board && state.board.bracket;
  const real = !!(b && Array.isArray(b.matches) && b.matches.length);
  const src = real ? b : SAMPLE_BRACKET;
  const matches = src.matches || [];
  return { real, matches, teamRanks: src.teamRanks || [], byNum: new Map(matches.map((m) => [m.match_number, m])) };
}

// Decided winner of a final KO match (regulation/ET, then penalties), or null.
function winnerOf(m) {
  if (!m || m.status !== 'final' || !m.home.resolved || !m.away.resolved) return null;
  const hs = m.home_score ?? 0, as = m.away_score ?? 0;
  if (hs > as) return m.home;
  if (as > hs) return m.away;
  const hp = m.home_penalties, ap = m.away_penalties;
  if (hp != null && ap != null && hp !== ap) return hp > ap ? m.home : m.away;
  return null; // level + no shootout data -> undecided
}

// Resolve ONE level only: resolved team -> {team}; undecided winner_of whose
// feeder is DECIDED -> {team}; feeder undecided but its two teams known ->
// {pair} (both real teams, never a pick); deeper/unknown -> {label}.
function resolveSlot(side, slot, byNum) {
  if (side && side.resolved) return { kind: 'team', name: side.name, flag: side.flag };
  if (slot && slot.type === 'winner_of' && slot.match != null) {
    const fm = byNum.get(slot.match);
    if (fm) {
      const w = winnerOf(fm);
      if (w) return { kind: 'team', name: w.name, flag: w.flag };
      if (fm.home.resolved && fm.away.resolved) {
        return { kind: 'pair', a: { name: fm.home.name, flag: fm.home.flag }, b: { name: fm.away.name, flag: fm.away.flag } };
      }
    }
  }
  return { kind: 'label', label: (slot && slot.label) || (side && side.label) || 'TBD' };
}
const slotText  = (r) => r.kind === 'team' ? r.name : r.kind === 'pair' ? `${r.a.name} / ${r.b.name}` : r.label;
const short     = (n) => (n || 'TBD').replace(/[^A-Za-z ]/g, '').slice(0, 3).toUpperCase();
const slotShort = (r) => r.kind === 'team' ? short(r.name) : r.kind === 'pair' ? `${short(r.a.name)}/${short(r.b.name)}` : r.label;

// Earliest round with an undecided slot — "the round currently being decided".
function nextRoundStage(matches) {
  for (const st of STAGE_ORDER) {
    const ms = matches.filter((m) => m.stage === st);
    if (ms.length && ms.some((m) => !m.home.resolved || !m.away.resolved)) return st;
  }
  for (const st of STAGE_ORDER) {
    const ms = matches.filter((m) => m.stage === st);
    if (ms.length && ms.some((m) => m.status !== 'final')) return st;
  }
  return 'final';
}

// Teams resolved into the bracket, minus those eliminated (lost a KO final),
// ordered by team-power rank (alive favourites first).
function aliveTeams(matches, teamRanks) {
  const rankOf = new Map(teamRanks.map((t) => [t.name, t.rank]));
  const inBracket = new Set(), eliminated = new Set();
  for (const m of matches) {
    if (m.home.resolved) inBracket.add(m.home.name);
    if (m.away.resolved) inBracket.add(m.away.name);
    const w = winnerOf(m);
    if (w) eliminated.add(m.home.name === w.name ? m.away.name : m.home.name);
  }
  return [...inBracket].filter((n) => !eliminated.has(n))
    .sort((a, b) => (rankOf.get(a) ?? 999) - (rankOf.get(b) ?? 999));
}

// One team's road: matches it's resolved in (results behind / next ahead), then
// future rounds projected via feeds_match (opponent = feeder pair/label).
function teamRoad(team, matches, byNum) {
  const legs = [];
  const mine = matches.filter((m) => (m.home.resolved && m.home.name === team) || (m.away.resolved && m.away.name === team))
    .sort((a, b) => a.match_number - b.match_number);
  let cur = null;
  for (const m of mine) {
    const isHome = m.home.resolved && m.home.name === team;
    const opp = resolveSlot(isHome ? m.away : m.home, isHome ? m.slot_away : m.slot_home, byNum);
    if (m.status === 'final') {
      const my = isHome ? m.home_score : m.away_score, op = isHome ? m.away_score : m.home_score;
      const won = winnerOf(m) && winnerOf(m).name === team;
      legs.push({ rd: STAGE_SHORT[m.stage], opp: `${won ? 'def.' : 'lost'} ${slotText(opp)} ${my ?? 0}–${op ?? 0}`, cls: won ? 'win' : 'loss' });
    } else {
      legs.push({ rd: STAGE_SHORT[m.stage], opp: `vs ${slotText(opp)}`, cls: 'next' });
    }
    cur = m;
  }
  while (cur && cur.feeds_match != null) {
    const nxt = byNum.get(cur.feeds_match);
    if (!nxt) break;
    const intoHome = nxt.slot_home && nxt.slot_home.match === cur.match_number;
    const opp = resolveSlot(intoHome ? nxt.away : nxt.home, intoHome ? nxt.slot_away : nxt.slot_home, byNum);
    legs.push({ rd: STAGE_SHORT[nxt.stage], opp: `vs ${slotText(opp)}`, cls: 'ahead' });
    cur = nxt;
  }
  return legs;
}

// side cell for Next-round mode (jade when resolved to a real team)
function nextSideHTML(r) {
  if (r.kind === 'team') return `<span style="color:var(--jade);font-weight:600">${r.flag ? flagImg(r.flag) : ''}${esc(r.name)}</span>`;
  return `<span style="color:var(--muted)">${esc(slotText(r))}</span>`;
}

function renderModeNext(matches, byNum) {
  const stage = nextRoundStage(matches);
  const ms = matches.filter((m) => m.stage === stage).sort((a, b) => a.match_number - b.match_number);
  const rows = ms.map((m) => {
    const h = resolveSlot(m.home, m.slot_home, byNum), a = resolveSlot(m.away, m.slot_away, byNum);
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.06);font-size:14px">
      <div style="flex:1;text-align:right">${nextSideHTML(h)}</div>
      <span class="vs">v</span>
      <div style="flex:1">${nextSideHTML(a)}</div></div>`;
  }).join('');
  return { body: rows || '<div class="lh-empty" style="margin:auto">No matches</div>', label: STAGE_LABEL[stage] || 'Next round' };
}

function renderModeTree(matches, byNum) {
  const strips = STAGE_ORDER.filter((st) => matches.some((m) => m.stage === st)).map((st) => {
    const ms = matches.filter((m) => m.stage === st).sort((a, b) => a.match_number - b.match_number);
    const chips = ms.map((m) => {
      const h = resolveSlot(m.home, m.slot_home, byNum), a = resolveSlot(m.away, m.slot_away, byNum);
      const w = winnerOf(m);
      const hv = w && h.kind === 'team' && w.name === h.name ? 'color:var(--jade)' : '';
      const av = w && a.kind === 'team' && w.name === a.name ? 'color:var(--jade)' : '';
      return `<span style="display:inline-block;white-space:nowrap;margin:2px 7px 2px 0;font-size:11px"><span style="${hv}">${esc(slotShort(h))}</span><span style="color:var(--muted)">·</span><span style="${av}">${esc(slotShort(a))}</span></span>`;
    }).join('');
    return `<div style="padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06)">
      <span style="display:inline-block;width:34px;color:var(--volt);font-size:11px;font-weight:700">${STAGE_SHORT[st]}</span>${chips}</div>`;
  }).join('');
  return { body: `<div style="overflow:auto;max-height:470px">${strips}</div>`, label: 'Full tree' };
}

function renderModeRoad(matches, byNum, teamRanks) {
  const alive = aliveTeams(matches, teamRanks);
  if (!alive.length) return { body: '<div class="lh-empty" style="margin:auto">No teams yet</div>', label: 'Team road' };
  const idx = clamp(state.roadTeamIdx, 0, alive.length - 1);
  const team = alive[idx];
  const legs = teamRoad(team, matches, byNum);
  const col = (c) => c === 'win' ? 'var(--jade)' : c === 'loss' ? 'var(--terra)' : 'var(--muted)';
  const rows = legs.map((l) => `<div class="bk-leg"><span class="rd">${esc(l.rd)}</span><span class="opp" style="color:${col(l.cls)}">${esc(l.opp)}</span></div>`).join('');
  // Default = highest-ranked alive team; Enter cycles. A future "followed team"
  // feature would seed state.roadTeamIdx from the user's follow right here.
  return {
    body: `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="color:var(--jade);font-weight:700">${esc(team)}</span>
        <span style="color:var(--muted);font-size:11px;margin-left:auto">↵ ${idx + 1}/${alive.length}</span></div>
      <div class="bk-road">${rows || '<div class="lh-empty">No road yet</div>'}</div>`,
    label: 'Team road',
  };
}

function renderBracket() {
  const { real, matches, teamRanks, byNum } = bracketData();
  const r = state.bracketMode === 0 ? renderModeNext(matches, byNum)
          : state.bracketMode === 1 ? renderModeTree(matches, byNum)
          :                           renderModeRoad(matches, byNum, teamRanks);
  $('surf-bracket').innerHTML = `
    <div class="shead"><span class="title">Bracket</span>
      <span class="bk-mode">${esc(r.label)} · ↑↓</span></div>
    ${r.body}
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
  const surf = SURFACES[state.surface];
  if (surf === 'bracket') {
    // ArrowUp/Down cycles the 3 modes (Next round → Full tree → Team road).
    // Enter (pinch) in Team-road mode cycles to the next alive team by rank.
    if (key === 'Enter' && state.bracketMode === 2) {
      const { matches, teamRanks } = bracketData();
      const n = aliveTeams(matches, teamRanks).length || 1;
      state.roadTeamIdx = (state.roadTeamIdx + 1) % n;
    } else {
      state.bracketMode = (state.bracketMode + 1) % 3;
    }
    renderBracket();
  } else if (surf === 'rankings') {
    // ArrowUp/Down (pinch) toggles Team <-> Player rankings.
    state.rankMode = state.rankMode === 'team' ? 'player' : 'team';
    renderRankings();
  } else if (surf === 'live') {
    // ArrowUp/Down scrolls the live events feed (no re-render — keeps position).
    const feed = $('live-feed');
    if (feed) feed.scrollBy({ top: key === 'ArrowUp' ? -72 : 72, behavior: 'smooth' });
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
