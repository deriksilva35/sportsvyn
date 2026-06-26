'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

const PLACEHOLDERS = {
  account:  'MY SPORTSVYN — Step 4',
  read:     'READ — destination pending (no article index route yet)',
};

// Bottom nav items. Items with `href` navigate (Capacitor WebView soft-loads
// the full site page; v1 intentionally drops the /app shell on tap — we are
// NOT persisting app-chrome over site pages yet). Items without `href` stay
// as in-shell sections that toggle the local `section` state and render
// their PLACEHOLDERS string. Read currently has no clean destination
// (only /article/[slug] exists; no article-index route), so it stays in-
// shell pending a decision.
// 'sched' is now an IN-SHELL section (no href) — tapping it switches the
// stage to <ScheduleView> while the header + bottom nav persist (Strategy 1),
// instead of soft-loading the website's /schedule and dropping the shell.
// bracket/rankings stay as <Link> navigations for now (later commits).
const NAV_ITEMS = [
  { id: 'sched',    label: 'Schedules', Icon: IconSched },
  { id: 'bracket',  label: 'Bracket',   Icon: IconBracket,  href: '/world-cup-2026/bracket' },
  { id: 'rankings', label: 'Rankings',  Icon: IconRankings, href: '/world-cup-2026/rankings' },
  { id: 'read',     label: 'Read',      Icon: IconRead },
];

const DAYS_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

export default function AppShellClient({ cards, schedule }) {
  const [section, setSection] = useState('deck');
  const [dateline, setDateline] = useState('');

  useEffect(() => {
    const now = new Date();
    setDateline(`${DAYS_SHORT[now.getDay()]} · ${MONTHS[now.getMonth()]} ${now.getDate()}`);
  }, []);

  return (
    <div className="sv-shell">
      <header className="sv-header">
        <button
          type="button"
          className={`sv-deck-tile ${section === 'deck' ? 'is-active' : ''}`}
          aria-label="Daily card"
          aria-pressed={section === 'deck'}
          onClick={() => setSection('deck')}
        >
          <span className="sv-deck-monogram">
            <span className="sv-macron sv-macron-ink" aria-hidden="true" />
            Y
          </span>
        </button>

        <div className="sv-wordmark-stack">
          <div className="sv-wordmark">
            SPORTSV<span className="sv-y-volt">
              <span className="sv-macron sv-macron-volt" aria-hidden="true" />
              Y
            </span>N
          </div>
          <div className="sv-dateline">{dateline || ' '}</div>
        </div>

        <button
          type="button"
          className={`sv-avatar ${section === 'account' ? 'is-active' : ''}`}
          aria-label="My Sportsvyn"
          aria-pressed={section === 'account'}
          onClick={() => setSection('account')}
        >
          DS
        </button>
      </header>

      <main className="sv-stage">
        {section === 'deck'
          ? <Deck cards={cards} />
          : section === 'sched'
            ? <ScheduleView data={schedule} />
            : <div className="sv-placeholder">{PLACEHOLDERS[section]}</div>
        }
      </main>

      <nav className="sv-nav" aria-label="Primary">
        {NAV_ITEMS.map(({ id, label, Icon, href }) => {
          const isActive = section === id;
          const className = `sv-nav-item ${isActive ? 'is-active' : ''}`;
          const inner = (
            <>
              <span className="sv-nav-icon" aria-hidden="true"><Icon /></span>
              <span className="sv-nav-label">{label}</span>
            </>
          );
          if (href) {
            return (
              <Link key={id} href={href} className={className} aria-label={label}>
                {inner}
              </Link>
            );
          }
          return (
            <button
              key={id}
              type="button"
              className={className}
              aria-label={label}
              aria-pressed={isActive}
              onClick={() => setSection(id)}
            >
              {inner}
            </button>
          );
        })}
      </nav>
    </div>
  );
}

// ─── DECK ────────────────────────────────────────────────────────────────

