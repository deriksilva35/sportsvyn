'use client';

/**
 * ScheduleClient — lens engine for /schedule. Implements the locked
 * sportsvyn-scores-worldcup-v1.html mock:
 *   - Lens: Today | This Week | Following
 *   - Scrubber (Today lens only): ±3 days around today PT
 *   - Status filter: All / Live / Upcoming / Final (+ Cancelled grouping)
 *   - Match card: flags via FlagSlot, KickoffTime client island for
 *     local TZ, unpriced win-prob placeholder, optional goal lines on
 *     live/final.
 *
 * Tournament furniture (stage filter, group chips A–L, standings) is
 * structural-only here — gated behind showWcTournamentFurniture and
 * unrendered for international-friendlies. The WC slice activates it.
 *
 * Watch Score is intentionally absent (separate slice — no fabrication).
 * The mock's WS pill + WS sort toggle are not rendered.
 */

import { useMemo, useState } from 'react';
import KickoffTime from '@/components/match/KickoffTime';
import FlagSlot from '@/components/FlagSlot';

// Map DB match.status → render bucket. Live and final are pass-through;
// scheduled becomes "upcoming"; cancelled gets its own bucket (the mock
// doesn't define this — added per spec so we don't silently drop
// cancelled fixtures).
function bucketOf(status) {
  if (status === 'live') return 'live';
  if (status === 'final') return 'final';
  if (status === 'cancelled') return 'cancelled';
  return 'upcoming';
}

// Group fixtures by PT day (from the server-computed pt_day) and
// preserve the time order within each day.
function groupByPtDay(fixtures) {
  const out = new Map();
  for (const f of fixtures) {
    if (!out.has(f.pt_day)) out.set(f.pt_day, []);
    out.get(f.pt_day).push(f);
  }
  return out;
}

