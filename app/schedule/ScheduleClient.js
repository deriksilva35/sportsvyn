'use client';

/**
 * ScheduleClient — lens engine for /schedule.
 *
 * STEP 2.5 layout: compressed header → tabs → CONTROL BAR (windowed
 * 7-day scrubber with ‹ › arrows + match-day dots, plus inline Stage /
 * Group / Status dropdowns on the right) → content.
 *
 * Filter logic (applyTournamentFilters + status filter) is unchanged
 * from Step 2 — only the controls' visual presentation moved. State is
 * still the same useState hooks; ?stage and ?group still mirror to URL
 * via router.replace.
 *
 * Scrubber: the page loads the entire tournament range. The scrubber
 * shows a 7-day window that slides over those days via ‹ ›; tapping a
 * day selects it (selection independent of window slide). Arrows
 * disable at tournament edges so the window can't run into empty
 * months.
 *
 * Match-day dots: any day that has at least one fixture in the loaded
 * set gets a small volt pip under it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import KickoffTime from '@/components/match/KickoffTime';
import FlagSlot from '@/components/FlagSlot';

// ─── DATE HELPERS (PT-string arithmetic without timezone drift) ──────────

const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function ptDateFromStr(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function ptDateToStr(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function addDays(s, n) {
  const d = ptDateFromStr(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ptDateToStr(d);
}
function clampDate(d, lo, hi) {
  if (d < lo) return lo;
  if (d > hi) return hi;
  return d;
}
function dayMeta(s, isCenterDay) {
  const d = ptDateFromStr(s);
  return {
    ptDate: s,
    weekday: WEEKDAYS[d.getUTCDay()],
    label: `${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`,
    isCenter: isCenterDay,
  };
}

// ─── STAGE LABELS ────────────────────────────────────────────────────────

const STAGE_LABELS = {
  group: 'Group Stage',
  'round-of-32': 'Round of 32',
  'round-of-16': 'Round of 16',
  quarters: 'Quarters',
  quarterfinals: 'Quarters',
  semis: 'Semis',
  semifinals: 'Semis',
  final: 'Final',
  'third-place': 'Third Place',
};
function stageLabel(s) {
  if (STAGE_LABELS[s]) return STAGE_LABELS[s];
  return String(s)
    .split(/[-_]/g)
    .map((p) => (p.length ? p[0].toUpperCase() + p.slice(1) : p))
    .join(' ');
}
const STAGE_ORDER = ['group','round-of-32','round-of-16','quarters','quarterfinals','semis','semifinals','third-place','final'];

const GROUP_LETTERS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

const STATUS_OPTIONS = [
  { k: 'all',       label: 'All' },
  { k: 'live',      label: 'Live' },
  { k: 'upcoming',  label: 'Upcoming' },
  { k: 'final',     label: 'Final' },
  { k: 'cancelled', label: 'Cancelled' },
];

// ─── RENDER HELPERS ──────────────────────────────────────────────────────

function bucketOf(status) {
  if (status === 'live')      return 'live';
  if (status === 'final')     return 'final';
  if (status === 'cancelled') return 'cancelled';
  return 'upcoming';
}

function groupByPtDay(fixtures) {
  const out = new Map();
  for (const f of fixtures) {
    if (!out.has(f.pt_day)) out.set(f.pt_day, []);
    out.get(f.pt_day).push(f);
  }
  return out;
}

function statusLabel(f) {
  if (f.status === 'live')      return 'LIVE';
  if (f.status === 'final')     return 'FULL TIME';
  if (f.status === 'cancelled') return 'CANCELLED';
  return null;
}

function scoreOrDash(f, side) {
  if (f.status === 'cancelled') return '';
  if (f[`${side}_score`] == null) return '';
  return f[`${side}_score`];
}

function loserClass(f, side) {
  if (f.status !== 'final') return '';
  const h = f.home_score ?? 0;
  const a = f.away_score ?? 0;
  if (h === a) return '';
  if (side === 'home' && a > h) return 'lose';
  if (side === 'away' && h > a) return 'lose';
  return '';
}

function MatchCard({ f }) {
  const bucket = bucketOf(f.status);
  const isLive = bucket === 'live';
  const isCancelled = bucket === 'cancelled';
  const cardCls = ['sch-card', isLive ? 'is-live' : '', isCancelled ? 'is-cancelled' : ''].filter(Boolean).join(' ');
  const hasGoals = (f.goals.home.length + f.goals.away.length) > 0;
  return (
    <a className={cardCls} href={`/match/${f.slug}`}>
      <div className="sch-matchup">
        <div className="sch-row">
          <FlagSlot flagSvgPath={f.home.flag_svg_path} colorPrimary={f.home.flag_color} size="md" />
          <span className={`sch-nm ${loserClass(f, 'home')}`}>{f.home.name}</span>
          <span className={`sch-sc ${loserClass(f, 'home')}`}>{scoreOrDash(f, 'home')}</span>
        </div>
        <div className="sch-row">
          <FlagSlot flagSvgPath={f.away.flag_svg_path} colorPrimary={f.away.flag_color} size="md" />
          <span className={`sch-nm ${loserClass(f, 'away')}`}>{f.away.name}</span>
          <span className={`sch-sc ${loserClass(f, 'away')}`}>{scoreOrDash(f, 'away')}</span>
        </div>
        {hasGoals && (
          <div className="sch-goals">
            <div className="sch-goals-col">
              {f.goals.home.map((g, i) => (
                <div key={`h-${i}`} className="sch-goal"><span className="sch-goal-pip" /><span>{g}</span></div>
              ))}
            </div>
            <div className="sch-goals-col away">
              {f.goals.away.map((g, i) => (
                <div key={`a-${i}`} className="sch-goal away"><span className="sch-goal-pip" /><span>{g}</span></div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="sch-meta">
        <div className={`sch-status ${bucket}`}>
          {isLive && <span className="sch-dot sch-pulse" aria-hidden="true" />}
          <span className="sch-status-txt">
            {statusLabel(f) ?? <KickoffTime kickoffAt={f.kickoff_at} />}
          </span>
        </div>
        {(bucket === 'upcoming' || bucket === 'live') && (
          <div className="sch-wp3 unpriced">
            <div className="sch-wp3-label">Win Probability</div>
            <div className="sch-wp3-note">Not yet priced · fills near kickoff</div>
          </div>
        )}
      </div>
    </a>
  );
}

function StatusSection({ title, items, modifier }) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="sch-seclabel">
        <span className={`sch-seclabel-lbl ${modifier ?? ''}`}>{title}</span>
        <span className="sch-seclabel-line" />
        <span className="sch-seclabel-ct">{items.length}</span>
      </div>
      <div className="sch-feed">
        {items.map((f) => <MatchCard key={f.id} f={f} />)}
      </div>
    </>
  );
}

// Pure filter — STEP 2 LOGIC PRESERVED.
function applyTournamentFilters(fixtures, stageFilter, groupFilter) {
  let list = fixtures;
  if (stageFilter !== 'all') list = list.filter((f) => f.stage === stageFilter);
  if (groupFilter !== 'all') list = list.filter((f) => f.group_code === groupFilter);
  return list;
}

function renderTodayLens(fixtures, statusFilter, stageFilter, groupFilter, ptDay) {
  const filtered = applyTournamentFilters(fixtures, stageFilter, groupFilter);
  const todays = filtered.filter((f) => f.pt_day === ptDay);
  let list = todays;
  if (statusFilter !== 'all') list = list.filter((f) => bucketOf(f.status) === statusFilter);
  if (list.length === 0) {
    return <div className="sch-empty">No matches match these filters.</div>;
  }
  const grouped = {
    live:      list.filter((f) => bucketOf(f.status) === 'live'),
    upcoming:  list.filter((f) => bucketOf(f.status) === 'upcoming'),
    final:     list.filter((f) => bucketOf(f.status) === 'final'),
    cancelled: list.filter((f) => bucketOf(f.status) === 'cancelled'),
  };
  return (
    <>
      <StatusSection title="Live Now"  items={grouped.live}      modifier="live" />
      <StatusSection title="Upcoming"  items={grouped.upcoming} />
      <StatusSection title="Full Time" items={grouped.final} />
      <StatusSection title="Cancelled" items={grouped.cancelled} modifier="cancelled" />
    </>
  );
}

function renderWeekLens(fixtures, statusFilter, stageFilter, groupFilter, windowDays, todayPt) {
  let list = applyTournamentFilters(fixtures, stageFilter, groupFilter);
  if (statusFilter !== 'all') list = list.filter((f) => bucketOf(f.status) === statusFilter);
  const grouped = groupByPtDay(list);
  const sections = [];
  for (const day of windowDays) {
    const items = grouped.get(day.ptDate);
    if (!items || items.length === 0) continue;
    const heading = `${day.weekday} · ${day.label}${day.ptDate === todayPt ? ' · Today' : ''}`;
    sections.push(
      <div key={day.ptDate} className="sch-daygroup">
        <div className="sch-dayhead">
          <span>{heading}</span>
          <span className="sch-dayhead-ct">{items.length} {items.length === 1 ? 'match' : 'matches'}</span>
        </div>
        {items.map((f) => <MatchCard key={f.id} f={f} />)}
      </div>
    );
  }
  if (sections.length === 0) {
    return <div className="sch-empty">No matches in this week match these filters.</div>;
  }
  return <>{sections}</>;
}

function renderFollowingLens() {
  return (
    <div className="sch-empty">
      Following nations · coming with the World Cup slate.
      <br />
      One nation will show its full path, several blend into a single timeline.
    </div>
  );
}

// ─── DROPDOWN PRIMITIVE ──────────────────────────────────────────────────

function Dropdown({ label, valueLabel, isActive, children, panelClass = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className={`sch-dd${open ? ' open' : ''}${isActive ? ' active' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="sch-dd-btn"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sch-dd-label">{label}</span>
        <span className="sch-dd-sep">·</span>
        <span className="sch-dd-value">{valueLabel}</span>
        <span className="sch-dd-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className={`sch-dd-panel ${panelClass}`} role="menu" onClick={(e) => e.stopPropagation()}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────

export default function ScheduleClient({
  fixtures,
  defaultPtDay,
  tournamentStart,
  tournamentEnd,
  showWcTournamentFurniture,
  initialStageFilter = 'all',
  initialGroupFilter = 'all',
  initialStatusFilter = 'all',
  kickerText,
  subheadText,
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [lens, setLens] = useState('today');
  // Selected day clamped into tournament range (today may be pre-tournament).
  const initialSelectedDay = clampDate(defaultPtDay, tournamentStart, tournamentEnd);
  const [ptDay, setPtDay] = useState(initialSelectedDay);

  const [statusFilter, setStatusFilter] = useState(initialStatusFilter);
  const [stageFilter,  setStageFilter]  = useState(initialStageFilter);
  const [groupFilter,  setGroupFilter]  = useState(initialGroupFilter);

  // Window state: 7-day strip's left-edge date. Slides by ±7 via arrows.
  // Initial window aligns to the selected day where possible.
  const windowSize = 7;
  const lastWindowStart = addDays(tournamentEnd, -(windowSize - 1));
  const initialWindowStart = clampDate(initialSelectedDay, tournamentStart, lastWindowStart);
  const [windowStart, setWindowStart] = useState(initialWindowStart);

  // Mirror filter state to the URL — STEP 2 LOGIC PRESERVED.
  useEffect(() => {
    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    if (stageFilter  === 'all') params.delete('stage');  else params.set('stage',  stageFilter);
    if (groupFilter  === 'all') params.delete('group');  else params.set('group',  groupFilter);
    if (statusFilter === 'all') params.delete('status'); else params.set('status', statusFilter);
    const q = params.toString();
    router.replace(`${pathname}${q ? `?${q}` : ''}`, { scroll: false });
  }, [stageFilter, groupFilter, statusFilter, pathname, router]);

  // Derived: distinct stages present (drives stage chip list dynamically).
  const availableStages = useMemo(() => {
    const set = new Set();
    for (const f of fixtures) if (f.stage) set.add(f.stage);
    return [...set].sort((a, b) => {
      const ia = STAGE_ORDER.indexOf(a);
      const ib = STAGE_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
  }, [fixtures]);

  // Derived: PT-day set with at least one match (for the match-day dots).
  const matchDaySet = useMemo(() => {
    const s = new Set();
    for (const f of fixtures) s.add(f.pt_day);
    return s;
  }, [fixtures]);

  // Build the visible 7-day strip from windowStart.
  const windowDays = useMemo(() => {
    const days = [];
    const todayPt = defaultPtDay;
    for (let i = 0; i < windowSize; i++) {
      const d = addDays(windowStart, i);
      days.push(dayMeta(d, d === todayPt));
    }
    return days;
  }, [windowStart, defaultPtDay]);

  const canBack    = windowStart > tournamentStart;
  const canForward = windowStart < lastWindowStart;
  function slideBack()    { if (canBack)    setWindowStart(clampDate(addDays(windowStart, -windowSize), tournamentStart, lastWindowStart)); }
  function slideForward() { if (canForward) setWindowStart(clampDate(addDays(windowStart,  windowSize), tournamentStart, lastWindowStart)); }

  const content = useMemo(() => {
    if (lens === 'today') return renderTodayLens(fixtures, statusFilter, stageFilter, groupFilter, ptDay);
    if (lens === 'week')  return renderWeekLens(fixtures, statusFilter, stageFilter, groupFilter, windowDays, defaultPtDay);
    return renderFollowingLens();
  }, [lens, ptDay, statusFilter, stageFilter, groupFilter, fixtures, windowDays, defaultPtDay]);

  // Active-state booleans for the dropdown highlight.
  const stageActive  = stageFilter  !== 'all';
  const groupActive  = groupFilter  !== 'all';
  const statusActive = statusFilter !== 'all';

  // Display labels for the dropdown values.
  const stageValueLabel  = stageActive  ? stageLabel(stageFilter)                          : 'All';
  const groupValueLabel  = groupActive  ? groupFilter                                      : 'All';
  const statusValueLabel = statusActive ? (STATUS_OPTIONS.find((s) => s.k === statusFilter)?.label ?? statusFilter) : 'All';

  return (
    <div className="sch-shell">
      <div className="sch-pagehead">
        <div className="sch-kicker">{kickerText}</div>
        <h1 className="sch-title">
          Scores <span className="sch-title-ctx">&amp; Schedule</span>
        </h1>
        {subheadText && <div className="sch-subhead">{subheadText}</div>}

        <div className="sch-lens" role="tablist" aria-label="Schedule lens">
          {[
            { key: 'today',     label: 'Today' },
            { key: 'week',      label: 'This Week' },
            { key: 'following', label: 'Following' },
          ].map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-selected={lens === l.key}
              className={lens === l.key ? 'active' : undefined}
              onClick={() => setLens(l.key)}
            >
              {l.label}
            </button>
          ))}
        </div>

        {(lens === 'today' || lens === 'week') && (
          <div className="sch-controlbar">
            <div className="sch-scrubwrap">
              <button
                type="button"
                className="sch-arrow"
                aria-label="Previous week"
                disabled={!canBack}
                onClick={slideBack}
              >
                ‹
              </button>
              <div className="sch-scrub">
                {windowDays.map((d) => {
                  const isActiveDay = d.ptDate === ptDay && lens === 'today';
                  const hasMatch = matchDaySet.has(d.ptDate);
                  return (
                    <button
                      key={d.ptDate}
                      type="button"
                      className={isActiveDay ? 'active' : undefined}
                      onClick={() => setPtDay(d.ptDate)}
                    >
                      <span className="sch-scrub-d">
                        {d.weekday}{d.isCenter ? ' · Today' : ''}
                      </span>
                      <span className="sch-scrub-n">{d.label}</span>
                      {hasMatch && <span className="sch-scrub-dot" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="sch-arrow"
                aria-label="Next week"
                disabled={!canForward}
                onClick={slideForward}
              >
                ›
              </button>
            </div>

            <div className="sch-ddrow">
              {showWcTournamentFurniture && (
                <>
                  <Dropdown label="Stage" valueLabel={stageValueLabel} isActive={stageActive}>
                    {(close) => (
                      <ul className="sch-dd-list">
                        <li>
                          <button
                            type="button"
                            className={stageFilter === 'all' ? 'is-on' : undefined}
                            onClick={() => { setStageFilter('all'); close(); }}
                          >
                            All
                          </button>
                        </li>
                        {availableStages.map((s) => (
                          <li key={s}>
                            <button
                              type="button"
                              className={stageFilter === s ? 'is-on' : undefined}
                              onClick={() => { setStageFilter(s); close(); }}
                            >
                              {stageLabel(s)}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Dropdown>

                  <Dropdown label="Group" valueLabel={groupValueLabel} isActive={groupActive} panelClass="sch-dd-grouppanel">
                    {(close) => (
                      <>
                        <button
                          type="button"
                          className={`sch-dd-gpall${groupFilter === 'all' ? ' is-on' : ''}`}
                          onClick={() => { setGroupFilter('all'); close(); }}
                        >
                          All groups
                        </button>
                        <div className="sch-dd-gpgrid">
                          {GROUP_LETTERS.map((g) => (
                            <button
                              key={g}
                              type="button"
                              className={`sch-dd-gpcell${groupFilter === g ? ' is-on' : ''}`}
                              onClick={() => { setGroupFilter(g); close(); }}
                            >
                              {g}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </Dropdown>
                </>
              )}

              <Dropdown label="Status" valueLabel={statusValueLabel} isActive={statusActive}>
                {(close) => (
                  <ul className="sch-dd-list">
                    {STATUS_OPTIONS.map((s) => (
                      <li key={s.k}>
                        <button
                          type="button"
                          className={statusFilter === s.k ? 'is-on' : undefined}
                          onClick={() => { setStatusFilter(s.k); close(); }}
                        >
                          {s.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Dropdown>
            </div>
          </div>
        )}
      </div>

      <div className="sch-content">{content}</div>
    </div>
  );
}
