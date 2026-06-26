'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { loadMatch, loadRankings, loadBracket } from './actions';

// Lets deeply-nested rows (Today's Card rows, Schedule rows) open the in-shell
// match view without prop-drilling through Deck / ScheduleView render helpers.
const MatchNavContext = createContext(null);

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
  { id: 'bracket',  label: 'Bracket',   Icon: IconBracket },
  { id: 'rankings', label: 'Rankings',  Icon: IconRankings },
  { id: 'read',     label: 'Read',      Icon: IconRead },
];

const DAYS_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER'];

export default function AppShellClient({ cards, schedule }) {
  const [section, setSection] = useState('deck');
  const [dateline, setDateline] = useState('');

  // ─ In-shell match view: section gains a 'match' value + a target slug,
  //   on-demand data via the loadMatch server action, cached per slug. ─
  const [matchSlug, setMatchSlug]       = useState(null);
  const [matchReturn, setMatchReturn]   = useState('deck');
  const [matchData, setMatchData]       = useState(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [matchError, setMatchError]     = useState(false);
  const matchCache = useRef(new Map());   // slug → assembled data (instant re-open)
  const reqSlug    = useRef(null);        // guards against stale awaits clobbering

  async function openMatch(slug) {
    if (!slug) return;
    setMatchReturn(section);     // remember where we came from for Back
    setMatchSlug(slug);
    setSection('match');
    setMatchError(false);
    reqSlug.current = slug;

    const cached = matchCache.current.get(slug);
    if (cached) { setMatchData(cached); setMatchLoading(false); return; }

    setMatchData(null);
    setMatchLoading(true);
    try {
      const data = await loadMatch(slug);
      if (reqSlug.current !== slug) return;   // a newer open superseded this one
      if (data) { matchCache.current.set(slug, data); setMatchData(data); }
      else setMatchError(true);
    } catch {
      if (reqSlug.current === slug) setMatchError(true);
    } finally {
      if (reqSlug.current === slug) setMatchLoading(false);
    }
  }
  function closeMatch() { setSection(matchReturn); }

  // ─ Live poll: re-call the DB-only loadMatch every 60s ONLY while a live
  //   match is open. Rides the poll-live cron's per-minute DB writes — no
  //   API-Sports call, no /api/sync/fixture, no KickoffWatcher. Wholesale-
  //   replaces matchData (static fields return identical → no flicker).
  //   STOPS via three paths, all caught by the deps + cleanup:
  //     · Back / nav tab     → `section` changes
  //     · open another match → `matchSlug` changes
  //     · full-time          → next snapshot's `state` !== 'live'
  useEffect(() => {
    if (section !== 'match' || matchData?.state !== 'live') return;
    let cancelled = false;
    const slug = matchSlug;
    const id = setInterval(async () => {
      const fresh = await loadMatch(slug);
      if (cancelled || reqSlug.current !== slug) return;   // stale guard (Commit 1's ref)
      if (fresh) { matchCache.current.set(slug, fresh); setMatchData(fresh); }
    }, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, [section, matchSlug, matchData?.state]);

  // ─ Rankings: lazy-loaded once on first tap of the Rankings tab (NOT in
  //   /app's Promise.all). Cached for the session — editions only change
  //   after a matchday, so no re-fetch on revisit. Same on-demand+cache
  //   shape as the match view, but paramless (one payload).
  const [rankingsData, setRankingsData]       = useState(null);
  const [rankingsLoading, setRankingsLoading] = useState(false);
  const [rankingsError, setRankingsError]     = useState(false);
  const rankingsLoaded = useRef(false);   // loaded-once guard
  useEffect(() => {
    if (section !== 'rankings' || rankingsLoaded.current) return;
    let cancelled = false;
    rankingsLoaded.current = true;
    setRankingsError(false);
    setRankingsLoading(true);
    (async () => {
      try {
        const data = await loadRankings();
        if (cancelled) return;
        if (data) setRankingsData(data);
        else { setRankingsError(true); rankingsLoaded.current = false; }
      } catch {
        if (!cancelled) { setRankingsError(true); rankingsLoaded.current = false; }
      } finally {
        if (!cancelled) setRankingsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section]);

  // ─ Bracket: lazy-loaded once on first tap (same pattern as Rankings).
  //   Tradeoff: loaded-once means newly-resolved knockout slots (filled by
  //   the cron as matches finish) won't appear without reopening the app —
  //   acceptable for v1 (same staleness tolerance as Rankings; we don't poll).
  const [bracketData, setBracketData]       = useState(null);
  const [bracketLoading, setBracketLoading] = useState(false);
  const [bracketError, setBracketError]     = useState(false);
  const bracketLoaded = useRef(false);
  useEffect(() => {
    if (section !== 'bracket' || bracketLoaded.current) return;
    let cancelled = false;
    bracketLoaded.current = true;
    setBracketError(false);
    setBracketLoading(true);
    (async () => {
      try {
        const data = await loadBracket();
        if (cancelled) return;
        if (data) setBracketData(data);
        else { setBracketError(true); bracketLoaded.current = false; }
      } catch {
        if (!cancelled) { setBracketError(true); bracketLoaded.current = false; }
      } finally {
        if (!cancelled) setBracketLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [section]);

  useEffect(() => {
    const now = new Date();
    setDateline(`${DAYS_SHORT[now.getDay()]} · ${MONTHS[now.getMonth()]} ${now.getDate()}`);
  }, []);

  return (
    <MatchNavContext.Provider value={openMatch}>
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
            : section === 'match'
              ? <MatchView data={matchData} loading={matchLoading} error={matchError} onBack={closeMatch} />
              : section === 'rankings'
                ? <RankingsView data={rankingsData} loading={rankingsLoading} error={rankingsError} />
                : section === 'bracket'
                  ? <BracketView data={bracketData} loading={bracketLoading} error={bracketError} />
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
    </MatchNavContext.Provider>
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
  const openMatch = useContext(MatchNavContext);
  const hasGoals = (f.goals.home.length + f.goals.away.length) > 0;
  // Keep the real href (accessible + JS-off fallback) but intercept the tap
  // to open the match IN-SHELL instead of navigating out to the website.
  const onClick = (e) => { if (openMatch) { e.preventDefault(); openMatch(f.slug); } };
  return (
    <a className="sv-sched-row" href={`/match/${f.slug}`} onClick={onClick}>
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

// ─── MATCH VIEW (in-shell, on-demand — Commit 1: pre-match + recap) ─────────
// Reached by tapping a Today's Card / Schedule row (openMatch via context).
// Data arrives from the loadMatch server action (assembled by readMatch). All
// times are pre-formatted PT server-side. LEAN static modules only — live
// polling is Commit 2. Built in the deck's design language (no match.css).

// Client-side relative time for the recap byline. MatchView never SSRs (it
// only mounts on a client tap, section!=='match' at first paint), so Date.now()
// here can't cause a hydration mismatch.
function relTime(ts) {
  const then = new Date(ts).getTime();
  if (Number.isNaN(then)) return '';
  const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  const min = Math.round(diffSec / 60); if (min < 60) return rtf.format(-min, 'minute');
  const hr  = Math.round(min / 60);     if (hr < 48)  return rtf.format(-hr, 'hour');
  return rtf.format(-Math.round(hr / 24), 'day');
}

function MatchView({ data, loading, error, onBack }) {
  return (
    <div className="sv-match">
      <button type="button" className="sv-match-back" onClick={onBack}>‹ Back</button>
      {loading ? (
        <div className="sv-match-status-msg">
          <span className="sv-match-spinner" aria-hidden="true" />
          Loading match…
        </div>
      ) : error || !data ? (
        <div className="sv-match-status-msg">Couldn&rsquo;t load this match.</div>
      ) : (
        <MatchBody data={data} />
      )}
    </div>
  );
}

// Period labels for the live clock (mirrors LiveHero's PERIOD_LABELS subset).
const SV_PERIOD = {
  '1H': '1st Half', 'HT': 'Half-time', '2H': '2nd Half', 'ET': 'Extra Time',
  'BT': 'Break', 'P': 'Penalties', 'SUSP': 'Suspended', 'INT': 'Interrupted',
};
function liveClockLabel(lc) {
  if (!lc) return 'Live';
  const clock = lc.minute != null
    ? (lc.minute_extra ? `${lc.minute}+${lc.minute_extra}'` : `${lc.minute}'`)
    : null;
  const period = SV_PERIOD[lc.status_short] ?? null;
  if (clock && period) return `${clock} · ${period}`;
  return clock || period || 'Live';
}

function MatchBody({ data }) {
  const {
    state, header, meta, watchScore, preview, winProb, whereToWatch, brief,
    liveClock, liveWatch, keyMoments,
  } = data;
  const isLive  = state === 'live';
  const isRecap = state === 'recap';
  const showScore = isLive || isRecap;
  const moments = keyMoments ?? [];
  return (
    <>
      <div className="sv-match-head">
        <div className="sv-match-teams2">
          <div className={`sv-match-team ${header.favored === 'home' ? 'is-favored' : ''}`}>
            <FlagSvg path={header.home.flag_svg_path} />
            <span className={`sv-match-tname ${header.home.followed ? 'sv-followed' : ''}`}>
              {header.home.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {header.home.name}
            </span>
          </div>
          <div className="sv-match-mid">
            {showScore
              ? <span className="sv-match-bigscore">{header.home_score ?? 0}<span className="sv-match-dash">–</span>{header.away_score ?? 0}</span>
              : <span className="sv-match-vsbig">v</span>}
          </div>
          <div className={`sv-match-team ${header.favored === 'away' ? 'is-favored' : ''}`}>
            <FlagSvg path={header.away.flag_svg_path} />
            <span className={`sv-match-tname ${header.away.followed ? 'sv-followed' : ''}`}>
              {header.away.followed && <span className="sv-star" aria-hidden="true">★</span>}
              {header.away.name}
            </span>
          </div>
        </div>

        <div className={`sv-match-statusline ${isLive ? 'is-live' : ''}`}>
          {isLive
            ? <><span className="sv-match-livepulse" aria-hidden="true" />{liveClockLabel(liveClock)}</>
            : isRecap ? 'Full Time' : meta.kickoffLabel}
        </div>
        {(meta.stage || meta.venue) && (
          <div className="sv-match-metaline">
            {[meta.stage && schedStageLabel(meta.stage), meta.venue].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>

      {/* Watch score: editorial analyst score pre-match; the LIVE tick score
          during live + recap (latest while live, peak at FT). */}
      {state === 'prematch' && watchScore && <MatchWatchScore ws={watchScore} />}
      {(isLive || isRecap) && liveWatch && <MatchLiveWatch liveWatch={liveWatch} mode={isRecap ? 'recap' : 'live'} />}

      {/* PRE-MATCH body */}
      {state === 'prematch' && (
        <>
          {preview && (preview.lede || preview.paragraphs.length > 0) && (
            <div className="sv-match-block">
              <div className="sv-kicker">Preview</div>
              {preview.lede && <p className="sv-lede">{preview.lede}</p>}
              {preview.paragraphs.map((p, i) => <p key={i} className="sv-body">{p}</p>)}
            </div>
          )}
          {winProb && <MatchWinProb wp={winProb} homeName={header.home.name} awayName={header.away.name} />}
          {whereToWatch && whereToWatch.length > 0 && (
            <div className="sv-match-block">
              <div className="sv-kicker">Where to Watch</div>
              <div className="sv-match-bcasts">
                {whereToWatch.map((b, i) => (
                  <span key={i} className={`sv-match-bcast ${b.primary ? 'is-primary' : ''}`}>{b.name}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* LIVE body: frozen consensus win-prob + the live timeline. */}
      {isLive && (
        <>
          {winProb && <MatchWinProb wp={winProb} homeName={header.home.name} awayName={header.away.name} />}
          {moments.length > 0 && <MatchKeyMoments moments={moments} />}
        </>
      )}

      {/* RECAP body: the brief, then the final timeline. */}
      {isRecap && (
        <>
          {brief ? (
            <div className="sv-match-block">
              <div className="sv-kicker">Recap</div>
              <h2 className="sv-title sv-title--longform">{brief.headline}</h2>
              <div className="sv-match-byline">
                By Sportsvyn · Auto-generated{brief.published_at ? ` · ${relTime(brief.published_at)}` : ''}
              </div>
              {brief.paragraphs.map((p, i) => <p key={i} className="sv-body">{p}</p>)}
            </div>
          ) : (
            <div className="sv-match-block">
              <div className="sv-empty">Recap publishes after full time.</div>
            </div>
          )}
          {moments.length > 0 && <MatchKeyMoments moments={moments} />}
        </>
      )}
    </>
  );
}

function MatchWatchScore({ ws }) {
  const DIMS = [
    ['stakes', 'Stakes'], ['quality', 'Quality'], ['narrative', 'Narrative'],
    ['drama', 'Drama'], ['moment', 'Moment'],
  ];
  return (
    <div className="sv-match-block">
      <div className="sv-kicker">Watch Score</div>
      <div className="sv-match-wsrow">
        <span className="sv-match-wsnum">{ws.composite.toFixed(1)}</span>
        {ws.summary && <p className="sv-match-wssum">{ws.summary}</p>}
      </div>
      <div className="sv-match-dims">
        {DIMS.filter(([k]) => ws.dims[k] != null).map(([k, label]) => (
          <div key={k} className="sv-match-dim">
            <span className="sv-match-dimval">{Number(ws.dims[k]).toFixed(1)}</span>
            <span className="sv-match-dimlabel">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchWinProb({ wp, homeName, awayName }) {
  return (
    <div className="sv-match-block">
      <div className="sv-kicker">Win Probability</div>
      <div className="sv-probbar" aria-label="Win probability">
        <span className="sv-probbar-seg sv-probbar-home" style={{ width: `${wp.home_pct}%` }} />
        <span className="sv-probbar-seg sv-probbar-draw" style={{ width: `${wp.draw_pct}%` }} />
        <span className="sv-probbar-seg sv-probbar-away" style={{ width: `${wp.away_pct}%` }} />
      </div>
      <div className="sv-prob-legend">
        <span><strong>{homeName}</strong> {Math.round(wp.home_pct)}%</span>
        <span><strong>Draw</strong> {Math.round(wp.draw_pct)}%</span>
        <span><strong>{awayName}</strong> {Math.round(wp.away_pct)}%</span>
      </div>
    </div>
  );
}

// LIVE watch score — from the live tick series (NOT the editorial composite).
// Live: latest tick + trend-from-kickoff. Recap: peak, frozen. A small SVG
// sparkline draws when there are ≥3 ticks.
function MatchLiveWatch({ liveWatch, mode }) {
  const series = liveWatch.series;
  let num, trendGlyph, trendLabel, trendDetail;
  if (mode === 'recap') {
    num = series.reduce((mx, r) => (r.composite > mx ? r.composite : mx), -Infinity);
    trendGlyph = '●'; trendLabel = 'Final'; trendDetail = `peaked at ${num.toFixed(1)}`;
  } else {
    num = liveWatch.latest.composite;
    const delta = num - liveWatch.baseline;
    if (delta > 0.3)       { trendGlyph = '▲'; trendLabel = 'Climbing'; trendDetail = `+${delta.toFixed(1)} from kickoff`; }
    else if (delta < -0.3) { trendGlyph = '▼'; trendLabel = 'Cooling';  trendDetail = `${delta.toFixed(1)} from kickoff`; }
    else                   { trendGlyph = '●'; trendLabel = 'Steady';   trendDetail = null; }
  }
  const spark = buildSparkPath(series);
  return (
    <div className="sv-match-block">
      <div className="sv-match-lwhead">
        <span className="sv-kicker">Live Watch Score</span>
        {mode === 'live' && (
          <span className="sv-match-lwtag"><span className="sv-match-livepulse" aria-hidden="true" />Live Now</span>
        )}
      </div>
      <div className="sv-match-lwrow">
        <span className="sv-match-wsnum">{num.toFixed(1)}</span>
        <span className="sv-match-lwtrend">
          {trendGlyph} {trendLabel}{trendDetail ? ` · ${trendDetail}` : ''}
        </span>
      </div>
      {spark && (
        <svg className="sv-match-spark" viewBox="0 0 280 60" preserveAspectRatio="none" aria-hidden="true">
          <path d={spark.fill} fill="rgba(212,255,0,0.16)" />
          <path d={spark.line} fill="none" stroke="#D4FF00" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <circle cx={spark.last.x} cy={spark.last.y} r="3.5" fill="#D4FF00" />
        </svg>
      )}
    </div>
  );
}

// Minimal data-scaled sparkline (index on X, composite on Y). Returns null
// under 3 ticks (caller renders number + trend without a degenerate line).
function buildSparkPath(series) {
  if (!series || series.length < 3) return null;
  const W = 280, H = 60, PADX = 2, PADT = 6, PADB = 8;
  const ys = series.map((r) => r.composite);
  const yMin = Math.min(...ys), yMax = Math.max(...ys), ySpan = (yMax - yMin) || 1;
  const dW = W - PADX * 2, dH = H - PADT - PADB, baseY = H - PADB;
  const pts = series.map((r, i) => ({
    x: PADX + (i / (series.length - 1)) * dW,
    y: PADT + dH - ((r.composite - yMin) / ySpan) * dH,
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1], first = pts[0];
  const fill = `${line} L${last.x.toFixed(1)},${baseY} L${first.x.toFixed(1)},${baseY} Z`;
  return { line, fill, last };
}

// Key-moments timeline (newest-first). Goal/card pips + player + AI gloss.
function MatchKeyMoments({ moments }) {
  return (
    <div className="sv-match-block">
      <div className="sv-kicker">Key Moments</div>
      <div className="sv-match-moments">
        {moments.map((e) => <MatchMomentRow key={e.id} e={e} />)}
      </div>
    </div>
  );
}
function momentKind(e) {
  if (e.event_type === 'Goal') return 'goal';
  if (e.event_type === 'Card') return (e.detail || '').toLowerCase().includes('red') ? 'red' : 'yellow';
  if (e.event_type === 'subst') return 'sub';
  return 'other';
}
function momentLabel(e) {
  if (e.event_type === 'Goal') return e.detail && e.detail !== 'Normal Goal' ? e.detail : 'Goal';
  if (e.event_type === 'Card') return e.detail || 'Card';
  if (e.event_type === 'subst') return 'Substitution';
  return e.detail || e.event_type;
}
function MatchMomentRow({ e }) {
  const min = e.minute_extra
    ? `${e.minute}+${e.minute_extra}'`
    : (e.minute != null ? `${e.minute}'` : '·');
  const kind = momentKind(e);
  return (
    <div className={`sv-match-moment ${e.team_side ? `is-${e.team_side}` : ''}`}>
      <span className="sv-match-mmin">{min}</span>
      <span className={`sv-match-mpip sv-match-mpip--${kind}`} aria-hidden="true" />
      <div className="sv-match-mbody">
        <div className="sv-match-mhead">
          {e.player_name && <strong>{e.player_name}</strong>}
          <span className="sv-match-mtype">{e.player_name ? ' · ' : ''}{momentLabel(e)}</span>
        </div>
        {e.gloss && <div className="sv-match-mgloss">{e.gloss}</div>}
      </div>
    </div>
  );
}

// ─── RANKINGS VIEW (in-shell, lazy-loaded — Commit 1) ───────────────────────
// Team Power ⇄ Tournament MVP sub-tabs. Top-10 = blurb-forward cards (the AI
// editorial_blurbs row blurb is the centerpiece); 11+ = compact bare rows.
// Secondary metrics (record + editorial/sites, or production/impact) compact
// to one small line so the blurb gets room. Team/player rows are plain web-
// page links (NOT openMatch — they aren't matches). Built in deck CSS.

function fmtRk(n)  { return n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2); }
function fmtRk1(n) { return n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(1); }
function rankMove(label) {
  if (label === 'up')           return { cls: 'up',   txt: '▲ UP' };
  if (label === 'down')         return { cls: 'down', txt: '▼ DOWN' };
  if (label === 'hold')         return { cls: 'hold', txt: '—' };
  if (label === 'returning')    return { cls: 'new',  txt: 'RET' };
  if (label === 'needs_review') return { cls: 'hold', txt: '?' };
  return { cls: 'new', txt: 'NEW' };
}
function RankMovePill({ label }) {
  const m = rankMove(label);
  return <span className={`sv-rank-move ${m.cls}`}>{m.txt}</span>;
}

function RankingsView({ data, loading, error }) {
  const [rankLens, setRankLens] = useState('teams');
  return (
    <div className="sv-rank">
      <div className="sv-rank-controls">
        <div className="sv-sched-lenstabs" role="tablist" aria-label="Rankings list">
          {[{ k: 'teams', label: 'Team Power' }, { k: 'players', label: 'Tournament MVP' }].map((t) => (
            <button
              key={t.k}
              type="button"
              role="tab"
              aria-selected={rankLens === t.k}
              className={`sv-sched-lens ${rankLens === t.k ? 'is-on' : ''}`}
              onClick={() => setRankLens(t.k)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sv-rank-scroll">
        {loading
          ? <div className="sv-match-status-msg"><span className="sv-match-spinner" aria-hidden="true" />Loading rankings…</div>
          : error || !data
            ? <div className="sv-match-status-msg">Couldn&rsquo;t load rankings.</div>
            : <RankList list={rankLens === 'teams' ? data.teams : data.players} kind={rankLens} />}
      </div>
    </div>
  );
}

function RankList({ list, kind }) {
  if (!list || list.empty || !list.rows || list.rows.length === 0) {
    return (
      <div className="sv-rank-empty">
        {kind === 'players'
          ? 'Tournament MVP rankings begin once the tournament is underway.'
          : 'Rankings publish before the opener.'}
      </div>
    );
  }
  const top  = list.rows.filter((r) => r.rank <= 10);
  const bare = list.rows.filter((r) => r.rank > 10);
  return (
    <>
      <div className="sv-rank-edhead">
        <div className="sv-kicker">{kind === 'players' ? 'Tournament MVP' : 'Team Power'}</div>
        <div className="sv-rank-edline">
          {list.editionLabel}{list.updatedLabel ? ` · Updated ${list.updatedLabel}` : ''}
        </div>
      </div>
      <div className="sv-rank-cards">
        {top.map((r) => (kind === 'teams'
          ? <RankTeamCard key={r.rank} r={r} showPoints={list.showPoints} />
          : <RankPlayerCard key={r.rank} r={r} />))}
      </div>
      {bare.length > 0 && (
        <div className="sv-rank-bares">
          {bare.map((r) => <RankBareRow key={r.rank} r={r} kind={kind} />)}
        </div>
      )}
    </>
  );
}

function RankTeamCard({ r, showPoints }) {
  const gd = (r.gf ?? 0) - (r.ga ?? 0);
  const gdStr = gd > 0 ? `+${gd}` : `${gd}`;
  const pts = 3 * (r.wins ?? 0) + (r.draws ?? 0);
  return (
    <a className="sv-rank-card" href={`/team/${r.slug}`}>
      <div className="sv-rank-top">
        <span className="sv-rank-num">{r.rank}</span>
        <FlagSvg path={r.flag_svg_path} />
        <span className={`sv-rank-name ${r.followed ? 'sv-followed' : ''}`}>
          {r.followed && <span className="sv-star" aria-hidden="true">★</span>}{r.name}
        </span>
        <span className="sv-rank-score">{fmtRk(r.score)}</span>
        <RankMovePill label={r.movement} />
      </div>
      <div className="sv-rank-metrics">
        {r.matches_played > 0 && <span>{r.wins}-{r.draws}-{r.losses} · {gdStr}{showPoints ? ` · ${pts}p` : ''}</span>}
        <span>ED {fmtRk(r.editorial)} · SI {fmtRk(r.sites)}</span>
      </div>
      {r.blurb && <p className="sv-rank-blurb">{r.blurb}</p>}
    </a>
  );
}

function RankPlayerCard({ r }) {
  return (
    <a className="sv-rank-card" href={`/player/${r.slug}`}>
      <div className="sv-rank-top">
        <span className="sv-rank-num">{r.rank}</span>
        {r.flag_svg_path ? <FlagSvg path={r.flag_svg_path} /> : null}
        <span className={`sv-rank-name ${r.followed ? 'sv-followed' : ''}`}>
          {r.followed && <span className="sv-star" aria-hidden="true">★</span>}{r.name}
        </span>
        {r.position && <span className="sv-rank-pos">{r.position}</span>}
        <span className="sv-rank-score">{fmtRk(r.score)}</span>
        <RankMovePill label={r.movement} />
      </div>
      <div className="sv-rank-metrics">
        <span>PROD {fmtRk1(r.production)} · IMP {fmtRk1(r.impact)}</span>
      </div>
      {r.blurb && <p className="sv-rank-blurb">{r.blurb}</p>}
    </a>
  );
}

function RankBareRow({ r, kind }) {
  const href = kind === 'teams' ? `/team/${r.slug}` : `/player/${r.slug}`;
  return (
    <a className="sv-rank-bare" href={href}>
      <span className="sv-rank-bnum">{r.rank}</span>
      <FlagSvg path={r.flag_svg_path} />
      <span className={`sv-rank-bname ${r.followed ? 'sv-followed' : ''}`}>{r.name}</span>
      {kind === 'players' && r.position && <span className="sv-rank-bpos">{r.position}</span>}
      <span className="sv-rank-bscore">{fmtRk(r.score)}</span>
      <RankMovePill label={r.movement} />
    </a>
  );
}

// ─── BRACKET VIEW (in-shell, lazy-loaded — Commit 2, the last screen) ───────
// Group Stage ⇄ Knockout sub-tabs. Knockout = VERTICAL round-by-round (the web
// is a horizontal tree; this is phone-native). Resolved knockout cells (both
// sides + a slug) open the in-shell match view via openMatch; TBD/slugless
// cells are static. Group rows are plain /team web links. Built in deck CSS.

function BracketView({ data, loading, error }) {
  // Default sub-tab derives from groupStageComplete (knockout once group done),
  // with a user override. Derived (not an effect) so it's right on first paint.
  const [tab, setTab] = useState(null);
  const activeTab = tab ?? (data?.groupStageComplete ? 'knockout' : 'group');
  return (
    <div className="sv-rank">
      <div className="sv-rank-controls">
        <div className="sv-sched-lenstabs" role="tablist" aria-label="Bracket view">
          {[{ k: 'group', label: 'Group Stage' }, { k: 'knockout', label: 'Knockout' }].map((t) => (
            <button
              key={t.k}
              type="button"
              role="tab"
              aria-selected={activeTab === t.k}
              className={`sv-sched-lens ${activeTab === t.k ? 'is-on' : ''}`}
              onClick={() => setTab(t.k)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="sv-rank-scroll">
        {loading
          ? <div className="sv-match-status-msg"><span className="sv-match-spinner" aria-hidden="true" />Loading bracket…</div>
          : error || !data
            ? <div className="sv-match-status-msg">Couldn&rsquo;t load the bracket.</div>
            : activeTab === 'knockout'
              ? <KnockoutPanel rounds={data.knockout} />
              : <GroupPanel groups={data.groups} />}
      </div>
    </div>
  );
}

function KnockoutPanel({ rounds }) {
  if (!rounds || rounds.length === 0) {
    return <div className="sv-rank-empty">The knockout bracket sets after the group stage.</div>;
  }
  return (
    <>
      {rounds.map((rd) => (
        <section key={rd.stage} className="sv-bracket-round">
          <div className="sv-bracket-roundhead">
            <span className="sv-bracket-roundlabel">{rd.roundLabel}</span>
            <span className="sv-sched-dayrule" aria-hidden="true" />
            <span className="sv-bracket-roundcount">{rd.matches.length}</span>
          </div>
          <div className="sv-bracket-cells">
            {rd.matches.map((m) => <BracketCell key={m.match_number} m={m} />)}
          </div>
        </section>
      ))}
    </>
  );
}

function BracketCell({ m }) {
  const openMatch = useContext(MatchNavContext);
  const bothResolved = m.home.resolved && m.away.resolved;
  const tappable = bothResolved && m.slug && openMatch;   // gate: resolved + slug
  const inner = (
    <>
      <div className="sv-bracket-cellmeta">
        <span>{m.dateLabel}</span>
        {m.venue && <span className="sv-bracket-venue">{m.venue}</span>}
        {m.isLive ? <span className="sv-live-tag">● LIVE</span> : m.isFinal ? <span className="sv-bracket-ft">FT</span> : null}
      </div>
      <BracketSide side={m.home} score={m.home_score} show={m.isFinal || m.isLive} loser={m.winner === 'away'} />
      <BracketSide side={m.away} score={m.away_score} show={m.isFinal || m.isLive} loser={m.winner === 'home'} />
    </>
  );
  const cls = `sv-bracket-cell${bothResolved ? '' : ' is-tbd'}`;
  if (tappable) {
    return (
      <a className={cls} href={`/match/${m.slug}`} onClick={(e) => { e.preventDefault(); openMatch(m.slug); }}>
        {inner}
      </a>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function BracketSide({ side, score, show, loser }) {
  if (!side.resolved) {
    return (
      <div className="sv-bracket-side is-tbd">
        <span className="sv-flag-svg sv-flag-svg--empty" aria-hidden="true" />
        <span className="sv-bracket-slot">{side.label}</span>
      </div>
    );
  }
  return (
    <div className={`sv-bracket-side ${loser ? 'is-loser' : ''}`}>
      <FlagSvg path={side.flag_svg_path} />
      <span className={`sv-bracket-tname ${side.followed ? 'sv-followed' : ''}`}>
        {side.followed && <span className="sv-star" aria-hidden="true">★</span>}{side.name}
      </span>
      <span className="sv-bracket-tscore">{show ? (score ?? 0) : ''}</span>
    </div>
  );
}

function GroupPanel({ groups }) {
  if (!groups || groups.length === 0) {
    return <div className="sv-rank-empty">Group standings populate as matches play.</div>;
  }
  return (
    <>
      {groups.map((g) => (
        <section key={g.letter} className="sv-bracket-group">
          <div className="sv-bracket-grouphead">Group {g.letter}</div>
          <div className="sv-bracket-table">
            <div className="sv-bracket-trow sv-bracket-thead">
              <span className="sv-bracket-tpos" />
              <span className="sv-bracket-tteam" />
              <span className="sv-bracket-tnum">W-D-L</span>
              <span className="sv-bracket-tnum">GD</span>
              <span className="sv-bracket-tpts">PTS</span>
            </div>
            {g.teams.map((t) => (
              <a key={t.team_id} className="sv-bracket-trow" href={`/team/${t.slug}`}>
                <span className="sv-bracket-tpos">{t.pos}</span>
                <span className="sv-bracket-tteam">
                  <FlagSvg path={t.flag_svg_path} />
                  <span className={t.followed ? 'sv-followed' : undefined}>{t.name}</span>
                </span>
                <span className="sv-bracket-tnum">{t.wins}-{t.draws}-{t.losses}</span>
                <span className="sv-bracket-tnum">{t.gd > 0 ? `+${t.gd}` : t.gd}</span>
                <span className="sv-bracket-tpts">{t.points}</span>
              </a>
            ))}
          </div>
        </section>
      ))}
    </>
  );
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
  const openMatch = useContext(MatchNavContext);
  const right = f.isFinal
    ? `FT ${f.home_score ?? 0}–${f.away_score ?? 0}`
    : f.isLive
      ? `${f.home_score ?? 0}–${f.away_score ?? 0}`
      : f.kickoffLabel;
  // Real href kept for accessibility/fallback; tap opens the match in-shell.
  const onClick = (e) => { if (openMatch) { e.preventDefault(); openMatch(f.slug); } };
  return (
    <a className="sv-match-row" href={`/match/${f.slug}`} onClick={onClick}>
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