function Deck({ cards }) {
  const railRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(0);

  const slots = [
    { key: 'today',  render: () => <CardTodaysCard data={cards.todaysCard} /> },
    { key: 'power',  render: () => <CardPower  rows={cards.power} /> },
    { key: 'player', render: () => <CardPlayers rows={cards.playerPot} /> },
    { key: 'watch',  render: () => <CardWatch  rows={cards.watch} /> },
    { key: 'read',   render: () => <CardRead   article={cards.read} /> },
    { key: 'stats',  render: () => <CardStats  data={cards.stats} /> },
  ];

  function onScroll() {
    const el = railRef.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < el.children.length; i++) {
      const c = el.children[i];
      const cCenter = c.offsetLeft + c.offsetWidth / 2;
      const dist = Math.abs(cCenter - center);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    }
    if (closest !== activeIdx) setActiveIdx(closest);
  }

  function jumpTo(i) {
    const el = railRef.current;
    if (!el) return;
    const c = el.children[i];
    if (!c) return;
    el.scrollTo({ left: c.offsetLeft - (el.clientWidth - c.offsetWidth) / 2, behavior: 'smooth' });
  }

  return (
    <div className="sv-deck-wrap">
      <div className="sv-deck" ref={railRef} onScroll={onScroll}>
        {slots.map(({ key, render }) => (
          <article key={key} className="sv-card">
            {render()}
          </article>
        ))}
      </div>

      <div className="sv-dots" role="tablist" aria-label="Card position">
        {slots.map((_, i) => (
          <button
            key={i}
            type="button"
            className={`sv-dot ${i === activeIdx ? 'is-active' : ''}`}
            aria-label={`Card ${i + 1} of ${slots.length}`}
            onClick={() => jumpTo(i)}
          />
        ))}
      </div>

      <div className="sv-deck-hint">← swipe · scroll inside →</div>
    </div>
  );
}

// ─── SCHEDULE VIEW (in-shell, interactive — Commit 2) ───────────────────────
// Replicates the website ScheduleClient's logic — lenses (Today / This Week /
// Following) + a 7-day scrubber + Stage/Group/Status filters + scorer pips —
// rebuilt in the deck's design language. All data is pre-shaped by
// readSchedule (server, PT-locked); the client does only PT-STRING date math
// for the scrubber window (no Date/TZ guessing, no KickoffTime, no FixtureCard
// / schedule.css import). Filter state is in-memory only (no URL mirroring —
// the shell never reloads, so there's nothing to deep-link). Defaults to TODAY.

// PT-string date helpers (operate on 'YYYY-MM-DD' — no timezone drift).
const SCHED_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SCHED_MONTHS   = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ptDateFromStr(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function ptDateToStr(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function addPtDays(s, n) { const d = ptDateFromStr(s); d.setUTCDate(d.getUTCDate() + n); return ptDateToStr(d); }
function clampPtDate(d, lo, hi) { if (lo && d < lo) return lo; if (hi && d > hi) return hi; return d; }

// Stage ordering + labels (mirrors the web ScheduleClient).
const SCHED_STAGE_ORDER = ['group', 'round-of-32', 'round-of-16', 'quarters', 'quarterfinals', 'semis', 'semifinals', 'third-place', 'final'];
const SCHED_STAGE_LABELS = {
  group: 'Group Stage', 'round-of-32': 'Round of 32', 'round-of-16': 'Round of 16',
  quarters: 'Quarters', quarterfinals: 'Quarters', semis: 'Semis', semifinals: 'Semis',
  final: 'Final', 'third-place': 'Third Place',
};
function schedStageLabel(s) {
  if (SCHED_STAGE_LABELS[s]) return SCHED_STAGE_LABELS[s];
  return String(s).split(/[-_]/g).map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : p)).join(' ');
}
const SCHED_GROUP_LETTERS  = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const SCHED_STATUS_OPTIONS = [
  { k: 'all', label: 'All' }, { k: 'live', label: 'Live' }, { k: 'upcoming', label: 'Upcoming' },
  { k: 'final', label: 'Final' }, { k: 'cancelled', label: 'Cancelled' },
];