function statusLabel(f) {
  if (f.status === 'live') return 'LIVE';
  if (f.status === 'final') return 'FULL TIME';
  if (f.status === 'cancelled') return 'CANCELLED';
  return null; // upcoming → kickoff time renders via KickoffTime
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
  const isFinal = bucket === 'final';
  const cardCls = [
    'sch-card',
    isLive ? 'is-live' : '',
    isCancelled ? 'is-cancelled' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const hasGoals = (f.goals.home.length + f.goals.away.length) > 0;

  return (
    <a className={cardCls} href={`/match/${f.slug}`}>
      <div className="sch-matchup">
        <div className="sch-row">
          <FlagSlot
            flagSvgPath={f.home.flag_svg_path}
            colorPrimary={f.home.flag_color}
            size="md"
          />
          <span className={`sch-nm ${loserClass(f, 'home')}`}>{f.home.name}</span>
          <span className={`sch-sc ${loserClass(f, 'home')}`}>{scoreOrDash(f, 'home')}</span>
        </div>
        <div className="sch-row">
          <FlagSlot
            flagSvgPath={f.away.flag_svg_path}
            colorPrimary={f.away.flag_color}
            size="md"
          />
          <span className={`sch-nm ${loserClass(f, 'away')}`}>{f.away.name}</span>
          <span className={`sch-sc ${loserClass(f, 'away')}`}>{scoreOrDash(f, 'away')}</span>
        </div>
        {hasGoals && (
          <div className="sch-goals">
            <div className="sch-goals-col">
              {f.goals.home.map((g, i) => (
                <div key={`h-${i}`} className="sch-goal">
                  <span className="sch-goal-pip" />
                  <span>{g}</span>
                </div>
              ))}
            </div>
            <div className="sch-goals-col away">
              {f.goals.away.map((g, i) => (
                <div key={`a-${i}`} className="sch-goal away">
                  <span className="sch-goal-pip" />
                  <span>{g}</span>
                </div>
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
        {/* Unpriced WP — friendlies carry no odds. Mock's already-designed
            unpriced state (italic serif "Not yet priced · fills near
            kickoff"). NEVER rendered for final/cancelled. */}
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
        {items.map((f) => (
          <MatchCard key={f.id} f={f} />
        ))}
      </div>
    </>
  );
}

function renderTodayLens(fixtures, statusFilter, ptDay) {
  const todays = fixtures.filter((f) => f.pt_day === ptDay);
  let list = todays;
  if (statusFilter !== 'all') {
    list = list.filter((f) => bucketOf(f.status) === statusFilter);
  }
  if (list.length === 0) {
    return (
      <div className="sch-empty">No matches match these filters.</div>
    );
  }
  const grouped = {
    live: list.filter((f) => bucketOf(f.status) === 'live'),
    upcoming: list.filter((f) => bucketOf(f.status) === 'upcoming'),
    final: list.filter((f) => bucketOf(f.status) === 'final'),
    cancelled: list.filter((f) => bucketOf(f.status) === 'cancelled'),
  };
  return (
    <>
      <StatusSection title="Live Now" items={grouped.live} modifier="live" />
      <StatusSection title="Upcoming" items={grouped.upcoming} />
      <StatusSection title="Full Time" items={grouped.final} />
      <StatusSection title="Cancelled" items={grouped.cancelled} modifier="cancelled" />
    </>
  );
}

function renderWeekLens(fixtures, statusFilter, scrubberDays) {
  let list = fixtures;
  if (statusFilter !== 'all') {
    list = list.filter((f) => bucketOf(f.status) === statusFilter);
  }
  const grouped = groupByPtDay(list);
  const dayOrder = scrubberDays.map((d) => d.ptDate);
  const sections = [];
  for (const day of dayOrder) {
    const items = grouped.get(day);
    if (!items || items.length === 0) continue;
    const sd = scrubberDays.find((d) => d.ptDate === day);
    const heading = `${sd.weekday} · ${sd.label}${sd.isCenter ? ' · Today' : ''}`;
    sections.push(
      <div key={day} className="sch-daygroup">
        <div className="sch-dayhead">
          <span>{heading}</span>
          <span className="sch-dayhead-ct">
            {items.length} {items.length === 1 ? 'match' : 'matches'}
          </span>
        </div>
        {items.map((f) => (
          <MatchCard key={f.id} f={f} />
        ))}
      </div>
    );
  }
  if (sections.length === 0) {
    return <div className="sch-empty">No matches in this week match these filters.</div>;
  }
  return <>{sections}</>;
}

function renderFollowingLens() {
  // Following is the WC-slice lens. On friendlies it's an honest
  // placeholder; the team-filter chip strip + the per-team timeline
  // light up once the WC import seeds the 48 nations + their group
  // games. Building the lens button + structure now so the WC slice is
  // a fill-in, not a new feature.
  return (
    <div className="sch-empty">
      Following nations · coming with the World Cup slate.
      <br />
      One nation will show its full path, several blend into a single timeline.
    </div>
  );
}

export default function ScheduleClient({
  fixtures,
  scrubberDays,
  defaultPtDay,
  showWcTournamentFurniture,
  kickerText,
  subheadText,
}) {
  const [lens, setLens] = useState('today');
  const [ptDay, setPtDay] = useState(defaultPtDay);
  const [statusFilter, setStatusFilter] = useState('all');

  const content = useMemo(() => {
    if (lens === 'today') return renderTodayLens(fixtures, statusFilter, ptDay);
    if (lens === 'week') return renderWeekLens(fixtures, statusFilter, scrubberDays);
    return renderFollowingLens();
  }, [lens, ptDay, statusFilter, fixtures, scrubberDays]);

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
            { key: 'today', label: 'Today' },
            { key: 'week', label: 'This Week' },
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

        {lens === 'today' && (
          <div className="sch-scrub">
            {scrubberDays.map((d) => (
              <button
                key={d.ptDate}
                type="button"
                className={d.ptDate === ptDay ? 'active' : undefined}
                onClick={() => setPtDay(d.ptDate)}
              >
                <span className="sch-scrub-d">
                  {d.weekday}
                  {d.isCenter ? ' · Today' : ''}
                </span>
                <span className="sch-scrub-n">{d.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Tournament-only filter rows — built but only rendered when a
          WC-stage league activates the prop. The structure here means
          turning on the WC slice is a one-line page-level flip. */}
      {showWcTournamentFurniture && (
        <>
          <div className="sch-filters">
            <span className="sch-flabel">Stage</span>
            <button className="sch-chip on" type="button">All</button>
            <button className="sch-chip" type="button">Group Stage</button>
            <button className="sch-chip" type="button">Round of 32</button>
            <button className="sch-chip" type="button">Round of 16</button>
            <button className="sch-chip" type="button">Quarters</button>
            <button className="sch-chip" type="button">Semis</button>
            <button className="sch-chip" type="button">Final</button>
          </div>
          <div className="sch-filters row2">
            <span className="sch-flabel">Group</span>
            <button className="sch-chip sch-chip-gp on" type="button">All</button>
            {['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].map((g) => (
              <button key={g} type="button" className="sch-chip sch-chip-gp">
                {g}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="sch-filters status-only">
        <span className="sch-flabel">Status</span>
        {[
          { k: 'all', label: 'All' },
          { k: 'live', label: 'Live' },
          { k: 'upcoming', label: 'Upcoming' },
          { k: 'final', label: 'Final' },
          { k: 'cancelled', label: 'Cancelled' },
        ].map((s) => (
          <button
            key={s.k}
            type="button"
            className={`sch-chip${statusFilter === s.k ? ' on' : ''}`}
            onClick={() => setStatusFilter(s.k)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="sch-content">{content}</div>
    </div>
  );
}
