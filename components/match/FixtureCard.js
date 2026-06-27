/**
 * FixtureCard — shared match card for /schedule (+ later, the homepage
 * slate). Renders the same DOM that ScheduleClient's old local
 * MatchCard rendered; the .sch-* class names continue to map back to
 * app/schedule/schedule.css. Anywhere the card is consumed needs the
 * schedule.css selectors in its critical path — that's why /schedule
 * works straight off, and why the homepage will need to either import
 * or alias those styles when Step 3b lands.
 *
 * Server-compatible — no hooks, no client-only APIs. KickoffTime is a
 * client island that hydrates on its own.
 *
 * Prop contract (matches what readFixturesByPtDay shapes today):
 *   f: {
 *     id, slug, status, kickoff_at, stage, group_code,
 *     home_score, away_score,
 *     home: { name, abbreviation, flag_svg_path, flag_color, ... },
 *     away: { name, abbreviation, flag_svg_path, flag_color, ... },
 *     goals: { home: string[], away: string[] }
 *   }
 *
 * bucketOf is exported so ScheduleClient can keep using it for its
 * status filter + section grouping without duplicating the definition.
 */

import KickoffTime from './KickoffTime';
import FlagSlot from '../FlagSlot';
import './fixture-card.css';

export function bucketOf(status) {
  if (status === 'live')      return 'live';
  if (status === 'final')     return 'final';
  if (status === 'cancelled') return 'cancelled';
  return 'upcoming';
}

function statusLabel(f) {
  if (f.status === 'live')      return 'LIVE';
  if (f.status === 'final')     return 'FULL TIME';
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

// One matchup side. A resolved side (real team) renders exactly as the card
// always has: flag + name + score. An unresolved knockout side (null team —
// surfaced on /schedule via the reader's LEFT JOIN + slot label) renders in
// label mode: empty flag slot + the slot label (e.g. "1D", "W73", "3rd
// B/E/F/I/J") + a dash, mirroring /bracket's KnockoutTeamRow. INNER-JOIN
// callers (homepage/app) always pass a resolved side, so they hit the
// unchanged path. `resolved` is the reader's flag; fall back to an id check
// for callers that don't set it.
function SideRow({ f, side, followedSet }) {
  const t = f[side];
  const isResolved = t?.resolved ?? (t?.id != null);
  if (isResolved) {
    const followed = followedSet?.has(t.id);
    return (
      <div className="sch-row">
        <FlagSlot flagSvgPath={t.flag_svg_path} colorPrimary={t.flag_color} size="md" />
        <span className={`sch-nm ${loserClass(f, side)}${followed ? ' team-name-followed' : ''}`}>{t.name}</span>
        <span className={`sch-sc ${loserClass(f, side)}`}>{scoreOrDash(f, side)}</span>
      </div>
    );
  }
  return (
    <div className="sch-row sch-row-tbd">
      <span className="sch-flag-tbd" aria-hidden="true" />
      <span className="sch-nm sch-nm-tbd">{t?.label ?? 'TBD'}</span>
      <span className="sch-sc">{'—'}</span>
    </div>
  );
}

export default function FixtureCard({ f, followedSet }) {
  const bucket = bucketOf(f.status);
  const isLive = bucket === 'live';
  const isCancelled = bucket === 'cancelled';
  const cardCls = ['sch-card', isLive ? 'is-live' : '', isCancelled ? 'is-cancelled' : ''].filter(Boolean).join(' ');
  const hasGoals = (f.goals.home.length + f.goals.away.length) > 0;
  // followedSet is optional — FixtureCard is shared and may be used in
  // places that don't pass it. SideRow resolves the per-side follow tint
  // (and the global rule's !important keeps the loser-class color from
  // winning the cascade when a followed team has lost).
  return (
    <a className={cardCls} href={`/match/${f.slug}`}>
      <div className="sch-matchup">
        <SideRow f={f} side="home" followedSet={followedSet} />
        <SideRow f={f} side="away" followedSet={followedSet} />
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