function schedBucketOf(status) {
  if (status === 'live')      return 'live';
  if (status === 'final')     return 'final';
  if (status === 'cancelled') return 'cancelled';
  return 'upcoming';
}
function applySchedFilters(list, stageFilter, groupFilter) {
  let out = list;
  if (stageFilter !== 'all') out = out.filter((f) => f.stage === stageFilter);
  if (groupFilter !== 'all') out = out.filter((f) => f.group_code === groupFilter);
  return out;
}

function ScheduleView({ data }) {
  const days    = data?.days ?? [];
  const ptToday = data?.ptToday ?? '';
  const tournamentStart = data?.tournamentStart ?? ptToday;
  const tournamentEnd   = data?.tournamentEnd ?? ptToday;

  // Flat fixture list; each carries pt_day for day-filtering/grouping.
  const fixtures = useMemo(
    () => days.flatMap((d) => d.fixtures.map((f) => ({ ...f, pt_day: d.ptDay }))),
    [days],
  );
  // Days with ≥1 fixture → volt dot in the scrubber.
  const matchDaySet = useMemo(() => new Set(days.map((d) => d.ptDay)), [days]);

  const windowSize = 7;
  const lastWindowStart = clampPtDate(addPtDays(tournamentEnd, -(windowSize - 1)), tournamentStart, tournamentEnd);

  // DEFAULT TO TODAY: selected day = ptToday clamped into the tournament range
  // (pins to tournamentStart only when today is pre-tournament).
  const initialSelectedDay = clampPtDate(ptToday, tournamentStart, tournamentEnd);

  const [lens, setLens]                 = useState('today');
  const [ptDay, setPtDay]               = useState(initialSelectedDay);
  const [windowStart, setWindowStart]   = useState(clampPtDate(initialSelectedDay, tournamentStart, lastWindowStart));
  const [statusFilter, setStatusFilter] = useState('all');
  const [stageFilter, setStageFilter]   = useState('all');
  const [groupFilter, setGroupFilter]   = useState('all');

  // Distinct stages present, sorted by canonical tournament order.
  const availableStages = useMemo(() => {
    const set = new Set();
    for (const f of fixtures) if (f.stage) set.add(f.stage);
    return [...set].sort((a, b) => {
      const ia = SCHED_STAGE_ORDER.indexOf(a), ib = SCHED_STAGE_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [fixtures]);

  // Contiguous 7-day strip from windowStart — INCLUDES empty days (string math).
  const windowDays = useMemo(() => {
    const out = [];
    for (let i = 0; i < windowSize; i++) {
      const ds = addPtDays(windowStart, i);
      const d  = ptDateFromStr(ds);
      out.push({
        ptDate: ds,
        weekday: SCHED_WEEKDAYS[d.getUTCDay()],
        label: `${SCHED_MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
        isToday: ds === ptToday,
      });
    }
    return out;
  }, [windowStart, ptToday]);

  const canBack    = windowStart > tournamentStart;
  const canForward = windowStart < lastWindowStart;
  function slideBack()    { if (canBack)    setWindowStart(clampPtDate(addPtDays(windowStart, -windowSize), tournamentStart, lastWindowStart)); }
  function slideForward() { if (canForward) setWindowStart(clampPtDate(addPtDays(windowStart,  windowSize), tournamentStart, lastWindowStart)); }

  const content = useMemo(() => {
    if (lens === 'today') return renderTodayLens(fixtures, statusFilter, stageFilter, groupFilter, ptDay);
    if (lens === 'week')  return renderWeekLens(fixtures, statusFilter, stageFilter, groupFilter, windowDays, ptToday);
    return renderFollowingLens();
  }, [lens, ptDay, statusFilter, stageFilter, groupFilter, fixtures, windowDays, ptToday]);

  // Hooks above are unconditional; only the render branches on emptiness.
  if (!data || days.length === 0) {
    return (
      <div className="sv-sched">
        <div className="sv-sched-empty">No fixtures scheduled yet.</div>
      </div>
    );
  }

  const stageValue  = stageFilter  === 'all' ? 'All' : schedStageLabel(stageFilter);
  const groupValue  = groupFilter  === 'all' ? 'All' : groupFilter;
  const statusValue = statusFilter === 'all' ? 'All' : (SCHED_STATUS_OPTIONS.find((s) => s.k === statusFilter)?.label ?? statusFilter);

  return (
    <div className="sv-sched">
      {/* Fixed control zone — does NOT scroll with the list. */}
      <div className="sv-sched-controls">
        <div className="sv-sched-lenstabs" role="tablist" aria-label="Schedule lens">
          {[{ k: 'today', label: 'Today' }, { k: 'week', label: 'This Week' }, { k: 'following', label: 'Following' }].map((l) => (
            <button
              key={l.k}
              type="button"
              role="tab"
              aria-selected={lens === l.k}
              className={`sv-sched-lens ${lens === l.k ? 'is-on' : ''}`}
              onClick={() => setLens(l.k)}
            >
              {l.label}
            </button>
          ))}
        </div>

        {(lens === 'today' || lens === 'week') && (
          <div className="sv-sched-scrub">
            <button type="button" className="sv-sched-arrow" aria-label="Previous week" disabled={!canBack} onClick={slideBack}>‹</button>
            <div className="sv-sched-days">
              {windowDays.map((d) => {
                const isSel = d.ptDate === ptDay && lens === 'today';
                return (
                  <button
                    key={d.ptDate}
                    type="button"
                    className={`sv-sched-daycell ${isSel ? 'is-sel' : ''}`}
                    onClick={() => setPtDay(d.ptDate)}
                  >
                    <span className="sv-sched-cw">{d.weekday}{d.isToday ? ' · Today' : ''}</span>
                    <span className="sv-sched-cn">{d.label}</span>
                    {matchDaySet.has(d.ptDate) && <span className="sv-sched-cdot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
            <button type="button" className="sv-sched-arrow" aria-label="Next week" disabled={!canForward} onClick={slideForward}>›</button>
          </div>
        )}

        {(lens === 'today' || lens === 'week') && (
          <div className="sv-sched-filters">
            <SchedSelect label="Stage" value={stageValue} active={stageFilter !== 'all'}>
              {(close) => (
                <>
                  <SchedOpt on={stageFilter === 'all'} onClick={() => { setStageFilter('all'); close(); }}>All</SchedOpt>
                  {availableStages.map((s) => (
                    <SchedOpt key={s} on={stageFilter === s} onClick={() => { setStageFilter(s); close(); }}>{schedStageLabel(s)}</SchedOpt>
                  ))}
                </>
              )}
            </SchedSelect>
            <SchedSelect label="Group" value={groupValue} active={groupFilter !== 'all'}>
              {(close) => (
                <>
                  <SchedOpt on={groupFilter === 'all'} onClick={() => { setGroupFilter('all'); close(); }}>All</SchedOpt>
                  <div className="sv-sched-ddgrid">
                    {SCHED_GROUP_LETTERS.map((g) => (
                      <SchedOpt key={g} on={groupFilter === g} grid onClick={() => { setGroupFilter(g); close(); }}>{g}</SchedOpt>
                    ))}
                  </div>
                </>
              )}
            </SchedSelect>
            <SchedSelect label="Status" value={statusValue} active={statusFilter !== 'all'}>
              {(close) => (
                <>
                  {SCHED_STATUS_OPTIONS.map((s) => (
                    <SchedOpt key={s.k} on={statusFilter === s.k} onClick={() => { setStatusFilter(s.k); close(); }}>{s.label}</SchedOpt>
                  ))}
                </>
              )}
            </SchedSelect>
          </div>
        )}
      </div>

      {/* Scrolling match list. */}
      <div className="sv-sched-scroll">{content}</div>
    </div>
  );
}

// TODAY lens — selected day, split into status sections (self-hiding when
// empty), in order: Live Now → Upcoming → Full Time → Cancelled.
// NOTE: the web ScheduleClient has a bug where its grouped{} omits the `live`
// key, so its "Live Now" section never populates — fixed here.
function renderTodayLens(fixtures, statusFilter, stageFilter, groupFilter, ptDay) {
  let list = applySchedFilters(fixtures, stageFilter, groupFilter).filter((f) => f.pt_day === ptDay);
  if (statusFilter !== 'all') list = list.filter((f) => schedBucketOf(f.status) === statusFilter);
  if (list.length === 0) return <div className="sv-sched-empty">No matches match these filters.</div>;
  const grouped = {
    live:      list.filter((f) => schedBucketOf(f.status) === 'live'),
    upcoming:  list.filter((f) => schedBucketOf(f.status) === 'upcoming'),
    final:     list.filter((f) => schedBucketOf(f.status) === 'final'),
    cancelled: list.filter((f) => schedBucketOf(f.status) === 'cancelled'),
  };
  return (
    <>
      <SchedStatusSection title="Live Now"  items={grouped.live}      modifier="is-live" />
      <SchedStatusSection title="Upcoming"  items={grouped.upcoming} />
      <SchedStatusSection title="Full Time" items={grouped.final} />
      <SchedStatusSection title="Cancelled" items={grouped.cancelled} modifier="is-cancelled" />
    </>
  );
}

// THIS WEEK lens — the visible window, one day-section per non-empty day.
function renderWeekLens(fixtures, statusFilter, stageFilter, groupFilter, windowDays, ptToday) {
  let list = applySchedFilters(fixtures, stageFilter, groupFilter);
  if (statusFilter !== 'all') list = list.filter((f) => schedBucketOf(f.status) === statusFilter);
  const byDay = new Map();
  for (const f of list) {
    if (!byDay.has(f.pt_day)) byDay.set(f.pt_day, []);
    byDay.get(f.pt_day).push(f);
  }
  const sections = [];
  for (const d of windowDays) {
    const items = byDay.get(d.ptDate);
    if (!items || items.length === 0) continue;
    sections.push(
      <section key={d.ptDate} className="sv-sched-day">
        <div className={`sv-sched-dayhead ${d.isToday ? 'is-today' : ''}`}>
          <span className="sv-sched-daylabel">{d.weekday} · {d.label}{d.isToday ? ' · Today' : ''}</span>
          <span className="sv-sched-dayrule" aria-hidden="true" />
          <span className="sv-sched-daycount">{items.length} {items.length === 1 ? 'match' : 'matches'}</span>
        </div>
        <div className="sv-sched-list">
          {items.map((f) => <ScheduleMatchRow key={f.id} f={f} />)}
        </div>
      </section>,
    );
  }
  if (sections.length === 0) return <div className="sv-sched-empty">No matches in this week match these filters.</div>;
  return <>{sections}</>;
}

// FOLLOWING lens — placeholder for now (matches the web; real follow-filtering
// is a later commit). Per-fixture followed flags already ride in, but Following
// is its own slice we build out separately.
function renderFollowingLens() {
  return (
    <div className="sv-sched-empty">
      Following nations · coming with the World Cup slate.
      <br />
      One nation will show its full path, several blend into a single timeline.
    </div>
  );
}

function SchedStatusSection({ title, items, modifier }) {
  if (items.length === 0) return null;
  return (
    <section className="sv-sched-day">
      <div className="sv-sched-dayhead">
        <span className={`sv-sched-daylabel ${modifier ?? ''}`}>{title}</span>
        <span className="sv-sched-dayrule" aria-hidden="true" />
        <span className="sv-sched-daycount">{items.length}</span>
      </div>
      <div className="sv-sched-list">
        {items.map((f) => <ScheduleMatchRow key={f.id} f={f} />)}
      </div>
    </section>
  );
}

// Compact dropdown filter — closes on outside-click / Escape. In-shell only,
// no URL state.
function SchedSelect({ label, value, active, children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e) { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);
  return (
    <div className={`sv-sched-dd ${open ? 'is-open' : ''} ${active ? 'is-active' : ''}`} ref={rootRef}>
      <button type="button" className="sv-sched-ddbtn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="sv-sched-ddlabel">{label}</span>
        <span className="sv-sched-ddval">{value}</span>
        <span className="sv-sched-ddcaret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="sv-sched-ddpanel" role="menu" onClick={(e) => e.stopPropagation()}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
function SchedOpt({ on, grid, onClick, children }) {
  return (
    <button type="button" className={`sv-sched-ddopt ${grid ? 'sv-sched-ddopt--grid' : ''} ${on ? 'is-on' : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}

// One fixture — a stacked two-line matchup (home over away) so FULL country
// names get their own line and wrap gracefully. Scorer pips render beneath
// when goals exist (home scorers left, away right). Plain <a> (stays in-
// WebView via allowNavigation; NOT a Next <Link>).
function ScheduleMatchRow({ f }) {
  const hasGoals = (f.goals.home.length + f.goals.away.length) > 0;
  return (
    <a className="sv-sched-row" href={`/match/${f.slug}`}>
      <div className="sv-sched-main">
        <div className="sv-sched-teams">
          <div className="sv-sched-team">
            <FlagSvg path={f.home.flag_svg_path} />
            <span className={`sv-sched-name ${f.home.followed ? 'sv-followed' : ''}`}>
              {f.home.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {f.home.name}
            </span>
            <span className="sv-sched-score">{scoreOrBlank(f, f.home_score)}</span>
          </div>
          <div className="sv-sched-team">
            <FlagSvg path={f.away.flag_svg_path} />
            <span className={`sv-sched-name ${f.away.followed ? 'sv-followed' : ''}`}>
              {f.away.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {f.away.name}
            </span>
            <span className="sv-sched-score">{scoreOrBlank(f, f.away_score)}</span>
          </div>
        </div>
        <div className="sv-sched-meta">
          {f.isLive
            ? <span className="sv-live-tag">● LIVE</span>
            : f.isFinal
              ? <span className="sv-sched-status">Full Time</span>
              : <span className="sv-sched-time">{f.kickoffLabel}</span>}
        </div>
      </div>
      {hasGoals && (
        <div className="sv-sched-goals">
          <div className="sv-sched-goalcol">
            {f.goals.home.map((g, i) => (
              <div key={`h-${i}`} className="sv-sched-goal"><span className="sv-sched-gpip" aria-hidden="true" />{g}</div>
            ))}
          </div>
          <div className="sv-sched-goalcol sv-sched-goalcol--away">
            {f.goals.away.map((g, i) => (
              <div key={`a-${i}`} className="sv-sched-goal"><span className="sv-sched-gpip" aria-hidden="true" />{g}</div>
            ))}
          </div>
        </div>
      )}
    </a>
  );
}

// Per-side score: shown only once a match is live or final (0 is a real
// score, so guard on null, not falsiness). Scheduled / cancelled → blank.
function scoreOrBlank(f, score) {
  if (!f.isLive && !f.isFinal) return '';
  return score == null ? '' : score;
}

// ─── CARDS ───────────────────────────────────────────────────────────────

// TODAY'S CARD — the deck's lead card. Mirrors the homepage's daily-card
// Header (kicker + dateline) + SlateSection (slate label + match rows),
// restyled in the deck's own design language. All time/date strings arrive
// pre-formatted from readTodaysCard (server, PT-locked) — no client Date math.
function CardTodaysCard({ data }) {
  // readTodaysCard never returns null (empty slate → count 0); the guard is
  // purely defensive against a data-load failure.
  if (!data) {
    return <EmptyCard kicker="Today&rsquo;s Card" message="Today&rsquo;s slate posts soon." accent />;
  }
  const { dateline, fixtures, count } = data;
  return (
    <div className="sv-card-body sv-card--accent">
      <div className="sv-kicker">Today&rsquo;s Card</div>
      <div className="sv-meta">{dateline}</div>

      <div className="sv-section-label">
        Today&rsquo;s Slate · {count} {count === 1 ? 'Match' : 'Matches'}
      </div>

      {count === 0 ? (
        <div className="sv-today-empty">No matches today</div>
      ) : (
        <div className="sv-matchlist">
          {fixtures.map((f) => <TodayMatchRow key={f.id} f={f} />)}
        </div>
      )}
    </div>
  );
}

// One slate row — plain <a> (stays in-WebView via the allowNavigation fix;
// deliberately NOT a Next <Link>, we want the real /match navigation).
function TodayMatchRow({ f }) {
  const right = f.isFinal
    ? `FT ${f.home_score ?? 0}–${f.away_score ?? 0}`
    : f.isLive
      ? `${f.home_score ?? 0}–${f.away_score ?? 0}`
      : f.kickoffLabel;
  return (
    <a className="sv-match-row" href={`/match/${f.slug}`}>
      <span className="sv-match-teams">
        <FlagSvg path={f.home.flag_svg_path} />
        <span className={f.home.followed ? 'sv-followed' : undefined}>
          {f.home.followed && <span className="sv-star" aria-hidden="true">★</span>}
          {teamShort(f.home.name, f.home.abbreviation)}
        </span>
        <span className="sv-vs"> v </span>
        <FlagSvg path={f.away.flag_svg_path} />
        <span className={f.away.followed ? 'sv-followed' : undefined}>
          {f.away.followed && <span className="sv-star" aria-hidden="true">★</span>}
          {teamShort(f.away.name, f.away.abbreviation)}
        </span>
        {f.isLive && <span className="sv-live-tag">· LIVE</span>}
      </span>
      <span className="sv-match-right">{right}</span>
      <span className="sv-match-ws">
        {f.watchScore != null ? f.watchScore.toFixed(1) : ''}
      </span>
    </a>
  );
}

function CardPower({ rows }) {
  if (!rows || rows.length === 0) {
    return <EmptyCard kicker="Power Rankings · Top 5" message="Rankings publish before the opener." />;
  }
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Power Rankings · Top 5</div>
      <h2 className="sv-title">The favorites, ranked</h2>
      <ol className="sv-ranklist">
        {rows.map((r) => (
          <li key={r.rank} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{r.rank}</span>
            <FlagSvg path={r.flag_svg_path} />
            <span className="sv-rank-name">
              {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {r.name}
            </span>
            <span className="sv-rank-score">{r.score.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardPlayers({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyCard
        kicker="Player of the Tournament · Top 5"
        message="Player of the Tournament — rankings begin once matches kick off."
      />
    );
  }
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Player of the Tournament · Top 5</div>
      <h2 className="sv-title">Who&rsquo;s running away with it</h2>
      <ol className="sv-ranklist sv-ranklist--players">
        {rows.map((r) => (
          <li key={r.rank} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{r.rank}</span>
            <div className="sv-player-meta">
              <span className="sv-rank-name">
                {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
                {r.name}
              </span>
              <span className="sv-rank-sub">
                {[r.country, r.pos].filter(Boolean).join(' · ')}
              </span>
            </div>
            <span className="sv-rank-score">{r.score.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardWatch({ rows }) {
  if (!rows || rows.length === 0) {
    return (
      <EmptyCard
        kicker="Watch Scores · Today"
        message="No matches scored yet today — back when kickoffs land."
      />
    );
  }
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Watch Scores · Today</div>
      <h2 className="sv-title">What&rsquo;s worth your time</h2>
      <ol className="sv-ranklist sv-ranklist--matches">
        {rows.map((r, i) => (
          <li key={i} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{i + 1}</span>
            <span className="sv-rank-name">
              {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {r.home} v {r.away}
            </span>
            <span className="sv-rank-score">{r.score.toFixed(1)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function CardRead({ article }) {
  if (!article) {
    return <EmptyCard kicker="The Read" message="First longform lands soon." />;
  }
  const footerBits = [
    'Sportsvyn',
    `${article.words.toLocaleString()} words`,
    `${article.read_time_min} min`,
  ];
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">{article.kicker}</div>
      <h2 className="sv-title sv-title--longform">{article.title}</h2>
      {article.excerpt && <p className="sv-lede">{article.excerpt}</p>}
      <div className="sv-card-footer">{footerBits.join(' · ')}</div>
    </div>
  );
}

function CardStats({ data }) {
  if (!data || !data.scorers || data.scorers.length === 0) {
    return <EmptyCard kicker="Golden Boot · Top 5" message="Scorers populate as matches play." />;
  }
  const { scorers, matches_played, total_goals, avg_goals_per_match } = data;
  const footerBits = [
    `${matches_played} ${matches_played === 1 ? 'match' : 'matches'}`,
    `${total_goals} goals`,
    `${avg_goals_per_match} per game`,
  ];
  return (
    <div className="sv-card-body">
      <div className="sv-kicker">Golden Boot · Top 5</div>
      <h2 className="sv-title">The race for the Golden Boot</h2>
      <ol className="sv-ranklist">
        {scorers.map((r, i) => (
          <li key={`${r.name}-${i}`} className={`sv-rankrow ${r.followed ? 'is-followed' : ''}`}>
            <span className="sv-rank-num">{i + 1}</span>
            <FlagSvg path={r.flag_svg_path} />
            <span className="sv-rank-name">
              {r.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {r.name}
            </span>
            <span className="sv-rank-score">{r.goals}</span>
          </li>
        ))}
      </ol>
      <div className="sv-card-footer">{footerBits.join(' · ')}</div>
    </div>
  );
}

// ─── PRIMITIVES ──────────────────────────────────────────────────────────

// Short team label for slate rows: abbreviation when present, else the
// first three letters of the name, upper-cased. Mirrors the homepage's
// teamShort intent (abbr-first) but with the deck's compact 3-char fallback
// so a row never widens out to a full country name.
function teamShort(name, abbr) {
  if (abbr && abbr.length > 0) return abbr;
  if (!name) return '—';
  return name.slice(0, 3).toUpperCase();
}

function EmptyCard({ kicker, message, accent = false }) {
  return (
    <div className={`sv-card-body ${accent ? 'sv-card--accent' : ''}`}>
      <div className="sv-kicker">{kicker}</div>
      <div className="sv-empty">{message}</div>
    </div>
  );
}

function FlagSvg({ path }) {
  if (!path) return <span className="sv-flag-svg sv-flag-svg--empty" aria-hidden="true" />;
  return (
    <span
      className="sv-flag-svg"
      aria-hidden="true"
      style={{ backgroundImage: `url(${path})` }}
    />
  );
}

// ─── NAV ICONS ──────────────────────────────────────────────────────────

function IconSched() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </svg>
  );
}
function IconBracket() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h3l2 6-2 6H3" />
      <path d="M21 6h-3l-2 6 2 6h3" />
      <path d="M9 12h6" />
    </svg>
  );
}
function IconRankings() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 21V11" /><path d="M12 21V5" /><path d="M19 21v-7" />
    </svg>
  );
}
function IconRead() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 5h7v15H4z" /><path d="M13 5h7v15h-7z" />
      <path d="M4 8h7M13 8h7" />
    </svg>
  );
}
